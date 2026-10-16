/** 뷰어 그래프: UI 상태·검색·mode persist (로딩 파이프라인은 useViewerGraphPipeline) */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  saveViewerMode,
  resolveInitialGraphFullScreen,
  resolvePersistedViewerMode,
  isHardNavigationReload,
  eventMatchesChapter,
} from '../../utils/viewer/viewerSession';
import { buildChapterCharacterSearchData, VIEWER_GRAPH_PIPELINE } from '../../utils/viewer/viewerGraph';
import { useGraphSearch, useGraphDisplayToggles } from '../graph/useGraphViewState';

/** 그래프 로딩 단계 (reloading > event > loading > idle) */
function deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }) {
  if (isReloading) return 'reloading';
  if (isEventGraphLoading) return 'event';
  if (isGraphLoading) return 'loading';
  return 'idle';
}

const { HARD_RELOAD_SETTLE_MS } = VIEWER_GRAPH_PIPELINE;

const INITIAL_GRAPH_LOAD = {
  isDataReady: false,
  isGraphLoading: true,
  isEventGraphLoading: false,
  appliedGraphKey: null,
  isDataEmpty: false,
};

/** 그래프 로딩 플래그는 이 reducer에서만 바뀐다 — 플래그 조합을 액션 단위로 고정 */
function graphLoadReducer(state, action) {
  let next;
  switch (action.type) {
    case 'bookReset':
      next = { isDataReady: false, isGraphLoading: true, isEventGraphLoading: true, appliedGraphKey: null, isDataEmpty: true };
      break;
    case 'chapterChanged':
      next = { isDataReady: false, isGraphLoading: true, isEventGraphLoading: true, appliedGraphKey: null };
      break;
    case 'pending':
      next = { isDataReady: false, isEventGraphLoading: true, appliedGraphKey: null };
      break;
    case 'retry':
      next = { isEventGraphLoading: true, appliedGraphKey: null };
      break;
    case 'applied':
      next = { appliedGraphKey: action.key ?? null };
      break;
    case 'finished':
      next = { isDataReady: action.ready, isEventGraphLoading: action.loading };
      break;
    case 'discoveryLoading':
      next = { isGraphLoading: action.loading };
      break;
    case 'empty':
      next = { isDataEmpty: action.empty };
      break;
    default:
      return state;
  }
  return Object.keys(next).every((k) => state[k] === next[k]) ? state : { ...state, ...next };
}

export function useViewerGraphState({
  currentChapter,
  bookKey,
  showGraph,
}) {
  const [currentEvent, setCurrentEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [prevValidEvent, setPrevValidEvent] = useState(null);
  const [graphFullScreen, setGraphFullScreen] = useState(() =>
    resolveInitialGraphFullScreen(showGraph),
  );
  const {
    edgeLabelVisible,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
  } = useGraphDisplayToggles();
  const [isReloading, setIsReloading] = useState(false);
  const [elements, setElements] = useState([]);
  const [graphLoad, dispatchGraphLoad] = useReducer(graphLoadReducer, INITIAL_GRAPH_LOAD);
  const { isDataReady, isGraphLoading, isEventGraphLoading, appliedGraphKey, isDataEmpty } = graphLoad;

  const currentChapterData = useMemo(
    () => buildChapterCharacterSearchData(events, currentChapter),
    [events, currentChapter],
  );

  const graphPhase = useMemo(
    () => deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }),
    [isReloading, isEventGraphLoading, isGraphLoading],
  );

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);

  useEffect(() => {
    saveViewerMode(resolvePersistedViewerMode(graphFullScreen, showGraph));
  }, [showGraph, graphFullScreen]);

  // 그래프를 끄면 전체화면 해제 (렌더 중 조정 → 중간 커밋 없음)
  if (!showGraph && graphFullScreen) setGraphFullScreen(false);

  // 챕터·이벤트 정합성은 렌더 중 조정 — 새 챕터 + 이전 이벤트 조합이 커밋되지 않게 함
  if (currentEvent) {
    if (!eventMatchesChapter(currentEvent, currentChapter)) {
      setCurrentEvent(null);
      setPrevValidEvent(null);
    } else if (prevValidEvent !== currentEvent) {
      setPrevValidEvent(currentEvent);
    }
  }

  const resetGraphPipelineState = useCallback(() => {
    setEvents([]);
    setElements([]);
    dispatchGraphLoad({ type: 'bookReset' });
  }, []);

  const resetGraphTransientState = useCallback(() => {
    setCurrentEvent(null);
    setPrevValidEvent(null);
    resetGraphPipelineState();
  }, [resetGraphPipelineState]);

  // 책 변경 hard reset
  useEffect(() => {
    resetGraphPipelineState();
  }, [bookKey, resetGraphPipelineState]);

  // 챕터 전환 중에도 기존 요소를 유지하고, 다음 스냅샷 적용 시 id diff로 증감만 반영한다.
  const [graphChapter, setGraphChapter] = useState(currentChapter);
  if (graphChapter !== currentChapter) {
    setGraphChapter(currentChapter);
    if (currentChapter != null) dispatchGraphLoad({ type: 'chapterChanged' });
  }

  useEffect(() => {
    if (!isHardNavigationReload()) return undefined;

    setIsReloading(true);
    resetGraphTransientState();
    setGraphFullScreen(resolveInitialGraphFullScreen());

    const timer = setTimeout(() => {
      setIsReloading(false);
      dispatchGraphLoad({ type: 'discoveryLoading', loading: false });
    }, HARD_RELOAD_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [resetGraphTransientState]);

  const graphState = useMemo(
    () => ({
      currentChapter,
      currentEvent,
      prevValidEvent,
      elements,
      edgeLabelVisible,
      graphFullScreen,
      showGraph: Boolean(showGraph),
    }),
    [
      currentChapter,
      currentEvent,
      prevValidEvent,
      elements,
      edgeLabelVisible,
      graphFullScreen,
      showGraph,
    ],
  );

  const graphActions = useMemo(
    () => ({
      setGraphFullScreen,
      setEdgeLabelVisible,
      filterStage,
      setFilterStage,
    }),
    [filterStage, setEdgeLabelVisible, setFilterStage],
  );

  const graphViewerState = useMemo(
    () => ({ graphPhase, isDataReady, isDataEmpty, appliedGraphKey }),
    [graphPhase, isDataReady, isDataEmpty, appliedGraphKey],
  );

  return {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    dispatchGraphLoad,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  };
}

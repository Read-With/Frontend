/** 뷰어 그래프 UI·파이프라인 상태 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useGraphSearch } from '../graph/useGraphViewHooks';
import { eventMatchesChapter } from '../../utils/viewer/viewerEventProgressUtils';
import { aggregateCharactersFromEvents } from '../../utils/graph/characterUtils';
import {
  saveViewerMode,
  resolveInitialGraphFullScreen,
  eventUtils,
} from '../../utils/viewer/viewerCoreStateUtils';

const HARD_RELOAD_SETTLE_MS = 1000;

function deriveGraphPhase({ isReloading, isFineGraphLoading, isGraphLoading }) {
  if (isReloading) return 'reloading';
  if (isFineGraphLoading) return 'fine';
  if (isGraphLoading) return 'loading';
  return 'idle';
}

function resolvePersistedViewerMode(graphFullScreen, showGraph) {
  if (graphFullScreen) return 'graph';
  if (showGraph) return 'split';
  return 'viewer';
}

function isHardNavigationReload() {
  if (!performance?.getEntriesByType) return false;
  const [entry] = performance.getEntriesByType('navigation');
  return entry?.type === 'reload';
}

/** showGraph는 settings(SSOT). 이 훅은 UI 반영·fullscreen persist만 담당 */
export function useViewerGraphState({
  currentChapter,
  bookKey,
  showGraph,
}) {
  const initialFullScreen = useMemo(
    () => resolveInitialGraphFullScreen(showGraph),
    // 마운트 시 1회: viewer_mode의 graph 전체화면 복원
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [currentEvent, setCurrentEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [prevValidEvent, setPrevValidEvent] = useState(null);

  const [graphFullScreen, setGraphFullScreen] = useState(initialFullScreen);

  const [isDataReady, setIsDataReady] = useState(false);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [filterStage, setFilterStage] = useState(0);
  const [isReloading, setIsReloading] = useState(false);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isFineGraphLoading, setFineGraphLoading] = useState(false);
  const [elements, setElements] = useState([]);
  const [isDataEmpty, setIsDataEmpty] = useState(false);

  const currentChapterData = useMemo(() => {
    if (!currentChapter || !Array.isArray(events) || events.length === 0) {
      return { characters: [] };
    }
    const chapterEvents = events.filter(
      (evt) => Number(eventUtils.resolveChapterIdx(evt)) === Number(currentChapter)
    );
    return { characters: Array.from(aggregateCharactersFromEvents(chapterEvents).values()) };
  }, [events, currentChapter]);

  const graphPhase = useMemo(
    () => deriveGraphPhase({ isReloading, isFineGraphLoading, isGraphLoading }),
    [isReloading, isFineGraphLoading, isGraphLoading]
  );

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);

  useEffect(() => {
    saveViewerMode(resolvePersistedViewerMode(graphFullScreen, showGraph));
  }, [showGraph, graphFullScreen]);

  // 그래프 숨김 시 전체화면 잔류로 뷰어 width 0% 되는 것 방지
  useEffect(() => {
    if (!showGraph && graphFullScreen) setGraphFullScreen(false);
  }, [showGraph, graphFullScreen]);

  // 챕터에 맞는 이벤트만 prevValid로 유지, 불일치 시 클리어
  useEffect(() => {
    if (!currentEvent) return;
    if (eventMatchesChapter(currentEvent, currentChapter)) {
      setPrevValidEvent(currentEvent);
      return;
    }
    setCurrentEvent(null);
    setPrevValidEvent(null);
  }, [currentChapter, currentEvent]);

  const resetGraphPipelineState = useCallback(() => {
    setEvents([]);
    setElements([]);
    setIsDataEmpty(true);
    setIsDataReady(false);
    setIsGraphLoading(true);
  }, []);

  const resetGraphTransientState = useCallback(() => {
    setCurrentEvent(null);
    setPrevValidEvent(null);
    resetGraphPipelineState();
  }, [resetGraphPipelineState]);

  useEffect(() => {
    resetGraphPipelineState();
  }, [currentChapter, bookKey, resetGraphPipelineState]);

  useEffect(() => {
    if (!isHardNavigationReload()) return undefined;

    setIsReloading(true);
    resetGraphTransientState();

    // settings.showGraph가 SSOT — 하드 리로드 시 fullscreen만 viewer_mode에서 복원
    setGraphFullScreen(resolveInitialGraphFullScreen());

    const timer = setTimeout(() => {
      setIsReloading(false);
      setIsGraphLoading(false);
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
    ]
  );

  const graphActions = useMemo(
    () => ({
      setGraphFullScreen,
      setEdgeLabelVisible,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    }),
    [
      setGraphFullScreen,
      setEdgeLabelVisible,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    ]
  );

  const graphViewerState = useMemo(
    () => ({
      graphPhase,
      isDataReady,
      isDataEmpty,
    }),
    [graphPhase, isDataReady, isDataEmpty]
  );

  return {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    setIsDataReady,
    setIsGraphLoading,
    setFineGraphLoading,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  };
}

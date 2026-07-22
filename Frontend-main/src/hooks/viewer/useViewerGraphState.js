/** 뷰어 그래프 UI 상태·검색·mode persist */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { deriveGraphPhase } from '../../utils/viewer/viewerCore';
import {
  saveViewerMode,
  resolveInitialGraphFullScreen,
  resolvePersistedViewerMode,
  isHardNavigationReload,
  eventMatchesChapter,
} from '../../utils/viewer/viewerSession';
import {
  buildChapterCharacterSearchData,
  VIEWER_GRAPH_PIPELINE,
} from '../../utils/viewer/viewerGraph';
import { useGraphSearch, useGraphDisplayToggles } from '../graph/useGraphViewState';

const { HARD_RELOAD_SETTLE_MS } = VIEWER_GRAPH_PIPELINE;

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
  const [isDataReady, setIsDataReady] = useState(false);
  const {
    edgeLabelVisible,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
  } = useGraphDisplayToggles();
  const [isReloading, setIsReloading] = useState(false);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isEventGraphLoading, setEventGraphLoading] = useState(false);
  const [elements, setElements] = useState([]);
  const [isDataEmpty, setIsDataEmpty] = useState(false);

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

  useEffect(() => {
    if (!showGraph && graphFullScreen) setGraphFullScreen(false);
  }, [showGraph, graphFullScreen]);

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
    ],
  );

  const graphActions = useMemo(
    () => ({
      setGraphFullScreen,
      setEdgeLabelVisible,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    }),
    [filterStage],
  );

  const graphViewerState = useMemo(
    () => ({ graphPhase, isDataReady, isDataEmpty }),
    [graphPhase, isDataReady, isDataEmpty],
  );

  return {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    setIsDataReady,
    setIsGraphLoading,
    setEventGraphLoading,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  };
}


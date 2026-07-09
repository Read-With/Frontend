/** 뷰어 그래프 UI·파이프라인 상태 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useGraphSearch } from '../graph/graphViewHooks';
import { eventMatchesChapter } from '../../utils/viewer/viewerEventProgressUtils';
import { aggregateCharactersFromEvents } from '../../utils/graph/characterUtils';
import {
  saveViewerMode,
  resolveInitialGraphMode,
  eventUtils,
} from '../../utils/viewer/viewerCoreStateUtils';

export function useViewerGraphState({ currentChapter, setCurrentChapter, bookKey }) {
  const initialGraphMode = useMemo(() => resolveInitialGraphMode(), []);

  const [currentEvent, setCurrentEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [prevValidEvent, setPrevValidEvent] = useState(null);

  const [graphFullScreen, setGraphFullScreen] = useState(initialGraphMode.fullScreen);
  const [showGraph, setShowGraph] = useState(initialGraphMode.show);

  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isDataReady, setIsDataReady] = useState(false);
  const [graphViewState, setGraphViewState] = useState(null);
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
    const charactersMap = aggregateCharactersFromEvents(chapterEvents);
    return { characters: Array.from(charactersMap.values()) };
  }, [events, currentChapter]);

  useEffect(() => {
    if (currentEvent && eventMatchesChapter(currentEvent, currentChapter)) {
      setPrevValidEvent(currentEvent);
    }
  }, [currentEvent, currentChapter]);

  const graphPhase = useMemo(() => {
    if (isReloading) return 'reloading';
    if (isFineGraphLoading) return 'fine';
    if (isGraphLoading) return 'loading';
    return 'idle';
  }, [isReloading, isFineGraphLoading, isGraphLoading]);

  const { searchState, searchActions } = useGraphSearch(elements, null, currentChapterData);

  useEffect(() => {
    if (graphFullScreen) {
      saveViewerMode('graph');
    } else if (showGraph) {
      saveViewerMode('split');
    } else {
      saveViewerMode('viewer');
    }
  }, [showGraph, graphFullScreen]);

  const resetGraphPipelineState = useCallback(() => {
    setEvents([]);
    setElements([]);
    setIsDataEmpty(true);
    setIsDataReady(false);
    setIsGraphLoading(true);
  }, []);

  const resetGraphTransientState = useCallback(() => {
    setCurrentEvent(null);
    resetGraphPipelineState();
    setPrevValidEvent(null);
  }, [resetGraphPipelineState]);

  useEffect(() => {
    resetGraphPipelineState();
  }, [currentChapter, bookKey, resetGraphPipelineState]);

  useEffect(() => {
    if (!currentEvent) return;
    if (!eventMatchesChapter(currentEvent, currentChapter)) {
      setCurrentEvent(null);
      setPrevValidEvent(null);
    }
  }, [currentChapter, currentEvent]);

  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length > 0 && navEntries[0].type === 'reload') {
        setIsReloading(true);
        resetGraphTransientState();

        const flags = resolveInitialGraphMode();
        setGraphFullScreen(flags.fullScreen);
        setShowGraph(flags.show);

        const timer = setTimeout(() => {
          setIsReloading(false);
          setIsGraphLoading(false);
        }, 1000);

        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [resetGraphTransientState]);

  const graphState = useMemo(
    () => ({
      currentChapter,
      currentEvent,
      prevValidEvent,
      events,
      elements,
      graphViewState,
      edgeLabelVisible,
      currentCharIndex,
      graphFullScreen,
      showGraph,
    }),
    [
      currentChapter,
      currentEvent,
      prevValidEvent,
      events,
      elements,
      graphViewState,
      edgeLabelVisible,
      currentCharIndex,
      graphFullScreen,
      showGraph,
    ]
  );

  const graphActions = useMemo(
    () => ({
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setEdgeLabelVisible,
      setElements,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    }),
    [
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setEdgeLabelVisible,
      setElements,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    ]
  );

  const graphViewerState = useMemo(
    () => ({
      fineGraphLoading: isFineGraphLoading,
      graphPhase,
      isDataReady,
      isDataEmpty,
    }),
    [isFineGraphLoading, graphPhase, isDataReady, isDataEmpty]
  );

  return {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    setGraphViewState,
    setCurrentCharIndex,
    setIsDataReady,
    setIsGraphLoading,
    setFineGraphLoading,
    setShowGraph,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  };
}

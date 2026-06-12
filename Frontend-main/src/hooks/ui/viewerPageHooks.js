/** 뷰어 페이지: 툴팁 활성 상태·챕터/이벤트 전환 상태 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { processTooltipData } from '../../utils/graph/graphUtils';
import { transitionUtils } from '../../utils/viewer/viewerUtils';

export function useTooltipState({
  onError = null,
  graphClearRef = null,
  clearDelay = 150,
  errorCheckDelay = 220,
} = {}) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const tooltipTimeoutRef = useRef(null);
  const lastTooltipOpenAtRef = useRef(0);
  const activeTooltipRef = useRef(null);
  const onErrorRef = useRef(onError);
  const graphClearRefRef = useRef(graphClearRef);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    graphClearRefRef.current = graphClearRef;
  }, [graphClearRef]);

  useEffect(() => {
    activeTooltipRef.current = activeTooltip;
  }, [activeTooltip]);

  const handleClearTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }

    const now = Date.now();
    if (now - lastTooltipOpenAtRef.current < clearDelay) {
      return;
    }

    setActiveTooltip(null);
    if (graphClearRefRef.current?.current) {
      graphClearRefRef.current.current();
    }
  }, [clearDelay]);

  const handleSetActiveTooltip = useCallback((tooltipData) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }

    const processedTooltipData = processTooltipData(tooltipData, tooltipData.type);
    lastTooltipOpenAtRef.current = Date.now();
    setActiveTooltip(processedTooltipData);

    if (onErrorRef.current) {
      const timeoutId = setTimeout(() => {
        if (!activeTooltipRef.current) {
          onErrorRef.current();
        }
        if (tooltipTimeoutRef.current === timeoutId) {
          tooltipTimeoutRef.current = null;
        }
      }, errorCheckDelay);
      tooltipTimeoutRef.current = timeoutId;
    }
  }, [errorCheckDelay]);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
        tooltipTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    activeTooltip,
    setActiveTooltip,
    handleClearTooltip,
    handleSetActiveTooltip,
    activeTooltipRef,
  };
}

export function useTransitionState({
  currentEvent,
  currentChapter,
  loading,
  isReloading,
  isGraphLoading,
  isDataReady,
}) {
  const [transitionState, setTransitionState] = useState({
    type: null,
    inProgress: false,
    error: false,
    direction: null,
  });

  const prevEventRef = useRef(null);
  const prevChapterRef = useRef(null);

  useEffect(() => {
    let timeoutId = null;

    if (currentEvent && prevEventRef.current) {
      const prevEvent = prevEventRef.current;
      const isEventChanged =
        prevEvent.eventNum !== currentEvent.eventNum ||
        prevEvent.chapter !== currentEvent.chapter;

      if (isEventChanged) {
        setTransitionState({ type: 'event', inProgress: true, error: false, direction: null });

        timeoutId = setTimeout(() => {
          transitionUtils.reset(setTransitionState);
        }, 200);
      }
    }

    if (currentEvent) {
      prevEventRef.current = currentEvent;
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [currentEvent]);

  useEffect(() => {
    if (prevChapterRef.current !== null && prevChapterRef.current !== currentChapter) {
      setTransitionState({
        type: 'chapter',
        inProgress: true,
        error: false,
        direction: null,
      });
    }
    prevChapterRef.current = currentChapter;
  }, [currentChapter]);

  useEffect(() => {
    if (loading || isReloading || isGraphLoading || !isDataReady || transitionState.type === 'chapter') {
      setTransitionState((prev) => ({ ...prev, error: false }));
    }
  }, [currentEvent, currentChapter, loading, isReloading, isDataReady, isGraphLoading, transitionState.type]);

  const resetTransition = useCallback(() => {
    transitionUtils.reset(setTransitionState);
  }, []);

  return {
    transitionState,
    setTransitionState,
    resetTransition,
  };
}

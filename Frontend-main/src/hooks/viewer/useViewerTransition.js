/** 뷰어 페이지: 챕터/이벤트 전환 상태 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { transitionUtils } from '../../utils/viewer/viewerCoreStateUtils';

export function useViewerTransition({
  currentEvent,
  currentChapter,
  fineGraphLoading,
  isReloading,
  graphPhase,
  isDataReady,
}) {
  const [transitionState, setTransitionState] = useState(transitionUtils.getInitialState);

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
        setTransitionState({
          type: 'event',
          inProgress: true,
          error: false,
          direction: null,
        });

        timeoutId = setTimeout(() => {
          transitionUtils.reset(setTransitionState);
        }, 50);
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
    if (isDataReady && transitionState.type === 'event' && transitionState.inProgress) {
      transitionUtils.reset(setTransitionState);
    }
  }, [isDataReady, transitionState.type, transitionState.inProgress]);

  useEffect(() => {
    if (
      fineGraphLoading ||
      isReloading ||
      graphPhase === 'loading' ||
      graphPhase === 'reloading' ||
      !isDataReady ||
      transitionState.type === 'chapter'
    ) {
      setTransitionState((prev) => (prev.error ? { ...prev, error: false } : prev));
    }
  }, [currentEvent, currentChapter, fineGraphLoading, isReloading, graphPhase, isDataReady, transitionState.type]);

  const resetTransition = useCallback(() => {
    transitionUtils.reset(setTransitionState);
  }, []);

  return {
    transitionState,
    resetTransition,
  };
}

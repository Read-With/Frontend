/** 뷰어 페이지: 챕터/이벤트 전환 상태 */

import { useState, useEffect, useRef, useCallback } from 'react';

const INITIAL_TRANSITION = Object.freeze({ type: null, inProgress: false });
const EVENT_TRANSITION_FALLBACK_MS = 50;

function createInitialTransition() {
  return { ...INITIAL_TRANSITION };
}

function resetTransitionState(setTransitionState) {
  setTransitionState((prev) => (
    prev.type == null && !prev.inProgress
      ? prev
      : createInitialTransition()
  ));
}

function isEventIdentityChanged(prev, next) {
  return prev.eventNum !== next.eventNum || prev.chapter !== next.chapter;
}

export function useViewerTransition({
  currentEvent,
  currentChapter,
  isDataReady,
}) {
  const [transitionState, setTransitionState] = useState(createInitialTransition);
  const prevEventRef = useRef(null);
  const prevChapterRef = useRef(null);

  const resetTransition = useCallback(() => {
    resetTransitionState(setTransitionState);
  }, []);

  useEffect(() => {
    let timeoutId = null;
    const prev = prevEventRef.current;

    if (currentEvent && prev && isEventIdentityChanged(prev, currentEvent)) {
      setTransitionState({ type: 'event', inProgress: true });
      timeoutId = setTimeout(
        () => resetTransitionState(setTransitionState),
        EVENT_TRANSITION_FALLBACK_MS
      );
    }

    if (currentEvent) {
      prevEventRef.current = currentEvent;
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [currentEvent]);

  useEffect(() => {
    if (prevChapterRef.current !== null && prevChapterRef.current !== currentChapter) {
      setTransitionState({ type: 'chapter', inProgress: true });
    }
    prevChapterRef.current = currentChapter;
  }, [currentChapter]);

  useEffect(() => {
    if (isDataReady && transitionState.type === 'event' && transitionState.inProgress) {
      resetTransitionState(setTransitionState);
    }
  }, [isDataReady, transitionState.type, transitionState.inProgress]);

  return {
    transitionState,
    resetTransition,
  };
}

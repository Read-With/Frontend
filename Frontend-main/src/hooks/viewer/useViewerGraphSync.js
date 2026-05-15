import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/**
 * Extracted from useViewerPage:
 * - prevValidEvent state (fixes stale-ref-in-useMemo bug)
 * - graphPhase enum (collapses 5 loading booleans into one)
 */
export function useViewerGraphSync({
  currentChapter,
  currentEvent,
  isReloading,
  isFineGraphLoading,
  isGraphLoading,
  graphLoading,
}) {
  const [prevValidEvent, setPrevValidEvent] = useState(null);
  const prevValidEventRef = useRef(null);

  const resetPrevValidEvent = useCallback(() => {
    prevValidEventRef.current = null;
    setPrevValidEvent(null);
  }, []);

  useEffect(() => {
    if (currentEvent && currentEvent.chapter === currentChapter) {
      prevValidEventRef.current = currentEvent;
      setPrevValidEvent(currentEvent);
    }
  }, [currentEvent, currentChapter]);

  // 'idle' | 'loading' | 'fine' | 'reloading'
  const graphPhase = useMemo(() => {
    if (isReloading) return 'reloading';
    if (isFineGraphLoading) return 'fine';
    if (isGraphLoading || graphLoading !== false) return 'loading';
    return 'idle';
  }, [isReloading, isFineGraphLoading, isGraphLoading, graphLoading]);

  return { prevValidEvent, prevValidEventRef, graphPhase, resetPrevValidEvent };
}

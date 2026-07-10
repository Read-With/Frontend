/** 그래프 외부 클릭 시 툴팁·선택 해제 */

import { useEffect, useCallback } from 'react';
import { isSidebarElement } from '../../utils/graph/graphUtils';
import { useLatestRef } from '../common/hooksShared';

export function isGraphDragEndEvent(event) {
  const type = event?.detail?.type;
  return type === 'graphDragEnd' || type === 'dragend';
}

export function shouldIgnoreGraphPageOutsideClick(event) {
  if (isGraphDragEndEvent(event)) return true;
  if (isSidebarElement(event)) return true;
  if (event.target.closest?.('.graph-canvas-area')) return true;
  return false;
}

export function shouldIgnoreViewerOutsideClick(event, containerRef) {
  if (event.target.closest?.('.graph-node-tooltip')) return true;
  if (event.target.closest?.('.edge-tooltip-container')) return true;
  if (containerRef?.current?.contains(event.target)) return true;
  if (isGraphDragEndEvent(event)) return true;
  return false;
}

/**
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {(event: Event) => void} options.onDismiss
 * @param {(event: Event) => boolean} options.shouldIgnoreClick
 * @param {number} [options.attachDelayMs=10]
 * @param {boolean} [options.blockDragEndEvents=false]
 */
export function useGraphOutsideDismiss({
  enabled,
  onDismiss,
  shouldIgnoreClick,
  attachDelayMs = 10,
  blockDragEndEvents = false,
}) {
  const shouldIgnoreRef = useLatestRef(shouldIgnoreClick);

  const handleOutsideClick = useCallback(
    (event) => {
      if (shouldIgnoreRef.current(event)) return;
      onDismiss(event);
    },
    [onDismiss, shouldIgnoreRef],
  );

  const handleDragEnd = useCallback((event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleOutsideClick, true);
      if (blockDragEndEvents) {
        document.addEventListener('graphDragEnd', handleDragEnd, true);
        document.addEventListener('dragend', handleDragEnd, true);
      }
    }, attachDelayMs);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleOutsideClick, true);
      if (blockDragEndEvents) {
        document.removeEventListener('graphDragEnd', handleDragEnd, true);
        document.removeEventListener('dragend', handleDragEnd, true);
      }
    };
  }, [enabled, handleOutsideClick, handleDragEnd, attachDelayMs, blockDragEndEvents]);
}

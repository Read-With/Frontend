/** 그래프 툴팁 열기 · 선택 포커스 · 외부 클릭 dismiss */

import { useEffect, useCallback, useMemo } from 'react';
import {
  isSidebarElement,
  openTooltipFromTap,
} from '../../utils/graph/graphUtils';
import { useLatestRef } from '../common/hooksShared';

/** 툴팁 연 직후 같은 클릭으로 dismiss 되는 것 방지 */
export const GRAPH_OUTSIDE_DISMISS_ATTACH_DELAY_MS = 10;

export function isGraphDragEndEvent(event) {
  const type = event?.detail?.type;
  return type === 'graphDragEnd' || type === 'dragend';
}

function shouldIgnoreCanvasOrDragEnd(event) {
  if (event.target.closest?.('.graph-canvas-area')) return true;
  if (isGraphDragEndEvent(event)) return true;
  return false;
}

export function shouldIgnoreGraphPageOutsideClick(event) {
  if (isGraphDragEndEvent(event)) return true;
  if (isSidebarElement(event)) return true;
  if (event.target.closest?.('.graph-canvas-area')) return true;
  return false;
}

export function shouldIgnoreViewerOutsideClick(event) {
  if (event.target.closest?.('.graph-node-tooltip')) return true;
  if (event.target.closest?.('.edge-tooltip-container')) return true;
  // 캔버스 클릭은 Cytoscape tap/background 핸들러가 담당
  return shouldIgnoreCanvasOrDragEnd(event);
}

/**
 * 반환값 없는 fire-and-forget 훅.
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {(event: Event) => void} options.onDismiss
 * @param {(event: Event) => boolean} options.shouldIgnoreClick
 * @param {number} [options.attachDelayMs]
 * @param {boolean} [options.blockDragEndEvents=false]
 */
export function useGraphOutsideDismiss({
  enabled,
  onDismiss,
  shouldIgnoreClick,
  attachDelayMs = GRAPH_OUTSIDE_DISMISS_ATTACH_DELAY_MS,
  blockDragEndEvents = false,
}) {
  const shouldIgnoreRef = useLatestRef(shouldIgnoreClick);
  const onDismissRef = useLatestRef(onDismiss);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleOutsideClick = (event) => {
      if (shouldIgnoreRef.current(event)) return;
      onDismissRef.current?.(event);
    };

    const handleDragEnd = (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
    };

    let dragEndBound = false;

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleOutsideClick, true);
      if (blockDragEndEvents) {
        document.addEventListener('graphDragEnd', handleDragEnd, true);
        document.addEventListener('dragend', handleDragEnd, true);
        dragEndBound = true;
      }
    }, attachDelayMs);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleOutsideClick, true);
      if (dragEndBound) {
        document.removeEventListener('graphDragEnd', handleDragEnd, true);
        document.removeEventListener('dragend', handleDragEnd, true);
      }
    };
  }, [enabled, shouldIgnoreRef, onDismissRef, attachDelayMs, blockDragEndEvents]);
}

/**
 * @param {object} options
 * @param {object|null} options.activeTooltip
 * @param {(tooltip: object) => void} [options.onSetActiveTooltip]
 * @param {() => void} [options.onBeforeOpen]
 * @param {(elementId: string) => void} options.centerSelection id만 전달
 * @param {number} options.focusDelayMs
 * @param {boolean} [options.tooltipOpen=false] 포커스·outside dismiss 공통 활성 플래그
 * @param {() => void} options.onDismiss
 * @param {(event: Event) => boolean} options.shouldIgnoreClick
 * @param {number} [options.attachDelayMs]
 * @param {boolean} [options.blockDragEndEvents]
 */
export function useGraphTooltipSelection({
  activeTooltip,
  onSetActiveTooltip,
  onBeforeOpen,
  centerSelection,
  focusDelayMs,
  tooltipOpen = false,
  onDismiss,
  shouldIgnoreClick,
  attachDelayMs,
  blockDragEndEvents = false,
}) {
  const centerSelectionRef = useLatestRef(centerSelection);
  const focusTooltipId =
    activeTooltip?.id != null && activeTooltip.id !== ''
      ? String(activeTooltip.id)
      : '';

  const openElementTooltip = useCallback((tapPayload, type) => {
    if (!onSetActiveTooltip) return;
    onBeforeOpen?.();
    onSetActiveTooltip(openTooltipFromTap(tapPayload, type));
  }, [onBeforeOpen, onSetActiveTooltip]);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useMemo(
    () => ({
      onShowNodeTooltip: (tapPayload) => openElementTooltip(tapPayload, 'node'),
      onShowEdgeTooltip: (tapPayload) => openElementTooltip(tapPayload, 'edge'),
    }),
    [openElementTooltip],
  );

  useEffect(() => {
    if (!tooltipOpen || !focusTooltipId) return undefined;
    const timeoutId = setTimeout(() => {
      centerSelectionRef.current?.(focusTooltipId);
    }, focusDelayMs);
    return () => clearTimeout(timeoutId);
  }, [focusTooltipId, focusDelayMs, tooltipOpen, centerSelectionRef]);

  useGraphOutsideDismiss({
    enabled: tooltipOpen,
    onDismiss,
    shouldIgnoreClick,
    attachDelayMs,
    blockDragEndEvents,
  });

  return { onShowNodeTooltip, onShowEdgeTooltip };
}

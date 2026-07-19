/** Cytoscape 탭·드래그·선택 하이라이트 */

import { useCallback, useMemo } from "react";
import {
  clearHighlightClassesOn,
  clearReciprocalEndpointBypass,
  fitGraphToNodes,
  getSelectionFocusElements,
  placeTooltipInCanvasAwayFromFocus,
} from '../../utils/graph/graphUtils';
import { useLatestRef } from '../common/hooksShared';

function isCyNode(element) {
  return typeof element?.isNode === 'function' ? element.isNode() : false;
}

function isFinitePoint(point) {
  return (
    point &&
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function applySelectionFade(cy, keepNodes, keepEdges, highlightedNodes = keepNodes, highlightedEdges = keepEdges) {
  if (!cy) return;
  clearHighlightClassesOn(cy);
  const fadedNodes = cy.nodes().difference(keepNodes);
  const fadedEdges = cy.edges().difference(keepEdges);
  cy.batch(() => {
    highlightedNodes.addClass("highlighted");
    highlightedEdges.addClass("highlighted");
    fadedNodes.addClass("faded");
    fadedEdges.addClass("faded");
    highlightedEdges.forEach((edge) => {
      if (edge.data("reciprocalPair")) clearReciprocalEndpointBypass(edge);
    });
  });
}

function applySelectionHighlight(cy, element) {
  if (!cy || !element || element.length === 0) return;
  const focus = getSelectionFocusElements(cy, element);
  if (!focus?.length) return;

  if (isCyNode(element)) {
    applySelectionFade(cy, focus.nodes(), focus.edges(), element, focus.edges());
    return;
  }
  applySelectionFade(cy, focus.nodes(), focus.edges());
}

function formatTapShowArgs(kind, element, evt, center, mouseX, mouseY) {
  if (kind === 'node') {
    return { node: element, evt, nodeCenter: center, mouseX, mouseY };
  }
  return { edge: element, evt, edgeCenter: center, mouseX, mouseY };
}

function getEdgeRenderedCenter(element) {
  try {
    const midpoint = typeof element.midpoint === 'function' ? element.midpoint() : null;
    if (isFinitePoint(midpoint)) return midpoint;
  } catch {
    /* fall through */
  }

  const source = element.source?.();
  const target = element.target?.();
  if (!source?.length || !target?.length) return null;

  const sourcePos = source.renderedPosition();
  const targetPos = target.renderedPosition();
  if (!isFinitePoint(sourcePos) || !isFinitePoint(targetPos)) return null;

  return {
    x: (sourcePos.x + targetPos.x) / 2,
    y: (sourcePos.y + targetPos.y) / 2,
  };
}

function getCyContainerOrigin(cy) {
  try {
    const cyRect = cy.container()?.getBoundingClientRect?.();
    if (cyRect) return { left: cyRect.left, top: cyRect.top };
  } catch {
    /* ignore */
  }
  return { left: 0, top: 0 };
}

/**
 * 노드: 클릭/렌더 좌표 + bbox offset (사이드바와 겹침 완화)
 * 엣지: focus 집합 기준 캔버스 내 배치
 */
function resolveTooltipAnchor(cy, kind, element, evt, calculateTooltipPosition) {
  if (kind === 'edge') {
    const focus = getSelectionFocusElements(cy, element);
    return placeTooltipInCanvasAwayFromFocus({ cy, focusEles: focus });
  }
  const bbox = element.renderedBoundingBox?.();
  const offsetX = (bbox?.w ?? 50) + 200;
  return calculateTooltipPosition(element, evt, offsetX);
}

/**
 * @param {object} options
 * @param {{ current: null | { kind: 'node'|'edge', id: string } }} options.selectedElementRef
 */
export function useGraphInteractions({
  cyRef,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedElementRef,
  onAfterReset,
}) {
  const onShowNodeTooltipRef = useLatestRef(onShowNodeTooltip);
  const onShowEdgeTooltipRef = useLatestRef(onShowEdgeTooltip);
  const onClearTooltipRef = useLatestRef(onClearTooltip);
  const onAfterResetRef = useLatestRef(onAfterReset);

  const clearSelectionRefs = useCallback(() => {
    if (selectedElementRef) selectedElementRef.current = null;
  }, [selectedElementRef]);

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    clearHighlightClassesOn(cyRef.current);
    onAfterResetRef.current?.();
  }, [cyRef, onAfterResetRef]);

  const dismissSelection = useCallback(() => {
    resetAllStyles();
    onClearTooltipRef.current?.();
    clearSelectionRefs();
  }, [resetAllStyles, clearSelectionRefs, onClearTooltipRef]);

  const reapplySelectionHighlight = useCallback(() => {
    const cy = cyRef?.current;
    const selected = selectedElementRef?.current;
    if (!cy || !selected?.id) return;

    const el = cy.getElementById(String(selected.id));
    if (el.length > 0) applySelectionHighlight(cy, el);
  }, [cyRef, selectedElementRef]);

  const calculateTooltipPosition = useCallback((element, evt, offset = 0) => {
    try {
      const cy = cyRef?.current;
      if (!cy) return { x: 0, y: 0 };

      if (evt?.originalEvent) {
        return {
          x: evt.originalEvent.clientX + offset,
          y: evt.originalEvent.clientY,
        };
      }

      const basePos = isCyNode(element)
        ? element.renderedPosition()
        : getEdgeRenderedCenter(element);
      if (!isFinitePoint(basePos)) return { x: 0, y: 0 };

      const { left, top } = getCyContainerOrigin(cy);
      return {
        x: left + basePos.x + offset,
        y: top + basePos.y,
      };
    } catch {
      return { x: 0, y: 0 };
    }
  }, [cyRef]);

  const selectElement = useCallback((kind, element) => {
    const cy = cyRef?.current;
    if (!cy) return false;
    try {
      applySelectionHighlight(cy, element);
    } catch {
      return false;
    }
    if (selectedElementRef) {
      selectedElementRef.current = { kind, id: String(element.id()) };
    }
    return true;
  }, [cyRef, selectedElementRef]);

  const showElementTooltip = useCallback((kind, element, evt) => {
    const cy = cyRef?.current;
    if (!cy) return;
    const onShowTooltipRef = kind === 'node' ? onShowNodeTooltipRef : onShowEdgeTooltipRef;
    const center = calculateTooltipPosition(element, null, 0);
    const anchor = resolveTooltipAnchor(cy, kind, element, evt, calculateTooltipPosition);
    onShowTooltipRef.current?.(
      formatTapShowArgs(kind, element, evt, center, anchor.x, anchor.y),
    );
  }, [cyRef, onShowNodeTooltipRef, onShowEdgeTooltipRef, calculateTooltipPosition]);

  const createTapHandler = useCallback((kind) => (evt) => {
    if (!cyRef?.current) return;

    const element = evt.target;
    if (!element || typeof element.data !== 'function' || !element.data()) return;

    const elementId = String(element.id());
    const prev = selectedElementRef?.current;
    if (prev?.kind === kind && String(prev.id) === elementId) {
      dismissSelection();
      return;
    }

    if (!selectElement(kind, element)) return;

    try {
      showElementTooltip(kind, element, evt);
    } catch {
      /* focus는 유지, 툴팁만 실패 */
    }
  }, [cyRef, selectedElementRef, dismissSelection, selectElement, showElementTooltip]);

  const tapNodeHandler = useMemo(() => createTapHandler('node'), [createTapHandler]);
  const tapEdgeHandler = useMemo(() => createTapHandler('edge'), [createTapHandler]);

  const tapBackgroundHandler = useCallback((evt) => {
    if (evt.target !== cyRef?.current) return;
    if (!selectedElementRef?.current) return;
    dismissSelection();
  }, [cyRef, selectedElementRef, dismissSelection]);

  /**
   * @param {{ fitViewport?: boolean }} [options]
   * fitViewport 기본 true — 챕터/이벤트 전환 등에서는 false
   */
  const clearSelection = useCallback((options = {}) => {
    const fitViewport = options?.fitViewport !== false;
    resetAllStyles();
    clearSelectionRefs();
    if (fitViewport) fitGraphToNodes(cyRef?.current, { duration: 500 });
  }, [cyRef, resetAllStyles, clearSelectionRefs]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
    reapplySelectionHighlight,
  };
}

export default useGraphInteractions;

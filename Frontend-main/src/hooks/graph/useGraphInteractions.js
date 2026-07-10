/** Cytoscape 탭·드래그·선택 하이라이트 */

import { useCallback, useMemo } from "react";
import { getContainerInfo, calculateCytoscapePosition, clearHighlightClassesOn } from '../../utils/graph/graphUtils';
import { useLatestRef } from '../common/hooksShared';

function applyNodeClickHighlight(cy, node) {
  if (!cy || !node || node.length === 0) return;
  try {
    clearHighlightClassesOn(cy);
    const nodeId = String(node.id());
    const connectedEdges = node.connectedEdges();
    const directEdges = connectedEdges.filter((edge) => {
      const sourceId = String(edge.source().id());
      const targetId = String(edge.target().id());

      if (sourceId === nodeId) return true;

      if (targetId === nodeId) {
        const hasReverseOutgoing = connectedEdges.some((candidate) => {
          const candidateSourceId = String(candidate.source().id());
          const candidateTargetId = String(candidate.target().id());
          return candidateSourceId === nodeId && candidateTargetId === sourceId;
        });
        return !hasReverseOutgoing;
      }

      return false;
    });
    const keepNodes = node.union(directEdges.connectedNodes());
    applySelectionFade(cy, keepNodes, directEdges, node, directEdges);
  } catch {
    /* ignore */
  }
}

function applyEdgeClickHighlight(cy, edge) {
  if (!cy || !edge || edge.length === 0) return;
  try {
    clearHighlightClassesOn(cy);
    const endpoints = edge.source().union(edge.target());
    applySelectionFade(cy, endpoints, edge, endpoints, edge);
  } catch {
    /* ignore */
  }
}

function applySelectionFade(cy, keepNodes, keepEdges, highlightedNodes, highlightedEdges) {
  if (!cy) return;
  const allNodes = cy.nodes();
  const allEdges = cy.edges();
  const fadedNodes = cy.nodes().difference(keepNodes);
  const fadedEdges = cy.edges().difference(keepEdges);
  cy.batch(() => {
    allNodes.removeClass("highlighted faded");
    allEdges.removeClass("highlighted faded");
    allNodes.forEach((n) => {
      n.removeStyle("opacity");
      n.removeStyle("text-opacity");
    });
    allEdges.forEach((e) => {
      e.removeStyle("opacity");
    });

    highlightedNodes.addClass("highlighted");
    highlightedEdges.addClass("highlighted");

    fadedNodes.addClass("faded");
    fadedEdges.addClass("faded");
  });
}

function formatTapShowArgs(kind, element, evt, center, mouseX, mouseY) {
  if (kind === 'node') {
    return { node: element, evt, nodeCenter: center, mouseX, mouseY };
  }
  return { edge: element, evt, edgeCenter: center, mouseX, mouseY };
}

export default function useGraphInteractions({
  cyRef,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
  onAfterReset,
}) {
  const onShowNodeTooltipRef = useLatestRef(onShowNodeTooltip);
  const onShowEdgeTooltipRef = useLatestRef(onShowEdgeTooltip);
  const onClearTooltipRef = useLatestRef(onClearTooltip);
  const onAfterResetRef = useLatestRef(onAfterReset);

  const clearSelectionRefs = useCallback(() => {
    if (selectedNodeIdRef) selectedNodeIdRef.current = null;
    if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
  }, [selectedNodeIdRef, selectedEdgeIdRef]);

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    clearHighlightClassesOn(cyRef.current);
    onAfterResetRef.current?.();
  }, [cyRef]);

  const calculateTooltipPosition = useCallback((element, evt, offset = 0) => {
    try {
      if (!cyRef?.current) return { x: 0, y: 0 };

      const { containerRect } = getContainerInfo();

      if (evt?.originalEvent) {
        let domX = evt.originalEvent.clientX - containerRect.left;
        let domY = evt.originalEvent.clientY - containerRect.top;
        if (offset !== 0) domX += offset;
        return { x: domX, y: domY };
      }

      const isNode = typeof element.renderedPosition === 'function';
      let basePos;
      if (isNode) {
        const rendered = element.renderedPosition();
        if (rendered && typeof rendered.x === 'number' && typeof rendered.y === 'number') {
          basePos = rendered;
        } else {
          const pos = element.position();
          basePos = pos && typeof pos.x === 'number' && typeof pos.y === 'number' ? pos : { x: 0, y: 0 };
        }
      } else {
        try {
          const midpoint = element.midpoint();
          if (midpoint && typeof midpoint.x === 'number' && typeof midpoint.y === 'number') {
            basePos = midpoint;
          } else {
            const source = element.source();
            const target = element.target();
            if (source && target) {
              const sourcePos = source.renderedPosition ? source.renderedPosition() : source.position();
              const targetPos = target.renderedPosition ? target.renderedPosition() : target.position();
              if (sourcePos && targetPos &&
                  typeof sourcePos.x === 'number' && typeof sourcePos.y === 'number' &&
                  typeof targetPos.x === 'number' && typeof targetPos.y === 'number') {
                basePos = {
                  x: (sourcePos.x + targetPos.x) / 2,
                  y: (sourcePos.y + targetPos.y) / 2
                };
              } else {
                basePos = { x: 0, y: 0 };
              }
            } else {
              basePos = { x: 0, y: 0 };
            }
          }
        } catch {
          basePos = { x: 0, y: 0 };
        }
      }

      if (!basePos || typeof basePos.x !== 'number' || typeof basePos.y !== 'number') {
        return { x: 0, y: 0 };
      }

      const position = calculateCytoscapePosition(basePos, cyRef);
      let domX = position.x - containerRect.left;
      let domY = position.y - containerRect.top;
      if (offset !== 0) domX += offset;

      return { x: domX, y: domY };
    } catch {
      return { x: 0, y: 0 };
    }
  }, [cyRef]);

  const createTapHandler = useCallback((kind) => {
    const isNode = kind === 'node';
    const applyHighlight = isNode ? applyNodeClickHighlight : applyEdgeClickHighlight;
    const selectedIdRef = isNode ? selectedNodeIdRef : selectedEdgeIdRef;
    const peerSelectedIdRef = isNode ? selectedEdgeIdRef : selectedNodeIdRef;
    const onShowTooltipRef = isNode ? onShowNodeTooltipRef : onShowEdgeTooltipRef;

    return (evt) => {
      try {
        if (!cyRef?.current) return;

        const element = evt.target;
        const elementData = element?.data?.();
        if (!element || !elementData) return;

        const elementId = element.id();
        if (selectedIdRef?.current === elementId) {
          resetAllStyles();
          onClearTooltipRef.current?.();
          clearSelectionRefs();
          return;
        }

        applyHighlight(cyRef.current, element);

        const bbox = element.renderedBoundingBox?.();
        const offsetX = (bbox?.w ?? 50) + 200;
        const { x: mouseX, y: mouseY } = calculateTooltipPosition(element, evt, offsetX);
        const center = calculateTooltipPosition(element, null, 0);

        onShowTooltipRef.current?.(
          formatTapShowArgs(kind, element, evt, center, mouseX, mouseY),
        );

        if (selectedIdRef) selectedIdRef.current = elementId;
        if (peerSelectedIdRef) peerSelectedIdRef.current = null;
      } catch {
        /* ignore */
      }
    };
  }, [
    cyRef,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    onShowNodeTooltipRef,
    onShowEdgeTooltipRef,
    onClearTooltipRef,
    calculateTooltipPosition,
    resetAllStyles,
    clearSelectionRefs,
  ]);

  const tapNodeHandler = useMemo(() => createTapHandler('node'), [createTapHandler]);
  const tapEdgeHandler = useMemo(() => createTapHandler('edge'), [createTapHandler]);

  const tapBackgroundHandler = useCallback((evt) => {
    try {
      if (evt.target !== cyRef?.current) return;
      if (strictBackgroundClear) {
        const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
        if (!hasSelection) return;
      }
      resetAllStyles();
      onClearTooltipRef.current?.();
      clearSelectionRefs();
    } catch {
      /* ignore */
    }
  }, [cyRef, strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles, clearSelectionRefs, onClearTooltipRef]);

  const clearSelection = useCallback(() => {
    try {
      resetAllStyles();
      clearSelectionRefs();
    } catch {
      /* ignore */
    }
  }, [resetAllStyles, clearSelectionRefs]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
  };
}

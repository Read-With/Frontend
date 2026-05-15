import { useCallback, useRef, useEffect } from "react";
import { getContainerInfo, calculateCytoscapePosition, clearHighlightClassesOn } from '../../utils/graph/graphUtils';

function applyNodeClickHighlight(cy, node) {
  if (!cy || !node || node.length === 0) return;
  try {
    clearHighlightClassesOn(cy);
    const nodeId = String(node.id());
    const connectedEdges = node.connectedEdges();
    const directEdges = connectedEdges.filter((edge) => {
      const sourceId = String(edge.source().id());
      const targetId = String(edge.target().id());

      // 선택 노드에서 나가는 간선은 항상 유지
      if (sourceId === nodeId) return true;

      // 선택 노드로 들어오는 간선은, 반대 방향(outgoing) 간선이 있으면 제외
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
    const keepEdges = directEdges;
    applySelectionFade(cy, keepNodes, keepEdges, node, directEdges);
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
    // 이전 상태를 먼저 정리해 스타일 충돌을 방지
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
  const onShowNodeTooltipRef = useRef(onShowNodeTooltip);
  const onShowEdgeTooltipRef = useRef(onShowEdgeTooltip);
  const onClearTooltipRef = useRef(onClearTooltip);

  useEffect(() => {
    onShowNodeTooltipRef.current = onShowNodeTooltip;
  }, [onShowNodeTooltip]);

  useEffect(() => {
    onShowEdgeTooltipRef.current = onShowEdgeTooltip;
  }, [onShowEdgeTooltip]);

  useEffect(() => {
    onClearTooltipRef.current = onClearTooltip;
  }, [onClearTooltip]);

  const onAfterResetRef = useRef(onAfterReset);
  useEffect(() => { onAfterResetRef.current = onAfterReset; }, [onAfterReset]);

  const clearSelectionRefs = useCallback(() => {
    if (selectedNodeIdRef) selectedNodeIdRef.current = null;
    if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
  }, [selectedNodeIdRef, selectedEdgeIdRef]);

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    clearHighlightClassesOn(cyRef.current);
    if (onAfterResetRef.current) onAfterResetRef.current();
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
        } catch (_err) {
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

  const tapNodeHandler = useCallback(
    (evt) => {
      try {
        if (!cyRef?.current) return;

        const node = evt.target;
        const nodeData = node?.data?.();
        if (!node || !nodeData) return;

        const nodeId = node.id();
        const isSameNodeSelected = selectedNodeIdRef?.current === nodeId;

        if (isSameNodeSelected) {
          resetAllStyles();
          if (onClearTooltipRef.current) onClearTooltipRef.current();
          clearSelectionRefs();
          return;
        }

        applyNodeClickHighlight(cyRef.current, node);

        const nodeSize = node.renderedBoundingBox()?.w || 50;
        const offsetX = nodeSize + 200;
        const { x: mouseX, y: mouseY } = calculateTooltipPosition(node, evt, offsetX);
        const nodeCenter = calculateTooltipPosition(node, null, 0);

        if (onShowNodeTooltipRef.current) {
          onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
        }

        if (selectedNodeIdRef) selectedNodeIdRef.current = nodeId;
        if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
      } catch {
      }
    },
    [cyRef, calculateTooltipPosition, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles, clearSelectionRefs]
  );

  const nodeDragEndHandler = useCallback((_evt) => {
    const dragEndEvent = new CustomEvent('graphDragEnd', {
      detail: { type: 'graphDragEnd', timestamp: Date.now() }
    });
    document.dispatchEvent(dragEndEvent);
  }, []);

  const tapEdgeHandler = useCallback(
    (evt) => {
      try {
        if (!cyRef?.current) return;

        const edge = evt.target;
        const edgeData = edge?.data?.();
        if (!edge || !edgeData) return;

        const currentEdgeId = edge.id();
        const isSameEdgeSelected = selectedEdgeIdRef?.current === currentEdgeId;

        if (isSameEdgeSelected) {
          resetAllStyles();
          if (onClearTooltipRef.current) onClearTooltipRef.current();
          clearSelectionRefs();
          return;
        }

        applyEdgeClickHighlight(cyRef.current, edge);

        const edgeSize = edge.renderedBoundingBox?.()?.w ?? 50;
        const offsetX = edgeSize + 200;
        const { x: mouseX, y: mouseY } = calculateTooltipPosition(edge, evt, offsetX);
        const edgeCenter = calculateTooltipPosition(edge, null, 0);

        if (onShowEdgeTooltipRef.current) {
          onShowEdgeTooltipRef.current({ edge, evt, edgeCenter, mouseX, mouseY });
        }

        if (selectedEdgeIdRef) selectedEdgeIdRef.current = currentEdgeId;
        if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      } catch {
      }
    },
    [cyRef, selectedEdgeIdRef, selectedNodeIdRef, calculateTooltipPosition, resetAllStyles, clearSelectionRefs]
  );

  const handleBackgroundClick = useCallback(() => {
    try {
      if (strictBackgroundClear) {
        const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
        if (!hasSelection) return;
      }
      resetAllStyles();
      if (onClearTooltipRef.current) {
        onClearTooltipRef.current();
      }
      clearSelectionRefs();
    } catch {
    }
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles, clearSelectionRefs]);

  const tapBackgroundHandler = useCallback(
    (evt) => {
      try {
        if (evt.target === cyRef?.current) {
          handleBackgroundClick();
        }
      } catch {
      }
    },
    [cyRef, handleBackgroundClick]
  );

  const clearSelectionAndRebind = useCallback(() => {
    try {
      resetAllStyles();
      clearSelectionRefs();
    } catch {
    }
  }, [resetAllStyles, clearSelectionRefs]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    nodeDragEndHandler,
    clearSelection: clearSelectionAndRebind,
    clearAll: resetAllStyles,
  };
}

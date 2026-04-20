import { useCallback, useRef, useEffect } from "react";
import { getContainerInfo, calculateCytoscapePosition } from '../../utils/graph/graphUtils';

function clearHighlightClassesOn(cy) {
  if (!cy) return;
  try {
    const touched = cy
      .collection()
      .union(cy.nodes(".highlighted"))
      .union(cy.nodes(".faded"))
      .union(cy.edges(".highlighted"))
      .union(cy.edges(".faded"));
    if (touched.length === 0) return;
    cy.batch(() => {
      touched.removeClass("highlighted faded");
      touched.nodes().forEach((node) => {
        node.removeStyle("opacity");
        node.removeStyle("text-opacity");
        node.removeStyle("border-color");
        node.removeStyle("border-width");
        node.removeStyle("border-opacity");
        node.removeStyle("border-style");
      });
      touched.edges().forEach((edge) => {
        edge.removeStyle("opacity");
        edge.removeStyle("text-opacity");
        edge.removeStyle("width");
      });
    });
  } catch {
    /* ignore */
  }
}

function applyNodeClickHighlight(cy, node) {
  if (!cy || !node || node.length === 0) return;
  try {
    clearHighlightClassesOn(cy);
    const directEdges = node.connectedEdges();
    const keep = node.union(directEdges).union(directEdges.connectedNodes());
    const fadeEles = cy.elements().difference(keep);
    cy.batch(() => {
      node.addClass("highlighted");
      directEdges.addClass("highlighted");
      fadeEles.nodes().addClass("faded");
      fadeEles.edges().addClass("faded");
    });
  } catch {
    /* ignore */
  }
}

function applyEdgeClickHighlight(cy, edge) {
  if (!cy || !edge || edge.length === 0) return;
  try {
    clearHighlightClassesOn(cy);
    const src = edge.source();
    const tgt = edge.target();
    const keep = edge.union(src).union(tgt);
    const fadeEles = cy.elements().difference(keep);
    cy.batch(() => {
      edge.addClass("highlighted");
      src.addClass("highlighted");
      tgt.addClass("highlighted");
      fadeEles.nodes().addClass("faded");
      fadeEles.edges().addClass("faded");
    });
  } catch {
    /* ignore */
  }
}

export default function useGraphInteractions({
  cyRef,
  onShowNodeTooltip, 
  onShowEdgeTooltip,
  onClearTooltip, 
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
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

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    clearHighlightClassesOn(cyRef.current);
  }, [cyRef]);

  const clearStyles = useCallback(() => {
    resetAllStyles();
  }, [resetAllStyles]);

  const clearSelectionOnly = useCallback(() => {
    clearStyles();
  }, [clearStyles]);

  const clearAll = useCallback(() => {
    clearStyles();
  }, [clearStyles]);

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

  const calculateNodePosition = useCallback((node) => {
    return calculateTooltipPosition(node, null, 0);
  }, [calculateTooltipPosition]);

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
          if (selectedNodeIdRef) selectedNodeIdRef.current = null;
          if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
          return;
        }

        applyNodeClickHighlight(cyRef.current, node);

        const nodeSize = node.renderedBoundingBox()?.w || 50;
        const offsetX = nodeSize + 200;
        const { x: mouseX, y: mouseY } = calculateTooltipPosition(node, evt, offsetX);
        const nodeCenter = calculateNodePosition(node);

        if (onShowNodeTooltipRef.current) {
          onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
        }
        
        if (selectedNodeIdRef) selectedNodeIdRef.current = nodeId;
      } catch {
      }
    },
    [cyRef, calculateNodePosition, calculateTooltipPosition, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles]
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
          if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
          if (selectedNodeIdRef) selectedNodeIdRef.current = null;
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
    [cyRef, selectedEdgeIdRef, selectedNodeIdRef, calculateTooltipPosition, resetAllStyles]
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
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    } catch {
    }
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles]);

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
      clearSelectionOnly();
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    } catch {
    }
  }, [clearSelectionOnly, selectedNodeIdRef, selectedEdgeIdRef]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    nodeDragEndHandler,
    clearSelection: clearSelectionAndRebind,
    clearSelectionOnly,
    clearAll,
  };
}

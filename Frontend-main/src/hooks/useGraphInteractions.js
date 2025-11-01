import { useCallback, useRef, useEffect } from "react";
import { applySearchHighlight } from '../utils/searchUtils.jsx';
import { getContainerInfo, calculateCytoscapePosition } from '../utils/graphUtils';

export default function useGraphInteractions({
  cyRef,
  onShowNodeTooltip, 
  onShowEdgeTooltip,
  onClearTooltip, 
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
  isSearchActive = false, 
  filteredElements = [], 
}) {
  const onShowNodeTooltipRef = useRef(onShowNodeTooltip);
  const onShowEdgeTooltipRef = useRef(onShowEdgeTooltip);
  const onClearTooltipRef = useRef(onClearTooltip);
  const prewarmedOnceRef = useRef(false);

  useEffect(() => {
    onShowNodeTooltipRef.current = onShowNodeTooltip;
  }, [onShowNodeTooltip]);

  useEffect(() => {
    onShowEdgeTooltipRef.current = onShowEdgeTooltip;
  }, [onShowEdgeTooltip]);

  useEffect(() => {
    onClearTooltipRef.current = onClearTooltip;
  }, [onClearTooltip]);

  const removeInlineStyles = useCallback((cy, { includeOpacity = true } = {}) => {
    try {
      cy.nodes().forEach((node) => {
        try {
          node.removeStyle('border-color');
          node.removeStyle('border-width');
          node.removeStyle('border-opacity');
          node.removeStyle('border-style');
          if (includeOpacity) {
            node.removeStyle('opacity');
            node.removeStyle('text-opacity');
          }
        } catch {}
      });
      cy.edges().forEach((edge) => {
        try {
          edge.removeStyle('width');
          if (includeOpacity) {
            edge.removeStyle('opacity');
            edge.removeStyle('text-opacity');
          }
        } catch {}
      });
    } catch {}
  }, []);

  const forceStyleUpdate = useCallback((cy, { immediate = true, asyncFrames = 2 } = {}) => {
    if (immediate) {
      try {
        cy.style().update();
      } catch {}
    }
    
    if (asyncFrames > 0) {
      const scheduleUpdate = (remainingFrames) => {
        if (remainingFrames <= 0) return;
        requestAnimationFrame(() => {
          try {
            cy.style().update();
            scheduleUpdate(remainingFrames - 1);
          } catch {}
        });
      };
      scheduleUpdate(asyncFrames);
    }
  }, []);

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    
    const cy = cyRef.current;
    
    cy.batch(() => {
      cy.nodes().removeClass("highlighted").addClass("faded");
      cy.edges().removeClass("highlighted").addClass("faded");
    });
    
    removeInlineStyles(cy, { includeOpacity: true });
    forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
    
    requestAnimationFrame(() => {
      try {
        cy.nodes().forEach((node) => {
          if (!node.hasClass('faded')) {
            try { node.addClass('faded'); } catch {}
          }
        });
        cy.edges().forEach((edge) => {
          if (!edge.hasClass('faded')) {
            try { edge.addClass('faded'); } catch {}
          }
        });
        cy.style().update();
      } catch {}
    });
  }, [cyRef, removeInlineStyles, forceStyleUpdate]);

  const clearStyles = useCallback(() => {
    if (!cyRef?.current) return;
    
    const cy = cyRef.current;
    cy.batch(() => {
      cy.nodes().removeClass("faded highlighted");
      cy.edges().removeClass("faded highlighted");
    });
    removeInlineStyles(cy, { includeOpacity: true });
    forceStyleUpdate(cy, { immediate: true, asyncFrames: 0 });
  }, [cyRef, removeInlineStyles, forceStyleUpdate]);

  const clearSelectionOnly = useCallback(() => {
    clearStyles();
  }, [clearStyles]);

  const clearAll = useCallback(() => {
    clearStyles();
  }, [clearStyles]);

  useEffect(() => {
    const cy = cyRef?.current;
    if (!cy || prewarmedOnceRef.current) return;

    const doPrewarm = () => {
      if (prewarmedOnceRef.current) return;
      try {
        const nodes = cy.nodes();
        const edges = cy.edges();
        
        if (nodes.length === 0 && edges.length === 0) return;
        
        cy.batch(() => {
          if (nodes.length > 0) {
            nodes.addClass('highlighted');
          }
          if (edges.length > 0) {
            edges.addClass('highlighted');
          }
        });
        
        try {
          cy.style().update();
        } catch {}
        
        requestAnimationFrame(() => {
          try {
            cy.style().update();
            cy.batch(() => {
              nodes.removeClass('highlighted');
              edges.removeClass('highlighted');
            });
            cy.style().update();
            prewarmedOnceRef.current = true;
          } catch {
            prewarmedOnceRef.current = true;
          }
        });
      } catch {
        prewarmedOnceRef.current = true;
      }
    };

    if (cy.nodes().length > 0 || cy.edges().length > 0) {
      doPrewarm();
    } else {
      const handleFirstElement = () => {
        if (cy.nodes().length > 0 || cy.edges().length > 0) {
          doPrewarm();
          try { 
            cy.removeListener('add', 'node', handleFirstElement); 
            cy.removeListener('add', 'edge', handleFirstElement);
          } catch {}
        }
      };
      try { 
        cy.on('add', 'node', handleFirstElement);
        cy.on('add', 'edge', handleFirstElement);
      } catch {}
      return () => {
        try { 
          cy.removeListener('add', 'node', handleFirstElement);
          cy.removeListener('add', 'edge', handleFirstElement);
        } catch {}
      };
    }
  }, [cyRef]);

  const applyNodeHighlightStyles = useCallback((node) => {
    try {
      node.style('border-color', '#5C6F5C');
      node.style('border-width', 6);
      node.style('border-opacity', 1);
      node.style('border-style', 'solid');
      node.style('opacity', 1);
      node.style('text-opacity', 1);
      if (typeof node.raise === 'function') node.raise();
    } catch {}
  }, []);

  const applyEdgeHighlightStyles = useCallback((edge) => {
    try {
      edge.style('width', 8);
      edge.style('opacity', 1);
      edge.style('text-opacity', 1);
    } catch {}
  }, []);

  const handleNodeHighlight = useCallback((node) => {
    try {
      if (!cyRef?.current) return;
      
      const cy = cyRef.current;
      
      if (isSearchActive && filteredElements.length > 0) {
        removeInlineStyles(cy, { includeOpacity: false });
        try {
          cy.style().update();
        } catch {}
        applySearchHighlight(cy, node, filteredElements);
      } else {
        resetAllStyles();
        forceStyleUpdate(cy, { immediate: true, asyncFrames: 0 });
        
        const connectedEdges = node.connectedEdges();
        const neighborhoodNodes = node.neighborhood().nodes();
        
        cy.batch(() => {
          node.removeClass("faded").addClass("highlighted");
          connectedEdges.removeClass("faded").addClass("highlighted");
          neighborhoodNodes.removeClass("faded");
        });
        
        applyNodeHighlightStyles(node);
        connectedEdges.forEach((edge) => applyEdgeHighlightStyles(edge));
        
        neighborhoodNodes.forEach((nbNode) => {
          try {
            nbNode.removeStyle('border-color');
            nbNode.removeStyle('border-width');
            nbNode.removeStyle('border-opacity');
            nbNode.removeStyle('border-style');
            nbNode.style('opacity', 1);
            nbNode.style('text-opacity', 1);
          } catch {}
        });
        
        forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
      }
    } catch (error) {
      console.error('❌ [useGraphInteractions] handleNodeHighlight 오류:', error);
    }
  }, [cyRef, isSearchActive, filteredElements, resetAllStyles, removeInlineStyles, forceStyleUpdate, applyNodeHighlightStyles, applyEdgeHighlightStyles]);

  const calculateTooltipPosition = useCallback((element, evt, offset = 0) => {
    try {
      if (!cyRef?.current) return { x: 0, y: 0 };
      
      const cy = cyRef.current;
      const isNode = typeof element.renderedPosition === 'function';
      
      let basePos;
      if (isNode) {
        basePos = element.renderedPosition();
      } else {
        const midpoint = element.midpoint();
        basePos = { x: midpoint.x, y: midpoint.y };
      }
      
      const pan = cy.pan();
      const zoom = cy.zoom();
      
      let domX = basePos.x * zoom + pan.x;
      let domY = basePos.y * zoom + pan.y;
      
      if (evt?.originalEvent) {
        const { containerRect } = getContainerInfo();
        domX = evt.originalEvent.clientX - containerRect.left;
        domY = evt.originalEvent.clientY - containerRect.top;
      }
      
      if (offset > 0 && isNode) {
        domX += offset;
      }
      
      return { x: domX, y: domY };
    } catch (error) {
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

        const nodeSize = node.renderedBoundingBox()?.w || 50;
        const offsetX = nodeSize + 100;
        const { x: mouseX, y: mouseY } = calculateTooltipPosition(node, evt, offsetX);
        const nodeCenter = calculateNodePosition(node);

        handleNodeHighlight(node);

        if (onShowNodeTooltipRef.current) {
          onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
        }
        
        if (selectedNodeIdRef) selectedNodeIdRef.current = node.id();
      } catch (error) {
        console.error('❌ [useGraphInteractions] 노드 클릭 처리 오류:', error);
      }
    },
    [cyRef, handleNodeHighlight, calculateNodePosition, calculateTooltipPosition, onShowNodeTooltipRef, selectedNodeIdRef]
  );

  const nodeDragStartHandler = useCallback((evt) => {
  }, []);

  const nodeDragEndHandler = useCallback((evt) => {
    const dragEndEvent = new CustomEvent('graphDragEnd', {
      detail: { type: 'graphDragEnd', timestamp: Date.now() }
    });
    document.dispatchEvent(dragEndEvent);
  }, []);

  const tapEdgeHandler = useCallback(
    (evt) => {
      try {
        if (!cyRef?.current) return;
        
        const cy = cyRef.current;
        const edge = evt.target;
        const edgeData = edge?.data?.();
        if (!edge || !edgeData) return;

        const { x: mouseX, y: mouseY } = calculateTooltipPosition(edge, evt, 0);

        if (onShowEdgeTooltipRef.current) {
          onShowEdgeTooltipRef.current({ edge, evt, absoluteX: mouseX, absoluteY: mouseY });
        }

        resetAllStyles();
        forceStyleUpdate(cy, { immediate: true, asyncFrames: 0 });
        
        const srcNode = edge.source();
        const tgtNode = edge.target();
        
        cy.batch(() => {
          edge.removeClass("faded").addClass("highlighted");
          srcNode.removeClass("faded").addClass("highlighted");
          tgtNode.removeClass("faded").addClass("highlighted");
        });
        
        applyEdgeHighlightStyles(edge);
        applyNodeHighlightStyles(srcNode);
        applyNodeHighlightStyles(tgtNode);
        
        forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });

        if (selectedEdgeIdRef) selectedEdgeIdRef.current = edge.id();
      } catch (error) {
        console.error('❌ [useGraphInteractions] 간선 클릭 처리 오류:', error);
      }
    },
    [cyRef, onShowEdgeTooltipRef, selectedEdgeIdRef, resetAllStyles, calculateTooltipPosition, forceStyleUpdate, applyEdgeHighlightStyles, applyNodeHighlightStyles]
  );

  const handleBackgroundClick = useCallback((evt) => {
    try {
      const isDragEvent = evt && evt.detail && evt.detail.type === 'dragend';
      
      if (strictBackgroundClear) {
        const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
        if (!hasSelection) return;
      }
      
      clearStyles();
      
      if (!isDragEvent && onClearTooltipRef.current) {
        onClearTooltipRef.current();
      }
    } catch (error) {
    }
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, clearStyles, onClearTooltipRef]);

  const tapBackgroundHandler = useCallback(
    (evt) => {
      try {
        if (evt.target === cyRef?.current) {
          handleBackgroundClick();
        }
      } catch (error) {
      }
    },
    [cyRef, handleBackgroundClick]
  );

  const clearSelectionAndRebind = useCallback(() => {
    try {
      clearSelectionOnly();
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    } catch (error) {
    }
  }, [clearSelectionOnly, selectedNodeIdRef, selectedEdgeIdRef]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    nodeDragStartHandler,
    nodeDragEndHandler,
    clearSelection: clearSelectionAndRebind,
    clearSelectionOnly,
    clearAll,
  };
}
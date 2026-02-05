import { useCallback, useRef, useEffect } from "react";
import { applySearchHighlight } from '../../utils/searchUtils.jsx';
import { getContainerInfo, calculateCytoscapePosition } from '../../utils/graph/graphUtils';

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

  const forceStyleUpdate = useCallback((cy, { immediate = true } = {}) => {
    if (!cy) return;
    if (immediate) {
      try {
        cy.style().update();
      } catch (error) {
        console.debug('forceStyleUpdate 실패:', error);
      }
    }
  }, []);

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    
    const cy = cyRef.current;
    
    cy.batch(() => {
      cy.nodes().removeClass("highlighted faded");
      cy.edges().removeClass("highlighted faded");
      cy.nodes().removeStyle('opacity');
      cy.nodes().removeStyle('text-opacity');
      cy.nodes().removeStyle('border-color');
      cy.nodes().removeStyle('border-width');
      cy.nodes().removeStyle('border-opacity');
      cy.nodes().removeStyle('border-style');
      cy.edges().removeStyle('opacity');
      cy.edges().removeStyle('text-opacity');
      cy.edges().removeStyle('width');
    });
    
    forceStyleUpdate(cy, { immediate: true });
  }, [cyRef, forceStyleUpdate]);

  const clearStyles = useCallback(() => {
    resetAllStyles();
  }, [resetAllStyles]);

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
        } catch (error) {
          console.debug('prewarm style update 실패:', error);
        }
        
        requestAnimationFrame(() => {
          try {
            cy.style().update();
            cy.batch(() => {
              nodes.removeClass('highlighted');
              edges.removeClass('highlighted');
            });
            cy.style().update();
            prewarmedOnceRef.current = true;
          } catch (error) {
            console.debug('prewarm cleanup 실패:', error);
            prewarmedOnceRef.current = true;
          }
        });
      } catch (error) {
        console.debug('prewarm 실행 실패:', error);
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
          } catch (error) {
            console.debug('listener 제거 실패:', error);
          }
        }
      };
      try { 
        cy.on('add', 'node', handleFirstElement);
        cy.on('add', 'edge', handleFirstElement);
      } catch (error) {
        console.debug('listener 등록 실패:', error);
      }
      return () => {
        try { 
          cy.removeListener('add', 'node', handleFirstElement);
          cy.removeListener('add', 'edge', handleFirstElement);
        } catch (error) {
          console.debug('cleanup listener 제거 실패:', error);
        }
      };
    }
  }, [cyRef]);

  const handleNodeHighlight = useCallback((node) => {
    try {
      if (!cyRef?.current) return;

      const cy = cyRef.current;

      if (isSearchActive && filteredElements.length > 0) {
        applySearchHighlight(cy, node, filteredElements);
        forceStyleUpdate(cy, { immediate: true });
        return;
      }

      const cyNodes = cy.nodes();
      const cyEdges = cy.edges();

      let connectedNodes = cy.collection([node]);
      if (typeof node.closedNeighborhood === 'function') {
        try {
          connectedNodes = node.closedNeighborhood().nodes();
        } catch (error) {
          console.debug('closedNeighborhood 호출 실패:', error);
          connectedNodes = cy.collection([node]);
        }
      }

      let connectedEdges = node.connectedEdges ? node.connectedEdges() : cy.collection();
      if (!connectedEdges || typeof connectedEdges.length !== 'number') {
        connectedEdges = cy.collection();
      }

      cy.batch(() => {
        cyNodes.removeClass("highlighted faded");
        cyEdges.removeClass("highlighted faded");

        connectedNodes.addClass("highlighted");
        connectedEdges.addClass("highlighted");

        const fadedNodes = cyNodes.difference(connectedNodes);
        const fadedEdges = cyEdges.difference(connectedEdges);

        fadedNodes.addClass("faded");
        fadedEdges.addClass("faded");
      });

      forceStyleUpdate(cy, { immediate: true });
    } catch (error) {
      console.debug('handleNodeHighlight 실패:', error);
    }
  }, [cyRef, isSearchActive, filteredElements, forceStyleUpdate]);

  const calculateTooltipPosition = useCallback((element, evt, offset = 0) => {
    try {
      if (!cyRef?.current) return { x: 0, y: 0 };
      
      const cy = cyRef.current;
      const { containerRect } = getContainerInfo();
      
      const isEdge = element && typeof element.midpoint === 'function';
      const edgeTooltipOffsetX = 60;

      // 마우스 클릭 이벤트가 있으면 마우스 위치를 우선 사용
      if (evt?.originalEvent) {
        let domX = evt.originalEvent.clientX - containerRect.left;
        let domY = evt.originalEvent.clientY - containerRect.top;

        if (offset > 0) domX += offset;
        if (isEdge) domX -= edgeTooltipOffsetX;

        return { x: domX, y: domY };
      }
      
      // 마우스 이벤트가 없으면 element 위치 계산
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
        } catch (err) {
          basePos = { x: 0, y: 0 };
        }
      }
      
      // calculateCytoscapePosition을 사용하여 정확한 컨테이너 기준 좌표 계산
      if (!basePos || typeof basePos.x !== 'number' || typeof basePos.y !== 'number') {
        return { x: 0, y: 0 };
      }
      
      const position = calculateCytoscapePosition(basePos, cyRef);
      
      let domX = position.x - containerRect.left;
      let domY = position.y - containerRect.top;

      if (offset > 0 && isNode) domX += offset;
      if (isEdge) domX -= edgeTooltipOffsetX;

      return { x: domX, y: domY };
    } catch (error) {
      console.debug('calculateTooltipPosition 실패:', error);
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
          if (onClearTooltipRef.current) onClearTooltipRef.current();
          if (selectedNodeIdRef) selectedNodeIdRef.current = null;
          if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
          resetAllStyles();
          return;
        }

        const nodeSize = node.renderedBoundingBox()?.w || 50;
        const offsetX = nodeSize + 100;
        const { x: mouseX, y: mouseY } = calculateTooltipPosition(node, evt, offsetX);
        const nodeCenter = calculateNodePosition(node);

        handleNodeHighlight(node);

        if (onShowNodeTooltipRef.current) {
          onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
        }
        
        if (selectedNodeIdRef) selectedNodeIdRef.current = nodeId;
      } catch (error) {
        console.debug('tapNodeHandler 실패:', error);
      }
    },
    [cyRef, handleNodeHighlight, calculateNodePosition, calculateTooltipPosition, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles]
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

        const currentEdgeId = edge.id();
        const isSameEdgeSelected = selectedEdgeIdRef?.current === currentEdgeId;

        if (isSameEdgeSelected) {
          if (onClearTooltipRef.current) onClearTooltipRef.current();
          if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
          if (selectedNodeIdRef) selectedNodeIdRef.current = null;
          resetAllStyles();
          return;
        }

        const { x: mouseX, y: mouseY } = calculateTooltipPosition(edge, evt, 0);
        const edgeCenter = calculateTooltipPosition(edge, null, 0);

        const connectedNodes = edge.connectedNodes ? edge.connectedNodes() : cy.collection();
        const edgeCollection = cy.collection([edge]);

        const cyNodes = cy.nodes();
        const cyEdges = cy.edges();

        cy.batch(() => {
          cyNodes.removeClass("highlighted faded");
          cyEdges.removeClass("highlighted faded");

          connectedNodes.addClass("highlighted");
          edgeCollection.addClass("highlighted");

          const fadedNodes = cyNodes.difference(connectedNodes);
          const fadedEdges = cyEdges.difference(edgeCollection);

          fadedNodes.addClass("faded");
          fadedEdges.addClass("faded");
        });

        forceStyleUpdate(cy, { immediate: true });

        if (onShowEdgeTooltipRef.current) {
          onShowEdgeTooltipRef.current({ edge, evt, edgeCenter, mouseX, mouseY });
        }

        if (selectedEdgeIdRef) selectedEdgeIdRef.current = currentEdgeId;
        if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      } catch (error) {
        console.debug('tapEdgeHandler 실패:', error);
      }
    },
    [cyRef, selectedEdgeIdRef, selectedNodeIdRef, resetAllStyles, calculateTooltipPosition, forceStyleUpdate]
  );

  const handleBackgroundClick = useCallback(() => {
    try {
      if (strictBackgroundClear) {
        const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
        if (!hasSelection) return;
      }
      if (onClearTooltipRef.current) {
        onClearTooltipRef.current();
      }
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
      resetAllStyles();
    } catch (error) {
      console.debug('handleBackgroundClick 실패:', error);
    }
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles]);

  const tapBackgroundHandler = useCallback(
    (evt) => {
      try {
        if (evt.target === cyRef?.current) {
          handleBackgroundClick();
        }
      } catch (error) {
        console.debug('tapBackgroundHandler 실패:', error);
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
      console.debug('clearSelectionAndRebind 실패:', error);
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
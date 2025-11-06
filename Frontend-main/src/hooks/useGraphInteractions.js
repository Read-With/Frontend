import { useCallback, useRef, useEffect } from "react";
import { applySearchHighlight, createFilteredElementIds } from '../utils/searchUtils.jsx';
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
      cy.nodes().removeClass("highlighted faded");
      cy.edges().removeClass("highlighted faded");
    });
    
    removeInlineStyles(cy, { includeOpacity: true });
    forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
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
      node.style('border-width', 4);
      node.style('border-opacity', 1);
      node.style('border-style', 'solid');
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
        cy.style().update();
        
        applySearchHighlight(cy, node, filteredElements);
        
        forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
      } else {
        cy.nodes().forEach((n) => {
          n.removeStyle('border-color');
          n.removeStyle('border-width');
          n.removeStyle('border-opacity');
          n.removeStyle('border-style');
        });
        cy.edges().forEach((e) => {
          e.removeStyle('width');
        });

        const clickedNodeId = node.id();
        const connectedEdges = node.connectedEdges();
        const connectedNodeIds = new Set([clickedNodeId]);
        const connectedEdgeIds = new Set();

        connectedEdges.forEach((edge) => {
          const edgeId = edge.id();
          const sourceId = edge.source().id();
          const targetId = edge.target().id();
          
          connectedEdgeIds.add(edgeId);
          connectedNodeIds.add(sourceId);
          connectedNodeIds.add(targetId);
        });

        const fadeOpacity = 0.05;
        const textFadeOpacity = 0.02;

        cy.batch(() => {
          cy.nodes().removeClass("highlighted faded");
          cy.edges().removeClass("highlighted faded");
          
          cy.nodes().forEach((n) => {
            if (connectedNodeIds.has(n.id())) {
              n.addClass("highlighted");
              n.style('opacity', '');
              n.style('text-opacity', '');
            } else {
              n.addClass("faded");
              n.style('opacity', fadeOpacity);
              n.style('text-opacity', textFadeOpacity);
            }
          });

          cy.edges().forEach((edge) => {
            if (connectedEdgeIds.has(edge.id())) {
              edge.addClass("highlighted");
              edge.style('opacity', '');
            } else {
              edge.addClass("faded");
              edge.style('opacity', fadeOpacity);
            }
          });
        });

        forceStyleUpdate(cy, { immediate: true, asyncFrames: 0 });

        applyNodeHighlightStyles(node);
        connectedEdges.forEach((edge) => applyEdgeHighlightStyles(edge));

        forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
      }
    } catch (error) {
    }
  }, [cyRef, isSearchActive, filteredElements, removeInlineStyles, forceStyleUpdate, applyNodeHighlightStyles, applyEdgeHighlightStyles]);

  const calculateTooltipPosition = useCallback((element, evt, offset = 0) => {
    try {
      if (!cyRef?.current) return { x: 0, y: 0 };
      
      const cy = cyRef.current;
      const { containerRect } = getContainerInfo();
      
      // 마우스 클릭 이벤트가 있으면 마우스 위치를 우선 사용
      if (evt?.originalEvent) {
        let domX = evt.originalEvent.clientX - containerRect.left;
        let domY = evt.originalEvent.clientY - containerRect.top;
        
        // 노드의 경우 offset 추가
        if (offset > 0) {
          domX += offset;
        }
        
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
        const edgeCenter = calculateTooltipPosition(edge, null, 0);

        const srcNode = edge.source();
        const tgtNode = edge.target();
        const srcId = srcNode.id();
        const tgtId = tgtNode.id();
        const edgeId = edge.id();

        const connectedNodeIds = new Set([srcId, tgtId]);
        const connectedEdgeIds = new Set([edgeId]);

        const fadeOpacity = 0.05;
        const textFadeOpacity = 0.02;

        cy.nodes().forEach((n) => {
          n.removeStyle('border-color');
          n.removeStyle('border-width');
          n.removeStyle('border-opacity');
          n.removeStyle('border-style');
        });
        cy.edges().forEach((e) => {
          e.removeStyle('width');
        });

        if (isSearchActive && filteredElements.length > 0) {
          const filteredElementIds = new Set();
          filteredElements.forEach(element => {
            if (element?.data) {
              if (element.data.source) {
                filteredElementIds.add(element.data.source);
                filteredElementIds.add(element.data.target);
              } else {
                filteredElementIds.add(element.data.id);
              }
            }
          });

          cy.batch(() => {
            cy.nodes().removeClass("highlighted faded");
            cy.edges().removeClass("highlighted faded");

            cy.nodes().forEach((n) => {
              const nodeId = n.id();
              if (connectedNodeIds.has(nodeId)) {
                n.addClass("highlighted");
                n.style('opacity', '');
                n.style('text-opacity', '');
              } else if (filteredElementIds.has(nodeId)) {
                n.addClass("faded");
                n.style('opacity', fadeOpacity);
                n.style('text-opacity', textFadeOpacity);
              } else {
                n.addClass("faded");
                n.style('opacity', fadeOpacity);
                n.style('text-opacity', textFadeOpacity);
              }
            });

            cy.edges().forEach((e) => {
              const eId = e.id();
              if (connectedEdgeIds.has(eId)) {
                e.addClass("highlighted");
                e.style('opacity', '');
              } else {
                e.addClass("faded");
                e.style('opacity', fadeOpacity);
              }
            });
          });

          forceStyleUpdate(cy, { immediate: true, asyncFrames: 0 });

          applyEdgeHighlightStyles(edge);
          applyNodeHighlightStyles(srcNode);
          applyNodeHighlightStyles(tgtNode);

          forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
        } else {
          resetAllStyles();
          forceStyleUpdate(cy, { immediate: true, asyncFrames: 0 });

          const srcNode = edge.source();
          const tgtNode = edge.target();
          const connectedNodeIds = new Set([srcNode.id(), tgtNode.id()]);

          const fadeOpacity = 0.05;
          const textFadeOpacity = 0.02;

          cy.batch(() => {
            cy.nodes().forEach((n) => {
              if (connectedNodeIds.has(n.id())) {
                n.removeClass("faded").addClass("highlighted");
                n.style('opacity', '');
                n.style('text-opacity', '');
              } else {
                n.removeClass("highlighted").addClass("faded");
                n.style('opacity', fadeOpacity);
                n.style('text-opacity', textFadeOpacity);
              }
            });

            cy.edges().forEach((e) => {
              if (e.id() === edge.id()) {
                e.removeClass("faded").addClass("highlighted");
                e.style('opacity', '');
              } else {
                e.removeClass("highlighted").addClass("faded");
                e.style('opacity', fadeOpacity);
              }
            });
          });

          applyEdgeHighlightStyles(edge);
          applyNodeHighlightStyles(srcNode);
          applyNodeHighlightStyles(tgtNode);

          forceStyleUpdate(cy, { immediate: true, asyncFrames: 2 });
        }

        if (onShowEdgeTooltipRef.current) {
          onShowEdgeTooltipRef.current({ edge, evt, edgeCenter, mouseX, mouseY });                                                                              
        }

        if (selectedEdgeIdRef) selectedEdgeIdRef.current = edge.id();
      } catch (error) {
      }
    },
    [cyRef, isSearchActive, filteredElements, onShowEdgeTooltipRef, selectedEdgeIdRef, resetAllStyles, calculateTooltipPosition, forceStyleUpdate, applyEdgeHighlightStyles, applyNodeHighlightStyles]                                                                            
  );

  const handleBackgroundClick = useCallback((evt) => {
    try {
      const isDragEvent = evt && evt.detail && evt.detail.type === 'dragend';
      
      if (strictBackgroundClear) {
        const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
        if (!hasSelection) return;
      }
      
      resetAllStyles();
      
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
      
      if (!isDragEvent && onClearTooltipRef.current) {
        onClearTooltipRef.current();
      }
    } catch (error) {
    }
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, resetAllStyles, onClearTooltipRef]);

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
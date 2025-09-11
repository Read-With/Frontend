import React, { useEffect, useRef, useState, useCallback, createContext } from "react";
import cytoscape from "cytoscape";
import "./RelationGraph.css";
import { detectAndResolveOverlap, calcGraphDiff } from "../../utils/graphDataUtils.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../utils/searchUtils.jsx";
import useGraphInteractions from "../../hooks/useGraphInteractions.js";

// Ripple 효과 생성 함수 - 확대/축소 상태 고려
const createRippleEffect = (container, x, y, cyRef) => {
  const ripple = document.createElement('div');
  ripple.className = 'ripple-effect';
  ripple.style.position = 'absolute';
  
  let domX, domY;
  if (cyRef?.current) {
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const containerRect = container.getBoundingClientRect();
    
    // Cytoscape 좌표를 DOM 좌표로 정확히 변환
    domX = x * zoom + pan.x;
    domY = y * zoom + pan.y;
  } else {
    domX = x;
    domY = y;
  }
  
  ripple.style.left = `${domX - 50}px`;
  ripple.style.top = `${domY - 50}px`;
  
  ripple.style.pointerEvents = 'none';
  ripple.style.zIndex = '1000';
  
  container.appendChild(ripple);

  setTimeout(() => {
    if (ripple.parentNode) {
      ripple.parentNode.removeChild(ripple);
    }
  }, 500);
};

export const CytoscapeGraphContext = createContext();

const CytoscapeGraphUnified = ({
  elements,
  stylesheet,
  layout,
  tapNodeHandler,  
  tapEdgeHandler,
  tapBackgroundHandler,
  fitNodeIds, 
  style = {},
  cyRef: externalCyRef,
  newNodeIds = [],
  onLayoutComplete,
  nodeSize = 40,
  searchTerm = "",
  isSearchActive = false,
  filteredElements = [],
  isResetFromSearch = false,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const [previousElements, setPreviousElements] = useState([]);
  const prevChapterRef = useRef(window.currentChapter);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const isDraggingRef = useRef(false);
  const prevMouseDownPositionRef = useRef({ x: 0, y: 0 });
  const mouseDownTimeRef = useRef(0);
  const hasMovedRef = useRef(false);
  const isMouseDownRef = useRef(false);

  const {
    tapNodeHandler: hookTapNodeHandler,
    tapEdgeHandler: hookTapEdgeHandler,
    tapBackgroundHandler: hookTapBackgroundHandler,
  } = useGraphInteractions({
    cyRef: externalCyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear,
    isSearchActive,
    filteredElements,
  });

  // 챕터 변경 감지
  useEffect(() => {
    const cy = externalCyRef?.current;
    
    if (!cy || !elements || elements.length === 0) {
      return;
    }

    const checkChapterChange = () => {
      if (window.currentChapter !== undefined) {
        const currentChapter = window.currentChapter;
        if (currentChapter !== prevChapterRef.current) {
          setIsInitialLoad(true);
          setPreviousElements([]);
          prevChapterRef.current = currentChapter;
        }
      }
    };

    checkChapterChange();

    if (previousElements.length === 0) {
      setPreviousElements(elements);
      return;
    }

    const diff = calcGraphDiff(previousElements, elements);
    setPreviousElements(elements);
  }, [elements, externalCyRef, previousElements]);

  // Cytoscape 인스턴스 생성
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    let cyInstance = externalCyRef?.current;
    if (!cyInstance || typeof cyInstance.container !== 'function') {
      cyInstance = cytoscape({
        container: containerRef.current,
        elements: [],
        style: stylesheet,
        layout: { name: "preset" },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        minZoom: 0.3,
        maxZoom: 1.8,
        wheelSensitivity: 1,
        autoungrabify: false,
        autolock: false,
        autounselectify: false,
        selectionType: 'single',
        touchTapThreshold: 8,
        desktopTapThreshold: 4,
      });
      if (externalCyRef) externalCyRef.current = cyInstance;
    } else {
      if (cyInstance.container() !== containerRef.current) {
        cyInstance.mount(containerRef.current);
      }
    }
    
    const cy = cyInstance;
    
    const CLICK_THRESHOLD = 200;
    const MOVE_THRESHOLD = 3;
    
    const handleMouseDown = (evt) => {
      if (evt.target !== evt.currentTarget) return;
      
      isMouseDownRef.current = true;
      mouseDownTimeRef.current = Date.now();
      prevMouseDownPositionRef.current = { x: evt.clientX, y: evt.clientY };
      hasMovedRef.current = false;
      isDraggingRef.current = false;
    };
    
    const handleMouseMove = (evt) => {
      if (!isMouseDownRef.current) return;
      
      const deltaX = Math.abs(evt.clientX - prevMouseDownPositionRef.current.x);
      const deltaY = Math.abs(evt.clientY - prevMouseDownPositionRef.current.y);
      
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        hasMovedRef.current = true;
        isDraggingRef.current = true;
      }
    };
    
    const handleMouseUp = (evt) => {
      if (!isMouseDownRef.current) return;
      
      const clickDuration = Date.now() - mouseDownTimeRef.current;
      const isClick = clickDuration < CLICK_THRESHOLD && !hasMovedRef.current;
      
      if (isDraggingRef.current) {
        isMouseDownRef.current = false;
        mouseDownTimeRef.current = 0;
        hasMovedRef.current = false;
        isDraggingRef.current = false;
        return;
      }
      
      isMouseDownRef.current = false;
      mouseDownTimeRef.current = 0;
      hasMovedRef.current = false;
      isDraggingRef.current = false;
    };
    
    const container = containerRef.current;
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    
    const handleDragFreeOn = () => {
      setTimeout(() => {
        detectAndResolveOverlap(cy, nodeSize);
      }, 50);
    };

    const handleDrag = (evt) => {
      const node = evt.target;
      node.style('transition-property', 'none');
    };

    const handleDragFree = (evt) => {
      const node = evt.target;
      node.style('transition-property', 'position');
    };

    cy.on('dragfreeon', 'node', handleDragFreeOn);
    cy.on('drag', 'node', handleDrag);
    cy.on('dragfree', 'node', handleDragFree);
    
    return () => {
      cy.removeListener('dragfreeon', 'node', handleDragFreeOn);
      cy.removeListener('drag', 'node', handleDrag);
      cy.removeListener('dragfree', 'node', handleDragFree);
      
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
    };
  }, [externalCyRef, nodeSize]);

  // 이벤트 핸들러 등록
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) return;
    
    cy.removeListener('tap', 'node');
    cy.removeListener('tap', 'edge');
    cy.removeListener('tap');
    
    const createRippleWrapper = (originalHandler) => (evt) => {
      if (containerRef.current && cy) {
        let x, y;
        
        if (evt.renderedPosition) {
          x = evt.renderedPosition.x;
          y = evt.renderedPosition.y;
        } else if (evt.originalEvent) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const clientX = evt.originalEvent.clientX - containerRect.left;
          const clientY = evt.originalEvent.clientY - containerRect.top;
          
          const pan = cy.pan();
          const zoom = cy.zoom();
          // 마우스 위치를 Cytoscape 좌표로 정확히 변환
          x = (clientX - pan.x) / zoom;
          y = (clientY - pan.y) / zoom;
        }
        
        if (x !== undefined && y !== undefined) {
          createRippleEffect(containerRef.current, x, y, cy);
        }
      }
      
      if (originalHandler) {
        originalHandler(evt);
      }
    };
    
    if (tapNodeHandler) {
      cy.on("tap", "node", createRippleWrapper(tapNodeHandler));
    } else {
      cy.on("tap", "node", createRippleWrapper(hookTapNodeHandler));
    }
    if (tapEdgeHandler) {
      cy.on("tap", "edge", createRippleWrapper(tapEdgeHandler));
    } else {
      cy.on("tap", "edge", createRippleWrapper(hookTapEdgeHandler));
    }
    
    const handleBackgroundTap = (evt) => {
      // 배경 클릭 감지 - evt.target이 Cytoscape core인 경우
      if (evt.target === cy) {
        // 드래그가 아닌 순수 클릭인 경우에만 처리
        if (!isDraggingRef.current) {
          if (tapBackgroundHandler) {
            createRippleWrapper(tapBackgroundHandler)(evt);
          } else {
            createRippleWrapper(hookTapBackgroundHandler)(evt);
          }
        }
      }
    };
    
    cy.on("tap", handleBackgroundTap);
    
    return () => {
      cy.removeListener("tap", "node");
      cy.removeListener("tap", "edge");
      cy.removeListener("tap", handleBackgroundTap);
    };
  }, [externalCyRef, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, hookTapNodeHandler, hookTapEdgeHandler, hookTapBackgroundHandler, isDraggingRef]);

  // elements diff patch 및 스타일/레이아웃 적용
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) {
      return;
    }
  
    if (previousElements.length === 0) {
      setPreviousElements(elements);
    }
    
    if (!elements || elements.length === 0) {
      cy.elements().remove();
      setIsGraphVisible(false);
      return;
    }
    
    cy.batch(() => {
      const prevNodeIds = new Set(cy.nodes().map(n => n.id()));
      const prevEdgeIds = new Set(cy.edges().map(e => e.id()));
      const nextNodeIds = new Set(elements.filter(e => !e.data.source).map(e => e.data.id));
      const nextEdgeIds = new Set(elements.filter(e => e.data.source).map(e => e.data.id));
      
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });
      
      const nodes = elements.filter(e => !e.data.source && !e.data.target);
      const edges = elements.filter(e => e.data.source && e.data.target);
      
      const NODE_SIZE = nodeSize;
      const MIN_DISTANCE = NODE_SIZE * 2.8;
      const placedPositions = nodes
        .filter(node => prevNodeIds.has(node.data.id) && node.position)
        .map(node => node.position);
      const newNodes = nodes.filter(node => !prevNodeIds.has(node.data.id));
      
      newNodes.forEach(node => {
        let found = false;
        let x, y;
        let attempts = 0;
        const maxAttempts = 100;
        while (!found && attempts < maxAttempts) {
          const angle = Math.random() * 2 * Math.PI;
          const radius = 100 + Math.random() * 100;
          x = Math.cos(angle) * radius;
          y = Math.sin(angle) * radius;
          found = placedPositions.every(pos => {
            const dx = x - pos.x;
            const dy = y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) > MIN_DISTANCE;
          });
          attempts++;
        }
        node.position = { x, y };
        placedPositions.push({ x, y });
      });
      
      const nodesToAdd = nodes.filter(node => !prevNodeIds.has(node.data.id));
      const edgesToAdd = edges.filter(edge => !prevEdgeIds.has(edge.data.id));
      if (nodesToAdd.length > 0) {
        cy.add(nodesToAdd);
      }
      if (edgesToAdd.length > 0) {
        cy.add(edgesToAdd);
      }
      
      if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
        cy.layout({ name: 'preset' }).run();
        
        if (stylesheet) cy.style(stylesheet);
        
        if (layout && layout.name !== 'preset') {
          const layoutInstance = cy.layout({
            ...layout,
            animationDuration: 800,
            animationEasing: 'ease-out'
          });
          layoutInstance.on('layoutstop', () => {
            setTimeout(() => {
              detectAndResolveOverlap(cy, nodeSize);
              
              if (nodesToAdd.length > 0 && !isInitialLoad && !isResetFromSearch) {
                nodesToAdd.forEach(node => {
                  const cyNode = cy.getElementById(node.data.id);
                  if (cyNode.length > 0) {
                    const position = cyNode.renderedPosition();
                    const domX = position.x;
                    const domY = position.y;
                    
                    createRippleEffect(containerRef.current, domX, domY, null);
                  }
                });
              }
              
              if (onLayoutComplete) onLayoutComplete();
            }, 200);
          });
          layoutInstance.run();
        } else {
          setTimeout(() => {
            detectAndResolveOverlap(cy, nodeSize);
            
            if (nodesToAdd.length > 0 && !isInitialLoad && !isResetFromSearch) {
              nodesToAdd.forEach(node => {
                const cyNode = cy.getElementById(node.data.id);
                if (cyNode.length > 0) {
                  const position = cyNode.renderedPosition();
                  const domX = position.x;
                  const domY = position.y;
                  createRippleEffect(containerRef.current, domX, domY, null);
                }
              });
            }
            
            if (onLayoutComplete) onLayoutComplete();
          }, 150);
        }
      } else {
        if (stylesheet) cy.style(stylesheet);
      }
      
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) {
          cy.fit(nodes, 60);
          
          cy.nodes().removeClass('search-highlight');
          nodes.addClass('search-highlight');
          
          cy.nodes().style('width', nodeSize);
          cy.nodes().style('height', nodeSize);
          nodes.style('width', nodeSize * 1.2);
          nodes.style('height', nodeSize * 1.2);
        }
      } else {
        // 검색이 비활성화된 상태에서는 fit을 호출하지 않음 (확대/축소 상태 유지)
        if (!isSearchActive) {
          cy.nodes().removeClass('search-highlight');
          cy.nodes().style('width', nodeSize);
          cy.nodes().style('height', nodeSize);
        }
      }
      
      if (isSearchActive || filteredElements.length > 0) {
        applySearchFadeEffect(cy, filteredElements, isSearchActive);
      }
    });
    
    if (isInitialLoad) {
      setIsInitialLoad(false);
    }
    
    setIsGraphVisible(true);
  }, [elements, externalCyRef, previousElements, isInitialLoad, stylesheet, layout, nodeSize, fitNodeIds, isSearchActive, filteredElements, onLayoutComplete, isResetFromSearch]);

  // 크기 반응형
  useEffect(() => {
    const handleResize = () => {
      if (externalCyRef?.current) externalCyRef.current.resize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [externalCyRef]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#ffffff",
        ...style,
        position: "relative",
        overflow: "hidden",
        zIndex: 1,
        visibility: isGraphVisible ? "visible" : "hidden",
        minHeight: "400px",
        minWidth: "450px",
      }}
      className="graph-canvas-area"
    >
      {shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds) && (
        (() => {
          const message = getNoSearchResultsMessage(searchTerm);
          return (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(255, 255, 255, 0.95)',
              padding: '20px 30px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e3e6ef',
              zIndex: 1000,
              textAlign: 'center',
              maxWidth: '300px'
            }}>
              <div style={{
                fontSize: '18px',
                fontWeight: '600',
                color: '#64748b',
                marginBottom: '8px'
              }}>
                {message.title}
              </div>
              <div style={{
                fontSize: '14px',
                color: '#94a3b8',
                lineHeight: '1.4'
              }}>
                {message.description}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
};

export default CytoscapeGraphUnified; 

export function CytoscapeGraphPortalProvider({ children }) {
  const [graphProps, setGraphProps] = useState({
    elements: [],
    stylesheet: [],
    layout: { name: "preset" },
    tapNodeHandler: undefined,
    tapEdgeHandler: undefined,
    tapBackgroundHandler: undefined,
    fitNodeIds: undefined,
    style: {},
    newNodeIds: [],
  });

  const updateGraph = useCallback((newProps) => {
    setGraphProps((prev) => ({ ...prev, ...newProps }));
  }, []);

  return (
    <CytoscapeGraphContext.Provider value={{ graphProps, updateGraph }}>
      {children}
      <CytoscapeGraphUnified {...graphProps} />
    </CytoscapeGraphContext.Provider>
  );
}
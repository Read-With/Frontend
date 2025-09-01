import React, { useEffect, useRef, useState, useCallback, createContext } from "react";
import cytoscape from "cytoscape";
import "./RelationGraph.css";
import { detectAndResolveOverlap, calcGraphDiff } from "../../utils/graphDataUtils.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../utils/searchUtils.jsx";
import useGraphInteractions from "../../hooks/useGraphInteractions.js";

// Ripple 효과 생성 함수
const createRippleEffect = (container, x, y, cyRef) => {
  const ripple = document.createElement('div');
  ripple.className = 'ripple-effect';
  ripple.style.position = 'absolute';
  
  // Cytoscape 좌표계를 DOM 좌표계로 변환
  let domX, domY;
  if (cyRef?.current) {
    const pan = cyRef.current.pan();
    const zoom = cyRef.current.zoom();
    domX = x * zoom + pan.x;
    domY = y * zoom + pan.y;
  } else {
    domX = x;
    domY = y;
  }
  
  // ripple 중심 (50px, 50px)이 마우스 클릭 위치와 동일하도록 보정
  ripple.style.left = `${domX - 50}px`;
  ripple.style.top = `${domY - 50}px`;
  
  ripple.style.pointerEvents = 'none';
  ripple.style.zIndex = '1000';
  
  container.appendChild(ripple);

  // 500ms 후 ripple 요소 제거
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
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
  isResetFromSearch = false,
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const [previousElements, setPreviousElements] = useState([]);
  const prevChapterRef = useRef(window.currentChapter); // 이전 챕터를 저장할 ref
  const [isInitialLoad, setIsInitialLoad] = useState(true); // 초기 로드 여부를 저장할 state

  // useGraphInteractions 훅 사용
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

    // 챕터 변경 감지
    const checkChapterChange = () => {
      if (window.currentChapter !== undefined) {
        const currentChapter = window.currentChapter;
        if (currentChapter !== prevChapterRef.current) {
          // 챕터가 변경되었으면 초기 로드로 처리
          setIsInitialLoad(true);
          setPreviousElements([]);
          prevChapterRef.current = currentChapter;
        }
      }
    };

    // 챕터 변경 체크
    checkChapterChange();

    // 이전 elements가 없으면 첫 번째 로드로 간주하고 저장만 함
    if (previousElements.length === 0) {
      setPreviousElements(elements);
      return;
    }

    // calcGraphDiff를 사용하여 새로 추가된 노드들 찾기
    const diff = calcGraphDiff(previousElements, elements);

    // 현재 elements를 이전 elements로 저장 (다음 챕터 전환 시 비교용)
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
    
    // 이벤트 핸들러 등록
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
    
    // 클린업 함수
    return () => {
      cy.removeListener('dragfreeon', 'node', handleDragFreeOn);
      cy.removeListener('drag', 'node', handleDrag);
      cy.removeListener('dragfree', 'node', handleDragFree);
    };
  }, [externalCyRef, nodeSize]);

  // 이벤트 핸들러 등록 (커스텀 핸들러가 있으면 사용, 없으면 훅 핸들러 사용)
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) return;
    
    // 기존 핸들러 제거
    cy.removeListener('tap', 'node');
    cy.removeListener('tap', 'edge');
    cy.removeListener('tap');
    
    // Ripple 효과를 포함한 래퍼 핸들러들
    const createRippleWrapper = (originalHandler) => (evt) => {
      // Ripple 효과 생성
      if (containerRef.current && cy) {
        let x, y;
        
        if (evt.renderedPosition) {
          x = evt.renderedPosition.x;
          y = evt.renderedPosition.y;

        } else if (evt.originalEvent) {
          // 배경 클릭 시 - 마우스 좌표를 Cytoscape 좌표로 변환
          const containerRect = containerRef.current.getBoundingClientRect();
          const clientX = evt.originalEvent.clientX - containerRect.left;
          const clientY = evt.originalEvent.clientY - containerRect.top;
          
          const pan = cy.pan();
          const zoom = cy.zoom();
          x = (clientX - pan.x) / zoom;
          y = (clientY - pan.y) / zoom;
        }
        
        if (x !== undefined && y !== undefined) {
          createRippleEffect(containerRef.current, x, y, cy);
        }
      }
      
      // 원본 핸들러 호출
      if (originalHandler) {
        originalHandler(evt);
      }
    };
    
    // 새 핸들러 등록 (커스텀 핸들러 우선, 없으면 훅 핸들러 사용)
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
    if (tapBackgroundHandler) {
      cy.on("tap", createRippleWrapper(tapBackgroundHandler));
    } else {
      cy.on("tap", createRippleWrapper(hookTapBackgroundHandler));
    }
  }, [externalCyRef, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, hookTapNodeHandler, hookTapEdgeHandler, hookTapBackgroundHandler]);

  // elements diff patch 및 스타일/레이아웃 적용
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) {
      return;
    }
  
    
    // 새로운 elements가 로드될 때 이전 elements 정보 초기화 (첫 번째 로드 시)
    if (previousElements.length === 0) {
      setPreviousElements(elements);
    }
    
    if (!elements || elements.length === 0) {
      cy.elements().remove();
      setIsGraphVisible(false);
      return;
    }
    
    cy.batch(() => {
      // 기존 노드/엣지 id 집합
      const prevNodeIds = new Set(cy.nodes().map(n => n.id()));
      const prevEdgeIds = new Set(cy.edges().map(e => e.id()));
      const nextNodeIds = new Set(elements.filter(e => !e.data.source).map(e => e.data.id));
      const nextEdgeIds = new Set(elements.filter(e => e.data.source).map(e => e.data.id));
      
      // 삭제할 요소들 제거
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });
      
      // 추가할 요소들 분리
      const nodes = elements.filter(e => !e.data.source && !e.data.target);
      const edges = elements.filter(e => e.data.source && e.data.target);
      
      // 새로운 노드들에 대해 랜덤한 초기 위치 할당 (겹침 완화)
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
      
      // 새로운 요소들만 추가 (기존 요소들은 유지)
      const nodesToAdd = nodes.filter(node => !prevNodeIds.has(node.data.id));
      const edgesToAdd = edges.filter(edge => !prevEdgeIds.has(edge.data.id));
      if (nodesToAdd.length > 0) {
        cy.add(nodesToAdd);
      }
      if (edgesToAdd.length > 0) {
        cy.add(edgesToAdd);
      }
      
      // 새로운 요소가 추가된 경우에만 레이아웃 실행 (깜빡임 방지)
      if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
        // 반드시 preset 레이아웃 실행
        cy.layout({ name: 'preset' }).run();
        
        // 스타일 적용
        if (stylesheet) cy.style(stylesheet);
        
        // 레이아웃 적용
        if (layout && layout.name !== 'preset') {
          const layoutInstance = cy.layout({
            ...layout,
            animationDuration: 800,
            animationEasing: 'ease-out'
          });
          layoutInstance.on('layoutstop', () => {
            setTimeout(() => {
              detectAndResolveOverlap(cy, nodeSize);
              
              // 초기 로드가 아닌 경우에만 새로운 노드들에 ripple 등장 효과 적용
              if (nodesToAdd.length > 0 && !isInitialLoad && !isResetFromSearch) {
                console.log('🎯 새로운 노드 ripple 효과 적용 시작');
                nodesToAdd.forEach(node => {
                  const cyNode = cy.getElementById(node.data.id);
                  if (cyNode.length > 0) {
                                    
                  const position = cyNode.renderedPosition();
                  // evt.renderedPosition과 동일한 방식으로 좌표 계산
                  const domX = position.x;
                  const domY = position.y;
                  
                  console.log(`📍 노드 ${node.data.id} 위치:`, {
                    cytoscapeX: position.x,
                    cytoscapeY: position.y,
                    domX: domX,
                    domY: domY
                  });
                  
                  // 노드 클릭 시와 동일하게 DOM 좌표계로 변환된 값 사용 (cyRef 없이)
                  createRippleEffect(containerRef.current, domX, domY, null);
                  } else {
                    console.log(`❌ 노드 ${node.data.id}를 찾을 수 없음`);
                  }
                });
                console.log('✅ 새로운 노드 ripple 효과 적용 완료');
              }
              
              if (onLayoutComplete) onLayoutComplete();
            }, 200);
          });
          layoutInstance.run();
        } else {
          setTimeout(() => {
            detectAndResolveOverlap(cy, nodeSize);
            
            // 초기 로드가 아닌 경우에만 preset 레이아웃 완료 후 새로운 노드들에 ripple 등장 효과 적용
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
        // 새로운 요소가 없으면 스타일만 적용
        if (stylesheet) cy.style(stylesheet);
      }
      
      // fit
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) {
          cy.fit(nodes, 60);
          
          // 검색된 노드들을 하이라이트
          cy.nodes().removeClass('search-highlight');
          nodes.addClass('search-highlight');
          
          // 검색된 노드들의 크기를 약간 키움
          cy.nodes().style('width', nodeSize);
          cy.nodes().style('height', nodeSize);
          nodes.style('width', nodeSize * 1.2);
          nodes.style('height', nodeSize * 1.2);
        }
      } else {
        cy.fit(undefined, 60);
        // 검색이 비활성화되면 하이라이트 제거
        if (!isSearchActive) {
          cy.nodes().removeClass('search-highlight');
          // 노드 크기도 원래대로 되돌림
          cy.nodes().style('width', nodeSize);
          cy.nodes().style('height', nodeSize);
        }
      }
      
      // 검색 상태에 따라 페이드 효과 적용
      if (isSearchActive || filteredElements.length > 0) {
        applySearchFadeEffect(cy, filteredElements, isSearchActive);
      }
    });
    
    // 초기 로드 완료 후 isInitialLoad를 false로 설정
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

      
      {/* 검색 결과가 없을 때 메시지 */}
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
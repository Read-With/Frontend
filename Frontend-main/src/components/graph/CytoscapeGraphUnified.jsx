import React, { useEffect, useRef, useState, useCallback, createContext } from "react";
import cytoscape from "cytoscape";
import "./RelationGraph.css";
import { detectAndResolveOverlap } from "../../utils/graphDataUtils.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../utils/searchUtils.jsx";

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
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const handlersRegisteredRef = useRef(false);

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
    
    // 사용자가 노드 드래그 후 놓았을 때만 겹침 감지 및 조정
    const cy = cyInstance;
    cy.on('dragfreeon', 'node', () => {
      // 드래그 완료 후 즉시 겹침 확인
      setTimeout(() => {
        detectAndResolveOverlap(cy, nodeSize);
      }, 50);
    });

    // 드래그 감도 조정
    cy.on('drag', 'node', (evt) => {
      const node = evt.target;
      const pos = node.position();
      // 드래그 중 부드러운 이동을 위한 애니메이션 비활성화
      node.style('transition-property', 'none');
    });

    // 드래그 완료 후 애니메이션 복원
    cy.on('dragfree', 'node', (evt) => {
      const node = evt.target;
      node.style('transition-property', 'position');
    });
    
    return () => {};
  }, []); // 의존성 배열을 빈 배열로 변경하여 한 번만 실행

  // 이벤트 핸들러 등록 (한 번만)
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy || handlersRegisteredRef.current) return;
    
    if (tapNodeHandler) {
      cy.on("tap", "node", tapNodeHandler);
    }
    if (tapEdgeHandler) {
      cy.on("tap", "edge", tapEdgeHandler);
    }
    if (tapBackgroundHandler) {
      cy.on("tap", tapBackgroundHandler);
    }
    
    handlersRegisteredRef.current = true;
  }, [externalCyRef, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);



  // elements diff patch 및 스타일/레이아웃 적용
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) {
      return;
    }
    
    // 디버깅: 간선 데이터 확인 (필요시 주석 해제)

    
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
      
      // 삭제
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });
      // 추가
      const nodes = elements.filter(e => !e.data.source && !e.data.target);
      const edges = elements.filter(e => e.data.source && e.data.target);
      
      // 새로운 노드들에 대해 랜덤한 초기 위치 할당 (겹침 완화)
      const NODE_SIZE = nodeSize;
      const MIN_DISTANCE = NODE_SIZE * 2.8; // 최소 거리(여유 포함)
      // 이미 배정된 노드들의 위치를 배열에 저장
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
      
      cy.add(nodes);
      cy.add(edges);
      
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
          // 노드 추가 후 즉시 겹침 확인
          setTimeout(() => {
            detectAndResolveOverlap(cy, nodeSize);
            if (onLayoutComplete) onLayoutComplete();
          }, 200);
        });
        layoutInstance.run();
      } else {
        // preset 레이아웃의 경우에도 즉시 겹침 확인
        setTimeout(() => {
          detectAndResolveOverlap(cy, nodeSize);
          if (onLayoutComplete) onLayoutComplete();
        }, 150);
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
      
      // 검색 상태에 따라 페이드 효과 적용 (유틸리티 함수 사용)
      // 그래프 온리 페이지에서는 검색이 비활성화되어 있어도 페이드 효과를 적용하지 않음
      if (isSearchActive || filteredElements.length > 0) {
        applySearchFadeEffect(cy, filteredElements, isSearchActive);
      }
      
      // 검색 결과가 없을 때 메시지 표시
      if (isSearchActive && (!fitNodeIds || fitNodeIds.length === 0)) {
        // 검색 결과가 없음을 표시하는 로직
      }
    });
    setIsGraphVisible(true);
  }, [elements, stylesheet, layout, fitNodeIds, nodeSize, isSearchActive, filteredElements]); // 의존성 배열 최적화

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
        minHeight: "400px", // 최소 높이 추가
        minWidth: "400px",  // 최소 너비 추가
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
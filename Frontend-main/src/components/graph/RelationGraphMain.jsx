import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import ViewerEdgeTooltip from "./ViewerEdgeTooltip";
import GraphSidebar from "./GraphSidebar";
import "./RelationGraph.css";
import { DEFAULT_LAYOUT } from "./graphLayouts";

// 간선 positivity 값에 따라 HSL 그라데이션 색상 반환
function getRelationColor(positivity) {
  // positivity: -1(빨강) ~ 0(회색) ~ 1(초록)
  // H: 0(빨강) ~ 120(초록)
  const h = (120 * (positivity + 1)) / 2; // -1~1 → 0~120
  return `hsl(${h}, 70%, 45%)`;
}

export const getNodeSize = () => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.includes('/user/viewer/')) return 40;
    if (path.includes('/user/graph/')) return 40;
  }
  return 40; // 기본값
};

// 간선(엣지) 스타일도 라우트에 따라 다르게 반환
const getEdgeStyle = () => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.includes('/user/viewer/')) {
      return {
        width: "data(weight)",  // weight 값을 그대로 사용
        fontSize: 9,
      };
    }
    if (path.includes('/user/graph/')) {
      return {
        width: "data(weight)",  // weight 값을 그대로 사용
        fontSize: 11,
      };
    }
  }
  return {
    width: "data(weight)",  // weight 값을 그대로 사용
    fontSize: 9,
  };
};

// MAX_EDGE_LABEL_LENGTH 제거됨 - 길이 제한 없음

const getWideLayout = () => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.includes('/user/graph/')) {
      // 퍼짐을 극대화한 레이아웃
      return {
        ...DEFAULT_LAYOUT,
        randomSeed: 22,
        nodeRepulsion: 2000,
        idealEdgeLength: 400,
        componentSpacing: 500,
        nodeOverlap: 0,
        avoidOverlap: true,
        nodeSeparation: 60,
      };
    }
  }
  return DEFAULT_LAYOUT;
};

function RelationGraphMain({ 
  elements, 
  inViewer = false, 
  fullScreen = false, 
  onFullScreen, 
  onExitFullScreen, 
  graphViewState, 
  setGraphViewState, 
  chapterNum, 
  eventNum, 
  hideIsolated, 
  maxEventNum, 
  newNodeIds, 
  maxChapter, 
  edgeLabelVisible = true,
  fitNodeIds = [],
  searchTerm = "",
  isSearchActive = false,
  filteredElements = null, // 검색된 요소들 (null이면 elements 사용)
}) {
  const cyRef = useRef(null);
  const hasCenteredRef = useRef(false); // 최초 1회만 중앙정렬
  const [activeTooltip, setActiveTooltip] = useState(null); // 하나의 툴팁만 관리
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { filename } = useParams();
  const prevElementsRef = useRef();
  const prevEventJsonRef = useRef();
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const prevChapterNum = useRef();
  const prevEventNum = useRef();
  const prevElementsStr = useRef();
  const [ripples, setRipples] = useState([]);
  const prevNodeIdsRef = useRef([]);
  const prevEdgeIdsRef = useRef([]);

  // gatsby.epub 단독 그래프 페이지에서만 간격을 더 넓게
  const isGraphPage = inViewer && fullScreen;
  
  // 그래프 단독 페이지 여부 확인
  const isStandaloneGraphPage = !inViewer;

  // 타임라인으로 이동하는 함수
  // const handleViewTimeline = () => {
  //   navigate(`/viewer/${filename}/timeline`, { state: location.state });
  // };

  // 노드 클릭 시 툴팁 표시
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const pos = node.renderedPosition();
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const container = document.querySelector('.graph-canvas-area');
    const containerRect = container.getBoundingClientRect();
    // 노드 중심의 화면 좌표 계산
    const nodeCenter = {
      x: pos.x * zoom + pan.x + containerRect.left,
      y: pos.y * zoom + pan.y + containerRect.top,
    };
    setActiveTooltip(null);
    cy.batch(() => {
      // 모든 노드에서 highlighted 클래스 제거 (이전 선택 해제)
      cy.nodes().removeClass("highlighted");
      cy.edges().removeClass("highlighted");
      
      // 모든 노드와 엣지에 faded 클래스 추가
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");
      
      // 클릭된 노드만 강조 (파란색 테두리)
      node.removeClass("faded").addClass("highlighted");
      
      // 연결된 간선들과 노드들 faded 제거
      const connectedEdges = node.connectedEdges();
      const connectedNodes = node.neighborhood().nodes();
      connectedEdges.removeClass("faded");
      connectedNodes.removeClass("faded");
    });
    // 마우스 포인터 위치를 툴팁에 넘김
    const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
    const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;
    setTimeout(() => {
      setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
    }, 0);
    selectedNodeIdRef.current = node.id();
  }, []);

  // 간선 클릭 시 툴팁 표시 (좌표 변환)
  const tapEdgeHandler = useCallback(
    (evt) => {
      // 디버깅: 간선 클릭 이벤트 (필요시 주석 해제)
      // console.log('=== 간선 클릭 이벤트 발생! ===');
      // console.log('evt:', evt);
      // console.log('evt.target:', evt.target);
      
      if (!cyRef.current) {
        // console.log('cyRef.current가 없음');
        return;
      }
      const cy = cyRef.current;
      const edge = evt.target;
      
      // 디버깅: 간선 클릭 시 데이터 확인 (필요시 주석 해제)
      // console.log('=== 간선 클릭 디버깅 ===');
      // console.log('클릭된 간선:', edge);
      // console.log('간선 데이터:', edge?.data());
      // console.log('간선 relation:', edge?.data()?.relation);
      // console.log('간선 label:', edge?.data()?.label);
      // console.log('========================');
      
      // 엣지 데이터 확인
      if (!edge || !edge.data()) {
        // console.log('엣지 데이터가 없음');
        return;
      }
      
      const container = document.querySelector(".graph-canvas-area");
      if (!container) {
        return;
      }
      
      const containerRect = container.getBoundingClientRect();

      // Cytoscape의 midpoint는 그래프 내부 좌표계이므로, 화면 좌표로 변환
      const pos = edge.midpoint();
      const pan = cy.pan();
      const zoom = cy.zoom();

      // 절대 좌표 계산 (컨테이너 기준)
      const absoluteX = pos.x * zoom + pan.x + containerRect.left;
      const absoluteY = pos.y * zoom + pan.y + containerRect.top;

      setActiveTooltip(null);
      setActiveTooltip({
        type: 'edge',
        id: edge.id(),
        x: absoluteX,
        y: absoluteY,
        data: edge.data(),
        sourceNode: edge.source(),
        targetNode: edge.target(),
      });

      cy.batch(() => {
        // 모든 노드에서 highlighted 클래스 제거 (이전 선택 해제)
        cy.nodes().removeClass("highlighted");
        cy.edges().removeClass("highlighted");
        
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        edge.removeClass("faded");
        // 연결된 노드들만 강조
        edge.source().removeClass("faded").addClass("highlighted");
        edge.target().removeClass("faded").addClass("highlighted");
        // 나머지 노드/간선은 faded 유지
      });

      selectedEdgeIdRef.current = edge.id();
    },
    []
  );

  // 배경 클릭 시 선택 해제
  const tapBackgroundHandler = useCallback((evt) => {
    if (evt.target === cyRef.current) {
      clearSelection();
    }
  }, []);

  // 선택 해제
  const clearSelection = useCallback(() => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.nodes().removeClass("faded");
      cy.edges().removeClass("faded");
      cy.nodes().removeClass("highlighted");
    }
    setActiveTooltip(null);
    selectedEdgeIdRef.current = null;
    selectedNodeIdRef.current = null;
  }, []);

  const handleCloseTooltip = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // elements/filteredElements를 id 기준으로 정렬해서 비교 및 전달
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  // 검색된 요소들 또는 원래 요소들 사용
  const finalElements = useMemo(() => {
    if (filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    return sortedElements;
  }, [filteredElements, sortedElements]);

  // currentEventJson이 내용이 같으면 참조도 같게 useMemo로 캐싱
  const stableEventJson = useMemo(() => graphViewState ? JSON.stringify(graphViewState) : '', [graphViewState]);

  const edgeStyle = getEdgeStyle();

  const stylesheet = useMemo(
    () => [
      {
        selector: "node[image]",
        style: {
          "background-color": "#eee",
          "background-image": "data(image)",
          "background-fit": "cover",
          "background-clip": "node",
          "border-width": (ele) => (ele.data("main") ? 2 : 1),
          "border-color": "#5B7BA0",
          "border-opacity": 1,
          width: getNodeSize(),
          height: getNodeSize(),
          shape: "ellipse",
          label: "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": (ele) => {
            if (typeof window !== 'undefined') {
              const path = window.location.pathname;
              if (path.includes('/user/graph/')) return 8;
            }
            return 6;
          },
          "font-weight": (ele) => (ele.data("main") ? 600 : 400),
          color: "#444",
          "text-margin-y": 2,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
        },
      },
      {
        selector: "edge",
        style: {
          width: edgeStyle.width,
          "line-color": (ele) => getRelationColor(ele.data("positivity")),
          "curve-style": "bezier",
          label: (ele) => {
            const label = ele.data('label') || '';
            if (!edgeLabelVisible) return '';
            return label; // 길이 제한 제거
          },
          "font-size": edgeStyle.fontSize,
          "text-rotation": "autorotate",
          color: "#42506b",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-outline-color": "#fff",
          "text-outline-width": 2,
          opacity: "mapData(weight, 0, 1, 0.55, 1)",
          "target-arrow-shape": "none",
          "line-style": "solid",
          "border-width": 0,
          events: "yes", // 클릭 이벤트 활성화
        },
      },
      {
        selector: "node.cytoscape-node-appear",
        style: {
          "border-color": "#22c55e",
          "border-width": 16,
          "border-opacity": 1,
          "transition-property": "border-width, border-color, border-opacity",
          "transition-duration": "700ms",
        },
      },
      {
        selector: ".faded",
        style: {
          opacity: 0.25,
          "text-opacity": 0.12,
        },
      },
      {
        selector: ".highlighted",
        style: {
          "border-color": "#3b82f6",
          "border-width": 2,
          "border-opacity": 1,
          "border-style": "solid",
        },
      },
    ],
    [edgeLabelVisible]
  );





  // === 오직 chapter_node_positions_{chapterNum}만 사용하여 노드 위치 복원 (절대적 위치) ===

  // 개선된 코드: chapterNum, eventNum이 바뀔 때만 로딩 오버레이 표시
  useEffect(() => {
    if (chapterNum !== prevChapterNum.current || eventNum !== prevEventNum.current) {
      setIsGraphLoading(true);
      prevChapterNum.current = chapterNum;
      prevEventNum.current = eventNum;
    }
  }, [chapterNum, eventNum]);



  // elements가 변경될 때 로딩 상태 업데이트
  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  // elements가 변경될 때 새로 등장한 노드와 간선에 선택 효과 적용
  useEffect(() => {
    if (!elements || elements.length === 0 || !cyRef.current) {
      prevNodeIdsRef.current = [];
      return;
    }
    
    // 새로 추가된 노드들 찾기
    const currentNodeIds = elements
      .filter((e) => e.data && !e.data.source)
      .map((e) => e.data.id);
    const prevNodeIds = prevNodeIdsRef.current;
    const newNodeIds = currentNodeIds.filter((id) => !prevNodeIds.includes(id));
    prevNodeIdsRef.current = currentNodeIds;
    
    // 새로 추가된 간선들 찾기
    const currentEdgeIds = elements
      .filter((e) => e.data && e.data.source)
      .map((e) => e.data.id);
    const prevEdgeIds = prevEdgeIdsRef.current || [];
    const newEdgeIds = currentEdgeIds.filter((id) => !prevEdgeIds.includes(id));
    prevEdgeIdsRef.current = currentEdgeIds;
    
    // 현재 선택된 노드나 간선이 있는지 확인
    const hasSelection = selectedNodeIdRef.current || selectedEdgeIdRef.current || activeTooltip;
    
    if (hasSelection) {
      // 선택된 노드가 있는 경우
      if (selectedNodeIdRef.current) {
        const selectedNode = cyRef.current.getElementById(selectedNodeIdRef.current);
        if (selectedNode && selectedNode.length > 0) {
          cyRef.current.batch(() => {
            // 새로 추가된 노드들에 대해 연결 여부 확인
            newNodeIds.forEach((id) => {
              const newNode = cyRef.current.getElementById(id);
              if (newNode && newNode.length > 0) {
                const connectedEdges = selectedNode.connectedEdges().intersection(newNode.connectedEdges());
                if (connectedEdges.length > 0) {
                  // 연결된 노드: faded 제거, highlighted 유지
                  newNode.removeClass("faded");
                  const connectedNodes = selectedNode.neighborhood().nodes();
                  if (connectedNodes.has(newNode)) {
                    newNode.addClass("highlighted");
                  }
                } else {
                  // 비연결 노드: faded 적용
                  newNode.addClass("faded");
                }
              }
            });
            
            // 새로 추가된 간선들에 대해 연결 여부 확인
            newEdgeIds.forEach((id) => {
              const newEdge = cyRef.current.getElementById(id);
              if (newEdge && newEdge.length > 0) {
                const sourceNode = newEdge.source();
                const targetNode = newEdge.target();
                
                if (sourceNode.same(selectedNode) || targetNode.same(selectedNode)) {
                  // 선택된 노드와 연결된 간선: faded 제거
                  newEdge.removeClass("faded");
                } else {
                  // 비연결 간선: faded 적용
                  newEdge.addClass("faded");
                }
              }
            });
          });
        }
      }
      
      // 선택된 간선이 있는 경우
      if (selectedEdgeIdRef.current) {
        const selectedEdge = cyRef.current.getElementById(selectedEdgeIdRef.current);
        if (selectedEdge && selectedEdge.length > 0) {
          cyRef.current.batch(() => {
            // 새로 추가된 노드들에 대해 연결 여부 확인
            newNodeIds.forEach((id) => {
              const newNode = cyRef.current.getElementById(id);
              if (newNode && newNode.length > 0) {
                const sourceNode = selectedEdge.source();
                const targetNode = selectedEdge.target();
                
                if (newNode.same(sourceNode) || newNode.same(targetNode)) {
                  // 선택된 간선의 소스/타겟 노드: faded 제거, highlighted 유지
                  newNode.removeClass("faded").addClass("highlighted");
                } else {
                  // 비연결 노드: faded 적용
                  newNode.addClass("faded");
                }
              }
            });
            
            // 새로 추가된 간선들에 대해 연결 여부 확인
            newEdgeIds.forEach((id) => {
              const newEdge = cyRef.current.getElementById(id);
              if (newEdge && newEdge.length > 0) {
                const selectedSource = selectedEdge.source();
                const selectedTarget = selectedEdge.target();
                const newSource = newEdge.source();
                const newTarget = newEdge.target();
                
                if (newSource.same(selectedSource) || newSource.same(selectedTarget) ||
                    newTarget.same(selectedSource) || newTarget.same(selectedTarget)) {
                  // 선택된 간선과 연결된 간선: faded 제거
                  newEdge.removeClass("faded");
                } else {
                  // 비연결 간선: faded 적용
                  newEdge.addClass("faded");
                }
              }
            });
          });
        }
      }
    } else {
      // 선택이 없는 경우: 새로 등장한 노드에 ripple 효과만 적용
      newNodeIds.forEach((id) => {
        const node = cyRef.current.getElementById(id);
        if (node && node.length > 0) {
          const pos = node.renderedPosition();
          const container = document.querySelector(".graph-canvas-area");
          if (container && pos) {
            const rect = container.getBoundingClientRect();
            const x = pos.x + rect.left;
            const y = pos.y + rect.top;
            const rippleId = Date.now() + Math.random();
            setRipples((prev) => [...prev, { id: rippleId, x: x - rect.left, y: y - rect.top }]);
            setTimeout(() => {
              setRipples((prev) => prev.filter((r) => r.id !== rippleId));
            }, 700);
          }
        }
      });
    }
  }, [elements, activeTooltip]);

  // elements, stylesheet, layout, searchLayout, style useMemo 최적화
  const memoizedElements = useMemo(() => finalElements, [finalElements]);
  const memoizedStylesheet = useMemo(() => stylesheet, [stylesheet]);
  const memoizedLayout = useMemo(() => getWideLayout(), []);
  const memoizedStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f8fafc'
  }), []);

  const nodeSize = getNodeSize();

  const handleCanvasClick = (e) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 700);
  };

  if (fullScreen && inViewer) {
    return (
      <div className="graph-page-container" style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999
      }}>
        {/* 그래프 본문만 렌더링 (상단바는 RelationGraphWrapper에서 처리) */}
        <div className="flex-1 relative overflow-hidden w-full h-full">
          <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
            {/* 툴팁 렌더링 */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
              {activeTooltip?.type === 'node' && activeTooltip.data && (
                <GraphNodeTooltip
                  key={`node-tooltip-${activeTooltip.id}`}
                  data={activeTooltip.data}
                  x={activeTooltip.x}
                  y={activeTooltip.y}
                  nodeCenter={activeTooltip.nodeCenter}
                  onClose={handleCloseTooltip}
                  style={{ pointerEvents: 'auto' }}
                />
              )}
              {activeTooltip?.type === 'edge' && activeTooltip.data && (
                inViewer ? (
                  <ViewerEdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    chapterNum={chapterNum}
                    eventNum={eventNum}
                    style={{ pointerEvents: 'auto' }}
                  />
                ) : (
                  <EdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    maxChapter={10}
                    style={{ pointerEvents: 'auto' }}
                  />
                )
              )}
            </div>
                         {/* 그래프 영역 */}
             <div
               className="graph-canvas-area"
               onClick={handleCanvasClick}
               style={{ position: "relative", width: "100%", height: "100%" }}
             >
               {memoizedElements.length === 0 ? (
                 <div style={{ 
                   width: '100%', 
                   height: '100%', 
                   display: 'flex', 
                   alignItems: 'center', 
                   justifyContent: 'center',
                   flexDirection: 'column',
                   gap: '16px'
                 }}>
                   <div style={{
                     fontSize: '20px',
                     color: '#6C8EFF',
                     fontWeight: '600',
                     textAlign: 'center'
                   }}>
                     관계가 없습니다
                   </div>
                   <div style={{
                     fontSize: '14px',
                     color: '#64748b',
                     textAlign: 'center',
                     maxWidth: '300px',
                     lineHeight: '1.5'
                   }}>
                     현재 챕터에서 선택한 이벤트에는<br />
                     등장 인물 간의 관계 정보가 없습니다.
                   </div>
                 </div>
               ) : (
                 <>
                   {ripples.map((ripple) => (
                     <div
                       key={ripple.id}
                       className="cytoscape-ripple"
                       style={{
                         left: ripple.x - 60,
                         top: ripple.y - 60,
                         width: 120,
                         height: 120,
                       }}
                     />
                   ))}
                   <CytoscapeGraphUnified
                     elements={memoizedElements}
                     stylesheet={memoizedStylesheet}
                     layout={memoizedLayout}
                     tapNodeHandler={tapNodeHandler}
                     tapEdgeHandler={tapEdgeHandler}
                     tapBackgroundHandler={tapBackgroundHandler}
                     fitNodeIds={fitNodeIds}
                     style={memoizedStyle}
                     cyRef={cyRef}
                     newNodeIds={newNodeIds}
                     nodeSize={nodeSize}
                     searchTerm={searchTerm}
                     isSearchActive={isSearchActive}
                   />
                 </>
               )}
             </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden ${fullScreen ? 'graph-container-wrapper' : ''}`} style={{ width: '100%', height: '100%' }}>
      {/* < 버튼은 inViewer && !fullScreen일 때만 보임 */}
      {/* 기존 중앙 고정 < 버튼 완전히 제거 */}

      <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
        {/* 툴팁 렌더링 - 그래프 단독 페이지가 아닐 때만 */}
        {!isStandaloneGraphPage && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
            {activeTooltip?.type === 'node' && activeTooltip.data && (
              <GraphNodeTooltip
                key={`node-tooltip-${activeTooltip.id}`}
                data={activeTooltip.data}
                x={activeTooltip.x}
                y={activeTooltip.y}
                nodeCenter={activeTooltip.nodeCenter}
                onClose={handleCloseTooltip}
                style={{ pointerEvents: 'auto' }}
              />
            )}
            {activeTooltip?.type === 'edge' && activeTooltip.data && (
              inViewer ? (
                <ViewerEdgeTooltip
                  key={`edge-tooltip-${activeTooltip.id}`}
                  data={activeTooltip.data}
                  x={activeTooltip.x}
                  y={activeTooltip.y}
                  onClose={handleCloseTooltip}
                  sourceNode={activeTooltip.sourceNode}
                  targetNode={activeTooltip.targetNode}
                  chapterNum={chapterNum}
                  eventNum={eventNum}
                  maxChapter={maxChapter}
                  style={{ pointerEvents: 'auto' }}
                />
              ) : (
                <EdgeTooltip
                  key={`edge-tooltip-${activeTooltip.id}`}
                  data={activeTooltip.data}
                  x={activeTooltip.x}
                  y={activeTooltip.y}
                  onClose={handleCloseTooltip}
                  sourceNode={activeTooltip.sourceNode}
                  targetNode={activeTooltip.targetNode}
                  maxChapter={10}
                  style={{ pointerEvents: 'auto' }}
                />
              )
            )}
          </div>
        )}

        {/* 그래프 영역 */}
        <div
          className="graph-canvas-area"
          onClick={handleCanvasClick}
          style={{ position: "relative", width: "100%", height: "100%" }}
        >
          {memoizedElements.length === 0 ? (
            <div style={{ 
              width: '100%', 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{
                fontSize: '20px',
                color: '#6C8EFF',
                fontWeight: '600',
                textAlign: 'center'
              }}>
                관계가 없습니다
              </div>
              <div style={{
                fontSize: '14px',
                color: '#64748b',
                textAlign: 'center',
                maxWidth: '300px',
                lineHeight: '1.5'
              }}>
                현재 챕터에서 선택한 이벤트에는<br />
                등장 인물 간의 관계 정보가 없습니다.
              </div>
            </div>
          ) : (
            <>
              {ripples.map((ripple) => (
                <div
                  key={ripple.id}
                  className="cytoscape-ripple"
                  style={{
                    left: ripple.x - 60,
                    top: ripple.y - 60,
                    width: 120,
                    height: 120,
                  }}
                />
              ))}
              <CytoscapeGraphUnified
                elements={memoizedElements}
                stylesheet={memoizedStylesheet}
                layout={memoizedLayout}
                tapNodeHandler={tapNodeHandler}
                tapEdgeHandler={tapEdgeHandler}
                tapBackgroundHandler={tapBackgroundHandler}
                fitNodeIds={fitNodeIds}
                style={memoizedStyle}
                cyRef={cyRef}
                newNodeIds={newNodeIds}
                nodeSize={nodeSize}
                searchTerm={searchTerm}
                isSearchActive={isSearchActive}
              />
            </>
          )}
        </div>
      </div>

             {/* 그래프 단독 페이지에서 슬라이드바 렌더링 */}
       {isStandaloneGraphPage && (
         <GraphSidebar
           activeTooltip={activeTooltip}
           onClose={handleCloseTooltip}
           chapterNum={chapterNum}
           eventNum={eventNum}
           maxChapter={maxChapter}
           hasNoRelations={!memoizedElements || memoizedElements.length === 0}
         />
       )}
    </div>
  );
}

export default RelationGraphMain;
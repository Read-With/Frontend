import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import GraphControls from "./GraphControls";
import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";
import { FaTimes, FaClock } from 'react-icons/fa';
import { filterGraphElements } from "./graphFilter";
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
    if (path.includes('/user/graph/')) return 42;
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

const MAX_EDGE_LABEL_LENGTH = 15;

const getWideLayout = () => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.includes('/user/graph/')) {
      // 퍼짐을 극대화한 레이아웃
      return {
        ...DEFAULT_LAYOUT,
        randomSeed: 22,
        nodeRepulsion: 1500,
        idealEdgeLength: 400,
        componentSpacing: 500,
        nodeOverlap: 400,
      };
    }
  }
  return DEFAULT_LAYOUT;
};

function RelationGraphMain({ elements, inViewer = false, fullScreen = false, onFullScreen, onExitFullScreen, graphViewState, setGraphViewState, chapterNum, eventNum, hideIsolated, maxEventNum, newNodeIds }) {
  const cyRef = useRef(null);
  const hasCenteredRef = useRef(false); // 최초 1회만 중앙정렬
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
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

  // gatsby.epub 단독 그래프 페이지에서만 간격을 더 넓게
  const isGraphPage = inViewer && fullScreen;

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
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");
      node.removeClass("faded").addClass("highlighted");
    });
    // 마우스 포인터 위치를 툴팁에 넘김
    const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
    const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;
    setTimeout(() => {
      setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
    }, 0);
  }, []);

  // 간선 클릭 시 툴팁 표시 (좌표 변환)
  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const edge = evt.target;
      const container = document.querySelector(".graph-canvas-area");
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
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        edge.removeClass("faded");
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
      cy.removeListener("tap", "node");
      cy.removeListener("tap", "edge");
      cy.removeListener("tap");
      cy.on("tap", "node", tapNodeHandler);
      cy.on("tap", "edge", tapEdgeHandler);
      cy.on("tap", tapBackgroundHandler);
    }
    setActiveTooltip(null);
    selectedEdgeIdRef.current = null;
    selectedNodeIdRef.current = null;
  }, [tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

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

  // filteredElements를 useMemo로 고정 (의존성 최소화)
  const { filteredElements, fitNodeIds } = useMemo(() => filterGraphElements(sortedElements, search), [sortedElements, search]);

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
          "font-size": 6,
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
            return label.length > MAX_EDGE_LABEL_LENGTH ? label.slice(0, MAX_EDGE_LABEL_LENGTH) + '...' : label;
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
    ],
    []
  );

  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    
    // 그래프 초기화
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().removeClass("faded");
      cy.elements().removeClass("highlighted");
      cy.fit(undefined, 15);
      cy.center();
    }
  }, [setSearch, setSearchInput]);

  const handleSearch = useCallback(() => {
    if (searchInput.trim()) {
      setSearch(searchInput.trim());
    }
  }, [searchInput]);

  const handleFitView = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.fit();
      cyRef.current.center();
    }
  }, []);

  const handleClose = useCallback(() => {
    window.location.href = `/user/viewer/${filename}`;
  }, [filename]);

  // === 오직 chapter_node_positions_{chapterNum}만 사용하여 노드 위치 복원 (절대적 위치) ===

  // 개선된 코드: chapterNum, eventNum이 바뀔 때만 로딩 오버레이 표시
  useEffect(() => {
    if (chapterNum !== prevChapterNum.current || eventNum !== prevEventNum.current) {
      setIsGraphLoading(true);
      prevChapterNum.current = chapterNum;
      prevEventNum.current = eventNum;
    }
  }, [chapterNum, eventNum]);

  useEffect(() => {
    console.log('[상태점검] chapterNum:', chapterNum, 'eventNum:', eventNum, 'maxEventNum:', maxEventNum, 'isLastEvent:', eventNum === maxEventNum);
  }, [chapterNum, eventNum, maxEventNum]);

  // elements가 변경될 때 로딩 상태 업데이트
  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  // elements가 변경될 때 새로 등장한 노드에 ripple 자동 적용
  useEffect(() => {
    if (!elements || elements.length === 0 || !cyRef.current) {
      prevNodeIdsRef.current = [];
      return;
    }
    const currentNodeIds = elements
      .filter((e) => e.data && !e.data.source)
      .map((e) => e.data.id);
    const prevNodeIds = prevNodeIdsRef.current;
    const newNodeIds = currentNodeIds.filter((id) => !prevNodeIds.includes(id));
    prevNodeIdsRef.current = currentNodeIds;
    // 새로 등장한 노드에 ripple
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
  }, [elements]);

  // elements, stylesheet, layout, searchLayout, style useMemo 최적화
  const memoizedElements = useMemo(() => filteredElements, [filteredElements]);
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
        {/* 상단바: > 버튼(복귀)만 왼쪽 끝에, 가운데 > 버튼은 완전히 제거 */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: 60,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 0,
          paddingLeft: 12,
          paddingRight: 90,
          paddingTop: 0,
          justifyContent: 'flex-start',
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          borderBottom: '1px solid #e5e7eb',
          zIndex: 10001,
        }}>
          {/* 눈에 띄는 복귀(>) 버튼 */}
          <button
            onClick={handleExitFullScreen}
            style={{
              height: 40,
              width: 40,
              minWidth: 40,
              minHeight: 40,
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              marginRight: 18,
              marginLeft: 4,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(79,109,222,0.13)',
              fontWeight: 700,
              outline: 'none',
              transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
            }}
            title='분할화면으로'
            onMouseOver={e => e.currentTarget.style.background = 'linear-gradient(100deg, #6fa7ff 0%, #4F6DDE 100%)'}
            onMouseOut={e => e.currentTarget.style.background = 'linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 100%)'}
          >
            {'>'}
          </button>
          {/* 그래프 본문, 컨트롤, 툴팁 등만 렌더링 (재귀 X) */}
          <div className="flex-1 relative overflow-hidden w-full h-full">
            {/* 검색 폼 추가 */}
            {!inViewer && (
              <div className="search-container" style={{ justifyContent: 'flex-start', paddingLeft: '20px' }}>
                <GraphControls
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  handleSearch={handleSearch}
                  handleReset={handleReset}
                  handleFitView={handleFitView}
                  search={search}
                  setSearch={setSearch}
                />
              </div>
            )}
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
                {activeTooltip?.type === 'edge' && (
                  <EdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    style={{ pointerEvents: 'auto' }}
                  />
                )}
              </div>
              {/* 그래프 영역 */}
              <div
                className="graph-canvas-area"
                onClick={handleCanvasClick}
                style={{ position: "relative", width: "100%", height: "100%" }}
              >
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
                />
              </div>
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

      {/* 검색 폼 추가 */}
      {!inViewer && (
        <div className="search-container" style={{ justifyContent: 'flex-start', paddingLeft: '20px' }}>
          <GraphControls
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            handleSearch={handleSearch}
            handleReset={handleReset}
            handleFitView={handleFitView}
            search={search}
            setSearch={setSearch}
          />
        </div>
      )}

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
          {activeTooltip?.type === 'edge' && (
            <EdgeTooltip
              key={`edge-tooltip-${activeTooltip.id}`}
              data={activeTooltip.data}
              x={activeTooltip.x}
              y={activeTooltip.y}
              onClose={handleCloseTooltip}
              sourceNode={activeTooltip.sourceNode}
              targetNode={activeTooltip.targetNode}
              style={{ pointerEvents: 'auto' }}
            />
          )}
        </div>

        {/* 그래프 영역 */}
        <div
          className="graph-canvas-area"
          onClick={handleCanvasClick}
          style={{ position: "relative", width: "100%", height: "100%" }}
        >
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
          />
        </div>
      </div>
    </div>
  );
}

export default RelationGraphMain;
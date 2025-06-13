import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import GraphControls from "./GraphControls";
import CytoscapeGraphDirect from "./CytoscapeGraphDirect";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";
import { FaTimes, FaClock } from 'react-icons/fa';

function getRelationColor(positivity) {
  if (positivity > 0.6) return '#15803d';
  if (positivity > 0.3) return '#059669';
  if (positivity > -0.3) return '#6b7280';
  if (positivity > -0.6) return '#dc2626';
  return '#991b1b';
}

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

  // gatsby.epub 단독 그래프 페이지에서만 간격을 더 넓게
  const isGraphPage = inViewer && fullScreen;

  // 타임라인으로 이동하는 함수
  const handleViewTimeline = () => {
    navigate(`/viewer/${filename}/timeline`, { state: location.state });
  };

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
  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = sortedElements;
    let fitNodeIds = null;
    if (search) {
      // 모든 일치하는 노드 찾기
      const matchedNodes = sortedElements.filter(
        (el) =>
          !el.data.source &&
          (el.data.label?.toLowerCase().includes(search.toLowerCase()) ||
            (el.data.names &&
              el.data.names.some((n) =>
                n.toLowerCase().includes(search.toLowerCase())
              )))
      );
      if (matchedNodes.length > 0) {
        // 모든 일치하는 노드와 관련된 엣지 찾기
        const matchedNodeIds = matchedNodes.map(node => node.data.id);
        const relatedEdges = sortedElements.filter(
          (el) =>
            el.data.source &&
            (matchedNodeIds.includes(el.data.source) ||
             matchedNodeIds.includes(el.data.target))
        );
        // 관련 노드 ID 수집
        const relatedNodeIds = [
          ...new Set(
            relatedEdges.flatMap((e) => [e.data.source, e.data.target])
          ),
        ];
        // 모든 관련 노드 찾기
        const relatedNodes = sortedElements.filter(
          (el) => !el.data.source && 
                 (matchedNodeIds.includes(el.data.id) || relatedNodeIds.includes(el.data.id))
        );
        filteredElements = [...relatedNodes, ...relatedEdges];
        fitNodeIds = [...matchedNodeIds, ...relatedNodeIds];
      } else {
        filteredElements = [];
        fitNodeIds = [];
      }
    } else {
      filteredElements = sortedElements;
    }
    return { filteredElements, fitNodeIds };
  }, [sortedElements, search]);

  // currentEventJson이 내용이 같으면 참조도 같게 useMemo로 캐싱
  const stableEventJson = useMemo(() => graphViewState ? JSON.stringify(graphViewState) : '', [graphViewState]);

  // 스타일시트 useMemo 의존성 최소화
  const stylesheet = useMemo(
    () => [
      {
        selector: "node[img]",
        style: {
          "background-image": "data(img)",
          "background-fit": "cover",
          "background-color": "#eee",
          "border-width": (ele) => ele.data("main") ? 2 : 1,
          "border-color": "#5B7BA0",
          "width": inViewer ? (ele => ele.data("main") ? 32 : 24) : 16,
          "height": inViewer ? (ele => ele.data("main") ? 32 : 24) : 16,
          "shape": "ellipse",
          "label": "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": inViewer ? 7 : 5,
          "font-weight": (ele) => ele.data("main") ? 200 : 100,
          "color": "#444",
          "text-margin-y": inViewer ? 9 : 8,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
        },
      },
      {
        selector: "node",
        style: {
          "background-color": "#eee",
          "border-width": (ele) => ele.data("main") ? 2 : 1,
          "border-color": "#5B7BA0",
          "width": inViewer ? (ele => ele.data("main") ? 32 : 24) : 16,
          "height": inViewer ? (ele => ele.data("main") ? 32 : 24) : 16,
          "shape": "ellipse",
          "label": "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": inViewer ? 4 : 3,
          "font-weight": (ele) => ele.data("main") ? 10 : 5,
          "color": "#444",
          "text-margin-y": inViewer ? 3 : 2,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
        },
      },
      {
        selector: "edge",
        style: {
          width: inViewer ? "mapData(weight, 0, 1, 1.8, 4.5)" : "mapData(weight, 0, 1, 1.5, 4)",
          "line-color": (ele) => getRelationColor(ele.data("positivity")),
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": inViewer ? 4 : 3,
          "text-rotation": "autorotate",
          color: "#42506b",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-outline-color": "#fff",
          "text-outline-width": 2,
          opacity: "mapData(weight, 0, 1, 0.55, 1)",
          "target-arrow-shape": "none"
        },
      },
      {
        selector: ".faded",
        style: {
          opacity: 0.25,
          "text-opacity": 0.12,
        },
      },
    ], []); // 의존성 배열을 []로 고정

  // layout useMemo 의존성 최소화
  const layout = useMemo(
    () => ({
      name: "cose",
      padding: 90,
      nodeRepulsion: 1800,
      idealEdgeLength: 120,
      animate: false,
      fit: true,
      randomize: false,
      nodeOverlap: 12,
      avoidOverlap: true,
      nodeSeparation: 10,
      randomSeed: 42,
      gravity: 0.25,
      componentSpacing: 90
    }), []);

  // searchLayout useMemo 의존성 최소화
  const searchLayout = useMemo(
    () => ({
      name: "cose",
      padding: 110,
      nodeRepulsion: 2500,
      idealEdgeLength: 135,
      animate: true,
      animationDuration: 800,
      fit: true,
      randomize: false,
      nodeOverlap: 14,
      avoidOverlap: true,
      nodeSeparation: 11,
      randomSeed: 42,
      gravity: 0.3,
      refresh: 20,
      componentSpacing: 110,
      coolingFactor: 0.95,
      initialTemp: 200
    }), []);

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
    // 뒤로 이동이 아니라 해당 파일의 뷰어로 이동
    navigate(`/viewer/${filename}`);
  }, [navigate, filename]);

  // === 오직 chapter_node_positions_{chapterNum}만 사용하여 노드 위치 복원 (절대적 위치) ===
  useEffect(() => {
    if (!cyRef.current || !elements || elements.length === 0) return;
    const cy = cyRef.current;
    if (typeof cy.nodes !== 'function') return;
    const storageKey = `chapter_node_positions_${chapterNum}`;
    let savedPositions = {};
    try {
      const savedStr = localStorage.getItem(storageKey);
      if (savedStr) savedPositions = JSON.parse(savedStr);
    } catch (e) {}

    // 전체 삭제/재생성 제거: 이미 존재하는 노드에만 position 적용
    cy.nodes().forEach(node => {
      const pos = savedPositions[node.id()];
      if (pos) {
        node.position(pos);
        node.lock();
      }
    });
    // pan/zoom 초기화는 제거 (그래프 전체 리셋 방지)
    // cy.pan({ x: 0, y: 0 });
    // cy.zoom(1);
  }, [chapterNum, eventNum, elements, maxEventNum]);

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

  // elements, stylesheet, layout, searchLayout, style useMemo 최적화
  const memoizedElements = useMemo(() => filteredElements, [filteredElements]);
  const memoizedStylesheet = useMemo(() => stylesheet, [stylesheet]);
  const memoizedLayout = useMemo(() => ({ name: 'preset' }), []);
  const memoizedStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f8fafc'
  }), []);

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
              <div className="graph-canvas-area w-full h-full" ref={cyRef} style={{ zIndex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                {/* 그래프가 없을 때 안내문구 */}
                {!isGraphLoading && (!elements || elements.length === 0) && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    color: '#6C8EFF',
                    fontSize: 20,
                    fontWeight: 600,
                    zIndex: 10,
                    background: 'rgba(255,255,255,0.85)',
                    padding: '32px 0',
                    borderRadius: 16,
                    boxShadow: '0 2px 8px rgba(108,142,255,0.07)'
                  }}>
                    표시할 그래프가 없습니다
                  </div>
                )}
                <CytoscapeGraphDirect
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
        <div className="graph-canvas-area w-full h-full" ref={cyRef} style={{ zIndex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          {/* 그래프가 없을 때 안내문구 */}
          {!isGraphLoading && (!elements || elements.length === 0) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              color: '#6C8EFF',
              fontSize: 20,
              fontWeight: 600,
              zIndex: 10,
              background: 'rgba(255,255,255,0.85)',
              padding: '32px 0',
              borderRadius: 16,
              boxShadow: '0 2px 8px rgba(108,142,255,0.07)'
            }}>
              표시할 그래프가 없습니다
            </div>
          )}
          <CytoscapeGraphDirect
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
          />
        </div>
      </div>
    </div>
  );
}

export default RelationGraphMain;
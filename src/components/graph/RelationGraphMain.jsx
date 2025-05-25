import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import GraphControls from "./GraphControls";
import CytoscapeGraph from "./CytoscapeGraph";
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

function RelationGraphMain({ elements, inViewer = false, fullScreen = false, onFullScreen, onExitFullScreen, graphViewState, setGraphViewState, chapterNum, eventNum, hideIsolated, maxEventNum }) {
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

  // === 추가: 컨테이너 크기 확정 후에만 CytoscapeGraph 렌더 ===
  const containerRef = useRef();
  const [containerReady, setContainerReady] = useState(false);
  useEffect(() => {
    function checkSize() {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width > 0 && height > 0) setContainerReady(true);
      else setContainerReady(false);
    }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

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
          "width": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "height": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "shape": "ellipse",
          "label": "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": inViewer ? 14 : 12,
          "font-weight": (ele) => ele.data("main") ? 700 : 400,
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
          "width": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "height": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "shape": "ellipse",
          "label": "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": inViewer ? 14 : 13,
          "font-weight": (ele) => ele.data("main") ? 700 : 400,
          "color": "#444",
          "text-margin-y": inViewer ? 9 : 8,
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
          "font-size": inViewer ? 13 : 11,
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
    ],
    [inViewer]
  );

  const layout = useMemo(
    () => ({
      name: "cose",
      padding: inViewer ? 90 : 150,
      nodeRepulsion: inViewer ? 1800 : 6000,
      idealEdgeLength: inViewer ? 120 : 150,
      animate: false,
      fit: true,
      randomize: false,
      nodeOverlap: inViewer ? 12 : 30,
      avoidOverlap: true,
      nodeSeparation: inViewer ? 10 : 20,
      randomSeed: 42,
      gravity: 0.25,
      componentSpacing: inViewer ? 90 : 120
    }),
    [inViewer, isGraphPage]
  );

  // 검색 결과에 따라 다른 레이아웃 옵션 적용
  const searchLayout = useMemo(
    () => ({
      name: "cose",
      padding: 110,
      nodeRepulsion: inViewer ? 2500 : 5000,
      idealEdgeLength: inViewer ? 135 : 180,
      animate: true,
      animationDuration: 800,
      fit: true,
      randomize: false,
      nodeOverlap: inViewer ? 14 : 40,
      avoidOverlap: true,
      nodeSeparation: inViewer ? 11 : 30,
      randomSeed: 42,
      gravity: 0.3,
      refresh: 20,
      componentSpacing: 110,
      coolingFactor: 0.95,
      initialTemp: 200
    }),
    [inViewer]
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
    // 뒤로 이동이 아니라 해당 파일의 뷰어로 이동
    navigate(`/viewer/${filename}`);
  }, [navigate, filename]);

  const eventKey = `chapter_${chapterNum}_event_${eventNum}_hideIsolated_${hideIsolated}`;

  // === graphViewState를 항상 localStorage에 저장 ===
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    // 저장 함수
    const saveGraphState = () => {
      const nodes = cy.nodes().map(n => ({
        id: n.id(),
        pos: n.position(),
        data: n.data(),
        classes: n.classes(),
        selected: n.selected()
      }));
      const edges = cy.edges().map(e => ({
        id: e.id(),
        source: e.source().id(),
        target: e.target().id(),
        data: e.data(),
        classes: e.classes(),
        selected: e.selected()
      }));
      const state = {
        pan: cy.pan(),
        zoom: cy.zoom(),
        nodes,
        edges
      };
      try {
        localStorage.setItem(`graph_${eventKey}`, JSON.stringify(state));
      } catch (e) {}
    };
    // 최초 mount/업데이트 시 저장
    saveGraphState();
    // cleanup(언마운트/이벤트 변경 직전)에도 저장
    return () => {
      saveGraphState();
    };
  }, [filteredElements, chapterNum, eventNum, hideIsolated]);

  // === graphViewState가 없을 때 localStorage에서 복원 ===
  useEffect(() => {
    if (!cyRef.current) return;
    if (graphViewState) return; // 이미 상위에서 복원됨
    const saved = localStorage.getItem(`graph_${eventKey}`);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        const cy = cyRef.current;
        cy.elements().remove();
        cy.add([
          ...(Array.isArray(state.nodes) ? state.nodes.map(n => ({
            group: 'nodes',
            data: n.data,
            position: n.pos,
            classes: n.classes
          })) : []),
          ...(Array.isArray(state.edges) ? state.edges.map(e => ({
            group: 'edges',
            data: e.data,
            classes: e.classes
          })) : [])
        ]);
        if (state.pan) cy.pan(state.pan);
        if (state.zoom) cy.zoom(state.zoom);
        // 복원 성공 시 layout을 절대 실행하지 않음
        return;
      } catch (e) {}
    }
    // 복원 실패 시에만 layout 실행 (기존 로직)
    const cy = cyRef.current;
    cy.elements().unlock();
    cy.resize();
    cy.elements().remove();
    cy.add(filteredElements);
    const currentLayout = cy.layout(search ? searchLayout : layout);
    currentLayout.run();
    cy.fit(undefined, 120);
    cy.center();
  }, [filteredElements, chapterNum, eventNum, hideIsolated, graphViewState]);

  // === 첫 이벤트에서만 레이아웃 실행 및 위치 저장, 이후에는 위치만 적용 ===
  useEffect(() => {
    if (!cyRef.current || !elements || elements.length === 0) return;
    // === 완전히 같은 그래프면 아무것도 하지 않음 ===
    const prevElements = prevElementsRef.current;
    const isSameElements = prevElements &&
      prevElements.length === elements.length &&
      prevElements.every((el, i) => JSON.stringify(el) === JSON.stringify(elements[i]));
    if (isSameElements) return;
    const cy = cyRef.current;

    // === localStorage에서 위치 누적 정보 불러오기 ===
    const storageKey = `chapter_node_positions_${chapterNum}`;
    let savedPositions = {};
    try {
      const savedStr = localStorage.getItem(storageKey);
      if (savedStr) savedPositions = JSON.parse(savedStr);
    } catch (e) {}

    if (eventNum === 1) {
      // 첫 이벤트: 레이아웃 실행 및 위치 저장
      cy.elements().remove();
      cy.add(elements);
      cy.layout({ name: 'cose', animate: true, fit: true, padding: 80 }).run();
      cy.one('layoutstop', () => {
        const layout = {};
        cy.nodes().forEach(node => {
          layout[node.id()] = node.position();
        });
        try {
          localStorage.setItem(storageKey, JSON.stringify(layout));
        } catch (e) {}
      });
    } else {
      // 이후 이벤트: 저장된 위치만 적용, 레이아웃/랜덤/fit/center 등 실행 X
      cy.elements().remove();
      cy.add(elements);
      cy.nodes().forEach(node => {
        if (savedPositions[node.id()]) {
          node.position(savedPositions[node.id()]);
        }
      });
      // 새로 등장한 노드만 위치 배치 및 위치 누적 저장
      let updated = false;
      const existingPositions = Object.values(savedPositions);
      cy.nodes().forEach(node => {
        if (!savedPositions[node.id()]) {
          const centerX = cy.width() / 2;
          const centerY = cy.height() / 2;
          const radius = Math.min(centerX, centerY) * 0.7;
          let angle = Math.random() * 2 * Math.PI;
          let tryCount = 0;
          let pos;
          do {
            pos = {
              x: centerX + radius * Math.cos(angle + tryCount * 0.3),
              y: centerY + radius * Math.sin(angle + tryCount * 0.3)
            };
            tryCount++;
          } while (
            existingPositions.some(ep => Math.hypot(ep.x - pos.x, ep.y - pos.y) < 140) && tryCount < 20
          );
          node.position(pos);
          savedPositions[node.id()] = pos;
          existingPositions.push(pos);
          updated = true;
        }
      });
      if (updated) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(savedPositions));
        } catch (e) {}
      }
    }
    prevElementsRef.current = elements;
  }, [elements, eventNum, chapterNum]);

  useEffect(() => {
    const elementsStr = JSON.stringify(elements);
    const isSame =
      prevChapterNum.current === chapterNum &&
      prevEventNum.current === eventNum &&
      prevElementsStr.current === elementsStr;

    // 이전과 완전히 같으면 로딩 상태로 전환하지 않음
    if (!isSame) {
      setIsGraphLoading(true);
    }
    // 이전과 같으면 로딩 상태를 false로 유지 (즉, 기존 그래프가 계속 보임)
    prevChapterNum.current = chapterNum;
    prevEventNum.current = eventNum;
    prevElementsStr.current = elementsStr;
  }, [elements, chapterNum, eventNum]);

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
              <div className="graph-canvas-area w-full h-full" ref={containerRef} style={{ zIndex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                {/* 로딩 중 표시 */}
                {(!inViewer && isGraphLoading) && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6C8EFF',
                    fontSize: 22,
                    fontWeight: 600,
                    pointerEvents: 'none',
                  }}>
                    <span className="graph-loading-spinner" style={{
                      width: 40,
                      height: 40,
                      border: '4px solid #e3e6ef',
                      borderTop: '4px solid #6C8EFF',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      marginBottom: 12,
                      display: 'inline-block',
                    }} />
                    로딩 중...
                  </div>
                )}
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
                {containerReady && elements && elements.length > 0 && (
                 <CytoscapeGraph
                 ref={cyRef}
                 elements={filteredElements}
                 stylesheet={stylesheet}
                 layout={search ? searchLayout : layout}
                 tapNodeHandler={tapNodeHandler}
                 tapEdgeHandler={tapEdgeHandler}
                 tapBackgroundHandler={tapBackgroundHandler}
                 fitNodeIds={fitNodeIds}
                 style={{ 
                   width: '100%', 
                   height: '100%', 
                   overflow: 'hidden', 
                   position: 'relative',
                   backgroundColor: '#f8fafc'
                 }}
                 onLayoutReady={() => setIsGraphLoading(false)}
               />
                )}
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
        <div className="graph-canvas-area w-full h-full" ref={containerRef} style={{ zIndex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          {/* 로딩 중 표시 */}
          {(!inViewer && isGraphLoading) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10000,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6C8EFF',
              fontSize: 22,
              fontWeight: 600,
              pointerEvents: 'none',
            }}>
              <span className="graph-loading-spinner" style={{
                width: 40,
                height: 40,
                border: '4px solid #e3e6ef',
                borderTop: '4px solid #6C8EFF',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: 12,
                display: 'inline-block',
              }} />
              로딩 중...
            </div>
          )}
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
          {containerReady && elements && elements.length > 0 && (
           <CytoscapeGraph
           ref={cyRef}
           elements={filteredElements}
           stylesheet={stylesheet}
           layout={search ? searchLayout : layout}
           tapNodeHandler={tapNodeHandler}
           tapEdgeHandler={tapEdgeHandler}
           tapBackgroundHandler={tapBackgroundHandler}
           fitNodeIds={fitNodeIds}
           style={{ 
             width: '100%', 
             height: '100%', 
             overflow: 'hidden', 
             position: 'relative',
             backgroundColor: '#f8fafc'
           }}
           onLayoutReady={() => setIsGraphLoading(false)}
         />
          )}
        </div>
      </div>
    </div>
  );
}

export default RelationGraphMain;
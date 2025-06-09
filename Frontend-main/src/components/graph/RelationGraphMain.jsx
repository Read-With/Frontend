import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useContext,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import GraphControls from "./GraphControls";
import CytoscapeGraphDirect from "./CytoscapeGraphDirect";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";
import { FaTimes, FaClock } from "react-icons/fa";
import { CytoscapeGraphContext } from "./CytoscapeGraphPortalProvider";
import { calcGraphDiff } from "./graphDiff";

function getRelationColor(positivity) {
  if (positivity > 0.6) return "#15803d";
  if (positivity > 0.3) return "#059669";
  if (positivity > -0.3) return "#6b7280";
  if (positivity > -0.6) return "#dc2626";
  return "#991b1b";
}

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
  onEventChange,
  graphDiff: _graphDiff,
  prevElements: _prevElements,
  currentElements,
  diffNodes,
}) {
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
  const prevElementsRef = useRef([]);
  const updateTimeoutRef = useRef(null);
  const { updateGraph, graphProps } = useContext(CytoscapeGraphContext);
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });

  // gatsby.epub 단독 그래프 페이지에서만 간격을 더 넓게
  const isGraphPage = inViewer && fullScreen;

  // 타임라인으로 이동하는 함수
  const handleViewTimeline = () => {
    navigate(`/viewer/${filename}/timeline`, { state: location.state });
  };

  // 이벤트 변경 핸들러를 useCallback으로 최적화
  const handleEventChange = useCallback(
    (num) => {
      if (onEventChange) {
        onEventChange(num);
      }
    },
    [onEventChange]
  );

  // 툴팁 상태 업데이트를 useCallback으로 최적화
  const updateTooltip = useCallback((type, data, position) => {
    setActiveTooltip({ type, ...data, ...position });
  }, []);

  // 노드 클릭 핸들러 최적화
  const tapNodeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const node = evt.target;
      const pos = node.renderedPosition();
      const cy = cyRef.current;
      const pan = cy.pan();
      const zoom = cy.zoom();
      const container = document.querySelector(".graph-canvas-area");
      const containerRect = container.getBoundingClientRect();

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

      const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
      const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;

      setTimeout(() => {
        updateTooltip(
          "node",
          {
            id: node.id(),
            data: node.data(),
            nodeCenter,
          },
          {
            x: mouseX,
            y: mouseY,
          }
        );
      }, 0);
    },
    [updateTooltip]
  );

  // 간선 클릭 핸들러 최적화
  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const edge = evt.target;
      const container = document.querySelector(".graph-canvas-area");
      const containerRect = container.getBoundingClientRect();

      const pos = edge.midpoint();
      const pan = cy.pan();
      const zoom = cy.zoom();

      const absoluteX = pos.x * zoom + pan.x + containerRect.left;
      const absoluteY = pos.y * zoom + pan.y + containerRect.top;

      setActiveTooltip(null);
      updateTooltip(
        "edge",
        {
          id: edge.id(),
          data: edge.data(),
          sourceNode: edge.source(),
          targetNode: edge.target(),
        },
        {
          x: absoluteX,
          y: absoluteY,
        }
      );

      cy.batch(() => {
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        edge.removeClass("faded");
        edge.source().removeClass("faded").addClass("highlighted");
        edge.target().removeClass("faded").addClass("highlighted");
      });

      selectedEdgeIdRef.current = edge.id();
    },
    [updateTooltip]
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

  // elements(노드/간선) 배열을 main 노드가 먼저 오도록 정렬
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    // 노드와 엣지 분리
    const nodes = elements.filter((e) => !e.data.source);
    const edges = elements.filter((e) => e.data.source);

    // main 노드 먼저, 그 다음 나머지 노드
    const mainNodes = nodes.filter((n) => n.data.main);
    const otherNodes = nodes.filter((n) => !n.data.main);

    // main 노드가 여러 개면 첫 번째만 맨 앞에, 나머지는 뒤에 붙임
    const orderedNodes =
      mainNodes.length > 0
        ? [mainNodes[0], ...otherNodes, ...mainNodes.slice(1)]
        : nodes;

    return [...orderedNodes, ...edges];
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
        const matchedNodeIds = matchedNodes.map((node) => node.data.id);
        const relatedEdges = sortedElements.filter(
          (el) =>
            el.data.source &&
            (matchedNodeIds.includes(el.data.source) ||
              matchedNodeIds.includes(el.data.target))
        );
        // 관련 노드 ID 수집
        const relatedNodeIds = new Set();
        relatedEdges.forEach((edge) => {
          relatedNodeIds.add(edge.data.source);
          relatedNodeIds.add(edge.data.target);
        });
        // 필터링된 요소 생성
        filteredElements = sortedElements.filter(
          (el) =>
            !el.data.source ||
            relatedNodeIds.has(el.data.id) ||
            matchedNodeIds.includes(el.data.id)
        );
        fitNodeIds = Array.from(relatedNodeIds);
      }
    }
    return { filteredElements, fitNodeIds };
  }, [sortedElements, search]);

  // currentEventJson이 내용이 같으면 참조도 같게 useMemo로 캐싱
  const stableEventJson = useMemo(
    () => (graphViewState ? JSON.stringify(graphViewState) : ""),
    [graphViewState]
  );

  // 스타일시트 useMemo 의존성 최소화
  const stylesheet = useMemo(
    () => [
      {
        selector: "node.appear, edge.appear",
        style: {
          opacity: 0,
          "transition-property": "opacity",
          "transition-duration": "1s",
          "transition-timing-function": "ease",
        },
      },
      {
        selector: "node",
        style: {
          "background-color": "#eee",
          "border-width": 2,
          "border-color": "#5B7BA0",
          width: 50,
          height: 50,
          shape: "ellipse",
          label: "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": 12,
          "font-weight": 100,
          color: "#444",
          "text-margin-y": 4,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          opacity: 1,
        },
      },
      {
        selector: "edge",
        style: {
          width: 6,
          "line-color": (ele) => getRelationColor(ele.data("positivity")),
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": 8,
          "text-rotation": "autorotate",
          color: "#42506b",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-outline-color": "#fff",
          "text-outline-width": 2,
          opacity: 1,
          "target-arrow-shape": "none",
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
        selector: "node.blink",
        style: {
          "background-color": "#ffeb3b",
          "transition-property": "background-color",
          "transition-duration": "0.5s",
          "transition-timing-function": "ease-in-out",
        },
      },
      {
        selector: "node[highlight]",
        style: {
          "background-color": "#ffeb3b",
          "transition-property": "background-color",
          "transition-duration": "0.2s",
          "transition-timing-function": "ease-in-out",
        },
      },
    ],
    []
  );

  // 노드 개수에 따라 spacingFactor 동적 조정
  const nodeCount = useMemo(() => {
    return elements ? elements.filter((e) => !e.data.source).length : 0;
  }, [elements]);
  const spacingFactor = useMemo(() => {
    if (nodeCount >= 21) return 2;
    if (nodeCount >= 11) return 1.5;
    return 1;
  }, [nodeCount]);

  const layout = useMemo(
    () => ({
      name: "circle",
      padding: 60,
      fit: true,
      avoidOverlap: true,
      spacingFactor: 1,
      radius: 100,
      startAngle: 0,
      animate: false,
    }),
    []
  );

  const searchLayout = useMemo(
    () => ({
      name: "circle",
      padding: 120,
      fit: true,
      avoidOverlap: true,
      spacingFactor: spacingFactor + 0.2,
      animate: true,
      animationDuration: 800,
    }),
    [spacingFactor]
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

  // === 오직 chapter_node_positions_{chapterNum}만 사용하여 노드 위치 복원 (절대적 위치) ===
  // 이전 코드 제거

  // 개선된 코드: chapterNum, eventNum이 바뀔 때만 로딩 오버레이 표시
  useEffect(() => {
    const isChapterOrEventChanged = prevElementsRef.current !== eventNum;

    if (isChapterOrEventChanged) {
      // setIsGraphLoading(true);
    }
    // 이전 값 저장
    prevElementsRef.current = eventNum;
  }, [eventNum]);

  useEffect(() => {
    console.log(
      "[상태점검] chapterNum:",
      chapterNum,
      "eventNum:",
      eventNum,
      "maxEventNum:",
      maxEventNum,
      "isLastEvent:",
      eventNum === maxEventNum
    );
  }, [chapterNum, eventNum, maxEventNum]);

  // elements, stylesheet, layout, searchLayout, style useMemo 최적화
  const memoizedElements = useMemo(() => filteredElements, [filteredElements]);
  const memoizedStylesheet = useMemo(() => stylesheet, [stylesheet]);
  const memoizedLayout = useMemo(() => ({ name: "preset" }), []);
  const memoizedStyle = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      overflow: "hidden",
      position: "relative",
      backgroundColor: "#f8fafc",
    }),
    []
  );

  // id 배열을 elements 객체 배열로 변환하는 함수
  function getElementsByIds(elements, ids, onlyNodes = false) {
    if (!elements) return [];
    if (!ids) return [];
    const idSet = new Set(ids.map(String));
    return elements.filter((e) => {
      const isNode = !e.data.source && !e.data.target;
      if (onlyNodes && !isNode) return false;
      return idSet.has(String(e.data.id));
    });
  }

  // 커스텀 diff 계산: 이전 filteredElements에 없고 현재 filteredElements에만 있는 id는 무조건 ripple 대상으로 인식 (id 배열 반환)
  function customGraphDiff(prevElements, currElements) {
    prevElements = prevElements || [];
    currElements = currElements || [];
    const prevIds = new Set(
      prevElements.map((e) => String(e.data && e.data.id)).filter(Boolean)
    );
    const currIds = new Set(
      currElements.map((e) => String(e.data && e.data.id)).filter(Boolean)
    );
    // 추가: 현재에만 있는 id (숨겨진 노드가 다시 보이게 되는 경우도 포함)
    const added = [...currIds].filter((id) => !prevIds.has(id));
    // 삭제: 이전에만 있고 현재에는 없는 id
    const removed = [...prevIds].filter((id) => !currIds.has(id));
    // updated: added + removed
    const updated = [...added, ...removed];
    return { added, removed, updated };
  }

  // CytoscapeGraphDirect에 전달할 diff를 filteredElements(화면에 보이는 그래프) 객체 배열로 변환 (노드만)
  const graphDiffForCytoscape = useMemo(() => {
    // prevElements가 undefined라면 prevElementsRef.current를 fallback으로 사용
    const prevElementsSource =
      typeof prevElements !== "undefined"
        ? prevElements
        : prevElementsRef.current;
    const prevElementsSafe = Array.isArray(prevElementsSource)
      ? prevElementsSource
      : [];
    if (!prevElementsSafe || prevElementsSafe.length === 0) {
      return { added: [], removed: [], updated: [] };
    }
    const diff = customGraphDiff(prevElementsSafe, filteredElements || []);
    const added = getElementsByIds(filteredElements, diff.added, true);
    const removed = getElementsByIds(prevElementsSafe, diff.removed, true);
    const updated = [...added, ...removed];
    console.log("[DIFF] graphDiffForCytoscape.added:", added);
    return { added, removed, updated };
  }, [filteredElements, prevElementsRef.current]);

  // CytoscapeGraphPortalProvider를 통한 데이터 갱신
  useEffect(() => {
    updateGraph({
      elements: memoizedElements,
      stylesheet: memoizedStylesheet,
      layout: memoizedLayout,
      tapNodeHandler,
      tapEdgeHandler,
      tapBackgroundHandler,
      fitNodeIds,
      style: memoizedStyle,
      cyRef,
      newNodeIds,
    });
    // eslint-disable-next-line
  }, [
    memoizedElements,
    memoizedStylesheet,
    memoizedLayout,
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    fitNodeIds,
    memoizedStyle,
    cyRef,
    newNodeIds,
  ]);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    console.log("[Main] elements:", elements);
  }, [elements]);

  useEffect(() => {
    console.log("[Main] graphProps:", graphProps);
  }, [graphProps]);

  console.log("[RelationGraphMain] diffNodes:", diffNodes);

  if (fullScreen && inViewer) {
    return (
      <div
        className="graph-page-container"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 9999,
        }}
      >
        {/* 상단바: > 버튼(복귀)만 왼쪽 끝에, 가운데 > 버튼은 완전히 제거 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100vw",
            height: 60,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 0,
            paddingLeft: 12,
            paddingRight: 90,
            paddingTop: 0,
            justifyContent: "flex-start",
            background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            borderBottom: "1px solid #e5e7eb",
            zIndex: 10001,
          }}
        >
          {/* 눈에 띄는 복귀(>) 버튼 */}
          <button
            onClick={handleExitFullScreen}
            style={{
              height: 40,
              width: 40,
              minWidth: 40,
              minHeight: 40,
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 100%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              marginRight: 18,
              marginLeft: 4,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(79,109,222,0.13)",
              fontWeight: 700,
              outline: "none",
              transition:
                "background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s",
            }}
            title="분할화면으로"
            onMouseOver={(e) =>
              (e.currentTarget.style.background =
                "linear-gradient(100deg, #6fa7ff 0%, #4F6DDE 100%)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.background =
                "linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 100%)")
            }
          >
            {">"}
          </button>
          {/* 그래프 본문, 컨트롤, 툴팁 등만 렌더링 (재귀 X) */}
          <div className="flex-1 relative overflow-hidden w-full h-full">
            {/* 검색 폼 추가 */}
            {!inViewer && (
              <div
                className="search-container"
                style={{ justifyContent: "flex-start", paddingLeft: "20px" }}
              >
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
            <div
              className="flex-1 relative overflow-hidden"
              style={{ width: "100%", height: "100%" }}
            >
              {/* 툴팁 렌더링 */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  zIndex: 9999,
                }}
              >
                {activeTooltip?.type === "node" && activeTooltip.data && (
                  <GraphNodeTooltip
                    key={`node-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    nodeCenter={activeTooltip.nodeCenter}
                    onClose={handleCloseTooltip}
                    style={{ pointerEvents: "auto" }}
                  />
                )}
                {activeTooltip?.type === "edge" && (
                  <EdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    style={{ pointerEvents: "auto" }}
                    chapterNum={chapterNum} // ← 추가!
                    eventNum={eventNum} // ← 추가!
                  />
                )}
              </div>
              {/* 그래프 영역: CytoscapeGraphDirect만 렌더링 */}
              <CytoscapeGraphDirect
                key={graphDiffForCytoscape.added
                  .map((n) => n.data.id)
                  .join(",")}
                elements={filteredElements}
                fitNodeIds={fitNodeIds}
                cyRef={cyRef}
                stylesheet={stylesheet}
                layout={search ? searchLayout : layout}
                tapNodeHandler={tapNodeHandler}
                tapEdgeHandler={tapEdgeHandler}
                tapBackgroundHandler={tapBackgroundHandler}
                graphDiff={graphDiffForCytoscape}
                prevElements={prevElementsRef.current}
                currentElements={filteredElements}
                chapterNum={chapterNum}
                eventNum={eventNum}
                diffNodes={diffNodes}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full w-full relative overflow-hidden ${
        fullScreen ? "graph-container-wrapper" : ""
      }`}
      style={{ width: "100%", height: "100%" }}
    >
      {/* < 버튼은 inViewer && !fullScreen일 때만 보임 */}
      {/* 기존 중앙 고정 < 버튼 완전히 제거 */}

      {/* 검색 폼 추가 */}
      {!inViewer && (
        <div
          className="search-container"
          style={{ justifyContent: "flex-start", paddingLeft: "20px" }}
        >
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

      <div
        className="flex-1 relative overflow-hidden"
        style={{ width: "100vh", height: "200vh" }}
      >
        {/* 툴팁 렌더링 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          {activeTooltip?.type === "node" && activeTooltip.data && (
            <GraphNodeTooltip
              key={`node-tooltip-${activeTooltip.id}`}
              data={activeTooltip.data}
              x={activeTooltip.x}
              y={activeTooltip.y}
              nodeCenter={activeTooltip.nodeCenter}
              onClose={handleCloseTooltip}
              style={{ pointerEvents: "auto" }}
            />
          )}
          {activeTooltip?.type === "edge" && (
            <EdgeTooltip
              key={`edge-tooltip-${activeTooltip.id}`}
              data={activeTooltip.data}
              x={activeTooltip.x}
              y={activeTooltip.y}
              onClose={handleCloseTooltip}
              sourceNode={activeTooltip.sourceNode}
              targetNode={activeTooltip.targetNode}
              style={{ pointerEvents: "auto" }}
              chapterNum={chapterNum} // ← 추가!
              eventNum={eventNum} // ← 추가!
            />
          )}
        </div>
        {/* 그래프 영역: CytoscapeGraphDirect만 렌더링 */}
        <CytoscapeGraphDirect
          key={graphDiffForCytoscape.added.map((n) => n.data.id).join(",")}
          elements={filteredElements}
          fitNodeIds={fitNodeIds}
          cyRef={cyRef}
          stylesheet={stylesheet}
          layout={search ? searchLayout : layout}
          tapNodeHandler={tapNodeHandler}
          tapEdgeHandler={tapEdgeHandler}
          tapBackgroundHandler={tapBackgroundHandler}
          graphDiff={graphDiffForCytoscape}
          prevElements={prevElementsRef.current}
          currentElements={filteredElements}
          chapterNum={chapterNum}
          eventNum={eventNum}
          diffNodes={diffNodes}
        />
      </div>
    </div>
  );
}

export default React.memo(RelationGraphMain, (prevProps, nextProps) => {
  return (
    prevProps.elements === nextProps.elements &&
    prevProps.newNodeIds === nextProps.newNodeIds &&
    prevProps.graphViewState === nextProps.graphViewState &&
    prevProps.chapterNum === nextProps.chapterNum &&
    prevProps.eventNum === nextProps.eventNum &&
    prevProps.hideIsolated === nextProps.hideIsolated
  );
});

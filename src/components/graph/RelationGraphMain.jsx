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

function RelationGraphMain({ elements }) {
  const cyRef = useRef(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeTooltip, setActiveTooltip] = useState(null); // 하나의 툴팁만 관리
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { filename } = useParams();

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

  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = elements;
    let fitNodeIds = null;
    if (search) {
      const matchedNode = elements.find(
        (el) =>
          !el.data.source &&
          (el.data.label?.toLowerCase().includes(search.toLowerCase()) ||
            (el.data.names &&
              el.data.names.some((n) =>
                n.toLowerCase().includes(search.toLowerCase())
              )))
      );
      if (matchedNode) {
        const relatedEdges = elements.filter(
          (el) =>
            el.data.source &&
            (el.data.source === matchedNode.data.id ||
              el.data.target === matchedNode.data.id)
        );
        const relatedNodeIds = [
          ...new Set(
            relatedEdges.flatMap((e) => [e.data.source, e.data.target])
          ),
        ];
        const relatedNodes = elements.filter(
          (el) => !el.data.source && relatedNodeIds.includes(el.data.id)
        );
        filteredElements = [...relatedNodes, ...relatedEdges];
        fitNodeIds = relatedNodeIds;
      } else {
        filteredElements = [];
        fitNodeIds = [];
      }
    } else {
      filteredElements = elements;
    }
    return { filteredElements, fitNodeIds };
  }, [elements, search]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "#fff",
          label: "data(label)",
          "font-size": (ele) => (ele.data("main") && ele.data("label") === "Nick" ? 16 : 12),
          "font-weight": (ele) => (ele.data("main") && ele.data("label") === "Nick" ? "bold" : "normal"),
          "text-valign": "center",
          "text-halign": "center",
          width: (ele) => (ele.data("main") && ele.data("label") === "Nick" ? 48 : 36),
          height: (ele) => (ele.data("main") && ele.data("label") === "Nick" ? 48 : 36),
          color: "#444",
          "text-outline-color": "#fff",
          "text-outline-width": 0,
          "text-background-color": "#fff",
          "text-background-opacity": 0.5,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-shadow-blur": 4,
          "text-shadow-color": "#8888",
          "text-shadow-offset-x": 1,
          "text-shadow-offset-y": 1,
          cursor: "pointer",
          "border-width": (ele) => (ele.data("main") && ele.data("label") === "Nick" ? 2 : 1),
          "border-color": (ele) => ele.data("main") && ele.data("label") === "Nick" ? "#5B7BA0" : "#A0BCDA",
        },
      },
      {
        selector: "edge",
        style: {
          width: "mapData(weight, 0, 1, 2, 7)",
          "line-color": (ele) => getRelationColor(ele.data("positivity")),
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": 10,
          "text-rotation": "autorotate",
          color: "#42506b",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-shadow-blur": 4,
          "text-shadow-color": "#8888",
          "text-shadow-offset-x": 1,
          "text-shadow-offset-y": 1,
          opacity: "mapData(weight, 0, 1, 0.5, 1)",
          "target-arrow-shape": "none",
          cursor: "pointer",
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

  const layout = useMemo(
    () => ({
      name: "cose",
      padding: 60,
      nodeRepulsion: 12000,
      idealEdgeLength: 120,
      animate: false,
      fit: false,
      randomize: false,
    }),
    []
  );

  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    clearSelection();
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().unlock();
      cy.resize();
      const layoutInstance = cy.layout(layout);
      layoutInstance.run();
      cy.one("layoutstop", () => {
        cy.fit(undefined, 60); // 전체 그래프를 한번 fit
        cy.center(); // 중심 정렬
      });
    }
  }, [clearSelection, layout]);

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
  }, [searchInput]);

  const handleFitView = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.fit();
      cyRef.current.center();
    }
  }, []);

  const handleClose = useCallback(() => {
    // 뒤로 이동
    navigate(-1);
  }, [navigate]);

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.on("tap", "node", tapNodeHandler);
    cy.on("tap", "edge", tapEdgeHandler);
    cy.on("tap", tapBackgroundHandler);
    return () => {
      cy.removeListener("tap", "node", tapNodeHandler);
      cy.removeListener("tap", "edge", tapEdgeHandler);
      cy.removeListener("tap", tapBackgroundHandler);
    };
  }, [tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  return (
    <div className="flex flex-col h-screen relative overflow-hidden">
      {/* 닫기 버튼 - 상단 맨 우측으로 변경 */}
      <button
        onClick={handleClose}
        className="close-btn"
      >
        <FaTimes size={20} />
      </button>

      <div className="flex-1 relative overflow-hidden">
        {/* 툴팁 렌더링 */}
        {activeTooltip?.type === 'node' && (
          <GraphNodeTooltip
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            nodeCenter={activeTooltip.nodeCenter}
            onClose={handleCloseTooltip}
          />
        )}
        {activeTooltip?.type === 'edge' && (
          <EdgeTooltip
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={handleCloseTooltip}
            sourceNode={activeTooltip.sourceNode}
            targetNode={activeTooltip.targetNode}
          />
        )}

        {/* 검색 컨트롤들 */}
        <GraphControls
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          handleSearch={handleSearch}
          handleReset={handleReset}
          search={search}
          setSearch={setSearch}
          handleViewTimeline={handleViewTimeline}
        />

        {/* 그래프 영역 */}
        <div className="graph-canvas-area w-full h-full">
          <CytoscapeGraph
            ref={cyRef}
            elements={filteredElements}
            stylesheet={stylesheet}
            layout={layout}
            tapNodeHandler={tapNodeHandler}
            tapEdgeHandler={tapEdgeHandler}
            tapBackgroundHandler={tapBackgroundHandler}
            fitNodeIds={fitNodeIds}
          />
        </div>
      </div>
    </div>
  );
}

export default RelationGraphMain;
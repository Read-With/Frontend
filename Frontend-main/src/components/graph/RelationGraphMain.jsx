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
import { FaTimes, FaClock } from "react-icons/fa";

function getRelationColor(positivity) {
  if (positivity > 0.6) return "#15803d";
  if (positivity > 0.3) return "#059669";
  if (positivity > -0.3) return "#6b7280";
  if (positivity > -0.6) return "#dc2626";
  return "#991b1b";
}

function RelationGraphMain({ elements }) {
  const cyRef = useRef(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeTooltip, setActiveTooltip] = useState(null);
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
      setActiveTooltip({
        type: "node",
        id: node.id(),
        x: mouseX,
        y: mouseY,
        data: node.data(),
        nodeCenter,
      });
    }, 0);
  }, []);

  // 간선 클릭 시 툴팁 표시 (좌표 변환)
  const tapEdgeHandler = useCallback((evt) => {
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
    setActiveTooltip({
      type: "edge",
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
    });
    selectedEdgeIdRef.current = edge.id();
  }, []);

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
          "background-fit": "cover",
          "background-image": "data(img)",
          "background-color": "#eee",
          "border-width": (ele) => (ele.data("main") ? 2 : 1),
          "border-color": "#5B7BA0",
          width: 48,
          height: 48,
          shape: "ellipse",
          label: "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": 13,
          "font-weight": (ele) => (ele.data("main") ? 700 : 400),
          color: "#444",
          "text-margin-y": 8,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
        },
      },
      {
        selector: "edge",
        style: {
          width: "mapData(weight, 0, 1, 1.5, 4)",
          "line-color": (ele) => getRelationColor(ele.data("positivity")),
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": 9,
          "text-rotation": "autorotate",
          color: "#42506b",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-outline-color": "#fff",
          "text-outline-width": 2,
          opacity: "mapData(weight, 0, 1, 0.5, 1)",
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
    ],
    []
  );

  const layout = useMemo(
    () => ({
      name: "cose",
      padding: 40,
      nodeRepulsion: 12000,
      idealEdgeLength: 120,
      animate: false,
      fit: false,
      randomize: false,
      nodeOverlap: 20,
      avoidOverlap: true,
      nodeSeparation: 50,
      randomSeed: 42,
    }),
    []
  );

  const handleReset = useCallback(() => {
    window.location.reload();
  }, []);

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
    navigate(`/viewer/${filename}`);
  }, [navigate, filename]);

  // ★★★ 노드 드래그 시 겹침 방지 로직 추가 ★★★
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    cy.on("dragfree", "node", function () {
      const nodes = cy.nodes();
      const nodePositions = {};
      nodes.forEach((node) => {
        nodePositions[node.id()] = {
          x: node.position("x"),
          y: node.position("y"),
        };
      });
      for (let iteration = 0; iteration < 3; iteration++) {
        let moved = false;
        nodes.forEach((node1) => {
          nodes.forEach((node2) => {
            if (node1.id() === node2.id()) return;
            const pos1 = nodePositions[node1.id()];
            const pos2 = nodePositions[node2.id()];
            const dx = pos1.x - pos2.x;
            const dy = pos1.y - pos2.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const size1 = node1.data("main") ? 60 : 40;
            const size2 = node2.data("main") ? 60 : 40;
            const minDistance = (size1 + size2) / 2 + 30;
            if (distance < minDistance && distance > 0) {
              moved = true;
              const pushFactor = ((minDistance - distance) / distance) * 0.5;
              nodePositions[node1.id()].x += dx * pushFactor;
              nodePositions[node1.id()].y += dy * pushFactor;
              nodePositions[node2.id()].x -= dx * pushFactor;
              nodePositions[node2.id()].y -= dy * pushFactor;
            }
          });
        });
        if (!moved) break;
      }
      nodes.forEach((node) => {
        const pos = nodePositions[node.id()];
        node.position({ x: pos.x, y: pos.y });
      });
    });
  }, []);

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

  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().unlock();
      cy.resize();
      const layoutInstance = cy.layout(layout);
      layoutInstance.run();
      cy.one("layoutstop", () => {
        cy.fit(undefined, 60);
        cy.center();
      });
    }
  }, [elements, layout]);

  return (
    <div className="graph-canvas-area">
      <GraphControls
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        handleSearch={handleSearch}
        handleReset={handleReset}
        handleFitView={handleFitView}
        search={search}
        setSearch={setSearch}
        handleViewTimeline={handleViewTimeline}
      />
      <CytoscapeGraph
        ref={cyRef}
        elements={filteredElements}
        stylesheet={stylesheet}
        layout={layout}
        fitNodeIds={fitNodeIds}
        tapNodeHandler={tapNodeHandler}
        tapEdgeHandler={tapEdgeHandler}
        tapBackgroundHandler={tapBackgroundHandler}
      />
      {activeTooltip && activeTooltip.type === "node" && (
        <GraphNodeTooltip
          data={activeTooltip.data}
          x={activeTooltip.x}
          y={activeTooltip.y}
          nodeCenter={activeTooltip.nodeCenter}
          onClose={handleCloseTooltip}
        />
      )}
      {activeTooltip && activeTooltip.type === "edge" && (
        <EdgeTooltip
          data={activeTooltip.data}
          x={activeTooltip.x}
          y={activeTooltip.y}
          onClose={handleCloseTooltip}
          sourceNode={activeTooltip.sourceNode}
          targetNode={activeTooltip.targetNode}
        />
      )}
    </div>
  );
}

export default RelationGraphMain;

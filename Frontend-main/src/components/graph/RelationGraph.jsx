import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import CytoscapeGraphDirect from "./CytoscapeGraphDirect";
import "./RelationGraph.css";

const RelationGraph = ({ elements, inViewer = false }) => {
  const cyRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);

  // 툴팁 상태 업데이트를 useCallback으로 최적화
  const updateTooltip = useCallback((type, data, position) => {
    setActiveTooltip({ type, ...data, ...position });
  }, []);

  // 노드 클릭 핸들러 최적화
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const pos = node.renderedPosition();
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const container = document.querySelector('.graph-canvas-area');
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
      updateTooltip('node', {
        id: node.id(),
        data: node.data(),
        nodeCenter
      }, {
        x: mouseX,
        y: mouseY
      });
    }, 0);
  }, [updateTooltip]);

  // 간선 클릭 핸들러 최적화
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
    updateTooltip('edge', {
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target()
    }, {
      x: absoluteX,
      y: absoluteY
    });

    cy.batch(() => {
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");
      edge.removeClass("faded");
      edge.source().removeClass("faded").addClass("highlighted");
      edge.target().removeClass("faded").addClass("highlighted");
    });

    selectedEdgeIdRef.current = edge.id();
  }, [updateTooltip]);

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

  // 스타일시트 useMemo 의존성 최소화
  const stylesheet = useMemo(() => [
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
        "font-weight": (ele) => ele.data("main") ? 700 : 400,
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
        "line-color": "#6b7280",
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
  ], [inViewer]);

  // layout useMemo 의존성 최소화
  const layout = useMemo(() => ({
    name: "cose",
    padding: 90,
    nodeRepulsion: 2000,
    idealEdgeLength: 150,
    animate: false,
    fit: true,
    randomize: false,
    nodeOverlap: 12,
    avoidOverlap: true,
    nodeSeparation: 50,
    randomSeed: 42,
    gravity: 0.25,
    componentSpacing: 90
  }), []);

  return (
    <div className="relation-graph-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <CytoscapeGraphDirect
        elements={elements}
        stylesheet={stylesheet}
        layout={layout}
        tapNodeHandler={tapNodeHandler}
        tapEdgeHandler={tapEdgeHandler}
        tapBackgroundHandler={tapBackgroundHandler}
        cyRef={cyRef}
      />
    </div>
  );
};

export default React.memo(RelationGraph);
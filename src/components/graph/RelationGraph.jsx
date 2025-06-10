import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import CytoscapeGraphDirect from "./CytoscapeGraphDirect";
import GraphNodeTooltip from './NodeTooltip';
import EdgeTooltip from './EdgeTooltip';
import "./RelationGraph.css";

// 간선 positivity 값에 따라 HSL 그라데이션 색상 반환
function getRelationColor(positivity) {
  // positivity: -1(빨강) ~ 0(회색) ~ 1(초록)
  // H: 0(빨강) ~ 120(초록)
  const h = 120 * (positivity + 1) / 2; // -1~1 → 0~120
  return `hsl(${h}, 70%, 45%)`;
}

const RelationGraph = ({ elements, inViewer = false }) => {
  const cyRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const [isLayoutDone, setIsLayoutDone] = useState(false);
  const [prevNodeCount, setPrevNodeCount] = useState(elements.filter(e => !e.data.source).length);

  // 툴크 상태 업데이트를 useCallback으로 최적화
  const updateTooltip = useCallback((type, data, position) => {
    setActiveTooltip((prev) => {
      return { type, ...data, ...position };
    });
  }, []);

  // 노드 클릭 핸들러 최적화
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const nodeData = node.data();
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
    
    // 데이터 복원
    let names = nodeData.names;
    if (typeof names === 'string') {
      try { names = JSON.parse(names); } catch { names = [names]; }
    }
    let main = nodeData.main;
    if (typeof main === 'string') main = main === 'true';
    
    setTimeout(() => {
      updateTooltip('node', {
        ...nodeData,
        names,
        main,
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

  // 선택 해제
  const clearSelection = useCallback(() => {
    let changed = false;
    if (cyRef.current) {
      const cy = cyRef.current;
      // faded/highlighted가 있는 경우에만 변경
      if (
        cy.nodes().some(n => n.hasClass("faded") || n.hasClass("highlighted")) ||
        cy.edges().some(e => e.hasClass("faded")) ||
        activeTooltip
      ) {
        changed = true;
        cy.nodes().removeClass("faded highlighted");
        cy.edges().removeClass("faded");
      }
      cy.removeListener("tap", "node");
      cy.removeListener("tap", "edge");
      cy.removeListener("tap");
      cy.on("tap", "node", tapNodeHandler);
      cy.on("tap", "edge", tapEdgeHandler);
      cy.on("tap", tapBackgroundHandler);
    }
    if (changed) {
      setActiveTooltip(null);
      selectedEdgeIdRef.current = null;
      selectedNodeIdRef.current = null;
    }
  }, [tapNodeHandler, tapEdgeHandler, activeTooltip]);

  // 배경 클릭 시 선택 해제
  const tapBackgroundHandler = useCallback((evt) => {
    if (evt.target === cyRef.current) {
      if (
        !selectedNodeIdRef.current &&
        !selectedEdgeIdRef.current &&
        !activeTooltip
      ) {
        // 아무것도 선택된 게 없으면 아무 동작도 하지 않음
        return;
      }
      clearSelection();
    }
  }, [activeTooltip, clearSelection]);

  // 스타일시트 useMemo 의존성 최소화
  const stylesheet = useMemo(() => [
    {
      selector: "node",
      style: {
        "background-color": "#eee",
        "border-width": (ele) => ele.data("main") ? 2 : 1,
        "border-color": "#5B7BA0",
        "border-opacity": 1,
        "width": inViewer ? (ele => ele.data("main") ? 56 : 48) : 40,
        "height": inViewer ? (ele => ele.data("main") ? 56 : 48) : 40,
        "shape": "ellipse",
        "label": "data(label)",
        "text-valign": "bottom",
        "text-halign": "center",
        "font-size": inViewer ? 15 : 12,
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
        "line-color": (ele) => getRelationColor(ele.data('positivity')),
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": inViewer ? 8 : 6,
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
      selector: 'node.cytoscape-node-appear',
      style: {
        'border-color': '#22c55e',
        'border-width': 16,
        'border-opacity': 1,
        'transition-property': 'border-width, border-color, border-opacity',
        'transition-duration': '700ms',
      }
    },
    {
      selector: ".faded",
      style: {
        opacity: 0.25,
        "text-opacity": 0.12,
      },
    },
  ], [inViewer]);

  // layout: 최초 1회만 cose, 이후에는 preset
  const layout = useMemo(() => {
    if (isLayoutDone) {
      return { name: 'preset' };
    }
    return {
      name: 'cose',
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
    };
  }, [isLayoutDone]);

  // 최초 1회만 레이아웃 실행 후 isLayoutDone을 true로
  useEffect(() => {
    if (!isLayoutDone && cyRef.current) {
      const cy = cyRef.current;
      const handler = () => setIsLayoutDone(true);
      cy.on('layoutstop', handler);
      return () => cy.off('layoutstop', handler);
    }
  }, [isLayoutDone]);

  // 그래프가 바뀔 때마다 항상 중앙에 fit
  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.fit();
    }
  }, [elements]);


  useEffect(() => {
    const currentNodeCount = elements.filter(e => !e.data.source).length;
    if (currentNodeCount > prevNodeCount) {
      setIsLayoutDone(false); // 새 노드 등장 시 레이아웃 재실행
    }
    setPrevNodeCount(currentNodeCount);
  }, [elements]);

  return (
    <div className="relation-graph-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 툴팁 렌더링 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
        {activeTooltip?.type === 'node' && (
          <GraphNodeTooltip
            key={`node-tooltip-${activeTooltip.id}`}
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            nodeCenter={activeTooltip.nodeCenter}
            onClose={clearSelection}
            style={{ pointerEvents: 'auto' }}
          />
        )}
        {activeTooltip?.type === 'edge' && (
          <EdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={clearSelection}
            sourceNode={activeTooltip.sourceNode}
            targetNode={activeTooltip.targetNode}
            style={{ pointerEvents: 'auto' }}
          />
        )}
      </div>
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

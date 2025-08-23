import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import GraphNodeTooltip from "./tooltip/NodeTooltip";
import UnifiedEdgeTooltip from "./tooltip/UnifiedEdgeTooltip";
import "./RelationGraph.css";
import { calcGraphDiff } from "../../utils/graphDiff";
import { DEFAULT_LAYOUT } from "../../utils/graphLayouts";

// 간선 positivity 값에 따라 HSL 그라데이션 색상 반환
function getRelationColor(positivity) {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
}

export const getNodeSize = () => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.includes('/user/viewer/')) return 40;
    if (path.includes('/user/graph/')) return 45;
  }
  return 40; // 기본값
};

// 간선(엣지) 스타일도 라우트에 따라 다르게 반환
const getEdgeStyle = () => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.includes('/user/viewer/')) {
      return {
        width: "data(weight)",
        fontSize: 8,
      };
    }
    if (path.includes('/user/graph/')) {
      return {
        width: "data(weight)",
        fontSize: 11,
      };
    }
  }
  return {
    width: "data(weight)",
    fontSize: 8,
  };
};

const RelationGraph = ({
  elements,
  chapterNum, // 관계 변화
  eventNum, // 관계 변화
  edgeLabelVisible = true,
  maxChapter = 10,
}) => {
  const cyRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const [isLayoutDone, setIsLayoutDone] = useState(false);
  const [prevNodeCount, setPrevNodeCount] = useState(
    elements.filter((e) => !e.data.source).length
  );
  const [ripples, setRipples] = useState([]);
  const prevNodeIdsRef = useRef([]);
  const prevEdgeIdsRef = useRef([]);

  // elements가 변경될 때마다 isLayoutDone 초기화
  useEffect(() => {
    if (elements && elements.length > 0) {
      const currentNodeCount = elements.filter((e) => !e.data.source).length;
      if (currentNodeCount !== prevNodeCount) {
        setIsLayoutDone(false);
        setPrevNodeCount(currentNodeCount);
      }
    }
  }, [elements, prevNodeCount]);

  const updateTooltip = useCallback((type, data, position) => {
    setActiveTooltip((prev) => {
      return { type, ...data, ...position };
    });
  }, []);

  const tapNodeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const node = evt.target;
      const nodeData = node.data();
      if (!nodeData) return;
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
      const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
      const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;
      let names = nodeData.names;
      if (typeof names === "string") {
        try {
          names = JSON.parse(names);
        } catch {
          names = [names];
        }
      }
      let main = nodeData.main;
      if (typeof main === "string") main = main === "true";
      setTimeout(() => {
        updateTooltip(
          "node",
          {
            ...nodeData,
            names,
            main,
            nodeCenter,
          },
          {
            x: mouseX,
            y: mouseY,
          }
        );
      }, 0);
      selectedNodeIdRef.current = node.id();
    },
    [updateTooltip]
  );

  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const edge = evt.target;
      const edgeData = edge.data();
      if (!edgeData) return;
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
          data: edgeData,
          sourceNode: edge.source(),
          targetNode: edge.target(),
        },
        {
          x: absoluteX,
          y: absoluteY,
        }
      );
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
    [updateTooltip]
  );

  const clearSelection = useCallback(() => {
    let changed = false;
    if (cyRef.current) {
      const cy = cyRef.current;
      if (
        cy
          .nodes()
          .some((n) => n.hasClass("faded") || n.hasClass("highlighted")) ||
        cy.edges().some((e) => e.hasClass("faded")) ||
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

  const tapBackgroundHandler = useCallback(
    (evt) => {
      if (evt.target === cyRef.current) {
        if (
          !selectedNodeIdRef.current &&
          !selectedEdgeIdRef.current &&
          !activeTooltip
        ) {
          return;
        }
        clearSelection();
      }
    },
    [activeTooltip, clearSelection]
  );

  const nodeSize = getNodeSize();
  const edgeStyle = getEdgeStyle();

  const MAX_EDGE_LABEL_LENGTH = 15;

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
          width: nodeSize,
          height: nodeSize,
          shape: "ellipse",
          label: "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": 12,
          "font-weight": (ele) => (ele.data("main") ? 700 : 400),
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
    [nodeSize, edgeStyle, edgeLabelVisible]
  );

  const layout = DEFAULT_LAYOUT;

  // layout 완료 핸들러
  const handleLayoutComplete = useCallback(() => {
    setIsLayoutDone(true);
  }, []);

  // 그래프가 바뀔 때마다 항상 중앙에 center만 사용
  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.center();
    }
  }, [elements]);

  useEffect(() => {
    if (!cyRef.current) return;
    const prevElements = cyRef.current.elements().map((e) => e.data());
    if (!prevElements || !elements) return;
    const { added } = calcGraphDiff(prevElements, elements);
    if (added.length > 0) {
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



  const handleCanvasClick = (e) => {
    // 그래프 캔버스 영역에서만 ripple
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

  return (
    <div
      className="relation-graph-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      {/* 툴크 렌더링 */}
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
        {activeTooltip?.type === "node" && (
          <GraphNodeTooltip
            key={`node-tooltip-${activeTooltip.id}`}
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            nodeCenter={activeTooltip.nodeCenter}
            onClose={clearSelection}
            inViewer={true}
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            style={{ pointerEvents: "auto" }}
          />
        )}
        {activeTooltip?.type === "edge" && (
          <UnifiedEdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={clearSelection}
            sourceNode={activeTooltip.sourceNode}
            targetNode={activeTooltip.targetNode}
            mode="viewer"
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            style={{ pointerEvents: "auto" }}
          />
        )}
      </div>
      <div
        className="graph-canvas-area"
        onClick={handleCanvasClick}
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        <CytoscapeGraphUnified
          elements={elements}
          stylesheet={stylesheet}
          layout={{ name: 'preset' }}
          tapNodeHandler={tapNodeHandler}
          tapEdgeHandler={tapEdgeHandler}
          tapBackgroundHandler={tapBackgroundHandler}
          cyRef={cyRef}
          onLayoutComplete={handleLayoutComplete}
          nodeSize={nodeSize}
        />
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
      </div>
    </div>
  );
};

export default React.memo(RelationGraph);

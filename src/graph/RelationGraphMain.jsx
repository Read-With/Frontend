import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import GraphControls from "./GraphControls";
import CytoscapeGraph from "./CytoscapeGraph";
import GraphNodeTooltip from "./GraphNodeTooltip"; 
import "./RelationGraph.css";

function RelationGraphMain({ elements }) {
  const cyRef = useRef(null);
  const [filterType, setFilterType] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [ripples, setRipples] = useState([]);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const lastTapTimeRef = useRef(0);
  const containerRef = useRef(null);
  
const handleClickContainer = () => {
  if (!containerRef.current) return;
  containerRef.current.classList.add('clicked');
  setTimeout(() => {
    containerRef.current.classList.remove('clicked');
  }, 300); // 0.3초 후 제거
};

  const createRipple = (x, y) => {
    const id = Date.now();
    setRipples(prev => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== id));
    }, 600);
  };

  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const cy = cyRef.current;
    const now = Date.now();

    if (now - lastTapTimeRef.current < 300) { // 더블 클릭
      const pos = node.renderedPosition();
      createRipple(pos.x, pos.y);

      selectedNodeIdRef.current = node.id();

      setTooltip(null);
      setTimeout(() => {
        setTooltip({
          id: node.id(),
          x: pos.x,
          y: pos.y,
          data: node.data(),
        });
      }, 0);

      lastTapTimeRef.current = 0; // 초기화
    } else {
      lastTapTimeRef.current = now; // 첫번째 클릭 기록
    }
  }, []);

  const tapEdgeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const edge = evt.target;

    const pos = evt.renderedPosition;
    createRipple(pos.x, pos.y);

    // ⭐ 흐림 효과 적용
    cy.nodes().addClass("faded");
    cy.edges().addClass("faded");

    edge.removeClass("faded");
    edge.source().removeClass("faded");
    edge.target().removeClass("faded");

    if (selectedEdgeIdRef.current === edge.id()) {
      clearSelection();
      return;
    }

    selectedEdgeIdRef.current = edge.id();
  }, [createRipple]);

  const tapBackgroundHandler = useCallback((evt) => {
    if (evt.target === cyRef.current) {
      clearSelection();
    }
  }, []);

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

    setTooltip(null);
    selectedEdgeIdRef.current = null;
    selectedNodeIdRef.current = null;
  }, [tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  const handleCloseTooltip = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const relationTypes = useMemo(() => 
    Array.from(new Set(
      elements
        .filter(el => el.data?.label && el.data?.source)
        .flatMap(el => el.data.label.split(", "))
    )),
  [elements]);

  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = elements;
    let fitNodeIds = null;
    if (search) {
      const matchedNode = elements.find(
        (el) =>
          !el.data.source &&
          (el.data.label?.toLowerCase().includes(search.toLowerCase()) ||
            (el.data.names && el.data.names.some(n =>
              n.toLowerCase().includes(search.toLowerCase())
            )))
      );
      if (matchedNode) {
        const relatedEdges = elements.filter(
          (el) =>
            el.data.source &&
            (el.data.source === matchedNode.data.id ||
              el.data.target === matchedNode.data.id) &&
            (filterType === "all" ||
              (el.data.label && el.data.label.includes(filterType)))
        );
        const relatedNodeIds = [...new Set(relatedEdges.flatMap(e => [e.data.source, e.data.target]))];
        const relatedNodes = elements.filter(el => !el.data.source && relatedNodeIds.includes(el.data.id));
        filteredElements = [...relatedNodes, ...relatedEdges];
        fitNodeIds = relatedNodeIds;
      } else {
        filteredElements = [];
        fitNodeIds = [];
      }
    } else {
      filteredElements = elements.filter((el) => {
        if (!el.data) return true;
        if (filterType === "all") return true;
        if (el.data.source && el.data.label) {
          return el.data.label.includes(filterType);
        }
        return true;
      });
    }
    return { filteredElements, fitNodeIds };
  }, [elements, search, filterType]);

  const stylesheet = useMemo(() => [
    {
      selector: "node",
      style: {
        "background-color": ele => ele.data("main") ? "#1976d2" : "#90a4ae",
        label: "data(label)",
        "font-size": ele => (ele.data("main") ? 8 : 6),
        "text-valign": "center",
        "text-halign": "center",
        width: ele => (ele.data("main") ? 40 : 32),
        height: ele => (ele.data("main") ? 40 : 32),
        color: "#fff",
        "text-outline-color": "#333",
        "text-outline-width": 1,
        cursor: "pointer",
      }
    },
    {
      selector: "edge",
      style: {
        width: "mapData(weight, 0, 1, 1, 8)",
        "line-color": "mapData(positivity, -1, 1, #e57373, #81c784)",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 8,
        "text-rotation": "autorotate",
        color: "#333",
        "text-background-color": "#fff",
        "text-background-opacity": 0.8,
        "text-background-padding": 2,
        opacity: "mapData(weight, 0, 1, 0.5, 1)",
        "target-arrow-shape": "none",
        cursor: "pointer",
      }
    },
    {
      selector: ".faded",
      style: {
        opacity: 0.25,
        "text-opacity": 0.12,
      }
    }
  ], []);

  const layout = useMemo(() => ({
    name: "cose",
    padding: 60,
    nodeRepulsion: 12000,
    idealEdgeLength: 120,
    animate: false,
    fit: false,
    randomize: false,
  }), []);

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

  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    setFilterType("all");
    clearSelection();

    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().unlock();
      cy.resize();
      const layout = cy.layout({
        name: "cose",
        padding: 60,
        nodeRepulsion: 12000,
        idealEdgeLength: 120,
        animate: false,
        fit: false,
        randomize: false,
      });
      layout.run();
      cy.one('layoutstop', () => {
        cy.fit(undefined, 60);
        cy.center();
      });
    }
  }, [clearSelection]);

  return (
    <div className="graph-container" style={{ position: "relative", overflow: "auto", width: "100%", height: "100%" }}>
      <GraphControls
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onSearch={(value) => {
          setSearch(value);
          clearSelection();
        }}
        filterType={filterType}
        setFilterType={setFilterType}
        onReset={handleReset}
        relationTypes={relationTypes}
        search={search}
        setSearch={setSearch}
      />
      <CytoscapeGraph
        ref={cyRef}
        elements={filteredElements}
        stylesheet={stylesheet}
        layout={layout}
        onNodeClick={() => {}}
        onEdgeClick={() => {}}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
        fitNodeIds={fitNodeIds}
        search={search}
        filterType={filterType}
      />
      {tooltip && (
        <GraphNodeTooltip nodeData={tooltip} onClose={handleCloseTooltip} />
      )}
      {ripples.map((ripple) => (
        <div
          key={ripple.id}
          className="ripple"
          style={{
            left: ripple.x,
            top: ripple.y,
          }}
        />
      ))}
      {isDragging && (
        <div className="drag-info">노드를 드래그해 연결관계 확인 가능<br />엣지를 클릭하면 관계 설명 확인</div>
      )}
    </div>
  );
}

export default RelationGraphMain;

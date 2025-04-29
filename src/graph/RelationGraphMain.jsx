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
  const [zoomLevel, setZoomLevel] = useState(100); // 표시용 zoom (100%, 110%...)
  const [baseZoom, setBaseZoom] = useState(1.0);   // 실제 초기 zoom 배율
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const lastTapTimeRef = useRef(0);

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
    const now = Date.now();

    if (now - lastTapTimeRef.current < 300) {
      const pos = node.renderedPosition();
      createRipple(pos.x, pos.y);
      selectedNodeIdRef.current = node.id();
      setTooltip(null);
      setTimeout(() => {
        setTooltip({ id: node.id(), x: pos.x, y: pos.y, data: node.data() });
      }, 0);
      lastTapTimeRef.current = 0;
    } else {
      lastTapTimeRef.current = now;
    }
  }, []);

  const tapEdgeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const edge = evt.target;
    const pos = evt.renderedPosition;
    createRipple(pos.x, pos.y);

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
      elements.filter(el => el.data?.label && el.data?.source).flatMap(el => el.data.label.split(", "))
    )), [elements]
  );

  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = elements;
    let fitNodeIds = null;
    if (search) {
      const matchedNode = elements.find(
        el => !el.data.source &&
        (el.data.label?.toLowerCase().includes(search.toLowerCase()) ||
          (el.data.names && el.data.names.some(n => n.toLowerCase().includes(search.toLowerCase()))))
      );
      if (matchedNode) {
        const relatedEdges = elements.filter(
          el => el.data.source &&
          (el.data.source === matchedNode.data.id || el.data.target === matchedNode.data.id) &&
          (filterType === "all" || (el.data.label && el.data.label.includes(filterType)))
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
      filteredElements = elements.filter(el => {
        if (!el.data) return true;
        if (filterType === "all") return true;
        return el.data.source && el.data.label && el.data.label.includes(filterType);
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
  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    setFilterType("all");
    clearSelection();
  
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().unlock();
      cy.resize();
      const layoutInstance = cy.layout(layout);
      layoutInstance.run();
      cy.one("layoutstop", () => {
        cy.fit(undefined, 60);          // 전체 그래프를 한번 fit
        const fittedZoom = cy.zoom();   // 이때 zoom 값 저장
        setBaseZoom(fittedZoom);        // baseZoom으로 기억
        setZoomLevel(100);              // 표시용은 100%
        cy.center();                    // 중심 정렬
      });
    }
  }, [clearSelection]);

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
    <div className="graph-container" style={{ position: "relative", overflow: "hidden", width: "100%", height: "100vh" }}>
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
        zoomLevel={zoomLevel}
        onZoomIn={() => {
          if (cyRef.current) {
            setZoomLevel(prev => {
              const newZoomLevel = prev + 10;
              const newZoom = baseZoom * (newZoomLevel / 100); // 기준 zoom을 비율로 계산
              cyRef.current.zoom({
                level: newZoom,
                renderedPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
              });
              return newZoomLevel;
            });
          }
        }}
        
        onZoomOut={() => {
          if (cyRef.current) {
            setZoomLevel(prev => {
              const newZoomLevel = prev - 10;
              const newZoom = baseZoom * (newZoomLevel / 100);
              cyRef.current.zoom({
                level: newZoom,
                renderedPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
              });
              return newZoomLevel;
            });
          }
        }}
        
      />
      <CytoscapeGraph
        ref={cyRef}
        elements={filteredElements}
        stylesheet={stylesheet}
        layout={layout}
        fitNodeIds={fitNodeIds}
        search={search}
        filterType={filterType}
        style={{ width: "100%", height: "100vh" }}
        userZoomingEnabled={false}
        cy={(cy) => { cyRef.current = cy; }}
      />
      {tooltip && <GraphNodeTooltip nodeData={tooltip} onClose={handleCloseTooltip} />}
      {ripples.map((ripple) => (
        <div key={ripple.id} className="ripple" style={{ left: ripple.x, top: ripple.y }} />
      ))}
      {isDragging && (
        <div className="drag-info">
          노드를 드래그해 연결관계 확인 가능<br />엣지를 클릭하면 관계 설명 확인
        </div>
      )}
    </div>
  );
}

export default RelationGraphMain;

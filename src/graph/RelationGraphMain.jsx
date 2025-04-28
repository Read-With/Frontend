import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import GraphControls from "./GraphControls";
import CytoscapeGraph from "./CytoscapeGraph";
import TooltipBelowNode from "./TooltipBelowNode"; 
import "./RelationGraph.css";

function RelationGraphMain({ elements }) {
  const cyRef = useRef(null);
  const [filterType, setFilterType] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [tooltip, setTooltip] = useState(null);

  // 관계 종류
  const relationTypes = useMemo(
    () =>
      Array.from(
        new Set(
          elements
            .filter((el) => el.data?.label && el.data?.source)
            .flatMap((el) => el.data.label.split(", "))
        )
      ),
    [elements]
  );

  // 검색/필터/fit 관련
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
              el.data.target === matchedNode.data.id) &&
            (filterType === "all" ||
              (el.data.label && el.data.label.includes(filterType)))
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
      filteredElements = elements.filter((el) => {
        if (!el.data) return true;
        if (filterType === "all") return true;
        if (el.data.source && el.data.label) {
          return el.data.label.includes(filterType);
        }
        return true;
      });
      fitNodeIds = null;
    }
    return { filteredElements, fitNodeIds };
  }, [elements, search, filterType]);

  // Cytoscape stylesheet/layout
  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": (ele) =>
            ele.data("main") ? "#1976d2" : "#90a4ae", // 주요 인물은 파란색, 일반은 회색
          label: "data(label)",
          
          
          "font-size": (ele) => (ele.data("main") ? 12 : 8),
          "text-valign": "center",
          "text-halign": "center",
          width: (ele) => (ele.data("main") ? 56 : 32),  // 주요 인물은 크고, 일반은 작게
          height: (ele) => (ele.data("main") ? 56 : 32), // 주요 인물은 크고, 일반은 작게
          color: "#fff",
          "text-outline-color": "#333",
          "text-outline-width": 1,
          "z-index": (ele) => (ele.data("main") ? 10 : 1),
          "transition-property": "border-color, border-width",
          "transition-duration": "0.3s",
          "box-shadow": (ele) =>
            ele.data("main") ? "0 0 10px #1976d288" : "none",
          cursor: "pointer",
        },
      },
      {
        selector: "edge",
        style: {
          width: "mapData(weight, 0, 1, 1, 8)",
          "line-color": "mapData(positivity, -1, 1, #e57373, #81c784)",
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": 10,
          "text-rotation": "autorotate",
          color: "#333",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-padding": 2,
          opacity: "mapData(weight, 0, 1, 0.5, 1)",
          "transition-property": "line-color, width, opacity",
          "transition-duration": "0.3s",
          "target-arrow-shape": "none",
          "z-index": 2,
          cursor: "pointer",
        },
      },
      {
        selector: "node.highlighted",
        style: {
          "border-width": 5,
          "border-color": "#ffeb3b",
          "box-shadow": "0 0 0 8px rgba(255,235,59,0.3)",
        },
      },
      {
        selector: "node.dragging",
        style: {
          "border-width": 3,
          "border-color": "#ff5722",
        },
      },
      // faded 스타일 추가
      {
        selector: ".faded",
        style: {
          opacity: 0.25,
          "text-opacity": 0.12,
          "transition-property": "opacity, text-opacity",
          "transition-duration": "0.25s"
        }
      },
    ],
    []
  );

  const layout = useMemo(
    () => ({
      name: "cose",
      padding: 60,
      nodeRepulsion: 12000,
      idealEdgeLength: 300,
      animate: false,
      fit: false,
      randomize: false,
    }),
    []
  );

  // 초기화 핸들러
  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    setFilterType("all");
    setTooltip(null);

    if (cyRef.current) {
      cyRef.current.elements().unlock();
      cyRef.current.layout({
        name: "cose",
        padding: 60,
        nodeRepulsion: 12000,
        idealEdgeLength: 500,
        animate: false,
        fit: false,
        randomize: false,
      }).run();
      cyRef.current.zoom(1);
      cyRef.current.center();
    }
  }, []);

  // Cytoscape 더블클릭 툴팁/edge faded 효과
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    let lastClick = 0;
    let lastNodeId = null;
    let selectedEdgeId = null;

    const tapNodeHandler = function (evt) {
      const now = Date.now();
      const node = evt.target;
      if (lastNodeId === this.id() && now - lastClick < 500) {
        // 더블클릭! (툴팁)
        const node = this;
        const pos = node.renderedPosition();
        setTooltip({
          id: node.id(),
          x: pos.x,
          y: pos.y,
          data: node.data(),
        });
        lastClick = 0;
        lastNodeId = null;
      } else {
        lastClick = now;
        lastNodeId = this.id();
      }
    };

    const tapEdgeHandler = function (evt) {
      const edge = evt.target;
      // 이미 선택된 edge라면 토글(초기화)
      if (selectedEdgeId === edge.id()) {
        cy.nodes().removeClass("faded");
        cy.edges().removeClass("faded");
        selectedEdgeId = null;
        return;
      }
      selectedEdgeId = edge.id();

      // 모든 노드/간선 흐리게
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");

      // 선택된 edge와 양 끝 노드는 흐림 제거(강조)
      edge.removeClass("faded");
      edge.source().removeClass("faded");
      edge.target().removeClass("faded");
    };

    const bgClickHandler = function (evt) {
      if (evt.target === cy) {
        // 배경 클릭시 전체 복귀
        cy.nodes().removeClass("faded");
        cy.edges().removeClass("faded");
        selectedEdgeId = null;
      }
      // 툴팁 닫기
      setTooltip(null);
    };

    cy.on("tap", "node", tapNodeHandler);
    cy.on("tap", "edge", tapEdgeHandler);
    cy.on("tap", bgClickHandler);

    cy.on("layoutstop", () => {
      cy.zoom(1);
      cy.center();
    });

    window.addEventListener("resize", () => {
      cyRef.current && cyRef.current.zoom(1) && cyRef.current.center();
    });

    return () => {
      cy.removeListener("tap", "node", tapNodeHandler);
      cy.removeListener("tap", "edge", tapEdgeHandler);
      cy.removeListener("tap", bgClickHandler);
      cy.removeListener("layoutstop");
      window.removeEventListener("resize", () => {
        cyRef.current && cyRef.current.zoom(1) && cyRef.current.center();
      });
    };
  }, [cyRef]);

  return (
    <div className="graph-container"
      style={{
        position: "relative",
        overflowX: "hidden",
        overflowY: "auto",
        width: "100%",
        height: "100%",
      }}
    >
      <GraphControls
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onSearch={(value) => {
          setSearch(value);
          setTooltip(null);
        }}
        filterType={filterType}
        setFilterType={setFilterType}
        onReset={handleReset}
        relationTypes={relationTypes}
        search={search}
        setSearch={setSearch}
      />
      {/* 안내문구/검색 결과 없음 */}
      {search && filteredElements.length === 0 && (
        <div className="search-guide">
          <span>검색 결과가 없습니다.</span>
        </div>
      )}
      <CytoscapeGraph
        ref={cyRef}
        elements={filteredElements}
        stylesheet={stylesheet}
        layout={layout}
        style={{
          width: "100%",
          height: "calc(100vh - 120px)",
          overflowX: "hidden",
          overflowY: "auto",
        }}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
        fitNodeIds={fitNodeIds}
        search={search}
        filterType={filterType}
        cyCallback={cy => {
          cy.zoom(1);
          cy.center();
        }}
      />
      {/* 노드 아래 툴팁 + 화면 내부 보정 */}
      {tooltip && (
        <TooltipBelowNode tooltip={tooltip} onClose={() => setTooltip(null)} />
      )}
      {isDragging && (
        <div className="drag-info">노드를 드래그해 연결관계 확인 가능<br />엣지를 클릭하면 관계 설명 확인</div>
      )}
    </div>
  );
}

export default RelationGraphMain;

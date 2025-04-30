import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import GraphControls from "./GraphControls";
import CytoscapeGraph from "./CytoscapeGraph";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";

function RelationGraphMain({ elements }) {
  const cyRef = useRef(null);
  const [filterType, setFilterType] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tooltip, setTooltip] = useState(null); // 노드 툴팁
  const [edgeTooltip, setEdgeTooltip] = useState(null); // 간선 툴팁
  const [ripples, setRipples] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [baseZoom, setBaseZoom] = useState(1.0);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);

  // ripple 효과
  const createRipple = (x, y) => {
    const id = Date.now();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);
  };

  // 노드 클릭 시 툴팁 표시
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const pos = node.renderedPosition();
    createRipple(pos.x, pos.y);
    selectedNodeIdRef.current = node.id();
    setEdgeTooltip(null); // 간선 툴팁 닫기
    setTooltip(null);
    setTimeout(() => {
      setTooltip({ id: node.id(), x: pos.x, y: pos.y, data: node.data() });
    }, 0);
  }, []);

  // 간선 클릭 시 툴팁 표시 (좌표 변환)
  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const edge = evt.target;
      const container = document.querySelector(".graph-container");
      const containerRect = container.getBoundingClientRect();

      // Cytoscape의 midpoint는 그래프 내부 좌표계이므로, 화면 좌표로 변환
      const pos = edge.midpoint();
      const pan = cy.pan();
      const zoom = cy.zoom();

      // 절대 좌표 계산 (컨테이너 기준)
      const absoluteX = pos.x * zoom + pan.x + containerRect.left;
      const absoluteY = pos.y * zoom + pan.y + containerRect.top;

      setTooltip(null);
      setEdgeTooltip({
        id: edge.id(),
        x: absoluteX,
        y: absoluteY,
        data: edge.data(),
      });

      cy.batch(() => {
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        edge.removeClass("faded");
        edge.source().removeClass("faded").addClass("highlighted");
        edge.target().removeClass("faded").addClass("highlighted");
      });

      selectedEdgeIdRef.current = edge.id();
    },
    [createRipple]
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
    setTooltip(null);
    setEdgeTooltip(null);
    selectedEdgeIdRef.current = null;
    selectedNodeIdRef.current = null;
  }, [tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  const handleCloseTooltip = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

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
        return (
          el.data.source && el.data.label && el.data.label.includes(filterType)
        );
      });
    }
    return { filteredElements, fitNodeIds };
  }, [elements, search, filterType]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": (ele) =>
            ele.data("main") ? "#1976d2" : "#90a4ae",
          label: "data(label)",
          "font-size": (ele) => (ele.data("main") ? 8 : 6),
          "text-valign": "center",
          "text-halign": "center",
          width: (ele) => (ele.data("main") ? 40 : 32),
          height: (ele) => (ele.data("main") ? 40 : 32),
          color: "#fff",
          "text-outline-color": "#333",
          "text-outline-width": 1,
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
          "font-size": 8,
          "text-rotation": "autorotate",
          color: "#333",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-padding": 2,
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
    setFilterType("all");
    clearSelection();
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().unlock();
      cy.resize();
      const layoutInstance = cy.layout(layout);
      layoutInstance.run();
      cy.one("layoutstop", () => {
        cy.fit(undefined, 60); // 전체 그래프를 한번 fit
        const fittedZoom = cy.zoom(); // 이때 zoom 값 저장
        setBaseZoom(fittedZoom); // baseZoom으로 기억
        setZoomLevel(100); // 표시용은 100%
        cy.center(); // 중심 정렬
      });
    }
  }, [clearSelection, layout]);

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
    <div className="graph-container">
      <GraphControls
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onSearch={() => setSearch(searchInput)}
        filterType={filterType}
        setFilterType={setFilterType}
        onReset={handleReset}
        relationTypes={relationTypes}
        search={search}
        setSearch={setSearch}
        onZoomIn={() => {
          if (!cyRef.current) return;
          const cy = cyRef.current;
          cy.zoom({
            level: cy.zoom() * 1.1,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
          });
          setZoomLevel(Math.round((cy.zoom() / baseZoom) * 100));
        }}
        onZoomOut={() => {
          if (!cyRef.current) return;
          const cy = cyRef.current;
          cy.zoom({
            level: cy.zoom() / 1.1,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
          });
          setZoomLevel(Math.round((cy.zoom() / baseZoom) * 100));
        }}
        zoomLevel={zoomLevel}
      />
      <CytoscapeGraph
        ref={cyRef}
        elements={filteredElements}
        stylesheet={stylesheet}
        layout={layout}
        fitNodeIds={fitNodeIds}
      />
      {tooltip && (
        <GraphNodeTooltip nodeData={tooltip} onClose={handleCloseTooltip} />
      )}
      {edgeTooltip && (
        <EdgeTooltip edgeData={edgeTooltip} onClose={handleCloseTooltip} />
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
    </div>
  );
}

export default RelationGraphMain;

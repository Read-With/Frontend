import React, { useEffect, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import "./RelationGraph.css";

export default function CharacterRelationGraph({ elements }) {
  const cyRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // 필터링된 elements (검색이 없으면 전체, 검색어 있으면 제한)
  let filteredElements = elements;
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
    } else {
      filteredElements = [];
    }
  } else {
    // 전체 보기지만, 관계 타입 필터는 계속 적용
    filteredElements = elements.filter((el) => {
      if (!el.data) return true;
      if (filterType === "all") return true;
      if (el.data.source && el.data.label) {
        return el.data.label.includes(filterType);
      }
      return true;
    });
  }

  // 관계 종류
  const relationTypes = Array.from(
    new Set(
      elements
        .filter((el) => el.data?.label && el.data?.source)
        .flatMap((el) => el.data.label.split(", "))
    )
  );

  // Cytoscape 이벤트 및 fit/초기화 관리
  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;

      // 첫 렌더(혹은 데이터 변경)시 애니메이션 없이 중앙 fit
      cy.resize();
      cy.fit(undefined, 60);

      // 드래그 종료: 항상 전체 fit (노드가 밖에 안나가게)
      cy.on("dragfree", "node", function () {
        setIsDragging(false);
        this.removeClass("dragging");
        cy.fit(undefined, 60);
      });

      // 상세 정보 패널 오픈
      cy.on("tap", "node", (evt) => {
        setSelectedNode(evt.target.data());
        setSelectedEdge(null);
      });
      cy.on("tap", "edge", (evt) => {
        setSelectedEdge(evt.target.data());
        setSelectedNode(null);
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) {
          setSelectedNode(null);
          setSelectedEdge(null);
        }
      });

      cy.on("dragstart", "node", function () {
        setIsDragging(true);
        this.addClass("dragging");
      });

      // 검색 하이라이트
      if (search) {
        cy.nodes().forEach((node) => {
          if (
            node.data("label")?.toLowerCase().includes(search.toLowerCase()) ||
            node.data("names")?.some((n) =>
              n.toLowerCase().includes(search.toLowerCase())
            )
          ) {
            node.addClass("highlighted");
            cy.center(node);
          } else {
            node.removeClass("highlighted");
          }
        });
      } else {
        cy.nodes().removeClass("highlighted");
      }

      // 창 리사이즈 시 전체 fit 유지
      const resizeGraph = () => {
        cy.resize();
        cy.fit(undefined, 60);
      };
      window.addEventListener("resize", resizeGraph);

      // cleanup
      return () => {
        window.removeEventListener("resize", resizeGraph);
        cy.removeAllListeners();
      };
    }
  }, [filterType, search, elements]);

  // 초기화 버튼 동작
  const handleReset = () => {
    setSearch("");
    setSearchInput("");
    setFilterType("all");
    setSelectedNode(null);
    setSelectedEdge(null);

    // cytoscape 그래프 위치/레이아웃도 완전히 복귀
    if (cyRef.current) {
      cyRef.current.elements().unlock(); // 드래그된 노드도 풀기
      cyRef.current.fit(undefined, 60);
      cyRef.current.layout({
        name: "cose",
        padding: 60,
        nodeRepulsion: 12000,
        idealEdgeLength: 150,
        animate: false,
        animationDuration: 700,
        fit: true,
        randomize: false,
      }).run();
    }
  };

  return (
    <div className="graph-container">
      {/* 상단 컨트롤 바 */}
      <div className="graph-controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setSelectedNode(null);
            setSelectedEdge(null);
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="text"
            placeholder="인물 검색 (이름/별칭)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button
            type="submit"
            className="search-btn"
          >
            검색
          </button>
          {search && (
            <button
              type="button"
              className="search-btn"
              style={{ background: "#bbb" }}
              onClick={() => {
                setSearch("");
                setSearchInput("");
                setSelectedNode(null);
                setSelectedEdge(null);
              }}
            >
              전체보기
            </button>
          )}
        </form>
        <button
          type="button"
          className="reset-btn"
          onClick={handleReset}
          title="그래프를 완전히 초기 상태로 복구"
        >
          초기화
        </button>
        <div className="filter-group">
          <button
            className={filterType === "all" ? "active" : ""}
            onClick={() => setFilterType("all")}
          >
            전체
          </button>
          {relationTypes.map((type) => (
            <button
              key={type}
              className={filterType === type ? "active" : ""}
              onClick={() => setFilterType(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
      {/* 안내/검색 결과 없음 */}
      {search && filteredElements.length === 0 && (
        <div className="search-guide">
          <span>검색 결과가 없습니다.</span>
        </div>
      )}
      {/* 그래프 */}
      {filteredElements.length > 0 && (
        <CytoscapeComponent
          elements={CytoscapeComponent.normalizeElements(filteredElements)}
          stylesheet={[
            ...stylesheet,
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
          ]}
          layout={{
            name: "cose",
            padding: 60,
            nodeRepulsion: 12000,
            idealEdgeLength: 150,
            animate: false, // 항상 "즉시 정렬"
            fit: true,
            randomize: false,
          }}
          style={{
            width: "100%",
            height: "calc(100vh - 120px)",
            overflow: "hidden",
          }}
          cy={(cy) => {
            cyRef.current = cy;
          }}
        />
      )}
      {/* 툴팁 */}
      {isDragging && (
        <div className="drag-info">
          노드를 드래그해 연결관계 확인 가능<br />
          엣지를 클릭하면 관계 설명 확인
        </div>
      )}

      {/* 사이드 패널 */}
      {(selectedNode || selectedEdge) && (
        <div className="side-panel">
          <button className="close-btn" onClick={() => {
            setSelectedNode(null); setSelectedEdge(null);
          }}>×</button>
          {selectedNode && (
            <>
              <h2>
                {selectedNode.label}{" "}
                {selectedNode.main && (
                  <span className="main-badge">주요 인물</span>
                )}
              </h2>
              <p>{selectedNode.description}</p>
              {selectedNode.names && (
                <div className="side-names">
                  <b>별칭:</b> {selectedNode.names.join(", ")}
                </div>
              )}
            </>
          )}
          {selectedEdge && (
            <>
              <h2>관계: {selectedEdge.label}</h2>
              <p>{selectedEdge.explanation}</p>
              <div className="side-relation-meta">
                <b>긍정도:</b> {selectedEdge.positivity} / <b>강도:</b> {selectedEdge.weight}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const stylesheet = [
  {
    selector: "node",
    style: {
      "background-color": (ele) =>
        ele.data("main") ? "#1976d2" : "#90a4ae",
      label: "data(label)",
      "font-size": 13,
      "text-valign": "center",
      "text-halign": "center",
      width: (ele) => (ele.data("main") ? 62 : 42),
      height: (ele) => (ele.data("main") ? 62 : 42),
      color: "#fff",
      "text-outline-color": "#333",
      "text-outline-width": 2,
      "z-index": (ele) => (ele.data("main") ? 10 : 1),
      "transition-property": "border-color, border-width",
      "transition-duration": "0.3s",
      "box-shadow": (ele) => (ele.data("main") ? "0 0 10px #1976d288" : "none"),
      "cursor": "pointer",
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
      "opacity": "mapData(weight, 0, 1, 0.5, 1)",
      "transition-property": "line-color, width, opacity",
      "transition-duration": "0.3s",
      "target-arrow-shape": "none",
      "z-index": 2,
      "cursor": "pointer",
    },
  },
];

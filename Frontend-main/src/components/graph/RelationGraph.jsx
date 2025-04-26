import React, { useEffect, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import "./RelationGraph.css";

export default function CharacterRelationGraph({ elements }) {
  const cyRef = useRef(null);

  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;

      // 즉시 그래프 크기 조정
      cy.resize();

      // 주요 인물 노드 찾기
      const mainCharacters = cy.nodes().filter((node) => node.data("main"));

      // 모든 노드가 보이도록 뷰 조정
      cy.fit(undefined, 30);

      // 주요 인물이 있으면 중앙에 배치
      if (mainCharacters.length > 0) {
        cy.center(mainCharacters);
      }

      // 창 크기 변경 시 그래프 크기 조정
      const resizeGraph = () => {
        cy.resize();
        cy.fit();
      };

      window.addEventListener("resize", resizeGraph);

      return () => {
        window.removeEventListener("resize", resizeGraph);
      };
    }
  }, []);

  return (
    <div className="graph-container">
      <div className="controls">
        <button onClick={() => cyRef.current.fit()}>전체보기</button>
        <button onClick={() => cyRef.current.zoom(cyRef.current.zoom() * 1.2)}>
          확대
        </button>
        <button onClick={() => cyRef.current.zoom(cyRef.current.zoom() / 1.2)}>
          축소
        </button>
      </div>

      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        layout={{
          name: "cose",
          padding: 30,
          nodeRepulsion: 8000,
          idealEdgeLength: 100,
          animate: true,
          animationDuration: 500,
          fit: true,
          randomize: false,
          gravity: 0.5,
        }}
        style={{
          width: "100%",
          height: "calc(100vh - 80px)", // 헤더 높이 고려
        }}
        cy={(cy) => {
          cyRef.current = cy;
        }}
      />
    </div>
  );
}

const stylesheet = [
  {
    selector: "node",
    style: {
      "background-color": (ele) => (ele.data("main") ? "#1976d2" : "#bdbdbd"),
      label: "data(label)",
      "font-size": 12,
      "text-valign": "center",
      "text-halign": "center",
      width: (ele) => (ele.data("main") ? 60 : 40),
      height: (ele) => (ele.data("main") ? 60 : 40),
      color: "#fff",
      "text-outline-color": "#222",
      "text-outline-width": 2,
      "z-index": (ele) => (ele.data("main") ? 10 : 1),
    },
  },
  {
    selector: "edge",
    style: {
      width: "mapData(weight, 1, 10, 1, 8)",
      "line-color": "mapData(positivity, -1, 1, #e57373, #81c784)",
      "target-arrow-color": "#888",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": 10,
      "text-rotation": "autorotate",
      color: "#333",
      "text-background-color": "#fff",
      "text-background-opacity": 0.7,
      "text-background-padding": 2,
    },
  },
];

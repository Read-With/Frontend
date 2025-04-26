import React, { useEffect, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import "./RelationGraph.css";

export default function CharacterRelationGraph({ elements }) {
  const cyRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

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

      // 드래그 시작 이벤트
      cy.on("dragstart", "node", function () {
        setIsDragging(true);
        this.addClass("dragging");
      });

      // 드래그 중 이벤트 - 모든 연결된 컴포넌트의 노드들이 따라오도록 함
      cy.on("drag", "node", function (e) {
        const draggedNode = e.target;

        // 독립된(연결되지 않은) 노드들을 제외한 모든 노드 가져오기
        const allConnectedNodes = cy.nodes().filter((node) => {
          // 드래그 중인 노드는 제외
          if (node.id() === draggedNode.id()) return false;

          // 노드가 어떤 엣지와도 연결되어 있지 않으면 제외
          if (node.connectedEdges().length === 0) return false;

          // 그 외의 노드는 포함
          return true;
        });

        // 드래그 중인 노드와 연결된 노드들 사이의 관계를 유지하면서 부드럽게 이동
        allConnectedNodes.forEach((connectedNode) => {
          // 드래그 중인 노드와의 거리에 따른 가중치 계산
          // 거리가 가까울수록 더 많이 따라오게 함
          const dx = draggedNode.position("x") - connectedNode.position("x");
          const dy = draggedNode.position("y") - connectedNode.position("y");
          const distance = Math.sqrt(dx * dx + dy * dy);

          // 거리에 반비례하는 가중치 (최대 0.1, 최소 0.01)로 조정
          const followFactor = Math.max(
            0.01,
            Math.min(0.1, 60 / (distance + 150))
          );

          // 새 위치 계산 (현재 위치 + 이동 거리의 일부)
          const newX = connectedNode.position("x") + dx * followFactor;
          const newY = connectedNode.position("y") + dy * followFactor;

          // 노드 겹침 방지를 위한 충돌 감지
          let finalX = newX;
          let finalY = newY;

          // 다른 모든 노드와의 충돌 확인
          cy.nodes().forEach((otherNode) => {
            if (otherNode.id() === connectedNode.id()) return;

            const otherX = otherNode.position("x");
            const otherY = otherNode.position("y");

            // 두 노드 사이의 거리 계산
            const nodeDx = finalX - otherX;
            const nodeDy = finalY - otherY;
            const nodeDistance = Math.sqrt(nodeDx * nodeDx + nodeDy * nodeDy);

            // 최소 거리 (노드 크기 기반)
            const size1 = connectedNode.data("main") ? 60 : 40;
            const size2 = otherNode.data("main") ? 60 : 40;
            const minDistance = (size1 + size2) / 2 + 50; // 여유 공간 50px로 증가

            // 충돌이 감지되면 위치 조정
            if (nodeDistance < minDistance && nodeDistance > 0) {
              const pushFactor = (minDistance - nodeDistance) / nodeDistance;
              finalX += nodeDx * pushFactor * 0.5;
              finalY += nodeDy * pushFactor * 0.5;
            }
          });

          // 연결된 노드 이동 (애니메이션 없이)
          connectedNode.position({ x: finalX, y: finalY });
        });
      });

      // 드래그 종료 이벤트
      cy.on("dragfree", "node", function () {
        setIsDragging(false);
        this.removeClass("dragging");

        // 드래그 종료 후 노드 위치 유지 (레이아웃 재실행하지 않음)
        // 대신 노드 간 겹침 방지를 위한 간단한 조정만 수행

        // 모든 노드 쌍에 대해 겹침 확인 및 조정
        const nodes = cy.nodes();
        const nodePositions = {};

        // 현재 노드 위치 저장
        nodes.forEach((node) => {
          nodePositions[node.id()] = {
            x: node.position("x"),
            y: node.position("y"),
          };
        });

        // 겹침 해결을 위한 반복 (최대 3회)
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

              // 최소 거리 (노드 크기 기반)
              const size1 = node1.data("main") ? 60 : 40;
              const size2 = node2.data("main") ? 60 : 40;
              const minDistance = (size1 + size2) / 2 + 30; // 여유 공간 30px로 증가

              // 충돌이 감지되면 위치 조정
              if (distance < minDistance) {
                moved = true;

                // 충돌 방향으로 밀어내기
                const pushFactor = (minDistance - distance) / distance;

                // 각 노드를 반대 방향으로 밀어냄
                nodePositions[node1.id()].x += dx * pushFactor * 0.5;
                nodePositions[node1.id()].y += dy * pushFactor * 0.5;
                nodePositions[node2.id()].x -= dx * pushFactor * 0.5;
                nodePositions[node2.id()].y -= dy * pushFactor * 0.5;
              }
            });
          });

          // 더 이상 이동이 없으면 종료
          if (!moved) break;
        }

        // 조정된 위치 적용
        nodes.forEach((node) => {
          const pos = nodePositions[node.id()];
          node.position({ x: pos.x, y: pos.y });
        });
      });

      // 창 크기 변경 시 그래프 크기 조정
      const resizeGraph = () => {
        cy.resize();
        cy.fit();
      };

      window.addEventListener("resize", resizeGraph);

      return () => {
        window.removeEventListener("resize", resizeGraph);
        cy.removeAllListeners(); // 이벤트 리스너 제거
      };
    }
  }, []);

  return (
    <div className="graph-container">
      {/* 컨트롤 버튼 부분 제거 */}

      <CytoscapeComponent
        elements={elements}
        stylesheet={[
          ...stylesheet,
          // 드래그 중인 노드와 연결된 노드들의 스타일
          {
            selector: "node.dragging",
            style: {
              "border-width": 3,
              "border-color": "#ff5722",
            },
          },
          {
            selector: "node.connected-to-dragging",
            style: {
              "border-width": 2,
              "border-color": "#ff9800",
            },
          },
        ]}
        layout={{
          name: "cose",
          padding: 50, // 30에서 50으로 증가
          nodeRepulsion: 10000, // 8000에서 10000으로 증가
          idealEdgeLength: 150, // 100에서 150으로 증가
          animate: true,
          animationDuration: 500,
          fit: true,
          randomize: false,
          gravity: 0.01, // 0.5에서 0.01로 감소하여 노드들이 덜 중앙에 모이도록
        }}
        style={{
          width: "100%",
          height: "calc(100vh - 80px)",
        }}
        cy={(cy) => {
          cyRef.current = cy;
        }}
      />

      {isDragging && (
        <div className="drag-info">
          노드를 드래그하는 중... 연결된 노드들이 따라옵니다.
        </div>
      )}
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

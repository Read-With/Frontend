import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import "./RelationGraph.css";

const CytoscapeGraphDirect = ({
  elements,
  stylesheet,
  layout,
  tapNodeHandler,
  tapEdgeHandler,
  tapBackgroundHandler,
  fitNodeIds,
  style = {},
  cyRef: externalCyRef,
  newNodeIds = [],
  onLayoutComplete,
}) => {
  const containerRef = useRef(null);
  const [ripples, setRipples] = useState([]);
  const [isGraphVisible, setIsGraphVisible] = useState(false);

  // cy 인스턴스 최초 생성 및 container 변경 대응
  useEffect(() => {
    if (!containerRef.current) return;
    let cyInstance = externalCyRef?.current;
    // cytoscape 인스턴스가 아니면 새로 생성
    if (!cyInstance || typeof cyInstance.container !== 'function') {
      cyInstance = cytoscape({
        container: containerRef.current,
        elements: [],
        style: stylesheet,
        layout: { name: "preset" },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        minZoom: 0.05,
        maxZoom: 2.5,
      });
      if (externalCyRef) externalCyRef.current = cyInstance;
    } else {
      if (cyInstance.container() !== containerRef.current) {
        cyInstance.mount(containerRef.current);
      }
    }
    // 이벤트 핸들러 등록
    const cy = cyInstance;
    cy.off("tap");
    if (tapNodeHandler) cy.on("tap", "node", tapNodeHandler);
    if (tapEdgeHandler) cy.on("tap", "edge", tapEdgeHandler);
    if (tapBackgroundHandler) cy.on("tap", tapBackgroundHandler);
    return () => {
      // cy 인스턴스는 파괴하지 않음(깜빡임 방지)
    };
  }, [containerRef.current, stylesheet, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, externalCyRef]);

  // elements diff patch
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) return;

    // elements가 없으면 그래프 초기화
    if (!elements || elements.length === 0) {
      cy.elements().remove();
      setIsGraphVisible(false);
      return;
    }

    cy.batch(() => {
      // 기존 노드/엣지 id 집합
      const prevNodeIds = new Set(cy.nodes().map(n => n.id()));
      const prevEdgeIds = new Set(cy.edges().map(e => e.id()));
      const nextNodeIds = new Set(elements.filter(e => !e.data.source).map(e => e.data.id));
      const nextEdgeIds = new Set(elements.filter(e => e.data.source).map(e => e.data.id));

      // 삭제: 없는 노드/엣지만 제거
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });

      // 추가: 새로 들어온 노드/엣지만 추가 (노드 먼저, 엣지 나중)
      const nodes = elements.filter(e => !e.data.source && !e.data.target);
      const edges = elements.filter(e => e.data.source && e.data.target);
      cy.add(nodes);
      cy.add(edges);

      // 스타일/레이아웃 적용
      if (stylesheet) {
        cy.style(stylesheet);
      }

      // 레이아웃 적용
      if (layout) {
        const layoutInstance = cy.layout(layout);
        layoutInstance.on('layoutstop', () => {
          if (onLayoutComplete) onLayoutComplete();
        });
        layoutInstance.run();
      }

      // fitNodeIds가 있으면 해당 노드에 맞춤
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) cy.fit(nodes, 40);
      } else {
        // 전체 그래프에 맞춤
        cy.fit(undefined, 40);
      }
    });

    // 모든 처리가 끝나면 즉시 보이게
    setIsGraphVisible(true);
  }, [elements, stylesheet, layout, fitNodeIds, externalCyRef, newNodeIds, onLayoutComplete]);

  // 크기 반응형
  useEffect(() => {
    const handleResize = () => {
      if (externalCyRef?.current) externalCyRef.current.resize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [externalCyRef]);

  // 그래프 영역 클릭 시 ripple 효과
  const handleRipple = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const key = Date.now() + Math.random();
    setRipples((prev) => [...prev, { x, y, key }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter(r => r.key !== key));
    }, 700);
  };

  console.log(
    "CytoscapeGraphDirect 전달 elements 노드 id:",
    elements.filter(e => !e.data.source && !e.data.target).map(e => e.data.id)
  );
  console.log(
    "CytoscapeGraphDirect 전달 elements 엣지:",
    elements.filter(e => e.data.source && e.data.target).map(e => ({
      id: e.data.id,
      source: e.data.source,
      target: e.data.target
    }))
  );

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        // minWidth: 600,
        // minHeight: 600,
        background: "#ffffff",
        ...style,
        position: "relative",
        overflow: "hidden",
        zIndex: 1,
        visibility: isGraphVisible ? "visible" : "hidden"
      }}
      className="graph-canvas-area"
      onClick={handleRipple}
    >
      {ripples.map(ripple => (
        <span
          key={ripple.key}
          className="cytoscape-ripple"
          style={{
            left: ripple.x - 80,
            top: ripple.y - 80,
            width: 160,
            height: 160,
          }}
        />
      ))}
    </div>
  );
};

export default CytoscapeGraphDirect; 
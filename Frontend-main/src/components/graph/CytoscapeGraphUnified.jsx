import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import "./RelationGraph.css";

const CytoscapeGraphUnified = ({
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
  const [isGraphVisible, setIsGraphVisible] = useState(false);

  // Cytoscape 인스턴스 생성 및 이벤트 핸들러 등록
  useEffect(() => {
    if (!containerRef.current) return;
    let cyInstance = externalCyRef?.current;
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
    return () => {};
  }, [containerRef.current, stylesheet, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, externalCyRef]);

  // elements diff patch 및 스타일/레이아웃 적용
  useEffect(() => {
    const cy = externalCyRef?.current;
    if (!cy) return;
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
      // 삭제
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });
      // 추가
      const nodes = elements.filter(e => !e.data.source && !e.data.target);
      const edges = elements.filter(e => e.data.source && e.data.target);
      
      // 새로운 노드들에 대해 랜덤한 초기 위치 할당
      const newNodes = nodes.filter(node => !prevNodeIds.has(node.data.id));
      newNodes.forEach(node => {
        const angle = Math.random() * 2 * Math.PI;
        const radius = 100 + Math.random() * 100; // 100~200px 반경
        node.position = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius
        };
      });
      
      cy.add(nodes);
      cy.add(edges);
      // 반드시 preset 레이아웃 실행
      cy.layout({ name: 'preset' }).run();
      // 스타일 적용
      if (stylesheet) cy.style(stylesheet);
      // 레이아웃 적용
      if (layout && layout.name !== 'preset') {
        const layoutInstance = cy.layout(layout);
        layoutInstance.on('layoutstop', () => {
          if (onLayoutComplete) onLayoutComplete();
        });
        layoutInstance.run();
      }
      // fit
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) cy.fit(nodes, 40);
      } else {
        cy.fit(undefined, 40);
      }
    });
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

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#ffffff",
        ...style,
        position: "relative",
        overflow: "hidden",
        zIndex: 1,
        visibility: isGraphVisible ? "visible" : "hidden"
      }}
      className="graph-canvas-area"
    />
  );
};

export default CytoscapeGraphUnified; 
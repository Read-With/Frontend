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
  nodeSize = 40,
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
    
    // 사용자가 노드 드래그 후 놓았을 때만 겹침 감지 및 조정
    cy.on('dragfreeon', 'node', () => {
      // 드래그 완료 후 즉시 겹침 확인
      setTimeout(() => {
        detectAndResolveOverlap(cy);
      }, 10);
    });
    
    return () => {};
  }, [containerRef.current, stylesheet, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, externalCyRef]);

  // 노드 겹침 감지 및 자동 조정 함수
  const detectAndResolveOverlap = (cy) => {
    const nodes = cy.nodes();
    const NODE_SIZE = nodeSize;
    const MIN_DISTANCE = NODE_SIZE * 1.0;
    let hasOverlap = false;
    
    // 모든 노드 쌍을 검사하여 겹침 감지
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const node1 = nodes[i];
        const node2 = nodes[j];
        const pos1 = node1.position();
        const pos2 = node2.position();
        
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < MIN_DISTANCE) {
          hasOverlap = true;
          // 겹침 해결: 두 노드를 서로 멀리 밀어냄
          const angle = Math.atan2(dy, dx);
          const pushDistance = MIN_DISTANCE - distance + 20; // 여유 거리 증가
          
          const newX1 = pos1.x + Math.cos(angle) * pushDistance * 0.5;
          const newY1 = pos1.y + Math.sin(angle) * pushDistance * 0.5;
          const newX2 = pos2.x - Math.cos(angle) * pushDistance * 0.5;
          const newY2 = pos2.y - Math.sin(angle) * pushDistance * 0.5;
          
          // 위치 변경을 즉시 적용 (애니메이션 없이)
          node1.position({ x: newX1, y: newY1 });
          node2.position({ x: newX2, y: newY2 });
          
          // 시각적 피드백을 위한 임시 스타일 적용
          node1.addClass('bounce-effect');
          node2.addClass('bounce-effect');
          
          // 300ms 후 스타일 제거
          setTimeout(() => {
            node1.removeClass('bounce-effect');
            node2.removeClass('bounce-effect');
          }, 300);
        }
      }
    }
    
    return hasOverlap;
  };

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
      
      // 새로운 노드들에 대해 랜덤한 초기 위치 할당 (겹침 완화)
      const NODE_SIZE = nodeSize;
      const MIN_DISTANCE = NODE_SIZE * 2.8; // 최소 거리(여유 포함)
      // 이미 배정된 노드들의 위치를 배열에 저장
      const placedPositions = nodes
        .filter(node => prevNodeIds.has(node.data.id) && node.position)
        .map(node => node.position);
      const newNodes = nodes.filter(node => !prevNodeIds.has(node.data.id));
      newNodes.forEach(node => {
        let found = false;
        let x, y;
        let attempts = 0;
        const maxAttempts = 100;
        while (!found && attempts < maxAttempts) {
          const angle = Math.random() * 2 * Math.PI;
          const radius = 100 + Math.random() * 100;
          x = Math.cos(angle) * radius;
          y = Math.sin(angle) * radius;
          found = placedPositions.every(pos => {
            const dx = x - pos.x;
            const dy = y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) > MIN_DISTANCE;
          });
          attempts++;
        }
        node.position = { x, y };
        placedPositions.push({ x, y });
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
           // 노드 추가 후 즉시 겹침 확인
           detectAndResolveOverlap(cy);
           if (onLayoutComplete) onLayoutComplete();
         });
         layoutInstance.run();
       } else {
         // preset 레이아웃의 경우에도 즉시 겹침 확인
         setTimeout(() => {
           detectAndResolveOverlap(cy);
           if (onLayoutComplete) onLayoutComplete();
         }, 100);
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
  }, [elements, stylesheet, layout, fitNodeIds, externalCyRef, newNodeIds, onLayoutComplete, nodeSize]);

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
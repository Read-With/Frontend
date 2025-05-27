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
    setIsGraphVisible(false); // 로딩 시작 시 숨김
    const cy = externalCyRef?.current;
    if (!cy) return;
    cy.batch(() => {
      // 기존 노드/엣지 id 집합
      const prevNodeIds = new Set(cy.nodes().map(n => n.id()));
      const prevEdgeIds = new Set(cy.edges().map(e => e.id()));
      const nextNodeIds = new Set(elements.filter(e => !e.data.source).map(e => e.data.id));
      const nextEdgeIds = new Set(elements.filter(e => e.data.source).map(e => e.data.id));

      // 삭제: 없는 노드/엣지만 제거
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });

      // 추가: 새로 들어온 노드/엣지만 추가
      elements.forEach(e => {
        if (!cy.getElementById(e.data.id).length) {
          const ele = cy.add(e);
          if (!e.data.source && newNodeIds && newNodeIds.includes(e.data.id)) {
            ele.addClass('cytoscape-node-appear');
            setTimeout(() => ele.removeClass('cytoscape-node-appear'), 700);
          }
        }
      });

      // 스타일/레이아웃 적용
      if (stylesheet) {
        cy.style(stylesheet);
      }
      let needLayout = false;
      if (layout && layout.name === 'preset') {
        elements.forEach(e => {
          if (e.position) {
            const node = cy.getElementById(e.data.id);
            if (node && (node.position('x') !== e.position.x || node.position('y') !== e.position.y)) {
              needLayout = true;
            }
          }
        });
        if (needLayout) {
          cy.layout(layout).run();
        }
      } else if (layout) {
        cy.layout(layout).run();
      }
      // fitNodeIds가 있으면 해당 노드에 맞춤
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) cy.fit(nodes, 40);
      }
    });
    // 노드 드래그 제어: grab에서 unlock, dragfree에서 lock
    if (cy) {
      cy.nodes().lock();
      cy.on('grab', 'node', function(evt) {
        evt.target.unlock();
      });
      cy.on('dragfree', 'node', function(evt) {
        evt.target.lock();
      });
    }
    // pan/zoom만 fit 적용 (노드 position은 그대로)
    setTimeout(() => {
      if (cy) cy.fit(undefined, 10);
      setIsGraphVisible(true); // 모든 처리 끝나면 보이게
    }, 0);
  }, [elements, stylesheet, layout, fitNodeIds, externalCyRef, newNodeIds]);

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

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minWidth: 600,
        minHeight: 600,
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
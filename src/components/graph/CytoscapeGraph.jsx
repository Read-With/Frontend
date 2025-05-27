import "./RelationGraph.css";
import React, { useEffect, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";

const CytoscapeGraph = React.forwardRef(
  ({ 
    elements, 
    stylesheet, 
    layout, 
    fitNodeIds,
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    ripples = [],
    style = {},
    onLayoutReady,
    newNodeIds,
  }, ref) => {
    const cyRef = useRef(null);
    const prevElementsRef = useRef([]);

    useEffect(() => {
      const originalBody = document.body.style.overflow;
      const originalHtml = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.body.style.height = "100%";
      document.documentElement.style.height = "100%";
      return () => {
        document.body.style.overflow = originalBody;
        document.documentElement.style.overflow = originalHtml;
        document.body.style.height = "";
        document.documentElement.style.height = "";
      };
    }, []);

    useEffect(() => {
      if (cyRef.current) {
        const cy = cyRef.current;
        cy.zoomingEnabled(true);
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.minZoom(0.05);
        cy.maxZoom(2.5);

        // 이벤트 핸들러 연결
        if (tapNodeHandler) {
          cy.on('tap', 'node', tapNodeHandler);
        }
        
        if (tapEdgeHandler) {
          cy.on('tap', 'edge', tapEdgeHandler);
        }
        
        if (tapBackgroundHandler) {
          cy.on('tap', tapBackgroundHandler);
        }

        return () => {
          cy.removeListener('tap');
        };
      }
    }, [elements, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

    useEffect(() => {
      if (ref.current) {
        const cy = ref.current;
        // layout, fit, center 등 자동 배치/화면 맞춤 완전 제거!
        if (onLayoutReady) onLayoutReady();
      }
    }, [elements, fitNodeIds, ref, layout]);

    // 최초 마운트 시 cy가 준비된 후 elements가 있으면 반드시 전체 추가
    useEffect(() => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      if (elements && elements.length > 0 && cy.elements().length === 0) {
        cy.add(elements);
      }
    }, [cyRef.current, elements]);

    // elements diff patch
    useEffect(() => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const prevElements = prevElementsRef.current;
      if (prevElements.length === 0 && cy.elements().length === 0) {
        // 최초 마운트: 전체 추가 (위에서 이미 처리)
        prevElementsRef.current = elements;
        return;
      }
      const prevNodeIds = new Set(prevElements.filter(el => el.data && !el.data.source).map(el => el.data.id));
      const prevEdgeIds = new Set(prevElements.filter(el => el.data && el.data.source).map(el => el.data.id));
      const currNodeIds = new Set(elements.filter(el => el.data && !el.data.source).map(el => el.data.id));
      const currEdgeIds = new Set(elements.filter(el => el.data && el.data.source).map(el => el.data.id));
      // 추가된 노드/엣지
      const addedNodes = elements.filter(el => el.data && !el.data.source && !prevNodeIds.has(el.data.id));
      const addedEdges = elements.filter(el => el.data && el.data.source && !prevEdgeIds.has(el.data.id));
      // 삭제된 노드/엣지
      const removedNodeIds = [...prevNodeIds].filter(id => !currNodeIds.has(id));
      const removedEdgeIds = [...prevEdgeIds].filter(id => !currEdgeIds.has(id));
      if (addedNodes.length > 0) cy.add(addedNodes);
      if (addedEdges.length > 0) cy.add(addedEdges);
      if (removedNodeIds.length > 0) cy.remove(removedNodeIds.map(id => `#${id}`));
      if (removedEdgeIds.length > 0) cy.remove(removedEdgeIds.map(id => `#${id}`));
      prevElementsRef.current = elements;
    }, [elements]);

    // 새로 추가된 노드에만 appear 클래스 부여
    useEffect(() => {
      if (cyRef.current && newNodeIds && newNodeIds.length > 0) {
        const cy = cyRef.current;
        newNodeIds.forEach(id => {
          const node = cy.getElementById(id);
          if (node && node.length > 0) {
            node.addClass('appear');
            setTimeout(() => node.removeClass('appear'), 800);
          }
        });
      }
    }, [newNodeIds]);

    const handleWheel = e => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.99995 : 1.000005;
      cy.zoom({
        level: cy.zoom() * factor,
        renderedPosition: { x, y },
        animate: true,
        duration: 220,
        easing: 'ease-in-out',
      });
    };

    return (
      <div
        className="graph-canvas-area"
        onWheel={handleWheel}
        style={{ position: "relative", width: "100%", height: "100%", ...style, overflow: 'hidden' }}
      >
        <CytoscapeComponent
          elements={[]}
          stylesheet={stylesheet}
          userZoomingEnabled={true}
          layout={{name:'preset'}}
          style={{
            width: "100%",
            height: "100%",
            background: "#f8fafc",
            position: "relative",
            ...style,
            overflow: 'hidden',
          }}
          cy={cy => {
            cyRef.current = cy;
            if (typeof ref === 'function') {
              ref(cy);
            } else if (ref) {
              ref.current = cy;
            }
          }}
          className="cytoscape-graph"
        />
      </div>
    );
  }
);

export default CytoscapeGraph;
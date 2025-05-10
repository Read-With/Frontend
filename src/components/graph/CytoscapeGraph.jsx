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
    ripples = [] 
  }, ref) => {
    const cyRef = useRef(null);

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
        cy.resize();
        if (fitNodeIds && fitNodeIds.length > 0) {
          const nodesToFit = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
          if (nodesToFit.length > 0) {
            cy.fit(nodesToFit, 120);
          }
        } else {
          cy.fit(undefined, 120);
        }
        // boundingBox를 이용해 그래프를 왼쪽에 맞춤
        const bb = cy.elements().boundingBox();
        const pan = cy.pan();
        cy.pan({ x: pan.x - bb.x1, y: pan.y });
      }
    }, [elements, fitNodeIds, ref]);

    const handleWheel = e => {
      e.preventDefault();
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
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        <CytoscapeComponent
          elements={CytoscapeComponent.normalizeElements(elements)}
          stylesheet={stylesheet}
          userZoomingEnabled={true}
          layout={layout}
          style={{
            width: "100%",
            height: "100%",
            background: "#f8fafc",
            position: "relative",
          }}
          cy={cy => {
            cyRef.current = cy;
            ref.current = cy;
          }}
          className="cytoscape-graph"
        />
      </div>
    );
  }
);

export default CytoscapeGraph;
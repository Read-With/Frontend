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
        // 노드 충돌 방지를 위한 레이아웃 실행
        const layoutInstance = cy.layout(layout);
        layoutInstance.run();
        // 레이아웃 완료 후 화면에 맞추기
        cy.one("layoutstop", () => {
          cy.resize();
          if (fitNodeIds && fitNodeIds.length > 0) {
            const nodesToFit = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
            if (nodesToFit.length > 0) {
              cy.fit(nodesToFit, 40);
            }
          } else {
            cy.fit(undefined, 40);
          }
          // 그래프를 중앙에 위치시키기
          const bb = cy.elements().boundingBox();
          const center = {
            x: (bb.x1 + bb.x2) / 2,
            y: (bb.y1 + bb.y2) / 2
          };
          const containerCenter = {
            x: cy.width() / 2,
            y: cy.height() / 2
          };
          cy.pan({
            x: containerCenter.x - center.x,
            y: containerCenter.y - center.y
          });
          if (onLayoutReady) onLayoutReady();
        });
      }
    }, [elements, fitNodeIds, ref, layout]);

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
          elements={elements}
          stylesheet={stylesheet}
          userZoomingEnabled={true}
          layout={layout}
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
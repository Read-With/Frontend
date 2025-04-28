import "./RelationGraph.css"
import React, { useEffect } from "react";
import CytoscapeComponent from "react-cytoscapejs";

const CytoscapeGraph = React.forwardRef(
  ({ elements, stylesheet, layout, onNodeClick, onEdgeClick, onDragStart, onDragEnd, fitNodeIds, search, filterType }, ref) => {
    useEffect(() => {
      if (ref.current) {
        const cy = ref.current;
        cy.resize();
        if (fitNodeIds && fitNodeIds.length > 0) {
          const nodesToFit = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
          if (nodesToFit.length > 0) {
            cy.fit(nodesToFit, 60);
          }
        } else {
          cy.fit(undefined, 60);
        }

        cy.on("tap", "node", evt => onNodeClick && onNodeClick(evt.target.data()));
        cy.on("tap", "edge", evt => onEdgeClick && onEdgeClick(evt.target.data()));
        cy.on("dragstart", "node", onDragStart);
        cy.on("dragfree", "node", onDragEnd);

        return () => cy.removeAllListeners();
      }
    }, [elements, fitNodeIds, ref, onNodeClick, onEdgeClick, onDragStart, onDragEnd]);

    return (
      <CytoscapeComponent
        elements={CytoscapeComponent.normalizeElements(elements)}
        stylesheet={stylesheet} // 스타일 객체를 전달
        layout={layout}
        style={{
          width: "100%",
          height: "calc(100vh - 120px)",
          overflow: "hidden",
        }}
        cy={cy => {
          ref.current = cy;
        }}
      />
    );
  }
);

export default CytoscapeGraph;

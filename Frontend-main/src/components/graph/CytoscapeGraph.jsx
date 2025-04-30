import "./RelationGraph.css";
import React, { useEffect } from "react";
import CytoscapeComponent from "react-cytoscapejs";

const CytoscapeGraph = React.forwardRef(
  ({ elements, stylesheet, layout, fitNodeIds }, ref) => {
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
      }
    }, [elements, fitNodeIds, ref]);

    return (
      <CytoscapeComponent
        elements={CytoscapeComponent.normalizeElements(elements)}
        stylesheet={stylesheet}
        userZoomingEnabled={false} 
        layout={layout}
        style={{
          width: "100%",
          height: "100vh",
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

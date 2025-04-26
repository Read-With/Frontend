import React from "react";
import CytoscapeComponent from "react-cytoscapejs";

const stylesheet = [
  {
    selector: "node",
    style: {
      "background-color": (ele) => (ele.data("main") ? "#1976d2" : "#bdbdbd"),
      label: "data(label)",
      "font-size": 12,
      "text-valign": "center",
      "text-halign": "center",
      width: 40,
      height: 40,
      color: "#fff",
      "text-outline-color": "#222",
      "text-outline-width": 2,
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

const layout = { name: "cose", animate: true };

export default function CharacterRelationGraph({ elements }) {
  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={stylesheet}
      layout={layout}
      style={{ width: "100%", height: "600px" }}
    />
  );
}

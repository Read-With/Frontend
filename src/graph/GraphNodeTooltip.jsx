import React from "react";
import "./RelationGraph.css"

function GraphNodeTooltip({ nodeData, onClose }) {
  if (!nodeData) return null;

  return (
    <div className="node-tooltip" style={{ left: nodeData.x, top: nodeData.y - 75 }} onClick={(e) => e.stopPropagation()}>
      <button className="close-btn" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <h2 style={{ marginTop: 0, marginBottom: 7 }}>
        {nodeData.data.label}
        {nodeData.data.main && <span className="main-badge">주요 인물</span>}
      </h2>
      <p style={{ marginBottom: 7 }}>{nodeData.data.description}</p>
      {nodeData.data.names && (
        <div className="side-names">
          <b>별칭:</b> {nodeData.data.names.join(", ")}
        </div>
      )}
    </div>
  );
}

export default GraphNodeTooltip;

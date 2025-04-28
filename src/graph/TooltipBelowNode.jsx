import React from "react";
import "./RelationGraph.css"

function TooltipBelowNode({ tooltip, onClose }) {
  const TIP_WIDTH = 240;
  const TIP_HEIGHT = 98;
  const PADDING = 10;
  const winW = window.innerWidth;
  const winH = window.innerHeight;

  // 1. x좌표 보정 (좌우 끝과 겹치지 않게)
  let left = tooltip.x;
  if (left - TIP_WIDTH / 2 < PADDING) {
    left = PADDING + TIP_WIDTH / 2;
  }
  if (left + TIP_WIDTH / 2 > winW - PADDING) {
    left = winW - PADDING - TIP_WIDTH / 2;
  }

  // 2. y좌표 보정 (아래 끝 겹치면 위로)
  let top = tooltip.y + 54; // 노드 밑에 툴팁
  if (top + TIP_HEIGHT > winH - PADDING) {
    top = tooltip.y - TIP_HEIGHT - 10; // 아래로 안 보이면 위로
  }

  return (
    <div
      className="node-tooltip"
      style={{
        position: "absolute",
        left,
        top,
        transform: "translate(-50%, 0)",
        zIndex: 100,
        minWidth: TIP_WIDTH,
        background: "white",
        border: "1.5px solid #1976d2",
        borderRadius: 8,
        padding: "16px 18px 14px 18px",
        boxShadow: "0 4px 18px #0002",
        fontSize: 14,
        pointerEvents: "auto",
        textAlign: "left",
        maxWidth: TIP_WIDTH,
        maxHeight: TIP_HEIGHT,
        wordBreak: "break-all",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="close-btn"
        style={{
          position: "absolute",
          top: 4,
          right: 8,
          fontSize: 18,
          border: "none",
          background: "none",
          color: "#1976d2",
          cursor: "pointer",
        }}
        onClick={onClose}
        aria-label="닫기"
      >
        ×
      </button>
      <h2 style={{ marginTop: 0, marginBottom: 7 }}>
        {tooltip.data.label}
        {tooltip.data.main && (
          <span
            className="main-badge"
            style={{
              display: "inline-block",
              marginLeft: 8,
              padding: "2px 6px",
              background: "#f7b500",
              color: "#222",
              borderRadius: 8,
              fontSize: 11,
              verticalAlign: "middle",
            }}
          >
            주요 인물
          </span>
        )}
      </h2>
      <p style={{ marginBottom: 7 }}>{tooltip.data.description}</p>
      {tooltip.data.names && (
        <div className="side-names" style={{ fontSize: 13, color: "#888", marginBottom: 5 }}>
          <b>별칭:</b> {tooltip.data.names.join(", ")}
        </div>
      )}
    </div>
  );
}

export default TooltipBelowNode;

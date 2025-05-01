import React, { useEffect, useState } from "react";
import "./RelationGraph.css";

function EdgeTooltip({ edgeData, onClose }) {
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!edgeData) return;

    const TOOLTIP_WIDTH = 260;
    const TOOLTIP_HEIGHT = 140;
    const PADDING = 16; // 화면 가장자리 여백

    let x = edgeData.x;
    let y = edgeData.y - TOOLTIP_HEIGHT - 20; // 기본 위치는 위쪽

    // 좌우 보정
    if (x - TOOLTIP_WIDTH / 2 < PADDING) {
      x = PADDING + TOOLTIP_WIDTH / 2;
    } else if (x + TOOLTIP_WIDTH / 2 > window.innerWidth - PADDING) {
      x = window.innerWidth - PADDING - TOOLTIP_WIDTH / 2;
    }

    // 상하 보정
    if (y < PADDING) {
      y = edgeData.y + 20; // 위로 안되면 아래쪽에 표시
      if (y + TOOLTIP_HEIGHT > window.innerHeight - PADDING) {
        y = window.innerHeight - TOOLTIP_HEIGHT - PADDING;
      }
    } else if (y + TOOLTIP_HEIGHT > window.innerHeight - PADDING) {
      y = window.innerHeight - TOOLTIP_HEIGHT - PADDING;
    }

    setTooltipPos({ x, y });
  }, [edgeData]);

  if (!edgeData) return null;

  return (
    <div
      className="edge-tooltip"
      style={{
        position: "absolute",
        left: tooltipPos.x,
        top: tooltipPos.y,
        transform: "translate(-50%, 0)",
        zIndex: 9999,
      }}
    >
      <button
        className="close-btn"
        onClick={onClose}
        aria-label="닫기"
        style={{
          position: "absolute",
          top: 6,
          right: 10,
          fontSize: 18,
          border: "none",
          background: "none",
          color: "#1976d2",
          cursor: "pointer",
        }}
      >
        ×
      </button>
      <div className="tooltip-header">
        <strong>관계 유형 : </strong>
          {edgeData.data.label?.split(", ").map((label, idx) => (
            <span key={idx} className="relation-badge">
              {label}
            </span>
          ))}
      </div>
      {edgeData.data.explanation && (
        <div className="explanation">
          <strong>설명</strong>
          <p>{edgeData.data.explanation}</p>
        </div>
      )}
      <div className="meta-info">
        <div>긍정도: {Math.round(edgeData.data.positivity * 100)}%  강도: {Math.round(edgeData.data.weight * 100)}%</div>

      </div>
    </div>
  );
}

export default EdgeTooltip;

import React, { useEffect, useState } from "react";
import "./RelationGraph.css";

function EdgeTooltip({ edgeData, onClose }) {
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!edgeData) return;

    const calculatePosition = () => {
      const container = document.querySelector(".graph-container");
      if (!container) return;

      const { left: containerLeft, top: containerTop } =
        container.getBoundingClientRect();
      const zoom = container.offsetWidth / container.scrollWidth;

      // 중심(x), 상단(y) 기준 좌표
      let x = edgeData.x * zoom + containerLeft + window.scrollX;
      let y = edgeData.y * zoom + containerTop + window.scrollY;

      const TOOLTIP_WIDTH = 260;
      const TOOLTIP_HEIGHT = 140;
      const SCREEN_PADDING = 20;

      // x: 중앙 기준 좌우 경계 보정
      if (x - TOOLTIP_WIDTH / 2 < SCREEN_PADDING) {
        x = SCREEN_PADDING + TOOLTIP_WIDTH / 2;
      } else if (x + TOOLTIP_WIDTH / 2 > window.innerWidth - SCREEN_PADDING) {
        x = window.innerWidth - SCREEN_PADDING - TOOLTIP_WIDTH / 2;
      }

      // y: 상단 기준 위쪽 경계 보정 (툴팁이 위로 너무 올라가면 아래로 내림)
      if (y - TOOLTIP_HEIGHT < SCREEN_PADDING) {
        y = SCREEN_PADDING + TOOLTIP_HEIGHT;
      }
      // 아래쪽은 transform(-120%)로 인해 충분히 보임

      setTooltipPos({ x, y });
    };

    calculatePosition();
    window.addEventListener("resize", calculatePosition);
    return () => window.removeEventListener("resize", calculatePosition);
  }, [edgeData]);

  if (!edgeData) return null;

  return (
    <div
      className="edge-tooltip"
      style={{
        left: tooltipPos.x,
        top: tooltipPos.y,
        transform: "translate(-50%, -120%)",
      }}
    >
      <button
        className="close-btn"
        onClick={onClose}
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
        aria-label="닫기"
      >
        ×
      </button>
      <div className="tooltip-header">
        <strong>관계 유형:</strong>
        <div className="relation-labels">
          {edgeData.data.label?.split(", ").map((label, idx) => (
            <span key={idx} className="relation-badge">
              {label}
            </span>
          ))}
        </div>
      </div>
      {edgeData.data.explanation && (
        <div className="explanation">
          <strong>설명</strong>
          <p>{edgeData.data.explanation}</p>
        </div>
      )}
      <div className="meta-info">
        <div>긍정도: {Math.round(edgeData.data.positivity * 100)}%</div>
        <div>강도: {Math.round(edgeData.data.weight * 100)}%</div>
      </div>
    </div>
  );
}

export default EdgeTooltip;

import React, { useEffect, useState } from "react";
import "./RelationGraph.css";

function GraphNodeTooltip({ nodeData, onClose }) {
  const [containerRect, setContainerRect] = useState(null);

  useEffect(() => {
    const container = document.querySelector('.graph-container');
    if (container) {
      setContainerRect(container.getBoundingClientRect());
    }
  }, []);

  if (!nodeData || !containerRect) return null;

  const TOOLTIP_WIDTH = 240; 
  const TOOLTIP_HEIGHT = 140;
  const PADDING = 200; // 항상 container 내부에 이만큼 여유 있게

  // container 위치/크기
  const { left: containerLeft, top: containerTop, width: containerWidth, height: containerHeight } = containerRect;

  // 툴팁을 노드 기준 중앙에 위치시킴 (container 내부 좌표 기준)
  let localLeft = nodeData.x - TOOLTIP_WIDTH / 2;
  let localTop = nodeData.y - TOOLTIP_HEIGHT - 20;

  // 좌우 보정 (container 안쪽에 PADDING 여유 보장)
  if (localLeft < PADDING) {
    localLeft = PADDING;
  }
  if (localLeft + TOOLTIP_WIDTH + PADDING > containerWidth) {
    localLeft = containerWidth - TOOLTIP_WIDTH - PADDING;
  }

  // 상하 보정 (container 안쪽에 PADDING 여유 보장)
  if (localTop < PADDING) {
    // 위로 공간 부족하면 아래로 배치
    localTop = nodeData.y + 200;
    if (localTop + TOOLTIP_HEIGHT + PADDING > containerHeight) {
      localTop = containerHeight - TOOLTIP_HEIGHT - PADDING;
    }
  } else {
    if (localTop + TOOLTIP_HEIGHT + PADDING > containerHeight) {
      localTop = containerHeight - TOOLTIP_HEIGHT - PADDING;
    }
  }

  // 최종 화면 절대 좌표로 변환
  const finalLeft = containerLeft + localLeft;
  const finalTop = containerTop + localTop;

  return (
    <div
      className="node-tooltip"
      style={{ left: finalLeft, top: finalTop }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="close-btn" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <h2 className="node-tooltip-title">
        {nodeData.data.label}
        {nodeData.data.main && <span className="main-badge">주요 인물</span>}
      </h2>
      {nodeData.data.description && (
        <p className="node-tooltip-description">{nodeData.data.description}</p>
      )}
      {nodeData.data.names && (
        <div className="side-names">
          <b>별칭:</b> {nodeData.data.names.join(", ")}
        </div>
      )}
    </div>
  );
}

export default GraphNodeTooltip;

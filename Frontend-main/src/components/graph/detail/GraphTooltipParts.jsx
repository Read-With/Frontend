/** 노드·간선 툴팁과 관계 분석 모달이 공유하는 표시 부품 */

import { useState } from "react";
import { GRAPH_LAYOUT_CONSTANTS } from '../../../utils/graph/graphCore.js';
import { GRAPH_COLORS } from "../../../utils/graph/graphStyles";
import { joinClasses } from "../../../utils/common/domUtils";
import "../styles/graph.css";

/** 인물 이미지 없을 때 공통 실루엣 */
export function PersonSilhouette({
  size = 48,
  bodyFill = '#bdbdbd',
}) {
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
      <circle cx={cx} cy={cx} r={cx} fill={GRAPH_COLORS.border} />
      <ellipse cx={cx} cy={size * 0.375} rx={size * 0.21} ry={size * 0.21} fill={bodyFill} />
      <ellipse cx={cx} cy={size * 0.79} rx={size * 0.29} ry={size * 0.17} fill={bodyFill} />
    </svg>
  );
}

/** 노드/간선 툴팁 공통 닫기 버튼 */
export function TooltipCloseButton({ onClose, ariaLabel, className }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={ariaLabel}
      className={joinClasses('tooltip-close-btn', className)}
    >
      &times;
    </button>
  );
}

export function ActionButton({ variant = 'secondary', onClick, children, ariaLabel, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`tooltip-action-btn tooltip-action-btn--${variant === 'primary' ? 'primary' : 'secondary'}`}
    >
      {children}
    </button>
  );
}

/** 플로팅 노드/간선 툴팁 셸 */
export function NodeTooltipShell({
  children,
  shellRef,
  className = 'graph-node-tooltip',
  position,
  showContent,
  isDragging,
  handleMouseDown,
  transition,
}) {
  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        left: position.x,
        top: position.y,
        zIndex: GRAPH_LAYOUT_CONSTANTS.Z_INDEX_TOOLTIP,
        ...(showContent !== undefined
          ? {
              opacity: showContent ? 1 : 0,
              transition,
              cursor: isDragging ? 'grabbing' : 'grab',
            }
          : null),
      }}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  );
}

/**
 * 인물 아바타(이미지 또는 실루엣 폴백). 사이드바/툴팁 헤더와 관계 분석 모달 헤더가 공유한다.
 * innerClassName을 null로 주면 바깥 wrapper 없이 단일 컨테이너로 렌더링(예: relation-modal-avatar).
 */
export function NodeProfileAvatar({
  node,
  size = 48,
  className = 'profile-image-placeholder',
  innerClassName = 'profile-img',
}) {
  // 실패한 이미지만 기억 → 노드 이미지가 바뀌면 다시 시도
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = node?.hasImage && node?.image && failedSrc !== node.image;
  const content = showImage ? (
    <img
      src={node.image}
      alt={node.displayName || 'character'}
      crossOrigin="anonymous"
      decoding="async"
      loading="eager"
      onError={() => setFailedSrc(node.image)}
    />
  ) : (
    <div>
      <PersonSilhouette size={size} />
    </div>
  );

  return (
    <div className={className}>
      {innerClassName ? <div className={innerClassName}>{content}</div> : content}
    </div>
  );
}

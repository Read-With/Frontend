/** 노드·간선 툴팁과 관계 분석 모달이 공유하는 표시 부품 */

import { GRAPH_LAYOUT_CONSTANTS } from "../../utils/graph/graphCore.js";
import { GRAPH_COLORS } from "../../utils/styles/graphStyles.js";
import { joinClasses } from "../../utils/styles/styles.js";
import "./RelationGraph.css";

/** 인물 이미지 없을 때 공통 실루엣 */
export function PersonSilhouette({
  size = 48,
  circleFill = GRAPH_COLORS.border,
  bodyFill = '#bdbdbd',
}) {
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
      <circle cx={cx} cy={cx} r={cx} fill={circleFill} />
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
  zIndex = GRAPH_LAYOUT_CONSTANTS.Z_INDEX_TOOLTIP,
  showContent,
  isDragging,
  handleMouseDown,
  transition,
  closeButton = null,
}) {
  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        left: position.x,
        top: position.y,
        zIndex,
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
      {closeButton}
      {children}
    </div>
  );
}

export function CenteredStatus({
  children,
  color = GRAPH_COLORS.textSecondary,
  fullHeight = true,
}) {
  return (
    <div
      className={`tooltip-centered-status${fullHeight ? '' : ' tooltip-centered-status--compact'}`}
      style={{ '--status-color': color }}
    >
      {children}
    </div>
  );
}

function handleProfileImageError(e) {
  e.target.style.display = 'none';
  if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
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
  style,
}) {
  const hasImage = !!node?.hasImage && !!node?.image;
  const content = (
    <>
      {hasImage ? (
        <img
          src={node.image}
          alt={node?.displayName || 'character'}
          crossOrigin="anonymous"
          decoding="async"
          loading="eager"
          onError={handleProfileImageError}
        />
      ) : null}
      <div style={{ display: hasImage ? 'none' : 'block' }}>
        <PersonSilhouette size={size} />
      </div>
    </>
  );

  return (
    <div className={className} style={style}>
      {innerClassName ? <div className={innerClassName}>{content}</div> : content}
    </div>
  );
}

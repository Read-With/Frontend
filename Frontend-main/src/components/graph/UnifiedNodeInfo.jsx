import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  processRelations,
  processRelationTags,
  extractRadarChartData,
  extractApiBookId,
  undirectedPairKey,
  isGraphNodeElement,
  GRAPH_LAYOUT_CONSTANTS,
} from "../../utils/graph/graphCore";
import { getEventDataByIndex } from "../../utils/graph/graphFetch.js";
import { useTooltipPosition, useClickOutside } from "../../hooks/ui/tooltipHooks";
import { getUnifiedEventInfoForTooltip } from "../../utils/viewer/viewerSession";
import { toNumberOrNull } from "../../utils/common/valueUtils.js";
import { USER_GRAPH_PREFIX } from "../../utils/common/urlUtils";
import {
  COLORS,
  mergeRefs,
  unifiedNodeTooltipStyles,
  unifiedNodeAnimations,
} from "../../utils/styles/styles.js";
import './RelationGraph.css';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { getPositivityColor, getPositivityLabel } from '../../utils/styles/relationStyles.js';
import { GRAPH_COLORS } from '../../utils/styles/graphStyles.js';


const NAME_LABEL_MAX = 6;
const RADAR_BRAND = GRAPH_COLORS.primary;
const RADAR_GRID = 'rgba(92, 111, 92, 0.22)';
const RADAR_AXIS_TICK = '#6f7f6f';
const RADAR_FILL = 'rgba(92, 111, 92, 0.14)';

function positivityDisplay(positivity) {
  return {
    color: getPositivityColor(positivity),
    label: getPositivityLabel(positivity || 0),
    percent: Math.round((positivity || 0) * 100),
  };
}

function truncateLabel(name) {
  if (!name) return '';
  if (name.length <= NAME_LABEL_MAX) return name;
  return `${name.slice(0, NAME_LABEL_MAX - 1)}…`;
}

function RelationTagsRow({ tags }) {
  if (!tags?.length) return null;
  return (
    <div className="tooltip-relation-tags">
      {tags.map((tag, i) => (
        <span key={i} className="tooltip-relation-tag">{tag}</span>
      ))}
    </div>
  );
}

function PositivityChip({ positivity }) {
  const { color, label, percent } = positivityDisplay(positivity);
  return (
    <div className="tooltip-positivity-chip" style={{ '--pos-color': color }}>
      <span className="tooltip-positivity-label">{label}</span>
      <div className="tooltip-positivity-percent">{percent}%</div>
    </div>
  );
}

function NameWithDot({ name, positivity, fontSize = '1rem' }) {
  const { color } = positivityDisplay(positivity);
  return (
    <div
      className="tooltip-name-with-dot"
      style={{ '--dot-color': color, '--dot-size': '10px', '--name-font-size': fontSize }}
    >
      <div className="tooltip-name-dot" />
      <span className="tooltip-name-label">{name}</span>
    </div>
  );
}

const RadarDot = memo(function RadarDot({
  cx,
  cy,
  payload,
  dataMap,
  activeName,
  onActivate,
}) {
  const fullData = payload?.name != null ? (dataMap.get(payload.name) || payload) : null;
  if (!payload || cx == null || cy == null || !fullData) return null;

  const { color } = positivityDisplay(fullData.positivity);
  const isActive = activeName === payload.name;
  const radius = isActive ? 7 : 4.5;

  const activate = (e) => {
    e.stopPropagation();
    onActivate?.(fullData, e);
  };

  return (
    <g className={`relation-radar-dot${isActive ? ' is-active' : ''}`}>
      <circle
        cx={cx}
        cy={cy}
        r={Math.max(16, radius * 3)}
        fill="transparent"
        style={{ cursor: 'pointer', pointerEvents: 'all' }}
        onMouseEnter={activate}
        onClick={activate}
        onFocus={activate}
        tabIndex={0}
        role="button"
        aria-label={`${fullData.name} 관계 상세`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate(e);
          }
        }}
      />
      {isActive ? (
        <circle
          cx={cx}
          cy={cy}
          r={radius + 4}
          fill="none"
          stroke={RADAR_BRAND}
          strokeWidth={1.5}
          strokeOpacity={0.55}
          style={{ pointerEvents: 'none' }}
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke={isActive ? '#fff' : 'rgba(255,255,255,0.85)'}
        strokeWidth={isActive ? 2 : 1}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
});

function RelationList({
  items,
  activeName,
  onSelect,
  emptyMessage,
}) {
  if (!items?.length) {
    return emptyMessage ? (
      <div className="relation-modal-list-empty">{emptyMessage}</div>
    ) : null;
  }

  return (
    <ul className="relation-modal-list" role="listbox" aria-label="연결된 인물 목록">
      {items.map((item) => {
        const active = activeName === item.name;
        return (
          <li key={item.id || item.name}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              className={`relation-modal-list-item${active ? ' is-active' : ''}`}
              onClick={() => onSelect(item)}
            >
              <NameWithDot name={item.name} positivity={item.positivity} />
              <PositivityChip positivity={item.positivity} />
              <RelationTagsRow tags={item.relationTags} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** −1~+1 긍정성 미니 스케일 (연결 적을 때 레이더 대체) */
function PositivityScaleBar({ positivity }) {
  const value = Number.isFinite(Number(positivity)) ? Number(positivity) : 0;
  const clamped = Math.max(-1, Math.min(1, value));
  const pct = ((clamped + 1) / 2) * 100;
  const { color, label } = positivityDisplay(clamped);

  return (
    <div
      className="relation-positivity-scale"
      role="img"
      aria-label={`긍정성 ${label} (${clamped.toFixed(2)})`}
    >
      <div className="relation-positivity-scale-track">
        <span className="relation-positivity-scale-zero" />
        <span
          className="relation-positivity-scale-marker"
          style={{ left: `${pct}%`, background: color }}
        />
      </div>
      <div className="relation-positivity-scale-labels" aria-hidden>
        <span>−1</span>
        <span>0</span>
        <span>+1</span>
      </div>
    </div>
  );
}

function RelationCard({ item, active, onSelect, sourceName }) {
  if (!item) return null;

  return (
    <button
      type="button"
      className={`relation-card${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(item)}
    >
      <div className="relation-card-top">
        <NameWithDot name={item.name} positivity={item.positivity} fontSize="1.05rem" />
        <PositivityChip positivity={item.positivity} />
      </div>
      {sourceName ? (
        <p className="relation-card-pair-hint">
          {sourceName} ↔ {item.name}
        </p>
      ) : null}
      <PositivityScaleBar positivity={item.positivity} />
      <RelationTagsRow tags={item.relationTags} />
    </button>
  );
}

function FewConnectionsPanel({
  items,
  activeName,
  onSelect,
  sourceName,
  connectionKind,
}) {
  const isPair = connectionKind === 'pair_connections';
  return (
    <div className="relation-few-panel">
      <div className="relation-modal-side-title">
        {isPair ? '연결된 인물 비교' : '연결된 인물'}
      </div>
      <p className="relation-modal-side-hint">
        {isPair
          ? '연결이 적어 관계 카드로 나란히 비교합니다. '
          : '연결이 적어 관계 카드로 표시합니다. '}
        챕터를 바꾸면 연결이 늘어날 수 있습니다.
      </p>
      <div
        className={`relation-card-grid${isPair ? ' is-pair' : ' is-single'}`}
        role="listbox"
        aria-label="연결된 인물 카드"
      >
        {items.map((item) => (
          <RelationCard
            key={item.id || item.name}
            item={item}
            active={activeName === item.name}
            onSelect={onSelect}
            sourceName={sourceName}
          />
        ))}
      </div>
    </div>
  );
}

function PersonSilhouette({ size = 48, circleFill = '#e5e7eb', bodyFill = '#bdbdbd' }) {
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
      <circle cx={cx} cy={cx} r={cx} fill={circleFill} />
      <ellipse cx={cx} cy={size * 0.375} rx={size * 0.21} ry={size * 0.21} fill={bodyFill} />
      <ellipse cx={cx} cy={size * 0.79} rx={size * 0.29} ry={size * 0.17} fill={bodyFill} />
    </svg>
  );
}

function PersonAvatar({ node, size = 40 }) {
  const hasImage = !!node?.hasImage && node?.image;
  return (
    <div className="relation-modal-avatar" style={{ width: size, height: size }}>
      {hasImage ? (
        <img src={node.image} alt="" crossOrigin="anonymous" />
      ) : (
        <PersonSilhouette size={size} />
      )}
    </div>
  );
}

function RelationAnalysisModalImpl({
  node,
  chapterNum,
  chapterScopeLabel = null,
  radarChartData = [],
  connectionKind,
  recommendedNodes = [],
  onClose,
  onSelectRelatedNode,
  returnFocusRef,
  chapterRailWidth = GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH,
}) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const activeNameRef = useRef(null);
  const switchTargetsRef = useRef(radarChartData);
  const [activeName, setActiveName] = useState(null);

  const overlayStyle = useMemo(() => {
    const inset = GRAPH_LAYOUT_CONSTANTS.ANALYSIS_MODAL_INSET;
    const top = GRAPH_LAYOUT_CONSTANTS.TOP_BAR_HEIGHT + inset;
    const left = Math.max(0, Number(chapterRailWidth) || 0) + inset;
    return {
      '--relation-modal-top': `${top}px`,
      '--relation-modal-left': `${left}px`,
      '--relation-modal-inset': `${inset}px`,
    };
  }, [chapterRailWidth]);

  const dataMap = useMemo(() => {
    const map = new Map();
    radarChartData.forEach((item) => map.set(item.name, item));
    return map;
  }, [radarChartData]);

  const activeItem = activeName ? dataMap.get(activeName) : null;
  const connectionCount = radarChartData.length;

  const switchTargets = radarChartData;
  const activeIndex = switchTargets.findIndex((item) => item.name === activeName);
  switchTargetsRef.current = switchTargets;
  activeNameRef.current = activeName;

  useEffect(() => {
    setActiveName(radarChartData[0]?.name ?? null);
  }, [node?.id, radarChartData]);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return undefined;

    const previouslyFocused = returnFocusRef?.current || document.activeElement;
    const getFocusable = () =>
      [...root.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

    closeBtnRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      const targets = switchTargetsRef.current || [];
      const currentName = activeNameRef.current;
      const idx = targets.findIndex((item) => item.name === currentName);

      if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && targets.length) {
        e.preventDefault();
        const next = (Math.max(idx, 0) + 1) % targets.length;
        setActiveName(targets[next].name);
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && targets.length) {
        e.preventDefault();
        const prev = (Math.max(idx, 0) - 1 + targets.length) % targets.length;
        setActiveName(targets[prev].name);
        return;
      }

      if (e.key !== 'Tab') return;
      const list = getFocusable();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (i === list.length - 1 || i === -1)) {
        e.preventDefault();
        list[0].focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = '';
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [onClose, returnFocusRef]);

  const activateItem = useCallback((item) => {
    if (!item?.name) return;
    setActiveName(item.name);
  }, []);

  const switchToRelated = useCallback((item) => {
    if (!item || !onSelectRelatedNode) return;
    onSelectRelatedNode(item.id || item.name, { keepAnalysisOpen: true });
  }, [onSelectRelatedNode]);

  const goSibling = useCallback((direction) => {
    if (!switchTargets.length) return;
    const base = activeIndex >= 0 ? activeIndex : 0;
    const next = (base + direction + switchTargets.length) % switchTargets.length;
    switchToRelated(switchTargets[next]);
  }, [switchTargets, activeIndex, switchToRelated]);

  const renderPolarAngleAxis = ({ payload, x: tickX, y: tickY, cx, cy }) => {
    const point = dataMap.get(payload.value);
    const color = point?.positivity !== undefined
      ? positivityDisplay(point.positivity).color
      : RADAR_AXIS_TICK;
    const active = activeName === payload.value;
    const dx = tickX - cx;
    const dy = tickY - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const raw = payload.value || '';
    const label = truncateLabel(raw);
    const scale = (distance + Math.max(34, 20 + (label.length * 1.8))) / distance;

    return (
      <text
        x={cx + dx * scale}
        y={cy + dy * scale}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={active ? color : RADAR_AXIS_TICK}
        fontSize={active ? 14 : 12}
        fontWeight={active ? 700 : 500}
        letterSpacing={active ? '0.01em' : '0'}
        style={{ cursor: point ? 'pointer' : 'default' }}
        onClick={() => point && activateItem(point)}
      >
        <title>{raw}</title>
        {label}
      </text>
    );
  };

  const formatRadarRadiusTick = (value) => {
    if (value === 0) return '−1';
    if (value === 50) return '0';
    if (value === 100) return '+1';
    return '';
  };

  const chartPanel = connectionKind === 'sufficient_connections' ? (
    <div className="relation-modal-chart" role="img" aria-label={`${node?.displayName} 관계 레이더 차트`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={radarChartData}
          margin={{ top: 52, right: 52, bottom: 52, left: 52 }}
          style={{ outline: 'none' }}
        >
          <PolarGrid
            gridType="polygon"
            stroke={RADAR_GRID}
            strokeWidth={1}
            radialLines
          />
          <PolarAngleAxis dataKey="name" tick={renderPolarAngleAxis} />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tickCount={3}
            axisLine={false}
            tick={{
              fontSize: 11,
              fill: RADAR_AXIS_TICK,
              fontWeight: 600,
            }}
            tickFormatter={formatRadarRadiusTick}
          />
          <Radar
            name={node?.displayName}
            dataKey="normalizedValue"
            stroke={RADAR_BRAND}
            fill={RADAR_FILL}
            fillOpacity={1}
            strokeWidth={2.25}
            dot={(dotProps) => {
              const { key, ...rest } = dotProps;
              return (
                <RadarDot
                  key={key}
                  {...rest}
                  dataMap={dataMap}
                  activeName={activeName}
                  onActivate={activateItem}
                />
              );
            }}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  ) : null;

  const isCardView =
    connectionKind === 'single_connection' || connectionKind === 'pair_connections';
  const isCompactModal = isCardView || connectionKind === 'no_connections';

  let bodyPanel = null;
  if (isCardView) {
    bodyPanel = (
      <FewConnectionsPanel
        items={radarChartData}
        activeName={activeName}
        onSelect={activateItem}
        sourceName={node?.displayName}
        connectionKind={connectionKind}
      />
    );
  } else if (connectionKind === 'no_connections') {
    bodyPanel = (
      <div className="relation-modal-side relation-modal-side--solo">
        <div className="relation-modal-side-title">추천 인물</div>
        <p className="relation-modal-side-hint">
          이 챕터 범위에서 연결된 인물이 없습니다. 다른 챕터를 보거나 아래 추천 인물을 확인해 보세요.
        </p>
        <RelationList
          items={recommendedNodes}
          activeName={activeName}
          onSelect={switchToRelated}
          emptyMessage="추천할 인물이 없습니다."
        />
      </div>
    );
  } else {
    bodyPanel = (
      <div className="relation-modal-side">
        <div className="relation-modal-side-title">연결된 인물</div>
        <RelationList
          items={radarChartData}
          activeName={activeName}
          onSelect={activateItem}
        />
      </div>
    );
  }

  const ctaRow = activeItem && onSelectRelatedNode && connectionKind !== 'no_connections' ? (
    <div className="relation-modal-cta-row">
      <button
        type="button"
        className="relation-modal-action-btn relation-modal-action-btn--secondary"
        onClick={() => switchToRelated(activeItem)}
      >
        이 인물로 분석 전환
      </button>
    </div>
  ) : null;

  const titleId = 'relation-analysis-modal-title';
  const bodyClassName = [
    'tooltip-modal-body',
    'relation-modal-body',
    connectionKind === 'sufficient_connections' ? 'has-chart' : '',
    isCardView ? 'is-card-view' : '',
    connectionKind === 'no_connections' ? 'is-empty-view' : '',
  ].filter(Boolean).join(' ');

  const containerClassName = [
    'modal-container',
    'relation-modal-container',
    isCompactModal ? 'relation-modal-container--compact' : '',
    connectionKind === 'pair_connections' ? 'is-pair' : '',
    connectionKind === 'single_connection' ? 'is-single' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={`modal-overlay relation-modal-overlay--graph-page${isCompactModal ? ' is-compact' : ''}`}
      style={overlayStyle}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={containerClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header relation-modal-header">
          <div className="relation-modal-header-main">
            <PersonAvatar node={node} />
            <div className="relation-modal-header-copy">
              <h2 id={titleId} className="tooltip-modal-title">
                {node?.displayName || '인물'} 관계 분석
              </h2>
              {(chapterScopeLabel || chapterNum != null) && (
                <span className="relation-modal-chip">
                  {chapterScopeLabel || `챕터 ${chapterNum}`}
                </span>
              )}
              <span className="relation-modal-chip">연결 {connectionCount}명</span>
            </div>
          </div>
          <div className="relation-modal-header-actions">
            {onSelectRelatedNode && switchTargets.length > 1 && (
              <div className="relation-modal-switcher">
                <button
                  type="button"
                  className="relation-modal-nav-btn"
                  aria-label="이전 연결 인물로 분석 전환"
                  onClick={() => goSibling(-1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="relation-modal-nav-btn"
                  aria-label="다음 연결 인물로 분석 전환"
                  onClick={() => goSibling(1)}
                >
                  ›
                </button>
              </div>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="modal-close-btn"
              aria-label="관계 분석 닫기"
            >
              ×
            </button>
          </div>
        </div>

        {connectionKind === 'sufficient_connections' ? (
          <div className="relation-modal-legend" aria-hidden="false">
            <span className="relation-modal-legend-label">긍정성</span>
            <div className="relation-modal-legend-bar">
              <span>부정 (−1)</span>
              <span className="relation-modal-legend-gradient" />
              <span>긍정 (+1)</span>
            </div>
          </div>
        ) : null}

        <div className={bodyClassName}>
          {chartPanel}
          {bodyPanel}
        </div>
        {ctaRow}
      </div>
    </div>
  );
}

const RelationAnalysisModal = memo(RelationAnalysisModalImpl);

const Z_INDEX_TOOLTIP = 99999;
const SUMMARY = { COLLAPSED: 'collapsed', WARNING: 'warning', CONTENT: 'content' };

/** 뷰어처럼 key remount 되어도 분석 모달을 유지하기 위한 플래그 */
let pendingKeepAnalysisOpen = false;

function normalizeToString(value) {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : "";
  }
  return String(value).trim();
}

function buildProcessedNode(data) {
  const raw = (data && (data.id || data.label))
    ? data
    : (data?.data || { id: data?.id, label: data?.label });
  if (!raw) return null;

  const description = String(raw.personalityText || raw.description || '').trim();
  return {
    ...raw,
    names: processRelationTags(raw.names || [], raw.common_name),
    displayName: raw.common_name || raw.label || "Unknown",
    hasImage: !!raw.image,
    isMainCharacter: !!raw.isMainCharacter,
    description,
  };
}

function buildIdentityContext(nodeLike) {
  const normalizedNodeId = normalizeToString(nodeLike?.id);
  return {
    normalizedNodeId,
    nodeIdNum: toNumberOrNull(normalizedNodeId),
    normalizedNodeName: normalizeToString(
      nodeLike?.common_name ?? nodeLike?.label ?? nodeLike?.name
    ),
  };
}

function isSameIdentifier(candidate, idCtx) {
  if (!candidate) return false;
  const candidateId =
    candidate.id ??
    candidate.character_id ??
    candidate.characterId ??
    candidate.char_id ??
    candidate.pk ??
    candidate.node_id;
  const candidateName =
    candidate.common_name ?? candidate.name ?? candidate.label ?? candidate.displayName;

  const candidateIdStr = normalizeToString(candidateId);
  if (candidateIdStr && idCtx.normalizedNodeId && candidateIdStr === idCtx.normalizedNodeId) {
    return true;
  }

  const candidateIdNum = toNumberOrNull(candidateIdStr);
  if (candidateIdNum !== null && idCtx.nodeIdNum !== null && candidateIdNum === idCtx.nodeIdNum) {
    return true;
  }

  const candidateNameStr = normalizeToString(candidateName);
  return !!(
    candidateNameStr &&
    idCtx.normalizedNodeName &&
    candidateNameStr === idCtx.normalizedNodeName
  );
}

function collectUndirectedRelations(rawRelations, targetNodeId = null) {
  const relationMap = new Map();
  const targetStr = targetNodeId != null ? String(targetNodeId) : null;

  rawRelations.forEach((rel) => {
    const id1 = rel.id1 ?? rel.source;
    const id2 = rel.id2 ?? rel.target;
    if (id1 == null || id2 == null) return;
    if (targetStr != null && String(id1) !== targetStr && String(id2) !== targetStr) return;

    const key = undirectedPairKey(id1, id2);
    if (relationMap.has(key)) return;

    relationMap.set(key, {
      id1,
      id2,
      relation: rel.relation || ['관계'],
      count: rel.count || rel.strength || 1,
      positivity: rel.positivity || 0,
    });
  });

  return Array.from(relationMap.values());
}

function checkNodeAppearance({ isSidebar, data, node, chapterNum, folderKey, eventNum, elements }) {
  const isGraphOnlyPage =
    typeof window !== 'undefined' && window.location.pathname.includes(`${USER_GRAPH_PREFIX}/`);
  if (isSidebar || isGraphOnlyPage) {
    return { appeared: true, error: null };
  }
  if (!data || !chapterNum || chapterNum <= 0) {
    return { appeared: false, error: null };
  }

  try {
    const json = getEventDataByIndex(folderKey, chapterNum, eventNum);
    const idCtx = buildIdentityContext({
      id: node?.id ?? data?.id ?? data?.data?.id,
      common_name:
        node?.common_name ??
        node?.label ??
        data?.common_name ??
        data?.label ??
        data?.data?.common_name ??
        data?.data?.label,
    });

    const inElements = Array.isArray(elements) && elements.some((el) => {
      if (!el || el.data?.source) return false;
      return isSameIdentifier(
        { id: el.data?.id ?? el.id, name: el.data?.common_name ?? el.data?.label },
        idCtx,
      );
    });

    if (!json?.relations) {
      return { appeared: inElements, error: null };
    }

    const relations = processRelations(json.relations);
    const inCharacters = Array.isArray(json.characters)
      && json.characters.some((c) => isSameIdentifier(c, idCtx));
    const inRelations = relations.some(
      (rel) =>
        isSameIdentifier({ id: rel.id1, name: rel.name1 }, idCtx) ||
        isSameIdentifier({ id: rel.id2, name: rel.name2 }, idCtx),
    );

    return { appeared: inCharacters || inRelations || inElements, error: null };
  } catch (err) {
    return { appeared: false, error: err.message };
  }
}

function resolvePovSummary(node, chapterNum, povSummaries, povError = null) {
  if (!node) return { text: '인물에 대한 요약 정보가 없습니다.', isError: false };

  if (povError) {
    return {
      text: typeof povError === 'string' ? povError : '관점 요약을 불러오지 못했습니다.',
      isError: true,
    };
  }

  const list = povSummaries?.povSummaries;
  if (Array.isArray(list) && list.length > 0) {
    const nodeId = Number(node.id);
    let match = Number.isFinite(nodeId)
      ? list.find((s) => Number(s.characterId) === nodeId)
      : null;
    if (!match) {
      const names = [node.common_name, node.label, node.displayName]
        .filter((n) => typeof n === 'string' && n.trim() !== '');
      match = list.find((s) => names.some((n) => n === s.characterName));
    }
    if (match?.summaryText) return { text: match.summaryText, isError: false };
  }

  return {
    text: `${node.displayName}에 대한 ${chapterNum || 1}장 관점 요약이 아직 준비되지 않았습니다.`,
    isError: false,
  };
}

function buildRadarChartData({
  node,
  chapterNum,
  apiBookGraphData,
  elements,
  folderKey,
  eventNum,
}) {
  if (!node?.id || !chapterNum) return [];

  try {
    if (apiBookGraphData?.relations && apiBookGraphData?.characters) {
      const { relations, characters } = apiBookGraphData;
      const bookElements = characters.map((char) => {
        const charName = char.common_name || char.name || '';
        return {
          data: {
            id: String(char.id),
            label: charName || `인물 ${char.id}`,
            common_name: charName || `인물 ${char.id}`,
          },
        };
      });

      const targetNodeId = node.id;

      return extractRadarChartData(
        targetNodeId,
        collectUndirectedRelations(relations, targetNodeId),
        bookElements,
        8,
      );
    }

    if (!elements?.length) return [];

    const edgeRels = elements
      .filter((el) => el?.data?.source && el?.data?.target)
      .map((el) => ({
        id1: el.data.source,
        id2: el.data.target,
        relation: el.data.relation || ['관계'],
        count: el.data.count || el.data.strength || 1,
        positivity: el.data.positivity || 0,
      }));

    if (edgeRels.length > 0) {
      const nodeElements = elements.filter((el) => isGraphNodeElement(el));
      return extractRadarChartData(
        node.id,
        collectUndirectedRelations(edgeRels, node.id),
        nodeElements,
        8,
      );
    }

    if (!folderKey) return [];
    const json = getEventDataByIndex(folderKey, chapterNum, eventNum);
    if (!json?.relations) return [];

    const relations = collectUndirectedRelations(json.relations);
    const ids = new Set(relations.flatMap((rel) => [String(rel.id1), String(rel.id2)]));
    const filtered = elements.filter(
      (el) => !el.data.source && ids.has(String(el.data.id)),
    );
    return extractRadarChartData(node.id, relations, filtered, 8);
  } catch {
    return [];
  }
}

function buildRecommendedNodes({ elements, apiBookGraphData, excludeId, limit = 3 }) {
  const exclude = excludeId != null ? String(excludeId) : null;
  const degree = new Map();

  const bump = (id) => {
    const key = String(id);
    if (exclude && key === exclude) return;
    degree.set(key, (degree.get(key) || 0) + 1);
  };

  if (apiBookGraphData?.relations?.length) {
    apiBookGraphData.relations.forEach((rel) => {
      bump(rel.id1 ?? rel.source);
      bump(rel.id2 ?? rel.target);
    });
  } else if (Array.isArray(elements)) {
    elements.forEach((el) => {
      if (!el?.data?.source || !el?.data?.target) return;
      bump(el.data.source);
      bump(el.data.target);
    });
  }

  const nameById = new Map();
  if (apiBookGraphData?.characters?.length) {
    apiBookGraphData.characters.forEach((char) => {
      nameById.set(String(char.id), char.common_name || char.name || `인물 ${char.id}`);
    });
  }
  if (Array.isArray(elements)) {
    elements.forEach((el) => {
      if (!isGraphNodeElement(el)) return;
      const id = String(el.data.id);
      nameById.set(id, el.data.common_name || el.data.label || nameById.get(id) || `인물 ${id}`);
    });
  }

  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({
      id,
      name: nameById.get(id) || `인물 ${id}`,
      positivity: 0,
      relationTags: [`연결 ${count}`],
    }));
}

function handleProfileImageError(e) {
  e.target.style.display = "none";
  if (e.target.nextSibling) e.target.nextSibling.style.display = "block";
}

function TooltipCloseButton({ onClose, ariaLabel, className }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={ariaLabel}
      className={['tooltip-close-btn', className].filter(Boolean).join(' ')}
    >
      &times;
    </button>
  );
}

function ActionButton({ variant = 'secondary', onClick, children, ariaLabel, title, minWidth }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`tooltip-action-btn tooltip-action-btn--${isPrimary ? 'primary' : 'secondary'}`}
      style={minWidth ? { minWidth } : undefined}
    >
      {children}
    </button>
  );
}

function NodeTooltipShell({
  children,
  shellRef,
  className = "graph-node-tooltip",
  containerStyle,
  position,
  zIndex,
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
        ...containerStyle,
        left: position.x,
        top: position.y,
        zIndex,
        ...(showContent !== undefined
          ? {
              opacity: showContent ? 1 : 0,
              transition,
              cursor: isDragging ? "grabbing" : "grab",
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

function CenteredStatus({ children, color = COLORS.textSecondary, fullHeight = true }) {
  return (
    <div
      className={`tooltip-centered-status${fullHeight ? '' : ' tooltip-centered-status--compact'}`}
      style={{ '--status-color': color }}
    >
      {children}
    </div>
  );
}

function NodeProfileAvatar({ node }) {
  const hasImage = !!node?.hasImage;
  return (
    <div className="profile-image-placeholder">
      <div className="profile-img">
        {hasImage ? (
          <img
            src={node.image}
            alt={node?.displayName || "character"}
            crossOrigin="anonymous"
            onError={handleProfileImageError}
          />
        ) : null}
        <div style={{ display: hasImage ? "none" : "block" }}>
          <PersonSilhouette size={48} />
        </div>
      </div>
    </div>
  );
}

function RelationAnalysisCta({
  node,
  connectionCount,
  onOpen,
  buttonRef,
  compact = false,
}) {
  return (
    <div
      className={`sidebar-section tooltip-analysis-section${compact ? ' tooltip-analysis-section--compact' : ''}`}
      role="region"
      aria-label="관계 분석"
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        className="relation-analysis-btn"
      >
        <div className="tooltip-analysis-copy">
          <h4 className="tooltip-section-title">
            인물 관계 분석
            <span className="tooltip-analysis-badge">관계 {connectionCount}</span>
          </h4>
          <p className="tooltip-analysis-desc">
            {node?.displayName}와 연결된 인물과의 관계를 시각화합니다
          </p>
        </div>
        <span className="tooltip-analysis-cta-label">분석 보기</span>
      </button>
    </div>
  );
}

function UnifiedNodeInfo({
  displayMode = 'tooltip',
  data,
  x,
  y,
  onClose,
  chapterNum,
  eventNum,
  elements = [],
  filename,
  currentEvent = null,
  prevValidEvent = null,
  povSummaries = null,
  povError = null,
  onRetryPov = null,
  apiBookGraphData = null,
  onSelectRelatedNode = null,
  chapterRailWidth = null,
}) {
  const { filename: urlFilename } = useParams();
  const isSidebar = displayMode === 'sidebar';
  const apiBookId = extractApiBookId(filename || urlFilename);
  const folderKey = apiBookId ? `api:${apiBookId}` : null;
  const node = useMemo(() => buildProcessedNode(data), [data]);

  const [appeared, setAppeared] = useState(false);
  const [error, setError] = useState(null);
  const [summaryStage, setSummaryStage] = useState(SUMMARY.COLLAPSED);
  const [isModalOpen, setIsModalOpen] = useState(() => {
    if (pendingKeepAnalysisOpen) {
      pendingKeepAnalysisOpen = false;
      return true;
    }
    return false;
  });
  const keepModalOpenRef = useRef(false);
  const analysisBtnRef = useRef(null);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => {
    pendingKeepAnalysisOpen = false;
    setIsModalOpen(false);
  }, []);

  const handleSelectRelatedNode = useCallback((idOrName, options = {}) => {
    if (!onSelectRelatedNode) return false;
    if (options.keepAnalysisOpen) {
      keepModalOpenRef.current = true;
      pendingKeepAnalysisOpen = true;
    } else {
      pendingKeepAnalysisOpen = false;
      keepModalOpenRef.current = false;
    }
    return onSelectRelatedNode(idOrName, options);
  }, [onSelectRelatedNode]);

  useEffect(() => {
    setSummaryStage(SUMMARY.COLLAPSED);
    if (keepModalOpenRef.current) {
      keepModalOpenRef.current = false;
      setIsModalOpen(true);
    } else {
      setIsModalOpen(false);
    }
  }, [node?.id]);

  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(
    x, y, { enabled: !isSidebar, bounds: 'window' }
  );

  const clickOutsideRef = useClickOutside(
    () => { if (onClose) onClose(); },
    !isSidebar && showContent && !isModalOpen,
    true
  );

  const eventInfo = useMemo(
    () => getUnifiedEventInfoForTooltip({ currentEvent, prevValidEvent, eventNum }),
    [currentEvent, prevValidEvent, eventNum],
  );

  useEffect(() => {
    const result = checkNodeAppearance({
      isSidebar,
      data,
      node,
      chapterNum,
      folderKey,
      eventNum: eventInfo.eventNum,
      elements,
    });
    setAppeared(result.appeared);
    setError(result.error);
  }, [data, node, chapterNum, eventInfo, folderKey, elements, isSidebar]);

  const summaryResult = useMemo(
    () => resolvePovSummary(node, chapterNum, povSummaries, povError),
    [node, chapterNum, povSummaries, povError],
  );
  const summaryText = summaryResult.text;
  const summaryIsError = summaryResult.isError;

  const radarChartData = useMemo(() => {
    if (!isSidebar) return [];
    return buildRadarChartData({
      node,
      chapterNum,
      apiBookGraphData,
      elements,
      folderKey,
      eventNum: eventInfo.eventNum,
    });
  }, [isSidebar, node, chapterNum, folderKey, elements, apiBookGraphData, eventInfo]);

  const connectionKind = useMemo(() => {
    if (!isSidebar) return 'no_connections';
    const n = radarChartData.length;
    if (n === 0) return 'no_connections';
    if (n === 1) return 'single_connection';
    if (n === 2) return 'pair_connections';
    return 'sufficient_connections';
  }, [isSidebar, radarChartData]);

  const recommendedNodes = useMemo(() => {
    if (!isSidebar || connectionKind !== 'no_connections') return [];
    return buildRecommendedNodes({
      elements,
      apiBookGraphData,
      excludeId: node?.id,
      limit: 3,
    });
  }, [isSidebar, connectionKind, elements, apiBookGraphData, node?.id]);

  const isWarning = summaryStage === SUMMARY.WARNING;
  const isContent = summaryStage === SUMMARY.CONTENT;

  const floatingShell = {
    shellRef: mergeRefs(tooltipRef, clickOutsideRef),
    position,
    zIndex: Z_INDEX_TOOLTIP,
    showContent,
    isDragging,
    handleMouseDown,
  };

  const analysisModal = isSidebar && isModalOpen ? (
    <RelationAnalysisModal
      node={node}
      chapterNum={chapterNum}
      chapterScopeLabel={chapterNum != null ? `챕터 1–${chapterNum} 누적` : null}
      radarChartData={radarChartData}
      connectionKind={connectionKind}
      recommendedNodes={recommendedNodes}
      onClose={closeModal}
      onSelectRelatedNode={onSelectRelatedNode ? handleSelectRelatedNode : null}
      returnFocusRef={analysisBtnRef}
      chapterRailWidth={
        chapterRailWidth ?? GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH
      }
    />
  ) : null;

  if (error) {
    const errorContent = (
      <div className="tooltip-error-block">
        <h4 className="tooltip-error-title">오류가 발생했습니다</h4>
        <p className="tooltip-error-msg">{error}</p>
        <button type="button" onClick={onClose} className="tooltip-error-close-btn">
          닫기
        </button>
      </div>
    );

    if (!isSidebar) {
      return (
        <NodeTooltipShell
          shellRef={tooltipRef}
          className="graph-node-tooltip error"
          containerStyle={unifiedNodeTooltipStyles.errorContainer}
          position={position}
          zIndex={Z_INDEX_TOOLTIP}
        >
          {errorContent}
        </NodeTooltipShell>
      );
    }

    return <CenteredStatus color="#d32f2f">{errorContent}</CenteredStatus>;
  }

  if (!appeared) {
    const eventHint = eventInfo.name
      ? `챕터 ${chapterNum} 이벤트 "${eventInfo.name}"에서는 등장하지 않습니다`
      : eventInfo.eventNum
        ? `챕터 ${chapterNum} 이벤트 ${eventInfo.eventNum}에서는 등장하지 않습니다`
        : `챕터 ${chapterNum}에서는 등장하지 않습니다`;

    return (
      <NodeTooltipShell
        {...floatingShell}
        containerStyle={unifiedNodeTooltipStyles.notAppearedContainer}
        transition={unifiedNodeAnimations.tooltipSimpleTransition(isDragging)}
        closeButton={(
          <TooltipCloseButton
            onClose={onClose}
            className="tooltip-close-btn--offset"
          />
        )}
      >
        <CenteredStatus fullHeight={false}>
          <div className="tooltip-not-appeared-avatar">
            <PersonSilhouette
              size={40}
              circleFill={COLORS.border}
              bodyFill={COLORS.textSecondary}
            />
          </div>
          <h3 className="tooltip-not-appeared-title">{node?.displayName}</h3>
          <p className="tooltip-not-appeared-msg">아직 등장하지 않은 인물입니다</p>
          <p className="tooltip-not-appeared-hint">{eventHint}</p>
        </CenteredStatus>
      </NodeTooltipShell>
    );
  }

  const nodeHeaderAndDescription = (
    <>
      <div className="node-tooltip-header">
        <NodeProfileAvatar node={node} />
        <div className="node-tooltip-identity">
          <div className="node-tooltip-name-row">
            <span className="node-tooltip-name">{node?.displayName}</span>
            {node?.isMainCharacter && (
              <span className="node-tooltip-badge">주요 인물</span>
            )}
          </div>
          {node?.names?.length > 0 && (
            <div className="node-tooltip-aliases">
              {node.names
                .filter((name) => name !== node.common_name)
                .map((name, i) => (
                  <span key={i} className="relation-tag">{name}</span>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className="business-card-description">
        {node?.description ? (
          <span>{node.description}</span>
        ) : (
          <span className="tooltip-desc-empty">설명 정보가 없습니다.</span>
        )}
      </div>
    </>
  );

  if (!isSidebar) {
    return (
      <NodeTooltipShell
        {...floatingShell}
        containerStyle={unifiedNodeTooltipStyles.tooltipContainer}
        transition={unifiedNodeAnimations.tooltipComplexTransition(isDragging)}
      >
        <div className="tooltip-content business-card">
          <TooltipCloseButton onClose={onClose} />
          {nodeHeaderAndDescription}
        </div>
      </NodeTooltipShell>
    );
  }

  return (
    <div className="graph-sidebar-panel">
      <TooltipCloseButton onClose={onClose} ariaLabel="사이드바 닫기" />

      <div className="graph-sidebar-body">
        {nodeHeaderAndDescription}

        <div
          className={`sidebar-section tooltip-summary-section tooltip-summary-section--${
            isWarning ? 'warning' : isContent ? 'content' : 'collapsed'
          }`}
          role="region"
          aria-label="인물 시점 요약"
        >
          <button
            type="button"
            onClick={() =>
              setSummaryStage((s) =>
                s === SUMMARY.COLLAPSED ? SUMMARY.WARNING : SUMMARY.COLLAPSED
              )
            }
            className="summary-toggle-btn"
          >
            <h4 className="tooltip-section-title">해당 인물 시점의 요약</h4>
            <span
              className={`tooltip-summary-chevron${
                summaryStage !== SUMMARY.COLLAPSED ? ' tooltip-summary-chevron--open' : ''
              }`}
            >
              ▼
            </span>
          </button>

          <div
            className={`tooltip-collapsible tooltip-collapsible--warning${
              isWarning ? ' is-open' : ''
            }`}
          >
            <div className="tooltip-spoiler-body">
              <h3 className={`tooltip-spoiler-title${isWarning ? ' is-fading' : ''}`}>
                스포일러 포함
              </h3>
              <p className={`tooltip-spoiler-text${isWarning ? ' is-fading' : ''}`}>
                스토리의 중요한 내용을 담고 있습니다.
                <br />
                내용을 확인하시겠습니까?
              </p>
              <div className={`tooltip-spoiler-actions${isWarning ? ' is-fading' : ''}`}>
                <ActionButton
                  onClick={() => setSummaryStage(SUMMARY.COLLAPSED)}
                  ariaLabel="접기"
                  title="접기"
                >
                  취소
                </ActionButton>
                <ActionButton
                  variant="primary"
                  onClick={() => setSummaryStage(SUMMARY.CONTENT)}
                  ariaLabel="스포일러 내용 확인하기"
                >
                  확인하고 보기
                </ActionButton>
              </div>
            </div>
          </div>

          <div
            className={`tooltip-collapsible tooltip-collapsible--content${
              isContent ? ' is-open' : ''
            }`}
            aria-hidden={!isContent}
          >
            <div className="tooltip-summary-content">
              <div className="tooltip-summary-quote">
                <p
                  className={`tooltip-summary-text${isContent ? ' is-animated' : ''}${
                    summaryIsError ? ' tooltip-summary-text--error' : ''
                  }`}
                >
                  {summaryText}
                </p>
                {summaryIsError && typeof onRetryPov === 'function' && (
                  <button
                    type="button"
                    className="tooltip-action-btn tooltip-action-btn--secondary"
                    onClick={onRetryPov}
                    style={{ marginTop: 8 }}
                  >
                    다시 시도
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <RelationAnalysisCta
          node={node}
          connectionCount={radarChartData.length}
          onOpen={openModal}
          buttonRef={analysisBtnRef}
        />
      </div>

      {analysisModal}
    </div>
  );
}

export default memo(UnifiedNodeInfo);

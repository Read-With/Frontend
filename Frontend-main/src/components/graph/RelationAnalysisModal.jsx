import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  GRAPH_LAYOUT_CONSTANTS,
} from "../../utils/graph/graphCore";
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
import './RelationGraph.css';

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
      style={{ '--dot-color': color, '--dot-size': '0.7rem', '--name-font-size': fontSize }}
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
        style={{ cursor: 'pointer', pointerEvents: 'all', outline: 'none' }}
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
        const { color, label, percent } = positivityDisplay(item.positivity);
        return (
          <li key={item.id || item.name}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              className={`relation-modal-list-item${active ? ' is-active' : ''}`}
              style={{ '--item-pos-color': color }}
              onClick={() => onSelect(item)}
            >
              <div className="relation-modal-list-item-head">
                <NameWithDot name={item.name} positivity={item.positivity} fontSize="1.15rem" />
                <div
                  className="relation-modal-list-pos"
                  style={{ '--pos-color': color }}
                  aria-label={`긍정성 ${label} ${percent}%`}
                >
                  <span className="relation-modal-list-pos-label">{label}</span>
                  <span className="relation-modal-list-pos-value">{percent}%</span>
                </div>
              </div>
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
        <span>−100%</span>
        <span>0%</span>
        <span>+100%</span>
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
  currentChapter,
  chapterScopeLabel = null,
  radarChartData = [],
  connectionKind,
  recommendedNodes = [],
  onClose,
  onSelectRelatedNode,
  returnFocusRef,
  chapterRailWidth = GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH,
  /** 슬라이드바(툴팁 패널)가 열려 있을 때 오른쪽 예약 너비 */
  reserveRight = 0,
}) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const activeNameRef = useRef(null);
  const switchTargetsRef = useRef(radarChartData);
  const [activeName, setActiveName] = useState(null);

  const overlayStyle = useMemo(() => {
    const inset = GRAPH_LAYOUT_CONSTANTS.ANALYSIS_MODAL_INSET;
    const top = GRAPH_LAYOUT_CONSTANTS.PAGE_CHROME_OFFSET;
    const left = Math.max(0, Number(chapterRailWidth) || 0) + inset;
    const right = Math.max(0, Number(reserveRight) || 0) + inset;
    return {
      '--relation-modal-top': `${top}px`,
      '--relation-modal-left': `${left}px`,
      '--relation-modal-right': `${right}px`,
      '--relation-modal-inset': `${inset}px`,
    };
  }, [chapterRailWidth, reserveRight]);

  const dataMap = useMemo(() => {
    const map = new Map();
    radarChartData.forEach((item) => map.set(item.name, item));
    return map;
  }, [radarChartData]);

  const activeItem = activeName ? dataMap.get(activeName) : null;

  const activeIndex = radarChartData.findIndex((item) => item.name === activeName);
  switchTargetsRef.current = radarChartData;
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
    if (!radarChartData.length) return;
    const base = activeIndex >= 0 ? activeIndex : 0;
    const next = (base + direction + radarChartData.length) % radarChartData.length;
    switchToRelated(radarChartData[next]);
  }, [radarChartData, activeIndex, switchToRelated]);

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
    if (value === 0) return '−100%';
    if (value === 50) return '0%';
    if (value === 100) return '+100%';
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
    connectionKind === 'no_connections' ? 'is-empty' : '',
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
              {(chapterScopeLabel || currentChapter != null) && (
                <span className="relation-modal-chip">
                  {chapterScopeLabel || `챕터 ${currentChapter}`}
                </span>
              )}
              <span className="relation-modal-chip">연결 {radarChartData.length}명</span>
            </div>
          </div>
          <div className="relation-modal-header-actions">
            {onSelectRelatedNode && radarChartData.length > 1 && (
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
              <span>부정 (−100%)</span>
              <span className="relation-modal-legend-gradient" />
              <span>긍정 (+100%)</span>
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

export default RelationAnalysisModal;

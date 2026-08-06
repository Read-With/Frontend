import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import {
  GRAPH_LAYOUT_CONSTANTS,
  RELATION_CONNECTION_KIND,
} from "../../utils/graph/graphCore";
import {Radar,RadarChart,PolarGrid,PolarAngleAxis,PolarRadiusAxis,ResponsiveContainer,} from 'recharts';
import { getPositivityDisplay, clampPositivity, getPositivityGradientCss, GRAPH_COLORS, brandAlpha } from '../../utils/styles/graphStyles.js';
import { truncateWithEllipsis, cycleIndex } from '../../utils/common/valueUtils.js';
import { joinClasses } from '../../utils/styles/styles.js';
import { NodeProfileAvatar } from './GraphControls';
import './RelationGraph.css';

const NAME_LABEL_MAX = 11; // truncate 시 10자 + …
const RADAR_GRID = brandAlpha(0.22);
const RADAR_AXIS_TICK = '#6f7f6f';
const RADAR_FILL = brandAlpha(0.14);
const RADAR_RADIUS_TICK_LABELS = {
  0: '−100%',
  50: '0%',
  100: '+100%',
};

const CONNECTION = RELATION_CONNECTION_KIND;
const POSITIVITY_GRADIENT = getPositivityGradientCss();

const SIBLING_NAV = [
  { dir: -1, label: '이전 연결 인물로 분석 전환', text: '‹' },
  { dir: 1, label: '다음 연결 인물로 분석 전환', text: '›' },
];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  const { color, label, percent } = getPositivityDisplay(positivity);
  return (
    <div className="tooltip-positivity-chip" style={{ '--pos-color': color }}>
      <span className="tooltip-positivity-label">{label}</span>
      <div className="tooltip-positivity-percent">{percent}%</div>
    </div>
  );
}

function NameWithDot({ name, positivity, fontSize = '1rem' }) {
  const { color } = getPositivityDisplay(positivity);
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

  const { color } = getPositivityDisplay(fullData.positivity);
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
          stroke={GRAPH_COLORS.primary}
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

function SwitchAnalysisButton({ item, onSwitch }) {
  if (!item || !onSwitch) return null;
  return (
    <button
      type="button"
      className="relation-modal-action-btn relation-modal-action-btn--secondary relation-modal-switch-inline"
      onClick={(e) => {
        e.stopPropagation();
        onSwitch(item);
      }}
    >
      이 인물로 분석 전환
    </button>
  );
}

function RelationList({
  items,
  activeName,
  onSelect,
  onSwitch,
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
        const { color, label, percent } = getPositivityDisplay(item.positivity);
        return (
          <li
            key={item.id || item.name}
            className={`relation-modal-list-item${active ? ' is-active' : ''}`}
            style={{ '--item-pos-color': color }}
            role="option"
            aria-selected={active}
          >
            <button
              type="button"
              className="relation-modal-list-item-main"
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
            {active ? <SwitchAnalysisButton item={item} onSwitch={onSwitch} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** −1~+1 긍정성 미니 스케일 (연결 적을 때 레이더 대체) */
function PositivityScaleBar({ positivity }) {
  const value = Number.isFinite(Number(positivity)) ? Number(positivity) : 0;
  const clamped = clampPositivity(value);
  const pct = ((clamped + 1) / 2) * 100;
  const { color, label } = getPositivityDisplay(clamped);

  return (
    <div
      className="relation-positivity-scale"
      role="img"
      aria-label={`긍정성 ${label} (${clamped.toFixed(2)})`}
    >
      <div
        className="relation-positivity-scale-track"
        style={{ background: POSITIVITY_GRADIENT }}
      >
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

function RelationCard({ item, active, onSelect, onSwitch, sourceName }) {
  if (!item) return null;

  return (
    <div
      className={`relation-card${active ? ' is-active' : ''}`}
      role="option"
      aria-selected={active}
    >
      <button
        type="button"
        className="relation-card-main"
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
      {active ? <SwitchAnalysisButton item={item} onSwitch={onSwitch} /> : null}
    </div>
  );
}

function FewConnectionsPanel({
  items,
  activeName,
  onSelect,
  onSwitch,
  sourceName,
  connectionKind,
}) {
  const isPair = connectionKind === CONNECTION.PAIR;
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
            onSwitch={onSwitch}
            sourceName={sourceName}
          />
        ))}
      </div>
    </div>
  );
}

function RelationAnalysisModalImpl({
  node,
  radarChartData = [],
  connectionKind,
  loadError = null,
  onClose,
  onSelectRelatedNode,
  returnFocusRef,
  chapterRailWidth = GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH,
  /**
   * 슬라이드바(툴팁 패널)가 열려 있을 때 오른쪽 예약 너비.
   * 연결이 충분해 레이더를 쓸 때는 0으로 두어 슬라이드바 영역까지 펼침.
   */
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
    // sufficient_connections: 노드 슬라이드바까지 덮어 레이더 영역을 최대화
    const rightPad =
      connectionKind === CONNECTION.SUFFICIENT
        ? 0
        : Math.max(0, Number(reserveRight) || 0);
    const right = rightPad + inset;
    return {
      '--relation-modal-top': `${top}px`,
      '--relation-modal-left': `${left}px`,
      '--relation-modal-right': `${right}px`,
      '--relation-modal-inset': `${inset}px`,
    };
  }, [chapterRailWidth, reserveRight, connectionKind]);

  const dataMap = useMemo(() => {
    const map = new Map();
    radarChartData.forEach((item) => map.set(item.name, item));
    return map;
  }, [radarChartData]);

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
      [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
      );

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
        setActiveName(targets[cycleIndex(idx, targets.length, 1)].name);
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && targets.length) {
        e.preventDefault();
        setActiveName(targets[cycleIndex(idx, targets.length, -1)].name);
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
    switchToRelated(radarChartData[cycleIndex(activeIndex, radarChartData.length, direction)]);
  }, [radarChartData, activeIndex, switchToRelated]);

  const renderPolarAngleAxis = ({ payload, x: tickX, y: tickY, cx, cy }) => {
    const point = dataMap.get(payload.value);
    const color = point?.positivity !== undefined
      ? getPositivityDisplay(point.positivity).color
      : RADAR_AXIS_TICK;
    const active = activeName === payload.value;
    const dx = tickX - cx;
    const dy = tickY - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const raw = payload.value || '';
    const label = truncateWithEllipsis(raw, NAME_LABEL_MAX);
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

  const formatRadarRadiusTick = (value) => RADAR_RADIUS_TICK_LABELS[value] ?? '';

  const chartPanel = connectionKind === CONNECTION.SUFFICIENT ? (
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
            stroke={GRAPH_COLORS.primary}
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
    connectionKind === CONNECTION.SINGLE || connectionKind === CONNECTION.PAIR;
  const isEmptyKind =
    connectionKind === CONNECTION.NONE || connectionKind === CONNECTION.ERROR;
  const isCompactModal = isCardView || isEmptyKind;

  let bodyPanel = null;
  if (connectionKind === CONNECTION.ERROR) {
    bodyPanel = (
      <div className="relation-modal-empty-message is-error" role="alert">
        <p>
          {loadError || '관계 분석 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
        </p>
      </div>
    );
  } else if (isCardView) {
    bodyPanel = (
      <FewConnectionsPanel
        items={radarChartData}
        activeName={activeName}
        onSelect={activateItem}
        onSwitch={onSelectRelatedNode ? switchToRelated : null}
        sourceName={node?.displayName}
        connectionKind={connectionKind}
      />
    );
  } else if (connectionKind === CONNECTION.NONE) {
    bodyPanel = (
      <div className="relation-modal-empty-message" role="status">
        <p>
          이 챕터 범위에서 연결된 인물이 없습니다. 다른 챕터를 선택해 보세요.
        </p>
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
          onSwitch={onSelectRelatedNode ? switchToRelated : null}
        />
      </div>
    );
  }

  const titleId = 'relation-analysis-modal-title';
  const bodyClassName = joinClasses(
    'tooltip-modal-body',
    'relation-modal-body',
    connectionKind === CONNECTION.SUFFICIENT && 'has-chart',
    isCardView && 'is-card-view',
    isEmptyKind && 'is-empty-view',
  );

  const containerClassName = joinClasses(
    'modal-container',
    'relation-modal-container',
    isCompactModal && 'relation-modal-container--compact',
    connectionKind === CONNECTION.PAIR && 'is-pair',
    connectionKind === CONNECTION.SINGLE && 'is-single',
    isEmptyKind && 'is-empty',
  );

  return (
    <div
      className={joinClasses(
        'modal-overlay',
        'relation-modal-overlay--graph-page',
        isCompactModal && 'is-compact',
      )}
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
            <NodeProfileAvatar
              node={node}
              size={40}
              className="relation-modal-avatar"
              innerClassName={null}
              style={{ width: 40, height: 40 }}
            />
            <div className="relation-modal-header-copy">
              <h2 id={titleId} className="tooltip-modal-title">
                {node?.displayName || '인물'} 관계 분석
              </h2>
              {connectionKind === CONNECTION.ERROR ? (
                <span className="relation-modal-chip relation-modal-chip--error">로드 실패</span>
              ) : (
                <span className="relation-modal-chip">연결 {radarChartData.length}명</span>
              )}
            </div>
          </div>
          <div className="relation-modal-header-actions">
            {onSelectRelatedNode && radarChartData.length > 1 && (
              <div className="relation-modal-switcher">
                {SIBLING_NAV.map(({ dir, label, text }) => (
                  <button
                    key={label}
                    type="button"
                    className="relation-modal-nav-btn"
                    aria-label={label}
                    onClick={() => goSibling(dir)}
                  >
                    {text}
                  </button>
                ))}
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

        {connectionKind === CONNECTION.SUFFICIENT ? (
          <div className="relation-modal-legend" aria-hidden="false">
            <span className="relation-modal-legend-label">긍정성</span>
            <div className="relation-modal-legend-bar">
              <span>부정 (−100%)</span>
              <span
                className="relation-modal-legend-gradient"
                style={{ background: POSITIVITY_GRADIENT }}
              />
              <span>긍정 (+100%)</span>
            </div>
          </div>
        ) : null}

        <div className={bodyClassName}>
          {chartPanel}
          {bodyPanel}
        </div>
      </div>
    </div>
  );
}

RelationAnalysisModalImpl.propTypes = {
  node: PropTypes.object,
  radarChartData: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      positivity: PropTypes.number,
      normalizedValue: PropTypes.number,
      relationTags: PropTypes.arrayOf(PropTypes.string),
    }),
  ),
  connectionKind: PropTypes.oneOf(Object.values(RELATION_CONNECTION_KIND)),
  loadError: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onSelectRelatedNode: PropTypes.func,
  returnFocusRef: PropTypes.shape({ current: PropTypes.any }),
  chapterRailWidth: PropTypes.number,
  reserveRight: PropTypes.number,
};

const RelationAnalysisModal = memo(RelationAnalysisModalImpl);

export default RelationAnalysisModal;

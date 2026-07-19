import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { getPositivityColor, getPositivityLabel } from '../../../utils/styles/relationStyles.js';
import { COLORS } from '../../../utils/styles/styles.js';

const NAME_LABEL_MAX = 6;

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
  const radius = isActive ? 8 : 5;

  const activate = (e) => {
    e.stopPropagation();
    onActivate?.(fullData, e);
  };

  return (
    <g>
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
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke={isActive ? '#fff' : 'none'}
        strokeWidth={isActive ? 2 : 0}
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

function SelectedDetail({ item, onFocusOnGraph, canFocusGraph }) {
  if (!item) {
    return (
      <div className="relation-modal-detail relation-modal-detail--empty">
        차트 점이나 목록에서 인물을 선택하면 관계 상세를 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="relation-modal-detail">
      <NameWithDot name={item.name} positivity={item.positivity} fontSize="1.15rem" />
      <PositivityChip positivity={item.positivity} />
      <RelationTagsRow tags={item.relationTags} />
      {canFocusGraph && (
        <button
          type="button"
          className="relation-modal-action-btn"
          onClick={() => onFocusOnGraph(item)}
        >
          그래프에서 이 인물 보기
        </button>
      )}
    </div>
  );
}

function PersonAvatar({ node, size = 40 }) {
  const hasImage = !!node?.hasImage && node?.image;
  return (
    <div className="relation-modal-avatar" style={{ width: size, height: size }}>
      {hasImage ? (
        <img src={node.image} alt="" crossOrigin="anonymous" />
      ) : (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={size / 2} fill="#e5e7eb" />
          <ellipse cx={size / 2} cy={size * 0.375} rx={size * 0.21} ry={size * 0.21} fill="#bdbdbd" />
          <ellipse cx={size / 2} cy={size * 0.79} rx={size * 0.29} ry={size * 0.17} fill="#bdbdbd" />
        </svg>
      )}
    </div>
  );
}

function RelationAnalysisModal({
  node,
  chapterNum,
  chapterScopeLabel = null,
  radarChartData = [],
  connectionKind,
  recommendedNodes = [],
  onClose,
  onSelectRelatedNode,
  onOpenChapterSidebar,
  returnFocusRef,
}) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const activeNameRef = useRef(null);
  const switchTargetsRef = useRef(radarChartData);
  const [activeName, setActiveName] = useState(null);

  const dataMap = useMemo(() => {
    const map = new Map();
    radarChartData.forEach((item) => map.set(item.name, item));
    return map;
  }, [radarChartData]);

  const activeItem = activeName ? dataMap.get(activeName) : null;
  const connectionCount = radarChartData.length;

  const avgPositivity = useMemo(() => {
    if (!radarChartData.length) return 0;
    return radarChartData.reduce((sum, item) => sum + (item.positivity || 0), 0) / radarChartData.length;
  }, [radarChartData]);

  const radarStroke = useMemo(() => {
    const { color } = positivityDisplay(avgPositivity);
    return color;
  }, [avgPositivity]);

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

  const focusOnGraph = useCallback((item) => {
    if (!item || !onSelectRelatedNode) return;
    const ok = onSelectRelatedNode(item.id || item.name, { keepAnalysisOpen: false });
    if (ok !== false) onClose();
  }, [onSelectRelatedNode, onClose]);

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
      : COLORS.textPrimary;
    const active = activeName === payload.value;
    const dx = tickX - cx;
    const dy = tickY - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const raw = payload.value || '';
    const label = truncateLabel(raw);
    const scale = (distance + Math.max(36, 22 + (label.length * 2))) / distance;

    return (
      <text
        x={cx + dx * scale}
        y={cy + dy * scale}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={active ? color : COLORS.textPrimary}
        fontSize={active ? 15 : 13}
        fontWeight={active ? 700 : 600}
        style={{ cursor: point ? 'pointer' : 'default' }}
        onClick={() => point && activateItem(point)}
      >
        <title>{raw}</title>
        {label}
      </text>
    );
  };

  const chartPanel = connectionKind === 'sufficient_connections' ? (
    <div className="relation-modal-chart" role="img" aria-label={`${node?.displayName} 관계 레이더 차트`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={radarChartData}
          margin={{ top: 48, right: 48, bottom: 48, left: 48 }}
          style={{ outline: 'none' }}
        >
          <PolarGrid stroke={COLORS.border} />
          <PolarAngleAxis dataKey="name" tick={renderPolarAngleAxis} />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: COLORS.textSecondary, fontWeight: 600 }}
            tickCount={5}
            tickFormatter={(v) => (((v / 100) * 2) - 1).toFixed(1)}
          />
          <Radar
            name={node?.displayName}
            dataKey="normalizedValue"
            stroke={radarStroke}
            fill={radarStroke}
            fillOpacity={0.18}
            strokeWidth={2}
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

  const listPanel = (
    <div className="relation-modal-side">
      <div className="relation-modal-side-title">
        {connectionKind === 'no_connections' ? '추천 인물' : '연결된 인물'}
      </div>
      {connectionKind === 'few_connections' && (
        <p className="relation-modal-side-hint">
          연결이 적어 레이더보다 목록으로 보는 편이 더 정확합니다.
        </p>
      )}
      {connectionKind === 'no_connections' && (
        <p className="relation-modal-side-hint">
          이 챕터 범위에서 연결된 인물이 없습니다. 다른 챕터를 보거나 아래 추천 인물을 확인해 보세요.
        </p>
      )}
      <RelationList
        items={connectionKind === 'no_connections' ? recommendedNodes : radarChartData}
        activeName={activeName}
        onSelect={(item) => {
          if (connectionKind === 'no_connections') {
            switchToRelated(item);
            return;
          }
          activateItem(item);
        }}
        emptyMessage={connectionKind === 'no_connections' ? '추천할 인물이 없습니다.' : null}
      />
      <SelectedDetail
        item={connectionKind === 'no_connections' ? null : activeItem}
        onFocusOnGraph={focusOnGraph}
        canFocusGraph={!!onSelectRelatedNode && connectionKind !== 'no_connections'}
      />
      <div className="relation-modal-cta-row">
        {onOpenChapterSidebar && (
          <button
            type="button"
            className="relation-modal-action-btn relation-modal-action-btn--secondary"
            onClick={() => {
              onOpenChapterSidebar();
              onClose();
            }}
          >
            챕터 선택 열기
          </button>
        )}
        {activeItem && onSelectRelatedNode && connectionKind !== 'no_connections' && (
          <button
            type="button"
            className="relation-modal-action-btn relation-modal-action-btn--secondary"
            onClick={() => switchToRelated(activeItem)}
          >
            이 인물로 분석 전환
          </button>
        )}
      </div>
    </div>
  );

  const titleId = 'relation-analysis-modal-title';

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="modal-container relation-modal-container"
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
              <div className="relation-modal-meta">
                {(chapterScopeLabel || chapterNum != null) && (
                  <span className="relation-modal-chip">
                    {chapterScopeLabel || `챕터 ${chapterNum}`}
                  </span>
                )}
                <span className="relation-modal-chip">연결 {connectionCount}명</span>
              </div>
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

        <div className="relation-modal-legend" aria-hidden="false">
          <span className="relation-modal-legend-label">긍정성</span>
          <div className="relation-modal-legend-bar">
            <span>부정 (−1)</span>
            <span className="relation-modal-legend-gradient" />
            <span>긍정 (+1)</span>
          </div>
        </div>

        <div className={`tooltip-modal-body relation-modal-body${connectionKind === 'sufficient_connections' ? ' has-chart' : ''}`}>
          {chartPanel}
          {listPanel}
        </div>
      </div>
    </div>
  );
}

export default memo(RelationAnalysisModal);

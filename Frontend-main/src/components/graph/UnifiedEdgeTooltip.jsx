import { memo, useState, useEffect, useMemo } from "react";
import {ResponsiveContainer, LineChart, CartesianGrid, ReferenceLine, Tooltip as RechartsTooltip, Line, XAxis, YAxis,} from "recharts";
import { useParams } from "react-router-dom";
import { useFloatingTooltip } from "../../hooks/ui/tooltipHooks";
import { useRelationData } from "../../hooks/graph/useApiGraphData";
import { getPositivityDisplay, getRelationColor, GRAPH_COLORS } from "../../utils/styles/graphStyles";
import { ANIMATION_VALUES, mergeRefs } from "../../utils/styles/styles";
import { clampPositivity, toNumberOrNull, toPositiveNumberOrNull } from "../../utils/common/valueUtils";
import { buildRelationTagDisplayItems } from "../../utils/graph/graphCore";
import {
  isLongEdgeTimeline,
  getSparseEdgeTickValues,
  buildEdgeRechartsLineData,
} from "../../utils/graph/graphCy";
import { TooltipCloseButton } from './GraphControls';

const NO_RELATION_MESSAGE = '이 위치에서는 표시할 관계가 없습니다.';

const VIEW_TABS = [
  { id: 'info', label: '요약' },
  { id: 'chart', label: '변화' },
];

const TAG_TONE_TITLE = {
  added: '이 위치에서 처음 추가된 관계',
  changed: '이 위치에서 갱신된 관계',
  prior: '이전에 추가된 관계',
};

function EndpointAvatar({ endpoint }) {
  const label = endpoint?.label || '?';
  if (endpoint?.image) {
    return (
      <img
        className="edge-tooltip-endpoint-avatar"
        src={endpoint.image}
        alt={label}
        crossOrigin="anonymous"
        decoding="async"
        loading="eager"
      />
    );
  }
  return (
    <div className="edge-tooltip-endpoint-avatar" aria-hidden>
      {label.charAt(0)}
    </div>
  );
}

/** positivity: 비어 있거나 숫자가 아니면 null, 아니면 −1~+1 */
function parseEdgePositivity(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? clampPositivity(n) : null;
}

/** "주요 문장|보충 설명" 형식 */
function parseExplanation(explanation) {
  if (typeof explanation !== 'string' || !explanation) {
    return { hasExplanation: false, primary: null, secondary: null };
  }
  const [primary, secondary] = explanation.split('|');
  return { hasExplanation: true, primary: primary ?? '', secondary: secondary || null };
}

function chartXAxisBounds(length) {
  if (length === 0) return { min: 1, max: 1 };
  if (length === 1) return { min: 0.5, max: 1.5 };
  return { min: 1, max: length };
}

function formatPositivityTooltip(value, item, lineData) {
  if (value == null || typeof value !== 'number') {
    return ['관계 없음', '긍정도'];
  }
  const pct = `${Math.round(Number(value) * 100)}%`;
  const idx = item?.payload?.x;
  const prev = Number.isFinite(idx) && idx > 1 ? lineData[idx - 2]?.y : null;
  if (typeof prev === 'number') {
    const d = Math.round((Number(value) - prev) * 100);
    const sign = d > 0 ? '+' : '';
    return [`${pct} (${sign}${d}%p)`, '긍정도'];
  }
  return [pct, '긍정도'];
}

function RelationTimelineChart({ lineData, numericPointCount, heightPx, isSidebar, color }) {
  const xAxisBounds = useMemo(() => chartXAxisBounds(lineData.length), [lineData]);
  const sparseTicks = useMemo(
    () => getSparseEdgeTickValues(lineData, { maxTicks: isSidebar ? 7 : 5 }),
    [lineData, isSidebar],
  );
  const visibleXLabelMap = useMemo(() => {
    const map = {};
    lineData.forEach((d) => {
      map[d.x] = d.label;
    });
    return map;
  }, [lineData]);
  const currentRefX = useMemo(() => lineData.find((d) => d.isCurrent)?.x ?? null, [lineData]);

  if (numericPointCount === 0) return null;
  if (numericPointCount === 1) {
    const only = lineData.find((d) => typeof d.y === 'number');
    return (
      <div className="edge-chart-empty">
        <p className="edge-chart-empty-title">아직 누적 변화가 없습니다</p>
        <p className="edge-chart-empty-value">
          현재 {Math.round((only?.y ?? 0) * 100)}%
        </p>
      </div>
    );
  }

  const longTimeline = isLongEdgeTimeline(lineData.length);
  const showDenseDots = lineData.length <= 6;
  const xTickFontSize = isSidebar ? (longTimeline ? 12 : 13) : (longTimeline ? 10 : 11);

  const renderDot = ({ cx, cy, payload, index }) => {
    if (cx == null || cy == null || payload?.y == null) return null;
    const isCurrent = payload?.isCurrent;
    const show = showDenseDots || isCurrent || payload?.isSignificant || payload?.isChapter;
    if (!show) {
      return (
        <circle
          key={`relation-timeline-dot-hidden-${index}`}
          cx={cx}
          cy={cy}
          r={0}
          fill="transparent"
        />
      );
    }
    const fill = payload?.isChapter ? '#9ca3af' : color;
    return (
      <circle
        key={`relation-timeline-dot-${index ?? `${cx}-${cy}`}`}
        cx={cx}
        cy={cy}
        r={isCurrent ? 6 : longTimeline ? 2.5 : 3.5}
        fill={fill}
        stroke={isCurrent ? GRAPH_COLORS.white : fill}
        strokeWidth={isCurrent ? 2 : 0}
      />
    );
  };

  return (
    <div className="edge-chart-plot">
      <ResponsiveContainer width="100%" height={Math.max(120, heightPx)}>
        <LineChart data={lineData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[xAxisBounds.min, xAxisBounds.max]}
            ticks={sparseTicks}
            tickFormatter={(v) => visibleXLabelMap[Math.round(v)] ?? ''}
            tick={{ fontSize: xTickFontSize, fill: '#6b7280', fontWeight: 700 }}
            axisLine={{ stroke: GRAPH_COLORS.border }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            domain={[-1, 1]}
            width={isSidebar ? 44 : 40}
            tick={{ fontSize: isSidebar ? 12 : 11, fill: '#6b7280', fontWeight: 700 }}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
            axisLine={false}
            tickLine={false}
            ticks={[-1, 0, 1]}
          />
          <RechartsTooltip
            formatter={(value, _name, item) => formatPositivityTooltip(value, item, lineData)}
            labelFormatter={(_l, payload) => payload?.[0]?.payload?.label ?? ''}
          />
          {currentRefX != null && (
            <ReferenceLine x={currentRefX} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
          )}
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={longTimeline ? 1.5 : 2}
            dot={renderDot}
            activeDot={{ r: 5, fill: color }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EdgeEndpoints({ data, sourceEndpoint, targetEndpoint }) {
  return (
    <div className="edge-tooltip-endpoints">
      <div className="edge-tooltip-endpoint">
        <EndpointAvatar endpoint={sourceEndpoint} />
        <span className="edge-tooltip-endpoint-name">
          {sourceEndpoint?.label || data?.source || '—'}
        </span>
      </div>
      <span className="edge-tooltip-endpoint-arrow" aria-hidden>→</span>
      <div className="edge-tooltip-endpoint">
        <EndpointAvatar endpoint={targetEndpoint} />
        <span className="edge-tooltip-endpoint-name">
          {targetEndpoint?.label || data?.target || '—'}
        </span>
      </div>
    </div>
  );
}

function EdgeViewTabs({ viewMode, onChange }) {
  return (
    <div className="edge-tooltip-tabs" role="tablist">
      {VIEW_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={viewMode === id}
          className={`edge-tooltip-tab${viewMode === id ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
      <span
        className={`edge-tooltip-tab-indicator${viewMode === 'chart' ? ' chart' : ''}`}
        aria-hidden
      />
    </div>
  );
}

function EdgeStatusMessage({ message, error = false, action = null }) {
  return (
    <div className={`edge-tooltip-status${error ? ' edge-tooltip-status--error' : ' edge-tooltip-status--muted'}`}>
      <span>{message}</span>
      {action}
    </div>
  );
}

function EdgeSkeleton({ message }) {
  return (
    <div className="edge-tooltip-status">
      <span>{message}</span>
      <div className="edge-tooltip-skeleton">
        <div className="edge-tooltip-skeleton-line" />
        <div className="edge-tooltip-skeleton-line short" />
        <div className="edge-tooltip-skeleton-line" />
      </div>
    </div>
  );
}

function RetryButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="edge-tooltip-retry-btn">
      다시 시도
    </button>
  );
}

function EdgeInfoView({ showNoRelation, tagItems, positivityDisplay, positivityPercentage, explanation }) {
  if (showNoRelation) return <EdgeStatusMessage message={NO_RELATION_MESSAGE} />;

  return (
    <>
      {tagItems.length > 0 && (
        <div className="relation-tags">
          {tagItems.map((item, index) => (
            <span
              key={`${item.text}-${index}`}
              className={`relation-tag relation-tag--${item.tone}`}
              style={{ '--tag-color': getRelationColor(item.positivity) }}
              title={TAG_TONE_TITLE[item.tone] || TAG_TONE_TITLE.prior}
            >
              {item.text}
            </span>
          ))}
        </div>
      )}
      <div className="relation-weight">
        <div className="weight-header">
          <span className="weight-label">{positivityDisplay.label}</span>
          <span className="weight-value">
            {positivityPercentage != null ? `${positivityPercentage}%` : '—'}
          </span>
        </div>
        {positivityPercentage != null && (
          <div className="positivity-track">
            <div className="positivity-fill" />
          </div>
        )}
      </div>
      {explanation.hasExplanation && (
        <div className="edge-tooltip-body">
          <div className="relation-explanation">
            <div className="quote-box">
              <strong>{explanation.primary}</strong>
            </div>
            {explanation.secondary && (
              <p className="explanation-text">{explanation.secondary}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function incompleteHintText(incomplete, usedProbe) {
  if (!incomplete) {
    return '챕터 구조 정보가 없어 이벤트 범위를 추정했습니다. 결과가 부정확할 수 있습니다.';
  }
  return `일부 이벤트를 불러오지 못했습니다.${usedProbe ? ' 이벤트 범위는 추정값입니다.' : ''}`;
}

function EdgeChartPanel({ relation, chart, title, missingEvent, heightPx, isSidebar, color }) {
  if (relation.loading) return <EdgeSkeleton message="데이터를 불러오는 중..." />;
  if (missingEvent) {
    return <EdgeStatusMessage message="이벤트 정보가 없어 관계 변화를 표시할 수 없습니다." />;
  }
  // 로드 실패는 단점 합성보다 항상 우선
  if (relation.error) {
    return (
      <EdgeStatusMessage
        message="데이터를 불러올 수 없습니다"
        error
        action={<RetryButton onClick={relation.fetchData} />}
      />
    );
  }
  if (!chart.hasChartData) return <EdgeStatusMessage message={NO_RELATION_MESSAGE} />;

  return (
    <div className="edge-chart-panel">
      <div className="edge-chart-title">{title}</div>
      {(relation.incomplete || relation.usedProbe) && (
        <p className="edge-chart-incomplete-hint">
          {incompleteHintText(relation.incomplete, relation.usedProbe)}
          {' '}
          <RetryButton onClick={relation.fetchData} />
        </p>
      )}
      <RelationTimelineChart
        lineData={chart.rechartsLineData}
        numericPointCount={chart.numericPointCount}
        heightPx={heightPx}
        isSidebar={isSidebar}
        color={color}
      />
    </div>
  );
}

function UnifiedEdgeTooltip({
  data,
  x,
  y,
  onClose,
  variant = 'graphPage',
  currentChapter = 1,
  eventNum = 1,
  bookId = null,
  sourceEndpoint = null,
  targetEndpoint = null,
  tooltipBoundsRef = null,
}) {
  const { filename } = useParams();
  const isSidebar = variant === 'graphPage';
  const isViewer = variant === 'viewer';
  const edge = data ?? {};

  const { position, showContent, isDragging, tooltipRef, handleMouseDown, clickOutsideRef } =
    useFloatingTooltip(x, y, {
      enabled: !isSidebar,
      center: edge.edgeCenter,
      boundsRef: tooltipBoundsRef,
      onClose,
    });

  const [viewMode, setViewMode] = useState("info");

  useEffect(() => {
    setViewMode("info");
  }, [edge.id, edge.source, edge.target]);

  const displayEventNum = toPositiveNumberOrNull(eventNum) ?? 0;
  const numericBookId = useMemo(
    () => toPositiveNumberOrNull(bookId) ?? toPositiveNumberOrNull(filename),
    [bookId, filename],
  );

  const relation = useRelationData(
    isViewer ? 'viewer' : 'cumulative',
    toNumberOrNull(edge.source),
    toNumberOrNull(edge.target),
    currentChapter,
    displayEventNum,
    numericBookId,
  );

  const edgePositivity = useMemo(() => parseEdgePositivity(edge.positivity), [edge.positivity]);

  const relationTagItems = useMemo(
    () =>
      buildRelationTagDisplayItems({
        relation: edge.relation,
        label: edge.label,
        labelHistory: edge.labelHistory,
        latestLabels: edge.latestLabels,
        currentEventId: edge.snapshotEventId ?? edge.latestEventId ?? null,
        fallbackPositivity: edgePositivity,
      }),
    [
      edge.relation,
      edge.label,
      edge.labelHistory,
      edge.latestLabels,
      edge.snapshotEventId,
      edge.latestEventId,
      edgePositivity,
    ]
  );

  const explanation = useMemo(() => parseExplanation(edge.explanation), [edge.explanation]);

  // 뷰어는 현재 이벤트까지만 열 표시
  const effectiveEventColumns = isViewer && displayEventNum > 0 ? displayEventNum : Number.POSITIVE_INFINITY;

  const chart = useMemo(
    () =>
      buildEdgeRechartsLineData({
        timeline: relation.timeline,
        labels: relation.labels,
        edgePositivity,
        displayEventNum,
        isViewer,
        effectiveEventColumns,
        relationError: relation.error,
      }),
    [
      relation.timeline,
      relation.labels,
      edgePositivity,
      displayEventNum,
      isViewer,
      effectiveEventColumns,
      relation.error,
    ],
  );

  const hasCurrentEdgeRelationData =
    relationTagItems.length > 0 ||
    edgePositivity != null ||
    (typeof edge.explanation === 'string' && edge.explanation.trim().length > 0);
  const effectiveNoRelation =
    relation.noRelation && !hasCurrentEdgeRelationData && !chart.hasChartData && !relation.error;

  const positivityDisplay = getPositivityDisplay(edgePositivity);
  const positivityPercentage = edgePositivity != null ? positivityDisplay.percent : null;
  const positivityBarWidth =
    positivityPercentage != null ? Math.min(100, Math.abs(positivityPercentage)) : 0;

  const infoView = (
    <EdgeInfoView
      showNoRelation={isViewer && effectiveNoRelation}
      tagItems={relationTagItems}
      positivityDisplay={positivityDisplay}
      positivityPercentage={positivityPercentage}
      explanation={explanation}
    />
  );
  const renderChartPanel = (heightPx) => (
    <EdgeChartPanel
      relation={relation}
      chart={chart}
      title={isViewer ? `챕터 ${currentChapter} 관계 변화` : `챕터 ${currentChapter}까지의 누적 관계 변화`}
      missingEvent={isViewer && displayEventNum <= 0}
      heightPx={heightPx}
      isSidebar={isSidebar}
      color={positivityDisplay.color}
    />
  );

  const tooltipInner = (
    <>
      <TooltipCloseButton onClose={onClose} ariaLabel={isSidebar ? '사이드바 닫기' : undefined} />
      <div
        className={`edge-tooltip-content edge-tooltip-themed${isSidebar ? ' edge-tooltip-content--sidebar' : ''}`}
        style={{ '--rel-color': positivityDisplay.color, '--pos-width': `${positivityBarWidth}%` }}
      >
        <div className="edge-tooltip-header">
          <EdgeEndpoints data={data} sourceEndpoint={sourceEndpoint} targetEndpoint={targetEndpoint} />
        </div>
        {!isSidebar && <EdgeViewTabs viewMode={viewMode} onChange={setViewMode} />}
        <div className={`edge-tooltip-panel${isSidebar ? ' edge-tooltip-panel--sidebar' : ''}`}>
          {isSidebar ? (
            <>
              {infoView}
              {renderChartPanel(240)}
            </>
          ) : (
            <div key={viewMode} className="edge-tooltip-panel-swap">
              {viewMode === 'info' ? infoView : renderChartPanel(280)}
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (isSidebar) {
    return (
      <div
        className="graph-sidebar-panel"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        tabIndex={0}
      >
        {tooltipInner}
      </div>
    );
  }

  return (
    <div
      ref={mergeRefs(tooltipRef, clickOutsideRef)}
      className="edge-tooltip-container"
      style={{
        left: position.x,
        top: position.y,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? 'none' : `opacity ${ANIMATION_VALUES.DURATION.NORMAL} ease-in-out`,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
    >
      {tooltipInner}
    </div>
  );
}

export default memo(UnifiedEdgeTooltip, (prevProps, nextProps) => {
  return (
    prevProps.data === nextProps.data &&
    prevProps.x === nextProps.x &&
    prevProps.y === nextProps.y &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.currentChapter === nextProps.currentChapter &&
    prevProps.eventNum === nextProps.eventNum &&
    prevProps.variant === nextProps.variant &&
    prevProps.bookId === nextProps.bookId &&
    prevProps.sourceEndpoint === nextProps.sourceEndpoint &&
    prevProps.targetEndpoint === nextProps.targetEndpoint &&
    prevProps.tooltipBoundsRef === nextProps.tooltipBoundsRef
  );
});

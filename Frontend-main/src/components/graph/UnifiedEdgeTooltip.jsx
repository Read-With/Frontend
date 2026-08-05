import { memo, useState, useEffect, useMemo } from "react";
import {ResponsiveContainer, LineChart, CartesianGrid, ReferenceLine, Tooltip as RechartsTooltip, Line, XAxis, YAxis,} from "recharts";
import { useParams } from "react-router-dom";
import { useTooltipPosition, useClickOutside, useCanvasAvoidPoint } from "../../hooks/ui/tooltipHooks";
import { useRelationData } from "../../hooks/graph/useApiGraphData";
import { getPositivityDisplay, clearStyleCache, clampPositivity, getRelationColor } from "../../utils/styles/graphStyles";
import { COLORS, ANIMATION_VALUES, mergeRefs } from "../../utils/styles/styles";
import { toFiniteNumber, toPositiveNumberOrNull } from "../../utils/common/valueUtils";
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

  const avoidPoint = useCanvasAvoidPoint(data?.edgeCenter);

  const {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
  } = useTooltipPosition(x, y, {
    enabled: !isSidebar,
    bounds: 'canvas',
    avoidPoint,
    boundsRef: tooltipBoundsRef,
  });

  const clickOutsideRef = useClickOutside(
    () => {
      if (onClose) onClose();
    },
    !isSidebar && showContent,
    true
  );

  const [viewMode, setViewMode] = useState("info");

  useEffect(() => {
    setViewMode("info");
  }, [data?.id, data?.source, data?.target]);

  const id1 = toFiniteNumber(data.source);
  const id2 = toFiniteNumber(data.target);

  const displayEventNum = toPositiveNumberOrNull(eventNum) ?? 0;

  const relationDataMode = isViewer ? 'viewer' : 'cumulative';

  const numericBookId = useMemo(
    () => toPositiveNumberOrNull(bookId) ?? toPositiveNumberOrNull(filename),
    [bookId, filename],
  );

  const {
    timeline,
    labels,
    loading,
    noRelation,
    error: relationError,
    incomplete: relationIncomplete,
    usedProbe: relationUsedProbe,
    fetchData,
  } = useRelationData(relationDataMode, id1, id2, currentChapter, displayEventNum, numericBookId);

  const edgePositivity = useMemo(() => {
    if (data?.positivity == null || data?.positivity === '') return null;
    const n = Number(data.positivity);
    if (!Number.isFinite(n)) return null;
    return clampPositivity(n);
  }, [data?.positivity]);

  const relationTagItems = useMemo(
    () =>
      buildRelationTagDisplayItems({
        relation: data?.relation,
        label: data?.label,
        labelHistory: data?.labelHistory,
        latestLabels: data?.latestLabels,
        currentEventId: data?.snapshotEventId ?? data?.latestEventId ?? null,
        fallbackPositivity: edgePositivity,
      }),
    [
      data?.relation,
      data?.label,
      data?.labelHistory,
      data?.latestLabels,
      data?.snapshotEventId,
      data?.latestEventId,
      edgePositivity,
    ]
  );
  const hasCurrentEdgeRelationData =
    relationTagItems.length > 0 ||
    edgePositivity != null ||
    (typeof data?.explanation === 'string' && data.explanation.trim().length > 0);

  useEffect(() => {
    return () => {
      clearStyleCache();
    };
  }, []);

  const effectiveEventColumns = useMemo(() => {
    if (!isViewer) return Number.POSITIVE_INFINITY;
    if (Number.isFinite(displayEventNum) && displayEventNum > 0) {
      return displayEventNum;
    }
    return Number.POSITIVE_INFINITY;
  }, [isViewer, displayEventNum]);

  const { rechartsLineData, hasChartData, numericPointCount } = useMemo(
    () =>
      buildEdgeRechartsLineData({
        timeline,
        labels,
        edgePositivity,
        displayEventNum,
        isViewer,
        effectiveEventColumns,
        relationError,
      }),
    [
      timeline,
      labels,
      edgePositivity,
      displayEventNum,
      isViewer,
      effectiveEventColumns,
      relationError,
    ],
  );

  const effectiveNoRelation = noRelation && !hasCurrentEdgeRelationData && !hasChartData && !relationError;

  const positivityDisplay = getPositivityDisplay(edgePositivity);
  const positivityPercentage = edgePositivity != null ? positivityDisplay.percent : null;
  const positivityBarWidth =
    positivityPercentage != null ? Math.min(100, Math.abs(positivityPercentage)) : 0;

  const explanationParts = useMemo(() => {
    if (typeof data?.explanation !== 'string' || !data.explanation) {
      return { hasExplanation: false, primary: null, secondary: null };
    }
    const [primary, secondary] = data.explanation.split('|');
    return {
      hasExplanation: true,
      primary: primary ?? '',
      secondary: secondary || null,
    };
  }, [data?.explanation]);

  const longTimeline = isLongEdgeTimeline(rechartsLineData.length);

  const xAxisBounds = useMemo(() => {
    if (rechartsLineData.length === 0) {
      return { min: 1, max: 1 };
    }
    if (rechartsLineData.length === 1) {
      return { min: 0.5, max: 1.5 };
    }
    return { min: 1, max: rechartsLineData.length };
  }, [rechartsLineData]);

  const sparseTicks = useMemo(
    () => getSparseEdgeTickValues(rechartsLineData, { maxTicks: isSidebar ? 7 : 5 }),
    [rechartsLineData, isSidebar],
  );

  const visibleXLabelMap = useMemo(() => {
    const map = {};
    rechartsLineData.forEach((d) => {
      map[d.x] = d.label;
    });
    return map;
  }, [rechartsLineData]);

  const currentRefX = useMemo(() => {
    const cur = rechartsLineData.find((d) => d.isCurrent);
    return cur?.x ?? null;
  }, [rechartsLineData]);

  const showDenseDots = rechartsLineData.length <= 6;

  const themeStyle = {
    '--rel-color': positivityDisplay.color,
    '--pos-width': `${positivityBarWidth}%`,
  };

  const relationTimelineChart = (heightPx) => {
    if (numericPointCount === 0) {
      return null;
    }
    if (numericPointCount === 1) {
      const only = rechartsLineData.find((d) => typeof d.y === 'number');
      return (
        <div className="edge-chart-empty">
          <p className="edge-chart-empty-title">아직 누적 변화가 없습니다</p>
          <p className="edge-chart-empty-value">
            현재 {Math.round((only?.y ?? 0) * 100)}%
          </p>
        </div>
      );
    }

    const chartH = Math.max(120, heightPx);

    return (
      <div className="edge-chart-plot">
        <ResponsiveContainer width="100%" height={chartH}>
          <LineChart
            data={rechartsLineData}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[xAxisBounds.min, xAxisBounds.max]}
              ticks={sparseTicks}
              tickFormatter={(v) => visibleXLabelMap[Math.round(v)] ?? ''}
              tick={{
                fontSize: isSidebar ? (longTimeline ? 12 : 13) : (longTimeline ? 10 : 11),
                fill: '#6b7280',
                fontWeight: 700,
              }}
              axisLine={{ stroke: COLORS.border }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              domain={[-1, 1]}
              width={isSidebar ? 44 : 40}
              tick={{
                fontSize: isSidebar ? 12 : 11,
                fill: '#6b7280',
                fontWeight: 700,
              }}
              tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
              axisLine={false}
              tickLine={false}
              ticks={[-1, 0, 1]}
            />
            <RechartsTooltip
              formatter={(value, _name, item) => {
                if (value == null || typeof value !== 'number') {
                  return ['관계 없음', '긍정도'];
                }
                const pct = `${Math.round(Number(value) * 100)}%`;
                const idx = item?.payload?.x;
                const prev =
                  Number.isFinite(idx) && idx > 1
                    ? rechartsLineData[idx - 2]?.y
                    : null;
                if (typeof prev === 'number') {
                  const d = Math.round((Number(value) - prev) * 100);
                  const sign = d > 0 ? '+' : '';
                  return [`${pct} (${sign}${d}%p)`, '긍정도'];
                }
                return [pct, '긍정도'];
              }}
              labelFormatter={(_l, payload) => payload?.[0]?.payload?.label ?? ''}
            />
            {currentRefX != null && (
              <ReferenceLine
                x={currentRefX}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            )}
            <Line
              type="monotone"
              dataKey="y"
              stroke={positivityDisplay.color}
              strokeWidth={longTimeline ? 1.5 : 2}
              dot={(dotProps) => {
                const { cx, cy, payload, index } = dotProps;
                if (cx == null || cy == null || payload?.y == null) return null;
                const isCurrent = payload?.isCurrent;
                const show =
                  showDenseDots || isCurrent || payload?.isSignificant || payload?.isChapter;
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
                const fill = payload?.isChapter ? '#9ca3af' : positivityDisplay.color;
                return (
                  <circle
                    key={`relation-timeline-dot-${index ?? `${cx}-${cy}`}`}
                    cx={cx}
                    cy={cy}
                    r={isCurrent ? 6 : longTimeline ? 2.5 : 3.5}
                    fill={fill}
                    stroke={isCurrent ? COLORS.white : fill}
                    strokeWidth={isCurrent ? 2 : 0}
                  />
                );
              }}
              activeDot={{ r: 5, fill: positivityDisplay.color }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderEndpoints = () => (
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

  const renderTabs = () => (
    <div className="edge-tooltip-tabs" role="tablist">
      {VIEW_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={viewMode === id}
          className={`edge-tooltip-tab${viewMode === id ? ' active' : ''}`}
          onClick={() => setViewMode(id)}
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

  const renderPositivityRow = () => (
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
  );

  const renderExplanationBody = () => {
    if (!explanationParts.hasExplanation) return null;

    return (
      <div className="relation-explanation">
        <div className="quote-box">
          <strong>{explanationParts.primary}</strong>
        </div>
        {explanationParts.secondary && (
          <p className="explanation-text">{explanationParts.secondary}</p>
        )}
      </div>
    );
  };

  const renderSkeleton = (message = '불러오는 중...') => (
    <div className="edge-tooltip-status">
      <span>{message}</span>
      <div className="edge-tooltip-skeleton">
        <div className="edge-tooltip-skeleton-line" />
        <div className="edge-tooltip-skeleton-line short" />
        <div className="edge-tooltip-skeleton-line" />
      </div>
    </div>
  );

  const renderStatusMessage = (message, { error = false, action } = {}) => (
    <div className={`edge-tooltip-status${error ? ' edge-tooltip-status--error' : ' edge-tooltip-status--muted'}`}>
      <span>{message}</span>
      {action}
    </div>
  );

  const chartTitle = isViewer
    ? `챕터 ${currentChapter} 관계 변화`
    : `챕터 ${currentChapter}까지의 누적 관계 변화`;

  const renderInfoView = () => {
    if (isViewer && effectiveNoRelation) {
      return renderStatusMessage(NO_RELATION_MESSAGE);
    }

    return (
      <>
        {relationTagItems.length > 0 && (
          <div className="relation-tags">
            {relationTagItems.map((item, index) => (
              <span
                key={`${item.text}-${index}`}
                className={`relation-tag relation-tag--${item.tone}`}
                style={{
                  '--tag-color': getRelationColor(item.positivity),
                }}
                title={TAG_TONE_TITLE[item.tone] || TAG_TONE_TITLE.prior}
              >
                {item.text}
              </span>
            ))}
          </div>
        )}
        {renderPositivityRow()}
        {explanationParts.hasExplanation && (
          <div className="edge-tooltip-body">
            {renderExplanationBody()}
          </div>
        )}
      </>
    );
  };

  const renderChartPanel = (chartHeight) => {
    if (loading) {
      return renderSkeleton('데이터를 불러오는 중...');
    }
    if (isViewer && displayEventNum <= 0) {
      return renderStatusMessage('이벤트 정보가 없어 관계 변화를 표시할 수 없습니다.');
    }
    // 로드 실패는 단점 합성보다 항상 우선
    if (relationError) {
      return renderStatusMessage('데이터를 불러올 수 없습니다', {
        error: true,
        action: (
          <button
            type="button"
            onClick={fetchData}
            className="edge-tooltip-retry-btn"
          >
            다시 시도
          </button>
        ),
      });
    }
    if (!hasChartData) {
      return renderStatusMessage(NO_RELATION_MESSAGE);
    }
    return (
      <div className="edge-chart-panel">
        <div className="edge-chart-title">{chartTitle}</div>
        {(relationIncomplete || relationUsedProbe) && (
          <p className="edge-chart-incomplete-hint">
            {relationIncomplete
              ? `일부 이벤트를 불러오지 못했습니다.${
                  relationUsedProbe ? ' 이벤트 범위는 추정값입니다.' : ''
                }`
              : '챕터 구조 정보가 없어 이벤트 범위를 추정했습니다. 결과가 부정확할 수 있습니다.'}
            {' '}
            <button type="button" onClick={fetchData} className="edge-tooltip-retry-btn">
              다시 시도
            </button>
          </p>
        )}
        {relationTimelineChart(chartHeight)}
      </div>
    );
  };

  const closeButton = (
    <TooltipCloseButton
      onClose={onClose}
      ariaLabel={isSidebar ? '사이드바 닫기' : undefined}
    />
  );

  const panelBody = isSidebar ? (
    <>
      {renderInfoView()}
      {renderChartPanel(240)}
    </>
  ) : (
    <div key={viewMode} className="edge-tooltip-panel-swap">
      {viewMode === 'info' ? renderInfoView() : renderChartPanel(280)}
    </div>
  );

  const tooltipInner = (
    <>
      {closeButton}
      <div
        className={`edge-tooltip-content edge-tooltip-themed${isSidebar ? ' edge-tooltip-content--sidebar' : ''}`}
        style={themeStyle}
      >
        <div className="edge-tooltip-header">
          {renderEndpoints()}
        </div>
        {!isSidebar && renderTabs()}
        <div className={`edge-tooltip-panel${isSidebar ? ' edge-tooltip-panel--sidebar' : ''}`}>
          {panelBody}
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
    prevProps.currentChapter === nextProps.currentChapter &&
    prevProps.eventNum === nextProps.eventNum &&
    prevProps.variant === nextProps.variant &&
    prevProps.bookId === nextProps.bookId &&
    prevProps.sourceEndpoint === nextProps.sourceEndpoint &&
    prevProps.targetEndpoint === nextProps.targetEndpoint
  );
});

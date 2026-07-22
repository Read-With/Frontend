import { memo, useState, useEffect, useMemo } from "react";
import {ResponsiveContainer, LineChart, CartesianGrid, ReferenceLine, Tooltip as RechartsTooltip, Line, XAxis, YAxis,} from "recharts";
import { useParams } from "react-router-dom";
import { useTooltipPosition, useClickOutside, TooltipGraphZoomControls } from "../../../hooks/ui/tooltipHooks";
import { useRelationData } from "../../../hooks/graph/useApiGraphData";
import { getRelationStyle, tooltipStyles } from "../../../utils/styles/relationStyles";
import { clampPositivity } from "../../../utils/styles/graphStyles";
import { COLORS, ANIMATION_VALUES, mergeRefs } from "../../../utils/styles/styles";
import { toFiniteNumber, toPositiveNumberOrNull } from "../../../utils/common/valueUtils";
import { processRelationTags, cleanupRelationUtils } from "../../../utils/graph/graphCore";
import { resolveEventOrdinalForDisplay } from "../../../utils/viewer/viewerSession";
import { isLongEdgeTimeline, annotateSignificantEdgePoints, getSparseEdgeTickValues, formatEdgeTimelineDisplayLabel } from "../../../utils/graph/graphCy";
import './tooltip.css';

function extractNumericLabel(label) {
  if (typeof label === 'number' && Number.isFinite(label)) {
    return label;
  }
  if (typeof label === 'string') {
    const match = label.match(/\d+/g);
    if (match && match.length > 0) {
      const parsed = Number(match[match.length - 1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function isChapterLabel(label) {
  return typeof label === 'string' && /^Ch\d+/i.test(label.trim());
}

function isPairCurrentEvent(pair, currentEventIdx) {
  if (!pair || pair.isChapterAggregate) return false;
  if (!Number.isFinite(currentEventIdx) || currentEventIdx <= 0) return false;
  return Number.isFinite(pair.numericLabel) && pair.numericLabel === currentEventIdx;
}

function EndpointAvatar({ endpoint }) {
  const label = endpoint?.label || '?';
  const initial = label.charAt(0);
  if (endpoint?.image) {
    return (
      <img
        className="edge-tooltip-endpoint-avatar"
        src={endpoint.image}
        alt={label}
      />
    );
  }
  return (
    <div className="edge-tooltip-endpoint-avatar" aria-hidden>
      {initial}
    </div>
  );
}

function UnifiedEdgeTooltip({
  data,
  x,
  y,
  onClose,
  variant = 'graphPage',
  chapterNum = 1,
  eventNum = 1,
  currentEvent = null,
  prevValidEvent = null,
  bookId = null,
  sourceEndpoint = null,
  targetEndpoint = null,
  cyRef = null,
}) {
  const { filename } = useParams();
  const isSidebar = variant === 'graphPage';
  const isViewer = variant === 'viewer';

  const {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
  } = useTooltipPosition(x, y, {
    enabled: !isSidebar,
    bounds: isViewer ? 'window' : 'canvas',
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

  const displayEventNum = useMemo(
    () =>
      resolveEventOrdinalForDisplay({
        currentEvent,
        prevValidEvent,
        progressTopBar: null,
        fallback: eventNum,
      }),
    [currentEvent, prevValidEvent, eventNum],
  );

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
    fetchData,
  } = useRelationData(relationDataMode, id1, id2, chapterNum, displayEventNum, numericBookId);

  const { graphBarPositivity, chartTimelineFallbackValue } = useMemo(() => {
    const n = Number(data?.positivity);
    if (!Number.isFinite(n)) {
      return { graphBarPositivity: 0, chartTimelineFallbackValue: null };
    }
    const clamped = clampPositivity(n);
    return { graphBarPositivity: clamped, chartTimelineFallbackValue: clamped };
  }, [data?.positivity]);

  const relationLabels = processRelationTags(data.relation, data.label);
  const hasCurrentEdgeRelationData =
    relationLabels.length > 0 ||
    Number.isFinite(Number(data?.positivity)) ||
    (typeof data?.explanation === 'string' && data.explanation.trim().length > 0);

  useEffect(() => {
    return () => {
      cleanupRelationUtils();
    };
  }, []);

  const currentEventIdx = Number(displayEventNum);

  const effectiveEventColumns = useMemo(() => {
    if (!isViewer) return Number.POSITIVE_INFINITY;
    if (Number.isFinite(currentEventIdx) && currentEventIdx > 0) {
      return currentEventIdx;
    }
    return Number.POSITIVE_INFINITY;
  }, [isViewer, currentEventIdx]);

  const { rechartsLineData, hasChartData } = useMemo(() => {
    const pairs = [];
    const timelineHasNumeric = Array.isArray(timeline)
      && timeline.some((value) => typeof value === 'number' && !Number.isNaN(value));

    if (timelineHasNumeric && Array.isArray(labels) && labels.length > 0) {
      const length = Math.min(labels.length, timeline.length);

      for (let i = 0; i < length; i++) {
        const label = labels[i];
        const value = timeline[i];
        if (typeof value !== 'number' || Number.isNaN(value)) {
          continue;
        }

        const normalizedValue = clampPositivity(value);
        const isChapter = isChapterLabel(label);

        if (
          isChapter &&
          timeline[i + 1] !== undefined &&
          typeof timeline[i + 1] === 'number' &&
          !Number.isNaN(timeline[i + 1])
        ) {
          pairs.push({
            value: normalizedValue,
            label,
            numericLabel: null,
            isChapterAggregate: true,
          });
          continue;
        }

        const numericLabel = extractNumericLabel(label);
        if (!Number.isFinite(numericLabel)) {
          continue;
        }

        if (isViewer && Number.isFinite(effectiveEventColumns) && numericLabel > effectiveEventColumns) {
          continue;
        }

        pairs.push({
          value: normalizedValue,
          label,
          numericLabel,
          isChapterAggregate: false,
        });
      }
    }

    if (pairs.length === 0 && chartTimelineFallbackValue !== null) {
      pairs.push({
        value: chartTimelineFallbackValue,
        label: `event ${displayEventNum || 1}`,
        numericLabel: displayEventNum || 1,
        isChapterAggregate: false,
      });
    }

    let active = pairs.length > 0;
    if (active && isViewer) {
      if (!Number.isFinite(currentEventIdx) || currentEventIdx <= 0) {
        active = pairs.length > 0;
      } else if (pairs.some((pair) => isPairCurrentEvent(pair, currentEventIdx))) {
        active = true;
      } else {
        active = pairs.some(
          (pair) =>
            !pair.isChapterAggregate &&
            Number.isFinite(pair.numericLabel) &&
            pair.numericLabel <= currentEventIdx,
        );
      }
    }

    if (!active) {
      return { rechartsLineData: [], hasChartData: false };
    }

    const annotated = annotateSignificantEdgePoints(pairs);
    const lineData = annotated.map((pair, i) => {
      const isChapter = pair.isChapterAggregate || isChapterLabel(pair.label);
      return {
        x: i + 1,
        y: pair.value,
        label: formatEdgeTimelineDisplayLabel(pair.label, pair.numericLabel, i),
        numericLabel: pair.numericLabel,
        isChapter,
        isCurrent: isPairCurrentEvent(pair, currentEventIdx),
        isSignificant: !!pair.isSignificant,
      };
    });

    return { rechartsLineData: lineData, hasChartData: lineData.length > 0 };
  }, [
    timeline,
    labels,
    chartTimelineFallbackValue,
    displayEventNum,
    isViewer,
    effectiveEventColumns,
    currentEventIdx,
  ]);

  const effectiveNoRelation = noRelation && !hasCurrentEdgeRelationData && !hasChartData;
  const shouldShowRelationError = !!relationError && !hasChartData;

  const positivityPercentage = Math.round(graphBarPositivity * 100);
  const positivityBarWidth = Math.min(100, Math.abs(positivityPercentage));
  const relationStyle = getRelationStyle(graphBarPositivity);

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
    '--rel-color': relationStyle.color,
    '--pos-width': `${positivityBarWidth}%`,
  };

  const relationTimelineChart = (heightPx) => {
    if (rechartsLineData.length === 0) {
      return null;
    }
    if (rechartsLineData.length === 1) {
      return (
        <div className="edge-chart-empty">
          <p className="edge-chart-empty-title">아직 누적 변화가 없습니다</p>
          <p className="edge-chart-empty-value">
            현재 {Math.round(rechartsLineData[0].y * 100)}%
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
              tick={{ fontSize: isSidebar ? (longTimeline ? 12 : 13) : (longTimeline ? 10 : 11), fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              domain={[-1, 1]}
              width={isSidebar ? 32 : 28}
              tick={{ fontSize: isSidebar ? 12 : 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              ticks={[-1, 0, 1]}
            />
            <RechartsTooltip
              formatter={(value, _name, item) => {
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
              stroke={relationStyle.color}
              strokeWidth={longTimeline ? 1.5 : 2}
              dot={(dotProps) => {
                const { cx, cy, payload, index } = dotProps;
                if (cx == null || cy == null) return null;
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
                const fill = payload?.isChapter ? '#9ca3af' : relationStyle.color;
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
              activeDot={{ r: 5, fill: relationStyle.color }}
              connectNulls
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
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === 'info'}
        className={`edge-tooltip-tab${viewMode === 'info' ? ' active' : ''}`}
        onClick={() => setViewMode('info')}
      >
        요약
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === 'chart'}
        className={`edge-tooltip-tab${viewMode === 'chart' ? ' active' : ''}`}
        onClick={() => setViewMode('chart')}
      >
        변화
      </button>
      <span
        className={`edge-tooltip-tab-indicator${viewMode === 'chart' ? ' chart' : ''}`}
        aria-hidden
      />
    </div>
  );

  const renderPositivityRow = () => (
    <div className="relation-weight">
      <div className="weight-header">
        <span className="weight-label">{relationStyle.text}</span>
        <span className="weight-value">{`${positivityPercentage}%`}</span>
      </div>
      <div className="positivity-track">
        <div className="positivity-fill" />
      </div>
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
    ? `Chapter ${chapterNum} 관계 변화`
    : `Chapter ${chapterNum}까지의 누적 관계 변화`;

  const renderInfoPanel = () => {
    if (isViewer && effectiveNoRelation) {
      return renderStatusMessage(NO_RELATION_MESSAGE);
    }

    return (
      <>
        {relationLabels.length > 0 && (
          <div className="relation-tags">
            {relationLabels.map((relation, index) => (
              <span key={index} className="relation-tag">
                {relation}
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
    if (shouldShowRelationError) {
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
    if (isViewer && effectiveNoRelation) {
      return renderStatusMessage(NO_RELATION_MESSAGE);
    }
    return (
      <div className="edge-chart-panel">
        <div className="edge-chart-title">{chartTitle}</div>
        {relationTimelineChart(chartHeight)}
      </div>
    );
  };

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="tooltip-close-btn"
      aria-label={isSidebar ? '사이드바 닫기' : undefined}
    >
      &times;
    </button>
  );

  const panelBody = isSidebar ? (
    <>
      {renderInfoPanel()}
      {renderChartPanel(240)}
    </>
  ) : (
    <div key={viewMode} className="edge-tooltip-panel-swap">
      {viewMode === 'info' ? renderInfoPanel() : renderChartPanel(200)}
    </div>
  );

  const tooltipInner = (
    <>
      {closeButton}
      {isViewer ? (
        <TooltipGraphZoomControls
          cyRef={cyRef}
          elementId={data?.id}
        />
      ) : null}
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
      className="edge-tooltip-container edge-tooltip-floating"
      style={{
        ...tooltipStyles.container,
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
    prevProps.currentEvent === nextProps.currentEvent &&
    prevProps.prevValidEvent === nextProps.prevValidEvent &&
    prevProps.chapterNum === nextProps.chapterNum &&
    prevProps.eventNum === nextProps.eventNum &&
    prevProps.variant === nextProps.variant &&
    prevProps.bookId === nextProps.bookId &&
    prevProps.sourceEndpoint === nextProps.sourceEndpoint &&
    prevProps.targetEndpoint === nextProps.targetEndpoint &&
    prevProps.cyRef === nextProps.cyRef
  );
});

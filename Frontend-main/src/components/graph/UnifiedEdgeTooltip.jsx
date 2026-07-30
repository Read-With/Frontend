import { memo, useState, useEffect, useMemo } from "react";
import {ResponsiveContainer, LineChart, CartesianGrid, ReferenceLine, Tooltip as RechartsTooltip, Line, XAxis, YAxis,} from "recharts";
import { useParams } from "react-router-dom";
import { useTooltipPosition, useClickOutside } from "../../hooks/ui/tooltipHooks";
import { useRelationData } from "../../hooks/graph/useApiGraphData";
import { getRelationStyle } from "../../utils/styles/relationStyles";
import { clampPositivity, getRelationColor } from "../../utils/styles/graphStyles";
import { COLORS, ANIMATION_VALUES, mergeRefs } from "../../utils/styles/styles";
import { toFiniteNumber, toPositiveNumberOrNull } from "../../utils/common/valueUtils";
import { cleanupRelationUtils, buildRelationTagDisplayItems } from "../../utils/graph/graphCore";
import { isLongEdgeTimeline, annotateSignificantEdgePoints, getSparseEdgeTickValues, formatEdgeTimelineDisplayLabel } from "../../utils/graph/graphCy";
import './RelationGraph.css';

const NO_RELATION_MESSAGE = '이 위치에서는 표시할 관계가 없습니다.';

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

function isPairCurrentEvent(pair, eventIdx) {
  if (!pair || pair.isChapterAggregate) return false;
  if (!Number.isFinite(eventIdx) || eventIdx <= 0) return false;
  return Number.isFinite(pair.numericLabel) && pair.numericLabel === eventIdx;
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
  currentChapter = 1,
  eventNum = 1,
  bookId = null,
  sourceEndpoint = null,
  targetEndpoint = null,
}) {
  const { filename } = useParams();
  const isSidebar = variant === 'graphPage';
  const isViewer = variant === 'viewer';

  const avoidPoint = useMemo(() => {
    const c = data?.edgeCenter;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
    return null;
  }, [data?.edgeCenter]);

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
      cleanupRelationUtils();
    };
  }, []);

  const effectiveEventColumns = useMemo(() => {
    if (!isViewer) return Number.POSITIVE_INFINITY;
    if (Number.isFinite(displayEventNum) && displayEventNum > 0) {
      return displayEventNum;
    }
    return Number.POSITIVE_INFINITY;
  }, [isViewer, displayEventNum]);

  const { rechartsLineData, hasChartData, numericPointCount } = useMemo(() => {
    // 로드 실패 시 간선 positivity로 단점 합성하지 않음
    if (relationError) {
      return { rechartsLineData: [], hasChartData: false, numericPointCount: 0 };
    }

    const pairs = [];
    const timelineHasValues = Array.isArray(timeline)
      && timeline.some((value) => value === null || (typeof value === 'number' && !Number.isNaN(value)));

    if (timelineHasValues && Array.isArray(labels) && labels.length > 0) {
      const length = Math.min(labels.length, timeline.length);

      for (let i = 0; i < length; i++) {
        const label = labels[i];
        const value = timeline[i];
        const isChapter = isChapterLabel(label);
        const numericLabel = extractNumericLabel(label);

        if (
          isViewer &&
          Number.isFinite(effectiveEventColumns) &&
          Number.isFinite(numericLabel) &&
          numericLabel > effectiveEventColumns
        ) {
          continue;
        }

        // 관계 공백(null) — 축은 유지하고 선은 끊음
        if (value === null) {
          if (!Number.isFinite(numericLabel) && !isChapter) continue;
          pairs.push({
            value: null,
            label,
            numericLabel: Number.isFinite(numericLabel) ? numericLabel : null,
            isChapterAggregate: false,
            isGap: true,
          });
          continue;
        }

        if (typeof value !== 'number' || Number.isNaN(value)) {
          continue;
        }

        const normalizedValue = clampPositivity(value);

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

        if (!Number.isFinite(numericLabel)) {
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

    // 타임라인 없고 로드 에러가 아닐 때만 현재 간선 positivity로 단점 보조
    if (pairs.length === 0 && edgePositivity !== null) {
      pairs.push({
        value: edgePositivity,
        label: `event ${displayEventNum || 1}`,
        numericLabel: displayEventNum || 1,
        isChapterAggregate: false,
      });
    }

    let active = pairs.some((pair) => typeof pair.value === 'number');
    if (active && isViewer) {
      if (!Number.isFinite(displayEventNum) || displayEventNum <= 0) {
        active = pairs.some((pair) => typeof pair.value === 'number');
      } else if (pairs.some((pair) => isPairCurrentEvent(pair, displayEventNum))) {
        active = true;
      } else {
        active = pairs.some(
          (pair) =>
            !pair.isChapterAggregate &&
            Number.isFinite(pair.numericLabel) &&
            pair.numericLabel <= displayEventNum &&
            typeof pair.value === 'number',
        );
      }
    }

    if (!active) {
      return { rechartsLineData: [], hasChartData: false, numericPointCount: 0 };
    }

    const annotated = annotateSignificantEdgePoints(pairs);
    const lineData = annotated.map((pair, i) => {
      const isChapter = pair.isChapterAggregate || isChapterLabel(pair.label);
      return {
        x: i + 1,
        y: typeof pair.value === 'number' ? pair.value : null,
        label: formatEdgeTimelineDisplayLabel(pair.label, pair.numericLabel, i),
        numericLabel: pair.numericLabel,
        isChapter,
        isCurrent: isPairCurrentEvent(pair, displayEventNum),
        isSignificant: !!pair.isSignificant,
        isGap: !!pair.isGap,
      };
    });

    const numericPointCount = lineData.filter((d) => typeof d.y === 'number').length;
    return {
      rechartsLineData: lineData,
      hasChartData: numericPointCount > 0,
      numericPointCount,
    };
  }, [
    timeline,
    labels,
    edgePositivity,
    displayEventNum,
    isViewer,
    effectiveEventColumns,
    relationError,
  ]);

  const effectiveNoRelation = noRelation && !hasCurrentEdgeRelationData && !hasChartData && !relationError;

  const positivityPercentage =
    edgePositivity != null ? Math.round(edgePositivity * 100) : null;
  const positivityBarWidth =
    positivityPercentage != null ? Math.min(100, Math.abs(positivityPercentage)) : 0;
  const relationStyle = getRelationStyle(edgePositivity);

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
              tick={{ fontSize: isSidebar ? (longTimeline ? 12 : 13) : (longTimeline ? 10 : 11), fill: '#9ca3af' }}
              axisLine={{ stroke: COLORS.border }}
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
              stroke={relationStyle.color}
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
    ? `Chapter ${currentChapter} 관계 변화`
    : `Chapter ${currentChapter}까지의 누적 관계 변화`;

  const renderInfoPanel = () => {
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
                style={{ '--tag-color': getRelationColor(item.positivity) }}
                title={
                  item.tone === 'added'
                    ? '이 위치에서 처음 추가된 관계'
                    : item.tone === 'changed'
                      ? '이 위치에서 갱신된 관계'
                      : '이전에 추가된 관계'
                }
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

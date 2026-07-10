import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useParams } from "react-router-dom";
import { useTooltipPosition, useClickOutside } from "../../../hooks/ui/tooltipHooks";
import { useRelationData } from "../../../hooks/graph/useRelationData";
import { getRelationStyle, tooltipStyles } from "../../../utils/styles/relationStyles";
import { createButtonStyle, createAdvancedButtonHandlers, COLORS, ANIMATION_VALUES, unifiedNodeTooltipStyles } from "../../../utils/styles/styles";
import { mergeRefs } from "../../../utils/styles/styles";
import { toFiniteNumber } from "../../../utils/common/valueUtils";
import { processRelationTags, cleanupRelationUtils } from "../../../utils/graph/relationUtils";
import {
  resolveEventOrdinalForDisplay,
} from "../../../utils/viewer/viewerEventProgressUtils";
import { resolveTooltipBookId } from "../graphShared";
import "../RelationGraph.css";

function UnifiedEdgeTooltip({
  data,
  x,
  y,
  onClose,
  style,
  variant,
  mode = 'standalone',
  displayMode = 'tooltip',
  chapterNum = 1,
  eventNum = 1,
  currentEvent = null,
  prevValidEvent = null,
  bookId = null,
}) {
  const { filename } = useParams();
  const resolvedVariant =
    variant
    ?? (displayMode === 'sidebar' ? 'graphPage' : mode === 'viewer' ? 'viewer' : 'graphPage');
  const isSidebar = resolvedVariant === 'graphPage';
  const isViewer = resolvedVariant === 'viewer';

  const {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
  } = useTooltipPosition(x, y, { enabled: !isSidebar });

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
    () => resolveTooltipBookId(bookId, filename),
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

  /** graphStyles.getRelationColor과 동일: 간선 data.positivity → 막대·라벨 색 통일 */
  const { graphBarPositivity, chartTimelineFallbackValue } = useMemo(() => {
    const n = Number(data?.positivity);
    if (!Number.isFinite(n)) {
      return { graphBarPositivity: 0, chartTimelineFallbackValue: null };
    }
    const clamped = Math.max(-1, Math.min(1, n));
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

  const timelineHasNumeric = Array.isArray(timeline)
    ? timeline.some(value => typeof value === 'number' && !Number.isNaN(value))
    : false;

  const extractNumericLabel = useCallback((label) => {
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
  }, []);

  const effectiveEventColumns = useMemo(() => {
    if (!isViewer) return Number.POSITIVE_INFINITY;

    const candidate = Number(displayEventNum);
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }

    return Number.POSITIVE_INFINITY;
  }, [isViewer, displayEventNum]);

  const chartPairs = useMemo(() => {
    const pairs = [];

    if (timelineHasNumeric && Array.isArray(labels) && labels.length > 0) {
      const length = Math.min(labels.length, timeline.length);

      for (let i = 0; i < length; i++) {
        const label = labels[i];
        const value = timeline[i];
        if (typeof value !== 'number' || Number.isNaN(value)) {
          continue;
        }

        const normalizedValue = Math.max(-1, Math.min(1, value));

        if (
          typeof label === 'string' &&
          label.startsWith('Ch') &&
          timeline[i + 1] !== undefined &&
          typeof timeline[i + 1] === 'number' &&
          !Number.isNaN(timeline[i + 1])
        ) {
          pairs.push({
            value: normalizedValue,
            label,
            numericLabel: null,
            isChapterAggregate: true
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
          isChapterAggregate: false
        });
      }
    }

    if (pairs.length === 0 && chartTimelineFallbackValue !== null) {
      pairs.push({
        value: chartTimelineFallbackValue,
        label: `E${displayEventNum || 1}`,
        numericLabel: displayEventNum || 1,
        isChapterAggregate: false
      });
    }

    return pairs;
  }, [
    timelineHasNumeric,
    labels,
    timeline,
    extractNumericLabel,
    displayEventNum,
    chartTimelineFallbackValue,
    isViewer,
    effectiveEventColumns
  ]);

  const activeEventHasPositivity = useMemo(() => {
    if (chartPairs.length === 0) return false;
    if (!isViewer) return true;
    const currentEventIdx = Number(displayEventNum);
    if (!Number.isFinite(currentEventIdx) || currentEventIdx <= 0) {
      return chartPairs.length > 0;
    }
    const currentLabel = `E${currentEventIdx}`;
    if (chartPairs.some((pair) => pair.label === currentLabel || pair.numericLabel === currentEventIdx)) {
      return true;
    }
    return chartPairs.some(
      (pair) =>
        !pair.isChapterAggregate &&
        Number.isFinite(pair.numericLabel) &&
        pair.numericLabel <= currentEventIdx
    );
  }, [chartPairs, displayEventNum, isViewer]);

  const chartPoints = useMemo(() => {
    if (!activeEventHasPositivity) return [];
    return chartPairs.map((pair, index) => ({
      x: index + 1,
      y: pair.value
    }));
  }, [chartPairs, activeEventHasPositivity]);

  const chartLabels = useMemo(() => {
    if (!activeEventHasPositivity) return [];
    return chartPairs.map((pair, index) => {
      if (typeof pair.label === 'string' && pair.label.trim().length > 0) {
        return pair.label;
      }
      if (Number.isFinite(pair.numericLabel) && pair.numericLabel > 0) {
        return `E${pair.numericLabel}`;
      }
      return `E${index + 1}`;
    });
  }, [chartPairs, activeEventHasPositivity]);

  const xLabelMap = useMemo(() => {
    const map = {};
    chartPoints.forEach((point, idx) => {
      map[Math.round(point.x)] = chartLabels[idx] ?? `E${idx + 1}`;
    });
    return map;
  }, [chartPoints, chartLabels]);

  const hasChartData = chartPoints.length > 0;
  const effectiveNoRelation = noRelation && !hasCurrentEdgeRelationData && !hasChartData;
  const shouldShowRelationError = !!relationError && !hasChartData;

  const positivityForBars = graphBarPositivity;
  const positivityPercentage = Math.round(graphBarPositivity * 100);

  const relationStyle = getRelationStyle(graphBarPositivity, filename);

  const buttonStyles = {
    primary: createButtonStyle(ANIMATION_VALUES, 'primaryEdge'),
    secondary: createButtonStyle(ANIMATION_VALUES, 'secondaryEdge'),
    close: createButtonStyle(ANIMATION_VALUES, 'closeEdge'),
    tooltipClose: createButtonStyle(ANIMATION_VALUES, 'tooltipClose')
  };

  const buttonHandlers = {
    primary: createAdvancedButtonHandlers('primaryEdge'),
    secondary: createAdvancedButtonHandlers('secondaryEdge'),
    close: createAdvancedButtonHandlers('closeEdge'),
    tooltipClose: createAdvancedButtonHandlers('tooltipClose')
  };

  const cardStyles = {
    sidebarCard: {
      ...unifiedNodeTooltipStyles.sidebarContainer,
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px',
      border: `1px solid ${COLORS.border}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    }
  };

  const renderProgressBars = (positivity, relationStyle, isSidebar = false) => {
    let p = Math.abs(positivity ?? 0);
    p = p * 100;
    let remain = p;
    
    return Array.from({ length: 5 }).map((_, i) => {
      let fill;
      if (remain >= 20) {
        fill = 1;
      } else if (remain > 0) {
        fill = remain / 20;
      } else {
        fill = 0;
      }
      remain -= 20;
      
      let background;
      if (fill === 1) background = relationStyle.color;
      else if (fill > 0)
        background = `linear-gradient(to right, ${relationStyle.color} ${fill * 100}%, #e5e7eb ${fill * 100}%)`;
      else background = "#e5e7eb";
      
      return (
        <div
          key={i}
          style={{
            ...tooltipStyles.progressBar,
            background,
            ...(isSidebar && {
              width: '80px',
              height: '24px',
              borderRadius: '6px',
              border: '1.5px solid #e5e7eb',
            })
          }}
        />
      );
    });
  };

  const renderPercentageLabels = (isSidebar = false) => {
    return [20, 40, 60, 80, 100].map((step, idx) => (
      <span
        key={idx}
        style={{
          width: isSidebar ? '80px' : 80,
          textAlign: 'center',
          fontSize: isSidebar ? '12px' : 12,
          color: COLORS.textSecondary,
          display: 'inline-block',
          lineHeight: '1.2',
        }}
      >
        {step}%
      </span>
    ));
  };

  const renderPositivityMeter = (isSidebarMode = false) => (
    <>
      <div
        style={
          isSidebarMode
            ? {
                display: 'flex',
                alignItems: 'flex-end',
                gap: '4px',
                height: '28px',
                margin: '16px 0 8px 0',
                justifyContent: 'center',
              }
            : {
                display: 'flex',
                alignItems: 'flex-end',
                gap: '0.2rem',
                height: '1.4rem',
                margin: '0.5rem 0 0.25rem 0',
                justifyContent: 'center',
              }
        }
      >
        {renderProgressBars(positivityForBars, relationStyle, isSidebarMode)}
      </div>
      <div
        style={
          isSidebarMode
            ? {
                display: 'flex',
                justifyContent: 'center',
                gap: '4px',
                marginBottom: '8px',
              }
            : {
                display: 'flex',
                justifyContent: 'center',
                gap: '0.2rem',
                marginBottom: '0.25rem',
              }
        }
      >
        {renderPercentageLabels(isSidebarMode)}
      </div>
    </>
  );

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

  const renderExplanationBody = (variant = 'tooltip') => {
    if (!explanationParts.hasExplanation) return null;

    if (variant === 'sidebar') {
      return (
        <div
          style={{
            borderLeft: `4px solid ${relationStyle.color}`,
            paddingLeft: '16px',
          }}
        >
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '14px',
              lineHeight: '1.6',
              color: COLORS.textPrimary,
              fontWeight: '500',
              letterSpacing: '-0.01em',
              wordBreak: 'keep-all',
            }}
          >
            {explanationParts.primary}
          </p>
          {explanationParts.secondary && (
            <p
              style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: '1.6',
                color: COLORS.textSecondary,
                letterSpacing: '-0.01em',
                wordBreak: 'keep-all',
              }}
            >
              {explanationParts.secondary}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="relation-explanation" style={{ width: '100%' }}>
        <div
          className="quote-box"
          style={{ borderLeft: `0.25rem solid ${relationStyle.color}` }}
        >
          <strong>{explanationParts.primary}</strong>
        </div>
        {explanationParts.secondary && (
          <p className="explanation-text">{explanationParts.secondary}</p>
        )}
      </div>
    );
  };

  const renderTooltipStatusPanel = ({
    message,
    messageColor = '#64748b',
    fontSize = '1rem',
    maxWidth = '17.5rem',
    includeOuterWidth = false,
    footer,
  }) => (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem',
        ...(includeOuterWidth
          ? { width: 'calc(100% - 40px)', margin: '0 auto' }
          : { minHeight: 0 }),
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            color: messageColor,
            fontSize,
            maxWidth,
            lineHeight: '1.5',
            wordBreak: 'keep-all',
          }}
        >
          {message}
        </div>
      </div>
      {footer}
    </div>
  );

  const renderSidebarChartLoading = () => (
    <div
      style={{
        textAlign: 'center',
        padding: '60px 20px',
        color: COLORS.textSecondary,
        fontSize: '14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid #e5e7eb',
          borderTop: '3px solid #5C6F5C',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      <span>데이터를 불러오는 중...</span>
    </div>
  );

  const renderSidebarChartError = () => (
    <div
      style={{
        textAlign: 'center',
        padding: '60px 20px',
        color: '#ef4444',
        fontSize: '14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: '#fef2f2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
        }}
      >
        ⚠️
      </div>
      <span>데이터를 불러올 수 없습니다</span>
      <button
        onClick={fetchData}
        style={{
          ...buttonStyles.secondary,
          fontSize: '12px',
          padding: '6px 12px',
        }}
        {...buttonHandlers.secondary}
      >
        다시 시도
      </button>
    </div>
  );

  const tooltipActionBarStyle = {
    flexShrink: 0,
    paddingTop: '0.5rem',
    paddingBottom: isViewer ? '0.5rem' : '0.75rem',
    textAlign: 'center',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: 'calc(100% - 40px)',
    margin: '0 auto',
  };

  const xAxisBounds = useMemo(() => {
    if (chartPoints.length === 0) {
      return { min: 1, max: 1 };
    }
    if (chartPoints.length === 1) {
      return { min: 0.5, max: 1.5 };
    }
    return { min: 1, max: chartPoints.length };
  }, [chartPoints]);

  const rechartsLineData = useMemo(() => {
    if (!hasChartData) return [];
    return chartPoints.map((p, i) => ({
      x: p.x,
      y: p.y,
      label: chartLabels[i] ?? `E${i + 1}`,
      pointColor:
        typeof chartPairs[i]?.label === 'string' && chartPairs[i].label.startsWith('Ch')
          ? '#9ca3af'
          : '#5C6F5C',
    }));
  }, [hasChartData, chartPoints, chartLabels, chartPairs]);

  const relationTimelineChart = (heightPx) => (
    <ResponsiveContainer width="100%" height={heightPx}>
      <LineChart data={rechartsLineData} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis
          type="number"
          dataKey="x"
          domain={[xAxisBounds.min, xAxisBounds.max]}
          ticks={rechartsLineData.map((d) => d.x)}
          tickFormatter={(v) => (hasChartData ? xLabelMap[Math.round(v)] ?? '' : '')}
        />
        <YAxis
          domain={[-1, 1]}
          width={44}
          label={{ value: '긍정도', angle: -90, position: 'insideLeft' }}
        />
        <RechartsTooltip
          formatter={(value) => [`관계 긍정도: ${Math.round(Number(value) * 100)}%`, '']}
          labelFormatter={(_l, payload) => payload?.[0]?.payload?.label ?? ''}
        />
        <Line
          type="monotone"
          dataKey="y"
          stroke="#5C6F5C"
          strokeWidth={2}
          dot={(dotProps) => {
            const { cx, cy, payload, index } = dotProps;
            if (cx == null || cy == null) return null;
            const fill = payload?.pointColor ?? '#5C6F5C';
            return (
              <circle
                key={`relation-timeline-dot-${index ?? `${cx}-${cy}`}`}
                cx={cx}
                cy={cy}
                r={4}
                fill={fill}
                stroke={fill}
              />
            );
          }}
          activeDot={{ r: 6 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  const zIndex = 99999;
  let chartTitle = "관계 변화 그래프";
  if (isViewer) {
    chartTitle = `Chapter ${chapterNum} 관계 변화`;
  } else {
    chartTitle = `Chapter ${chapterNum}까지의 누적 관계 변화`;
  }

  if (isSidebar) {
    return (
      <div 
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: COLORS.background,
          overflow: 'hidden',
          fontFamily: 'var(--font-family-primary)',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        tabIndex={0}
      >
        <div style={{
          padding: '20px 20px 16px 20px',
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.background,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}>
            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: COLORS.textPrimary,
              margin: 0,
              letterSpacing: '-0.025em',
            }}>
              관계 정보
            </h3>
            <button
              onClick={onClose}
              aria-label="사이드바 닫기"
              style={buttonStyles.close}
              {...buttonHandlers.close}
            >
              ×
            </button>
          </div>
          
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginBottom: '0',
          }}>
            {relationLabels.map((relation, index) => (
              <span
                key={index}
                style={{
                  ...tooltipStyles.relationTag,
                  background: '#e3e6ef',
                  color: '#42506b',
                  borderRadius: '8px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  fontWeight: 500,
                  border: 'none',
                }}
              >
                {relation}
              </span>
            ))}
          </div>
        </div>

        <div
          className="sidebar-content"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '0 5px',
          }}
        >
          {viewMode === "info" ? (
            <div style={{ padding: '20px 0' }}>
              <div
                className="sidebar-card"
                style={{
                  ...cardStyles.sidebarCard,
                  width: 'calc(100% - 40px)',
                  margin: '0 auto'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}>
                  <span style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: relationStyle.color,
                    letterSpacing: '-0.025em',
                  }}>
                    {relationStyle.text}
                  </span>
                  <span style={{
                    fontSize: '20px',
                    fontWeight: '700',
                    color: relationStyle.color,
                    letterSpacing: '-0.025em',
                  }}>
                    {`${positivityPercentage}%`}
                  </span>
                </div>
                
                {renderPositivityMeter(true)}
              </div>

              {explanationParts.hasExplanation && (
                <div 
                  className="sidebar-card"
                  style={{
                    ...cardStyles.sidebarCard,
                    width: 'calc(100% - 40px)',
                    margin: '0 auto'
                  }}
                >
                  <h4 style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: COLORS.textPrimary,
                    margin: '0 0 12px 0',
                    letterSpacing: '-0.025em',
                  }}>
                    관계 설명
                  </h4>
                  {renderExplanationBody('sidebar')}
                </div>
              )}

              <button
                onClick={() => setViewMode("chart")}
                style={{ 
                  ...buttonStyles.primary, 
                  width: '100%',
                  marginTop: '16px'
                }}
                {...buttonHandlers.primary}
              >
                관계 변화 그래프 보기
              </button>
            </div>
          ) : (
            <div style={{ padding: '10px 0' }}>
              <div
                className="sidebar-card"
                style={{
                  ...cardStyles.sidebarCard,
                  width: 'calc(100% - 40px)',
                  margin: '0 auto'
                }}
              >
                <h4 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  color: COLORS.textPrimary,
                  margin: '0 0 16px 0',
                  textAlign: 'center',
                  letterSpacing: '-0.025em',
                }}>
                  {chartTitle}
                </h4>
                
                {loading ? (
                  renderSidebarChartLoading()
                ) : relationError ? (
                  renderSidebarChartError()
                ) : (
                  <div style={{ 
                    height: '352px',
                    width: '100%',
                    background: '#fafafa',
                    borderRadius: '8px',
                    padding: '0',
                  }}>
                    {relationTimelineChart(352)}
                  </div>
                )}
              </div>

              <button
                onClick={() => setViewMode("info")}
                style={{ 
                  ...buttonStyles.secondary, 
                  width: '100%',
                  marginTop: '16px'
                }}
                {...buttonHandlers.secondary}
              >
                관계 정보로 돌아가기
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mergeRefs(tooltipRef, clickOutsideRef)}
      className={`edge-tooltip-container edge-tooltip-flip${viewMode === 'chart' ? ' flipped' : ''}`}
      style={{
        ...tooltipStyles.container,
        left: position.x,
        top: position.y,
        zIndex,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? "none" : `opacity ${ANIMATION_VALUES.DURATION.NORMAL} ease-in-out`,
        cursor: isDragging ? "grabbing" : "grab",
        ...(style || {}),
      }}
      onMouseDown={handleMouseDown}
    >
      <div 
        className="edge-tooltip-flip-inner" 
        style={{
          ...tooltipStyles.flipInner,
          transform: viewMode === 'chart' ? 'rotateY(180deg)' : 'rotateY(0deg)'
        }}
      >
        <div className="edge-tooltip-content edge-tooltip-front" style={tooltipStyles.front}>
          <button
            onClick={onClose}
            className="tooltip-close-btn"
            style={buttonStyles.tooltipClose}
            {...buttonHandlers.tooltipClose}
          >
            &times;
          </button>
          {viewMode === "info" && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {(isViewer && effectiveNoRelation) ? (
                renderTooltipStatusPanel({
                  message: '관계 형성이 이뤄지지 않았습니다',
                  fontSize: 16,
                  maxWidth: '280px',
                  includeOuterWidth: true,
                  footer: (
                    <div
                      className="edge-tooltip-actions"
                      style={{ ...tooltipActionBarStyle, marginTop: 'auto' }}
                    >
                      <button
                        className="relation-change-chart-btn edge-tooltip-animated-btn"
                        style={buttonStyles.primary}
                        onClick={() => setViewMode("chart")}
                        {...buttonHandlers.primary}
                      >
                        관계 변화 그래프
                      </button>
                    </div>
                  ),
                })
              ) : (
                <div style={{ 
                  height: '100%',
                  display: 'flex', 
                  flexDirection: 'column', 
                  overflow: 'hidden',
                  padding: isViewer ? '0.5rem 0.25rem' : '0.5rem'
                }}>
                  <div 
                    className="edge-tooltip-header" 
                    style={{ 
                      ...tooltipStyles.header, 
                      padding: isViewer ? '0.75rem 0.5rem' : '0.75rem',
                      width: 'calc(100% - 40px)',
                      margin: '0 auto',
                      flexShrink: 0
                    }}
                  >
                    <div className="relation-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.375rem', marginBottom: '0.5rem' }}>
                      {relationLabels.map((relation, index) => (
                        <span
                          key={index}
                          className="relation-tag"
                          style={tooltipStyles.relationTag}
                        >
                          {relation}
                        </span>
                      ))}
                    </div>
                    <div className="relation-weight">
                      <div className="weight-header">
                        <span
                          className="weight-label"
                          style={{ color: relationStyle.color }}
                        >
                          {relationStyle.text}
                        </span>
                        <span className="weight-value">
                          {`${positivityPercentage}%`}
                        </span>
                      </div>
                      {renderPositivityMeter(false)}
                    </div>
                  </div>
                  {explanationParts.hasExplanation && (
                    <div 
                      className="edge-tooltip-body" 
                      style={{ 
                        flex: 1,
                        overflowY: 'auto',
                        display: 'flex', 
                        alignItems: 'flex-start', 
                        justifyContent: 'center',
                        padding: isViewer ? '0.5rem 0.5rem' : '0.5rem',
                        width: 'calc(100% - 40px)',
                        margin: '0 auto',
                        minHeight: 0
                      }}
                    >
                      {renderExplanationBody('tooltip')}
                    </div>
                  )}
                  <div
                    className="edge-tooltip-actions"
                    style={tooltipActionBarStyle}
                  >
                    <button
                      className="relation-change-chart-btn edge-tooltip-animated-btn"
                      style={buttonStyles.primary}
                      onClick={() => setViewMode("chart")}
                      {...buttonHandlers.primary}
                    >
                      관계 변화 그래프
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="edge-tooltip-content edge-tooltip-back" style={tooltipStyles.back}>
          {viewMode === "chart" && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <h3 style={{ 
                margin: "0.75rem 0 0.5rem 0", 
                fontWeight: 700, 
                fontSize: '1.125rem', 
                textAlign: "center",
                flexShrink: 0
              }}>
                {chartTitle}
              </h3>
              {loading ? (
                <div style={{ 
                  flex: 1,
                  textAlign: "center", 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  minHeight: 0
                }}>
                  불러오는 중...
                </div>
              ) : shouldShowRelationError ? (
                renderTooltipStatusPanel({
                  message: '데이터를 불러올 수 없습니다',
                  messageColor: '#ef4444',
                  footer: (
                    <div style={tooltipActionBarStyle}>
                      <button
                        onClick={fetchData}
                        style={buttonStyles.secondary}
                        {...buttonHandlers.secondary}
                      >
                        다시 시도
                      </button>
                    </div>
                  ),
                })
              ) : (isViewer && effectiveNoRelation) ? (
                renderTooltipStatusPanel({
                  message: '관계 형성이 이뤄지지 않았습니다',
                  footer: (
                    <div style={tooltipActionBarStyle}>
                      <button
                        style={buttonStyles.secondary}
                        onClick={() => setViewMode("info")}
                        {...buttonHandlers.secondary}
                      >
                        간선 정보로 돌아가기
                      </button>
                    </div>
                  ),
                })
              ) : (
                <div style={{ 
                  flex: 1,
                  padding: '0.5rem 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 0,
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: '100%',
                    height: '100%',
                    maxHeight: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {relationTimelineChart(280)}
                  </div>
                </div>
              )}
              {!isViewer && !loading && !shouldShowRelationError && (
                <div style={{ 
                  fontSize: '0.8125rem', 
                  color: "#64748b", 
                  marginTop: '0.5rem', 
                  marginBottom: '0.5rem', 
                  textAlign: "center",
                  flexShrink: 0
                }}>
                  x축: 챕터별 마지막/이벤트, y축: 관계 긍정도(-1~1)
                </div>
              )}
              {!(isViewer && effectiveNoRelation) && (
              <div style={{ 
                ...tooltipActionBarStyle,
                paddingTop: '0.75rem',
              }}>
                <button
                  style={buttonStyles.secondary}
                  onClick={() => setViewMode("info")}
                  {...buttonHandlers.secondary}
                >
                  간선 정보로 돌아가기
                </button>
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(UnifiedEdgeTooltip, (prevProps, nextProps) => {
  return (
    prevProps.data === nextProps.data &&
    prevProps.x === nextProps.x &&
    prevProps.y === nextProps.y &&
    prevProps.currentEvent === nextProps.currentEvent &&
    prevProps.prevValidEvent === nextProps.prevValidEvent &&
    prevProps.chapterNum === nextProps.chapterNum &&
    prevProps.eventNum === nextProps.eventNum &&
    prevProps.variant === nextProps.variant &&
    prevProps.mode === nextProps.mode &&
    prevProps.displayMode === nextProps.displayMode
  );
});

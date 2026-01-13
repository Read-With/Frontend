import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Line } from "react-chartjs-2";
import "chart.js/auto";
import { useParams } from "react-router-dom";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { useRelationData } from "../../../hooks/useRelationData";
import { getRelationStyle, getRelationLabels, tooltipStyles } from "../../../utils/styles/relationStyles";
import { createButtonStyle, createAdvancedButtonHandlers, COLORS, ANIMATION_VALUES, unifiedNodeTooltipStyles } from "../../../utils/styles/styles";
import { mergeRefs } from "../../../utils/styles/animations";
import { safeNum, processRelationTagsCached } from "../../../utils/relationUtils";
import { cleanupRelationUtils } from "../../../utils/common/cleanupUtils";
import { getMaxChapter } from "../../../utils/common/cache/manifestCache";
import "../RelationGraph.css";

/**
 * 통합 간선 툴팁 컴포넌트
 * @param {object} props - 컴포넌트 props
 * @param {object} props.data - 간선 데이터
 * @param {number} props.x - 초기 X 좌표
 * @param {number} props.y - 초기 Y 좌표
 * @param {function} props.onClose - 닫기 핸들러
 * @param {object} props.sourceNode - 출발 노드
 * @param {object} props.targetNode - 도착 노드
 * @param {object} props.style - 추가 스타일
 * @param {string} props.mode - 'standalone' | 'viewer'
 * @param {string} props.displayMode - 'tooltip' | 'sidebar'
 * @param {number} props.chapterNum - 현재 챕터 번호
 * @param {number} props.eventNum - 현재 이벤트 번호
 * @param {number} props.maxChapter - 최대 챕터 수 (standalone 모드에서만 사용)
 */
function UnifiedEdgeTooltip({
  data,
  x,
  y,
  onClose,
  sourceNode,
  targetNode,
  style,
  mode = 'standalone', // 'standalone' | 'viewer'
  displayMode = 'tooltip', // 'tooltip' | 'sidebar'
  chapterNum = 1,
  eventNum = 1,
  maxChapter,
  currentEvent = null,
  prevValidEvent = null,
  events = [],
  bookId = null, // API 책 ID
}) {
  const { filename } = useParams();

  // 위치 및 드래그 관리 (사이드바 모드에서는 사용하지 않음)
  const {
    position,
    showContent,
    isDragging,
    justFinishedDragging,
    tooltipRef,
    handleMouseDown,
  } = displayMode === 'sidebar' ? {
    position: { x: 0, y: 0 },
    showContent: true,
    isDragging: false,
    justFinishedDragging: false,
    tooltipRef: null,
    handleMouseDown: () => {},
  } : useTooltipPosition(x, y);

  // 외부 클릭 감지 훅 - 툴팁 외부 클릭 시 닫기 (사이드바 모드에서는 비활성화, 드래그 후 클릭 무시)
  const clickOutsideRef = displayMode === 'sidebar' ? null : useClickOutside(() => {
    if (onClose) onClose();
  }, showContent, true);

  // ref 병합은 animations.js에서 import한 함수 사용

  // 뷰 모드: "info" | "chart"
  const [viewMode, setViewMode] = useState("info");
  
  // 로딩 상태 관리
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // 간선이 변경될 때마다 viewMode를 "info"로 리셋
  useEffect(() => {
    setViewMode("info");
  }, [data?.id, data?.source, data?.target]);

  // ViewerTopBar와 동일한 방식으로 이벤트 정보 처리
  const getUnifiedEventInfo = useCallback(() => {
    // ViewerTopBar와 동일한 로직: currentEvent || prevValidEvent
    const eventToShow = currentEvent || prevValidEvent;
    
    if (eventToShow) {
      return {
        eventNum: eventToShow.eventNum ?? 0,
        name: eventToShow.name || eventToShow.event_name || "",
        chapterProgress: eventToShow.chapterProgress,
        currentChars: eventToShow.currentChars,
        totalChars: eventToShow.totalChars
      };
    }
    
    // 이벤트 정보가 없는 경우 기존 로직 사용 (하위 호환성)
    return { eventNum: eventNum || 0 };
  }, [currentEvent, prevValidEvent, eventNum]);


  // source/target을 safeNum으로 변환
  const id1 = safeNum(data.source);
  const id2 = safeNum(data.target);

  // 통합된 이벤트 정보 가져오기
  const unifiedEventInfo = getUnifiedEventInfo();

  // 그래프 온리 페이지 감지 (URL 패턴으로 판단)
  const isGraphOnlyPage = window.location.pathname.includes('/user/graph/');
  
  // 모드 결정: 그래프 온리 페이지에서는 cumulative 모드 사용
  const relationDataMode = useMemo(() => {
    if (mode === 'viewer') {
      return 'viewer';
    }
    if (isGraphOnlyPage || displayMode === 'sidebar' || bookId) {
      return 'cumulative';
    }
    return mode;
  }, [mode, isGraphOnlyPage, displayMode, bookId]);

  const numericBookId = useMemo(() => {
    if (bookId !== null && bookId !== undefined) {
      const parsed = Number(bookId);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    if (filename) {
      const parsed = Number(filename);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }, [bookId, filename]);

  const safeMaxChapterValue = useMemo(() => {
    if (maxChapter && maxChapter > 0) {
      return maxChapter;
    }
    if (numericBookId) {
      const manifestMax = getMaxChapter(numericBookId);
      if (manifestMax && manifestMax > 0) {
        return manifestMax;
      }
    }
    return 10;
  }, [maxChapter, numericBookId]);
  
  // 관계 데이터 관리 (그래프 온리 페이지에서는 누적 모드 사용)
  const {
    timeline,
    labels,
    loading,
    noRelation,
    error: relationError,
    fetchData,
    getMaxEventCount,
  } = useRelationData(relationDataMode, id1, id2, chapterNum, unifiedEventInfo.eventNum, safeMaxChapterValue, filename, numericBookId);


  // 초기 로딩 완료 감지
  useEffect(() => {
    if (!loading && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [loading, isInitialLoad]);

  // 차트 모드일 때 데이터 가져오기 (통합된 이벤트 정보 사용)
  useEffect(() => {
    if (viewMode === "chart") {
      fetchData();
    }
  }, [viewMode, id1, id2, chapterNum, unifiedEventInfo.eventNum, maxChapter, fetchData]);

  // 앞면에서도 관계 존재 여부 확인 (viewer 모드에서만, 통합된 이벤트 정보 사용)
  useEffect(() => {
    if (viewMode === "info" && mode === 'viewer') {
      fetchData();
    }
  }, [viewMode, id1, id2, chapterNum, unifiedEventInfo.eventNum, mode, fetchData]);

  // 컴포넌트 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      cleanupRelationUtils();
    };
  }, []);

  // 관계 라벨 배열 생성 (캐시된 함수 사용으로 성능 최적화)
  const relationLabels = processRelationTagsCached(data.relation, data.label);

  const hasFallbackPositivity = typeof data?.positivity === 'number' && !Number.isNaN(data.positivity);
  const clampedFallbackPositivity = hasFallbackPositivity
    ? Math.max(-1, Math.min(1, data.positivity))
    : null;

  const timelineHasNumeric = Array.isArray(timeline)
    ? timeline.some(value => typeof value === 'number' && !Number.isNaN(value))
    : false;

  const currentEventNumber = useMemo(() => {
    const candidates = [
      currentEvent?.eventNum,
      currentEvent?.eventIdx,
      eventNum
    ];

    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return 1;
  }, [currentEvent?.eventNum, currentEvent?.eventIdx, eventNum]);

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

  const earliestNumericLabel = useMemo(() => {
    if (!timelineHasNumeric || !Array.isArray(labels) || labels.length === 0) {
      return null;
    }
    const length = Math.min(labels.length, timeline.length);
    for (let i = 0; i < length; i += 1) {
      const label = labels[i];
      const value = timeline[i];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        continue;
      }
      const numericLabel = extractNumericLabel(label);
      if (Number.isFinite(numericLabel) && numericLabel > 0) {
        return numericLabel;
      }
    }
    return null;
  }, [timelineHasNumeric, labels, timeline, extractNumericLabel]);

  const effectiveEventColumns = useMemo(() => {
    if (isGraphOnlyPage) return Number.POSITIVE_INFINITY;

    const candidate = Number(currentEventNumber);
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }

    return Number.POSITIVE_INFINITY;
  }, [isGraphOnlyPage, currentEventNumber]);

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

        if (!isGraphOnlyPage && Number.isFinite(effectiveEventColumns) && numericLabel > effectiveEventColumns) {
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

    if (pairs.length === 0 && clampedFallbackPositivity !== null) {
      pairs.push({
        value: clampedFallbackPositivity,
        label: `E${currentEventNumber || 1}`,
        numericLabel: currentEventNumber || 1,
        isChapterAggregate: false
      });
    }

    return pairs;
  }, [
    timelineHasNumeric,
    labels,
    timeline,
    extractNumericLabel,
    currentEventNumber,
    clampedFallbackPositivity,
    isGraphOnlyPage,
    effectiveEventColumns
  ]);

  const activeEventHasPositivity = useMemo(() => {
    if (chartPairs.length === 0) return false;
    if (isGraphOnlyPage) return true;
    const currentEventIdx = Number(currentEvent?.eventNum ?? currentEvent?.eventIdx ?? eventNum ?? 0);
    if (!Number.isFinite(currentEventIdx) || currentEventIdx <= 0) {
      return chartPairs.length > 0;
    }
    const currentLabel = `E${currentEventIdx}`;
    return chartPairs.some(pair => pair.label === currentLabel || pair.numericLabel === currentEventIdx);
  }, [chartPairs, currentEvent, eventNum, isGraphOnlyPage]);

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
  const effectiveNoRelation = !hasChartData;
  const shouldShowRelationError = !!relationError && !hasChartData;

  const timelinePositivity = useMemo(() => {
    const validPairs = chartPairs.filter(pair => typeof pair?.value === 'number' && !Number.isNaN(pair.value));
    if (validPairs.length === 0) {
      return null;
    }

    const getLastEventPair = () => {
      for (let i = validPairs.length - 1; i >= 0; i -= 1) {
        const pair = validPairs[i];
        if (!pair?.isChapterAggregate) {
          return pair;
        }
      }
      return validPairs[validPairs.length - 1] ?? null;
    };

    if (mode === 'viewer') {
      let targetEvent = Number(currentEventNumber || 0);

      if ((!Number.isFinite(targetEvent) || targetEvent <= 0) && validPairs.length > 0) {
        const firstPair = validPairs.find(pair => !pair.isChapterAggregate && Number.isFinite(pair.numericLabel));
        if (firstPair?.numericLabel) {
          targetEvent = firstPair.numericLabel;
        }
      }

      if (Number.isFinite(targetEvent) && targetEvent > 0) {
        for (let i = validPairs.length - 1; i >= 0; i -= 1) {
          const pair = validPairs[i];
          if (pair?.isChapterAggregate) continue;
          if (pair?.numericLabel === targetEvent) {
            return pair.value;
          }
        }
        for (let i = validPairs.length - 1; i >= 0; i -= 1) {
          const pair = validPairs[i];
          if (pair?.isChapterAggregate) continue;
          if (typeof pair?.numericLabel === 'number' && pair.numericLabel < targetEvent) {
            return pair.value;
          }
        }
      }
      const fallbackPair = getLastEventPair();
      return fallbackPair ? fallbackPair.value : null;
    }

    const lastPair = getLastEventPair();
    return lastPair ? lastPair.value : null;
  }, [chartPairs, mode, currentEventNumber]);

  const effectivePositivity = useMemo(() => {
    if (typeof timelinePositivity === 'number' && !Number.isNaN(timelinePositivity)) {
      return Math.max(-1, Math.min(1, timelinePositivity));
    }
    if (typeof clampedFallbackPositivity === 'number' && !Number.isNaN(clampedFallbackPositivity)) {
      return clampedFallbackPositivity;
    }
    return null;
  }, [timelinePositivity, clampedFallbackPositivity]);

  const hasDisplayPositivity = typeof effectivePositivity === 'number' && !Number.isNaN(effectivePositivity);
  const displayPositivityValue = hasDisplayPositivity ? effectivePositivity : null;
  const positivityForBars = hasDisplayPositivity ? effectivePositivity : 0;
  const positivityPercentage = hasDisplayPositivity ? Math.round(effectivePositivity * 100) : null;

  // positivity 값에 따른 색상과 텍스트 결정 (filename 기반)
  const relationStyle = getRelationStyle(hasDisplayPositivity ? effectivePositivity : 0, filename);

  // utils/styles에서 가져온 버튼 스타일 사용
  const buttonStyles = {
    primary: createButtonStyle(ANIMATION_VALUES, 'primaryEdge'),
    secondary: createButtonStyle(ANIMATION_VALUES, 'secondaryEdge'),
    close: createButtonStyle(ANIMATION_VALUES, 'closeEdge'),
    tooltipClose: createButtonStyle(ANIMATION_VALUES, 'tooltipClose')
  };

  // utils/styles에서 가져온 버튼 핸들러 사용
  const buttonHandlers = {
    primary: createAdvancedButtonHandlers('primaryEdge'),
    secondary: createAdvancedButtonHandlers('secondaryEdge'),
    close: createAdvancedButtonHandlers('closeEdge'),
    tooltipClose: createAdvancedButtonHandlers('tooltipClose')
  };

  // utils/styles에서 가져온 카드 스타일 사용
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

  // relationStyles의 기존 스타일을 사용한 진행률 바 렌더링 함수
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

  // 퍼센트 라벨 렌더링 함수 (utils/styles의 COLORS 사용)
  const renderPercentageLabels = (isSidebar = false) => {
    return [20, 40, 60, 80, 100].map((step, idx) => (
      <span
        key={idx}
        style={{
          width: isSidebar ? '80px' : 80,
          textAlign: 'center',
          fontSize: isSidebar ? '12px' : 12,
          color: isSidebar ? COLORS.textSecondary : COLORS.textSecondary,
          display: 'inline-block',
          lineHeight: '1.2',
        }}
      >
        {step}%
      </span>
    ));
  };

  // 점 색상 배열 생성 (그래프 온리 페이지에서 라벨에 따라 색상 구분)
  const getPointBackgroundColors = () => {
    if (!hasChartData) return [];
    return chartPairs.map(pair => {
      if (typeof pair.label === 'string' && pair.label.startsWith('Ch')) {
        return "#9ca3af";
      }
      return "#5C6F5C";
    });
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

  const chartConfig = {
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: "관계 긍정도",
          data: chartPoints,
          borderColor: "#5C6F5C",
          backgroundColor: "rgba(92,111,92,0.1)",
          pointBackgroundColor: getPointBackgroundColors(),
          pointBorderColor: getPointBackgroundColors(),
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.3,
          spanGaps: true,
          parsing: false
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: 0
      },
      scales: {
        y: {
          min: -1,
          max: 1,
          title: { display: true, text: "긍정도" },
        },
        x: {
          type: 'linear',
          title: { display: false, text: '' },
          min: xAxisBounds.min,
          max: xAxisBounds.max,
          ticks: {
            stepSize: 1,
            callback: (value) => {
              if (!hasChartData) return '';
              return xLabelMap[value] ?? '';
            }
          }
        },
      },
      plugins: { 
        legend: { display: false },
        tooltip: {
          padding: 10,
          titleFont: {
            size: 15
          },
          bodyFont: {
            size: 15
          },
          borderRadius: 8,
          callbacks: {
            title: function(context) {
              if (!context?.length) return '';
              const point = context[0];
              const label = xLabelMap[Math.round(point.parsed.x)];
              return label || '';
            },
            label: function(context) {
              const value = context.parsed.y;
              const percentage = Math.round(value * 100);
              return `관계 긍정도: ${percentage}%`;
            }
          }
        }
      },
    }
  };

  // 모드별 설정 (통합된 이벤트 정보 사용)
  const zIndex = mode === 'viewer' ? 99999 : 99999;
  
  // 모드별 차트 제목 설정
  let chartTitle = "관계 변화 그래프";
  if (mode === 'viewer') {
    chartTitle = `Chapter ${chapterNum} 관계 변화`;
  } else if (isGraphOnlyPage) {
    chartTitle = `Chapter ${chapterNum}까지의 누적 관계 변화`;
  }
  // 동적으로 최대 챕터 수 계산

  // 사이드바 모드일 때는 완전히 다른 레이아웃 사용
  if (displayMode === 'sidebar') {
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
        {/* 사이드바 헤더 */}
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
          
          {/* 관계 태그들 - 툴팁과 동일한 스타일 */}
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

        {/* 사이드바 본문 */}
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
              {/* 관계 긍정도 섹션 */}
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
                    {positivityPercentage !== null ? `${positivityPercentage}%` : "N/A"}
                  </span>
                </div>
                
                {/* 진행률 바 - 공통 함수 사용 */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '4px',
                  height: '28px',
                  margin: '16px 0 8px 0',
                  justifyContent: 'center',
                }}>
                  {renderProgressBars(positivityForBars, relationStyle, true)}
                </div>
                
                {/* 퍼센트 라벨 - 공통 함수 사용 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '4px',
                  marginBottom: '8px',
                }}>
                  {renderPercentageLabels(true)}
                </div>
              </div>

              {/* 설명 섹션 */}
              {data.explanation && (
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
                  <div style={{
                    borderLeft: `4px solid ${relationStyle.color}`,
                    paddingLeft: '16px',
                  }}>
                    <p style={{
                      margin: '0 0 8px 0',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      color: COLORS.textPrimary,
                      fontWeight: '500',
                      letterSpacing: '-0.01em',
                      wordBreak: 'keep-all',
                    }}>
                      {data.explanation.split("|")[0]}
                    </p>
                    {data.explanation.split("|")[1] && (
                      <p style={{
                        margin: 0,
                        fontSize: '14px',
                        lineHeight: '1.6',
                        color: COLORS.textSecondary,
                        letterSpacing: '-0.01em',
                        wordBreak: 'keep-all',
                      }}>
                        {data.explanation.split("|")[1]}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 차트 보기 버튼 - 다른 페이지와 일관성 있는 스타일 */}
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
              {/* 차트 섹션 */}
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
                  <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: COLORS.textSecondary,
                    fontSize: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                  }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      border: '3px solid #e5e7eb',
                      borderTop: '3px solid #5C6F5C',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}></div>
                    <span>데이터를 불러오는 중...</span>
                  </div>
                ) : relationError ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#ef4444',
                    fontSize: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                  }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#fef2f2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                    }}>
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
                ) : (
                  <div style={{ 
                    height: '352px',
                    width: '100%',
                    background: '#fafafa',
                    borderRadius: '8px',
                    padding: '0',
                  }}>
                    <Line {...chartConfig} />
                  </div>
                )}
              </div>

              {/* 정보 보기 버튼 - 다른 페이지와 일관성 있는 스타일 */}
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

  // 툴팁 모드일 때는 기존 코드 사용
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
        {/* 앞면 */}
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
            <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
              {(mode === 'viewer' && effectiveNoRelation) ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '1rem',
                  minHeight: '100%',
                  width: 'calc(100% - 40px)',
                  margin: '0 auto'
                }}>
                  <div style={{ 
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <div style={{ 
                      textAlign: "center", 
                      color: "#64748b", 
                      fontSize: 16,
                      maxWidth: '280px',
                      lineHeight: '1.5',
                      wordBreak: 'keep-all'
                    }}>
                      관계 형성이 이뤄지지 않았습니다
                    </div>
                  </div>
                  <div
                    className="edge-tooltip-actions"
                    style={{ 
                      marginTop: 'auto', 
                      paddingTop: '0.5rem', 
                      paddingBottom: mode === 'viewer' ? '0.5rem' : '0.75rem', 
                      textAlign: "center",
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      width: 'calc(100% - 40px)',
                      margin: '0 auto'
                    }}
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
              ) : (
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flex: 1,
                  padding: mode === 'viewer' ? '1rem 0.25rem' : '1rem'
                }}>
                  <div className="edge-tooltip-header" style={{ 
                    ...tooltipStyles.header, 
                    padding: mode === 'viewer' ? '0.75rem 0.5rem' : '0.75rem',
                    width: 'calc(100% - 40px)',
                    margin: '0 auto'
                  }}>
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
                          {positivityPercentage !== null ? `${positivityPercentage}%` : "N/A"}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          gap: '0.2rem',
                          height: '1.4rem',
                          margin: "0.5rem 0 0.25rem 0",
                          justifyContent: "center",
                        }}
                      >
                        {renderProgressBars(positivityForBars, relationStyle, false)}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          gap: '0.2rem',
                          marginBottom: '0.25rem',
                        }}
                      >
                        {renderPercentageLabels(false)}
                      </div>
                    </div>
                  </div>
                  {data.explanation && (
                    <div className="edge-tooltip-body" style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      padding: mode === 'viewer' ? '0.75rem 0.5rem' : '0.75rem',
                      width: 'calc(100% - 40px)',
                      margin: '0 auto'
                    }}>
                      <div className="relation-explanation">
                        <div
                          className="quote-box"
                          style={{ borderLeft: `0.25rem solid ${relationStyle.color}` }}
                        >
                          <strong>{data.explanation.split("|")[0]}</strong>
                        </div>
                        {data.explanation.split("|")[1] && (
                          <p className="explanation-text">
                            {data.explanation.split("|")[1]}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <div
                    className="edge-tooltip-actions"
                    style={{ 
                      marginTop: 'auto', 
                      paddingTop: '0.5rem', 
                      paddingBottom: mode === 'viewer' ? '0.5rem' : '0.75rem', 
                      textAlign: "center",
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      width: 'calc(100% - 40px)',
                      margin: '0 auto'
                    }}
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

        {/* 뒷면 */}
        <div className="edge-tooltip-content edge-tooltip-back" style={tooltipStyles.back}>
          {viewMode === "chart" && (
            <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ margin: "0.75rem 0 0.75rem 0", fontWeight: 700, fontSize: '1.125rem', textAlign: "center" }}>
                {chartTitle}
              </h3>
              {loading ? (
                <div style={{ textAlign: "center", marginTop: '3.75rem', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  불러오는 중...
                </div>
              ) : shouldShowRelationError ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '1rem',
                  minHeight: '100%'
                }}>
                  <div style={{ 
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <div style={{ 
                      textAlign: "center", 
                      color: "#ef4444", 
                      fontSize: '1rem',
                      maxWidth: '17.5rem',
                      lineHeight: '1.5',
                      wordBreak: 'keep-all'
                    }}>
                      데이터를 불러올 수 없습니다
                    </div>
                  </div>
                  <div style={{ 
                    marginTop: 'auto', 
                    paddingTop: '0.5rem', 
                    paddingBottom: mode === 'viewer' ? '0.5rem' : '0.75rem', 
                    textAlign: "center",
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 'calc(100% - 40px)',
                    margin: '0 auto'
                  }}>
                    <button
                      onClick={fetchData}
                      style={buttonStyles.secondary}
                      {...buttonHandlers.secondary}
                    >
                      다시 시도
                    </button>
                  </div>
                </div>
              ) : (mode === 'viewer' && effectiveNoRelation) ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '1rem',
                  minHeight: '100%'
                }}>
                  <div style={{ 
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <div style={{ 
                      textAlign: "center", 
                      color: "#64748b", 
                      fontSize: '1rem',
                      maxWidth: '17.5rem',
                      lineHeight: '1.5',
                      wordBreak: 'keep-all'
                    }}>
                      관계 형성이 이뤄지지 않았습니다
                    </div>
                  </div>
                  <div style={{ 
                    marginTop: 'auto', 
                    paddingTop: '0.5rem', 
                    paddingBottom: mode === 'viewer' ? '0.5rem' : '0.75rem', 
                    textAlign: "center",
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 'calc(100% - 40px)',
                    margin: '0 auto'
                  }}>
                    <button
                      style={buttonStyles.secondary}
                      onClick={() => setViewMode("info")}
                      {...buttonHandlers.secondary}
                    >
                      간선 정보로 돌아가기
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ 
                  flex: 1, 
                  padding: mode === 'viewer' ? '0.75rem 0' : '0.75rem 0',
                  display: 'flex',
                  alignItems: mode === 'viewer' ? 'flex-start' : 'center',
                  justifyContent: mode === 'viewer' ? 'flex-start' : 'center',
                  height: '50rem',
                  overflowY: 'auto'
                }}>
                  <div style={{ 
                    width: '100%',
                    height: mode === 'viewer' ? '100%' : 'auto'
                  }}>
                    <Line {...chartConfig} style={{ height: '12.5rem', width: '100%' }} />
                  </div>
                </div>
              )}
              {mode === 'standalone' && (
                <div style={{ fontSize: '0.8125rem', color: "#64748b", marginTop: '0.75rem', marginBottom: '0.75rem', textAlign: "center" }}>
                  x축: 챕터별 마지막/이벤트, y축: 관계 긍정도(-1~1)
                </div>
              )}
              <div style={{ 
                marginTop: 'auto', 
                paddingTop: '1rem', 
                paddingBottom: mode === 'viewer' ? '0.5rem' : '1rem', 
                textAlign: "center",
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: 'calc(100% - 40px)',
                margin: '0 auto'
              }}>
                <button
                  style={buttonStyles.secondary}
                  onClick={() => setViewMode("info")}
                  {...buttonHandlers.secondary}
                >
                  간선 정보로 돌아가기
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 성능 최적화를 위한 React.memo 적용
export default React.memo(UnifiedEdgeTooltip, (prevProps, nextProps) => {
  // 주요 props만 비교하여 불필요한 리렌더링 방지
  return (
    prevProps.data === nextProps.data &&
    prevProps.x === nextProps.x &&
    prevProps.y === nextProps.y &&
    prevProps.currentEvent === nextProps.currentEvent &&
    prevProps.prevValidEvent === nextProps.prevValidEvent &&
    prevProps.chapterNum === nextProps.chapterNum &&
    prevProps.eventNum === nextProps.eventNum &&
    prevProps.mode === nextProps.mode &&
    prevProps.displayMode === nextProps.displayMode
  );
});
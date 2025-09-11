import React, { useState, useEffect, useCallback } from "react";
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
import { cleanupRelationUtils } from "../../../utils/cleanupUtils";
import { getSafeMaxChapter, getFolderKeyFromFilename } from "../../../utils/graphData";
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
  }, true, true);

  // ref 병합은 animations.js에서 import한 함수 사용

  // 뷰 모드: "info" | "chart"
  const [viewMode, setViewMode] = useState("info");
  
  // 로딩 상태 관리
  const [isInitialLoad, setIsInitialLoad] = useState(true);

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

  // 디버깅: 이벤트 정보 변경 감지 (개발 환경에서만)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
    }
  }, [currentEvent, prevValidEvent, getUnifiedEventInfo]);

  // source/target을 safeNum으로 변환
  const id1 = safeNum(data.source);
  const id2 = safeNum(data.target);

  // 통합된 이벤트 정보 가져오기
  const unifiedEventInfo = getUnifiedEventInfo();

  // 그래프 온리 페이지 감지 (URL 패턴으로 판단)
  const isGraphOnlyPage = window.location.pathname.includes('/user/graph/');
  
  // 모드 결정: 그래프 온리 페이지에서는 cumulative 모드 사용
  const relationDataMode = isGraphOnlyPage ? 'cumulative' : mode;
  
  // 관계 데이터 관리 (그래프 온리 페이지에서는 누적 모드 사용)
  const {
    timeline,
    labels,
    loading,
    noRelation,
    error: relationError,
    fetchData,
    getMaxEventCount,
  } = useRelationData(relationDataMode, id1, id2, chapterNum, unifiedEventInfo.eventNum, maxChapter, filename);

  // 디버깅: 관계 데이터 상태 변경 감지 (개발 환경에서만)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
    }
  }, [timeline, labels, loading, noRelation]);

  // 초기 로딩 완료 감지
  useEffect(() => {
    if (!loading && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [loading, isInitialLoad]);

  // 차트 모드일 때 데이터 가져오기 (통합된 이벤트 정보 사용)
  useEffect(() => {
    if (viewMode === "chart") {
      if (process.env.NODE_ENV === 'development') {
      }
      fetchData();
    }
  }, [viewMode, id1, id2, chapterNum, unifiedEventInfo.eventNum, maxChapter, fetchData]);

  // 앞면에서도 관계 존재 여부 확인 (viewer 모드에서만, 통합된 이벤트 정보 사용)
  useEffect(() => {
    if (viewMode === "info" && mode === 'viewer') {
      if (process.env.NODE_ENV === 'development') {
      }
      fetchData();
    }
  }, [viewMode, id1, id2, chapterNum, unifiedEventInfo.eventNum, mode, fetchData]);

  // 컴포넌트 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      cleanupRelationUtils();
    };
  }, []);

  // positivity 값에 따른 색상과 텍스트 결정 (filename 기반)
  const relationStyle = getRelationStyle(data.positivity, filename);

  // 관계 라벨 배열 생성 (캐시된 함수 사용으로 성능 최적화)
  const relationLabels = processRelationTagsCached(data.relation, data.label);

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
    if (!isGraphOnlyPage || !labels) return "#2563eb";
    
    return labels.map(label => {
      // 라벨이 "Ch"로 시작하면 회색, "E"로 시작하면 파란색
      if (typeof label === 'string' && label.startsWith('Ch')) {
        return "#9ca3af"; // 회색
      }
      return "#2563eb"; // 파란색
    });
  };

  // 중복 제거된 차트 설정
  const chartConfig = {
    data: {
      labels,
      datasets: [
        {
          label: "관계 긍정도",
          data: timeline,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.1)",
          pointBackgroundColor: getPointBackgroundColors(),
          pointBorderColor: getPointBackgroundColors(),
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: -1,
          max: 1,
          title: { display: true, text: "긍정도" },
        },
        x: {
          title: { display: true, text: "이벤트 순서" },
          min: 0,
          max: getMaxEventCount(),
          ticks: {
            stepSize: 1
          }
        },
      },
      plugins: { 
        legend: { display: false },
        tooltip: {
          callbacks: {
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
  const folderKey = getFolderKeyFromFilename(filename);
  const safeMaxChapter = maxChapter || getSafeMaxChapter(folderKey, 10);

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
            padding: '0 20px',
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
                    {data.positivity !== undefined ? `${Math.round(data.positivity * 100)}%` : "N/A"}
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
                  {renderProgressBars(data.positivity, relationStyle, true)}
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
            <div style={{ padding: '20px 0' }}>
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
                      borderTop: '3px solid #2563eb',
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
                    height: '320px',
                    background: '#fafafa',
                    borderRadius: '8px',
                    padding: '16px',
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
              {(mode === 'viewer' && noRelation) ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '1.5rem',
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
                      lineHeight: '1.5'
                    }}>
                      관계 형성이 이뤄지지 않았습니다
                    </div>
                  </div>
                  <div
                    className="edge-tooltip-actions"
                    style={{ 
                      marginTop: 'auto', 
                      paddingTop: '1.25rem', 
                      paddingBottom: '0.375rem', 
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
                  padding: mode === 'viewer' ? '1.5rem 0.375rem' : '1.5rem'
                }}>
                  <div className="edge-tooltip-header" style={{ 
                    ...tooltipStyles.header, 
                    padding: mode === 'viewer' ? '1.25rem 0.5rem' : '1.25rem',
                    width: 'calc(100% - 40px)',
                    margin: '0 auto'
                  }}>
                    <div className="relation-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem 0.5rem', marginBottom: '0.75rem' }}>
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
                          {data.positivity !== undefined ? `${Math.round(data.positivity * 100)}%` : "N/A"}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          gap: '0.25rem',
                          height: '1.75rem',
                          margin: "1rem 0 0.5rem 0",
                          justifyContent: "center",
                        }}
                      >
                        {renderProgressBars(data.positivity, relationStyle, false)}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          gap: '0.25rem',
                          marginBottom: '0.5rem',
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
                      padding: mode === 'viewer' ? '1.25rem 0.5rem' : '1.25rem',
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
                      paddingTop: '1rem', 
                      paddingBottom: mode === 'viewer' ? '0.5rem' : '1rem', 
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
              ) : relationError ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '1.5rem',
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
                      lineHeight: '1.5'
                    }}>
                      데이터를 불러올 수 없습니다
                    </div>
                  </div>
                  <div style={{ 
                    marginTop: 'auto', 
                    paddingTop: '1.25rem', 
                    paddingBottom: '0.375rem', 
                    paddingLeft: '0.375rem', 
                    paddingRight: '0.375rem', 
                    textAlign: "center",
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center'
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
              ) : (mode === 'viewer' && noRelation) ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '1.5rem',
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
                      lineHeight: '1.5'
                    }}>
                      관계 형성이 이뤄지지 않았습니다
                    </div>
                  </div>
                  <div style={{ 
                    marginTop: 'auto', 
                    paddingTop: '1.25rem', 
                    paddingBottom: '0.375rem', 
                    paddingLeft: '0.375rem', 
                    paddingRight: '0.375rem', 
                    textAlign: "center",
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center'
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
                  padding: mode === 'viewer' ? '0.75rem 0.5rem' : '0.75rem 0',
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
                    <Line {...chartConfig} style={{ height: '12.5rem' }} />
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
                alignItems: 'center'
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
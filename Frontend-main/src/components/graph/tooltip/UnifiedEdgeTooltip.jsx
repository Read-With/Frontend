import React, { useState, useEffect, useCallback } from "react";
import { Line } from "react-chartjs-2";
import "chart.js/auto";
import { useParams } from "react-router-dom";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { useRelationData } from "../../../hooks/useRelationData";
import { getRelationStyle, getRelationLabels, tooltipStyles } from "../../../utils/relationStyles";
import { safeNum } from "../../../utils/relationUtils";
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
  chapterNum = 1,
  eventNum = 1,
  maxChapter = 10,
}) {
  const { filename } = useParams();

  // 위치 및 드래그 관리
  const {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
  } = useTooltipPosition(x, y);

  // 외부 클릭 감지 훅 - 툴팁 외부 클릭 시 닫기
  const clickOutsideRef = useClickOutside(() => {
    if (onClose) onClose();
  }, true);

  // ref 병합 함수
  const mergeRefs = useCallback((...refs) => {
    return (element) => {
      refs.forEach(ref => {
        if (typeof ref === 'function') {
          ref(element);
        } else if (ref != null) {
          ref.current = element;
        }
      });
    };
  }, []);

  // 뷰 모드: "info" | "chart"
  const [viewMode, setViewMode] = useState("info");

  // source/target을 safeNum으로 변환
  const id1 = safeNum(data.source);
  const id2 = safeNum(data.target);

  // 관계 데이터 관리
  const {
    timeline,
    labels,
    loading,
    noRelation,
    fetchData,
    getMaxEventCount,
  } = useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter, filename);

  // 차트 모드일 때 데이터 가져오기
  useEffect(() => {
    if (viewMode === "chart") {
      fetchData();
    }
  }, [viewMode, id1, id2, chapterNum, eventNum, maxChapter]);

  // 앞면에서도 관계 존재 여부 확인 (viewer 모드에서만)
  useEffect(() => {
    if (viewMode === "info" && mode === 'viewer') {
      fetchData();
    }
  }, [viewMode, id1, id2, chapterNum, eventNum, mode]);

  // positivity 값에 따른 색상과 텍스트 결정
  const relationStyle = getRelationStyle(data.positivity);

  // 관계 라벨 배열 생성
  const relationLabels = getRelationLabels(data.relation, data.label);

  // 모드별 설정
  const zIndex = mode === 'viewer' ? 10000 : 9999;
  const chartTitle = mode === 'viewer' ? `Chapter ${chapterNum}` : "관계 변화 그래프";
  const safeMaxChapter = mode === 'standalone' && maxChapter && !isNaN(maxChapter) ? maxChapter : 10;

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
        transition: isDragging ? "none" : "opacity 0.3s ease-in-out",
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
            onMouseDown={(e) => e.stopPropagation()}
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
                  minHeight: '100%',
                  padding: '20px'
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
                    style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: 6, textAlign: "center" }}
                  >
                    <button
                      className="relation-change-chart-btn edge-tooltip-animated-btn"
                      style={tooltipStyles.button.primary}
                      onClick={() => setViewMode("chart")}
                      onMouseOver={e => e.currentTarget.style.background = '#3b82f6'}
                      onMouseOut={e => e.currentTarget.style.background = '#2563eb'}
                      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
                      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
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
                  padding: mode === 'viewer' ? '20px 6px' : '20px'
                }}>
                  <div className="edge-tooltip-header" style={{ 
                    ...tooltipStyles.header, 
                    padding: mode === 'viewer' ? '20px 6px' : '20px',
                    width: '100%'
                  }}>
                    <div className="relation-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 10px', marginBottom: '10px' }}>
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
                          gap: 4,
                          height: 28,
                          margin: "12px 0 4px 0",
                          justifyContent: "center",
                        }}
                      >
                        {(() => {
                          let p = Math.abs(data.positivity ?? 0); // 절댓값 사용
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
                              background = `linear-gradient(to right, ${
                                relationStyle.color
                              } ${fill * 100}%, #e5e7eb ${fill * 100}%)`;
                            else background = "#e5e7eb";
                            return (
                              <div
                                key={i}
                                style={{
                                  ...tooltipStyles.progressBar,
                                  background,
                                }}
                              />
                            );
                          });
                        })()}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          gap: 4,
                          marginBottom: 4,
                        }}
                      >
                        {[20, 40, 60, 80, 100].map((step, idx) => (
                          <span
                            key={idx}
                            style={{
                              width: 80,
                              textAlign: "center",
                              fontSize: 12,
                              color: "#6b7280",
                              display: "inline-block",
                              lineHeight: "1.2",
                            }}
                          >
                            {step}%
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {data.explanation && (
                    <div className="edge-tooltip-body" style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      padding: mode === 'viewer' ? '20px 6px' : '20px',
                      width: '100%'
                    }}>
                      <div className="relation-explanation">
                        <div
                          className="quote-box"
                          style={{ borderLeft: `4px solid ${relationStyle.color}` }}
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
                    style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: mode === 'viewer' ? 6 : 20, textAlign: "center" }}
                  >
                    <button
                      className="relation-change-chart-btn edge-tooltip-animated-btn"
                      style={tooltipStyles.button.primary}
                      onClick={() => setViewMode("chart")}
                      onMouseOver={e => e.currentTarget.style.background = '#3b82f6'}
                      onMouseOut={e => e.currentTarget.style.background = '#2563eb'}
                      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
                      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
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
              <h3 style={{ margin: "10px 0 10px 0", fontWeight: 700, fontSize: 18, textAlign: "center" }}>
                {chartTitle}
              </h3>
              {loading ? (
                <div style={{ textAlign: "center", marginTop: 60, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  불러오는 중...
                </div>
              ) : (mode === 'viewer' && noRelation) ? (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center', 
                  padding: '20px',
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
                      fontSize: 16,
                      maxWidth: '280px',
                      lineHeight: '1.5'
                    }}>
                      관계 형성이 이뤄지지 않았습니다
                    </div>
                  </div>
                  <div style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: 6, paddingLeft: 6, paddingRight: 6, textAlign: "center" }}>
                    <button
                      style={tooltipStyles.button.secondary}
                      onClick={() => setViewMode("info")}
                      onMouseOver={e => e.currentTarget.style.background = '#e3eafe'}
                      onMouseOut={e => e.currentTarget.style.background = '#fff'}
                      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
                      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      간선 정보로 돌아가기
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ 
                  flex: 1, 
                  padding: mode === 'viewer' ? '10px 6px' : '10px 0',
                  display: 'flex',
                  alignItems: mode === 'viewer' ? 'flex-start' : 'center',
                  justifyContent: mode === 'viewer' ? 'flex-start' : 'center',
                  height: '800px',
                  overflowY: 'auto'
                }}>
                  <div style={{ 
                    width: '100%',
                    height: mode === 'viewer' ? '100%' : 'auto'
                  }}>
                    <Line
                      data={{
                        labels,
                        datasets: [
                          {
                            label: "관계 긍정도",
                            data: timeline,
                            borderColor: "#2563eb",
                            backgroundColor: "rgba(37,99,235,0.1)",
                            fill: true,
                            tension: 0.3,
                            spanGaps: true,
                          },
                        ],
                      }}
                      options={{
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
                        plugins: { legend: { display: false } },
                      }}
                      style={{ height: '200px' }}
                    />
                  </div>
                </div>
              )}
              {mode === 'standalone' && (
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 10, marginBottom: 10, textAlign: "center" }}>
                  x축: 챕터별 마지막/이벤트, y축: 관계 긍정도(-1~1)
                </div>
              )}
              <div style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: mode === 'viewer' ? 6 : 20, textAlign: "center" }}>
                <button
                  style={tooltipStyles.button.secondary}
                  onClick={() => setViewMode("info")}
                  onMouseOver={e => e.currentTarget.style.background = '#e3eafe'}
                  onMouseOut={e => e.currentTarget.style.background = '#fff'}
                  onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
                  onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
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

export default UnifiedEdgeTooltip;

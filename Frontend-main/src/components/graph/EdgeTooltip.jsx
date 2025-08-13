import React, { useState, useEffect, useRef } from "react";
import { Line } from "react-chartjs-2";
import "chart.js/auto";

// === glob import: 반드시 data/gatsby 하위 전체 관계 파일 import ===
const relationshipModules = import.meta.glob(
  "../../data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);

// 안전한 id 변환 함수: 1.0 → 1, "1.0" → 1, "1" → 1, 1 → 1, null/undefined → NaN
const safeNum = (v) => {
  if (v === undefined || v === null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return Number(String(v));
};

// 챕터별 마지막 이벤트 번호 구하기 (glob import 기반)
function getChapterLastEventNums(maxChapter = 10) {
  const lastNums = [];
  for (let chapter = 1; chapter <= maxChapter; chapter++) {
    let last = 0;
    for (let i = 1; i < 100; i++) {
      const filePath = `../../data/gatsby/chapter${chapter}_relationships_event_${i}.json`;
      if (relationshipModules[filePath]) {
        last = i;
      } else {
        break;
      }
    }
    lastNums.push(last);
  }
  return lastNums;
}

// 전체 챕터에서 최대 이벤트 수 계산
function getMaxEventCount(maxChapter = 10) {
  const lastEventNums = getChapterLastEventNums(maxChapter);
  return Math.max(...lastEventNums, 1); // 최소값 1 보장
}

// 관계 변화 데이터: 그래프 단독 페이지용
function fetchRelationTimelineMulti(
  id1,
  id2,
  chapterNum,
  eventNum,
  maxChapter = 10
) {
  const lastEventNums = getChapterLastEventNums(maxChapter);

  const points = [];
  const labelInfo = [];
  
  // 그래프 단독 페이지: 전체 챕터에서 처음 등장한 시점부터 현재 이벤트까지
  let firstAppearance = null;
  for (let ch = 1; ch <= chapterNum; ch++) {
    const lastEv = lastEventNums[ch - 1];
    for (let i = 1; i <= lastEv; i++) {
      const filePath = `../../data/gatsby/chapter${ch}_relationships_event_${i}.json`;
      const json = relationshipModules[filePath]?.default;
      if (!json) continue;
      
      const found = (json.relations || [])
        .filter(r => {
          const rid1 = safeNum(r.id1 ?? r.source);
          const rid2 = safeNum(r.id2 ?? r.target);
          return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
        })
        .find((r) => {
          const rid1 = safeNum(r.id1 ?? r.source);
          const rid2 = safeNum(r.id2 ?? r.target);
          const sid1 = safeNum(id1);
          const sid2 = safeNum(id2);
          
          const match = (
            (rid1 === sid1 && rid2 === sid2) ||
            (rid1 === sid2 && rid2 === sid1)
          );
          
          return match;
        });
      
      if (found) {
        firstAppearance = { chapter: ch, event: i };
        break;
      }
    }
    if (firstAppearance) break;
  }
  
  // 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
  if (firstAppearance) {
    for (let ch = firstAppearance.chapter; ch <= chapterNum; ch++) {
      const lastEv = ch === chapterNum ? eventNum : lastEventNums[ch - 1];
      const startEv = ch === firstAppearance.chapter ? firstAppearance.event : 1;
      
      for (let i = startEv; i <= lastEv; i++) {
        const filePath = `../../data/gatsby/chapter${ch}_relationships_event_${i}.json`;
        const json = relationshipModules[filePath]?.default;
        
        if (!json) {
          points.push(0);
          labelInfo.push(`챕터${ch} 이벤트${i}`);
          continue;
        }
        
        const found = (json.relations || [])
          .filter(r => {
            const rid1 = safeNum(r.id1 ?? r.source);
            const rid2 = safeNum(r.id2 ?? r.target);
            return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
          })
          .find((r) => {
            const rid1 = safeNum(r.id1 ?? r.source);
            const rid2 = safeNum(r.id2 ?? r.target);
            const sid1 = safeNum(id1);
            const sid2 = safeNum(id2);
            
            const match = (
              (rid1 === sid1 && rid2 === sid2) ||
              (rid1 === sid2 && rid2 === sid1)
            );
            
            return match;
          });
        
        points.push(found ? found.positivity : 0);
        labelInfo.push(`E${i}`);
      }
    }
  }
  
  return { points, labelInfo };
}

function EdgeTooltip({
  data,
  x,
  y,
  onClose,
  sourceNode,
  targetNode,
  style,
  maxChapter,
  chapterNum = 1,
  eventNum = 1,
}) {
  // 디버깅 로그 제거됨
  const safeMaxChapter = maxChapter && !isNaN(maxChapter) ? maxChapter : 10;
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const tooltipRef = useRef(null);

  // 뷰 모드: "info" | "chart"
  const [viewMode, setViewMode] = useState("info");
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);

  // source/target을 safeNum으로 변환
  const id1 = safeNum(data.source);
  const id2 = safeNum(data.target);

  useEffect(() => {
    if (viewMode === "chart") {
      setLoading(true);
      // import 방식은 동기이므로 바로 처리
      const result = fetchRelationTimelineMulti(
        id1,
        id2,
        chapterNum,
        eventNum,
        safeMaxChapter
      );
      
      // 이벤트가 1개일 때 가운데에 위치하도록 패딩 추가
      if (result.points.length === 1) {
        const paddedLabels = Array(11).fill('').map((_, index) => 
          index === 5 ? result.labelInfo[0] : ''
        );
        const paddedTimeline = Array(11).fill(null).map((_, index) => 
          index === 5 ? result.points[0] : null
        );
        setTimeline(paddedTimeline);
        setLabels(paddedLabels);
      } else {
        setTimeline(result.points);
        setLabels(result.labelInfo);
      }
      
      setLoading(false);
    }
  }, [viewMode, id1, id2, chapterNum, eventNum, safeMaxChapter]);

  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
    if (e.target.closest(".tooltip-close-btn")) return;
    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = Math.min(
      document.documentElement.clientWidth,
      window.innerWidth
    );
    const viewportHeight = Math.min(
      document.documentElement.clientHeight,
      window.innerHeight
    );
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    newX = Math.max(
      scrollX,
      Math.min(newX, viewportWidth + scrollX - tooltipRect.width)
    );
    newY = Math.max(
      scrollY,
      Math.min(newY, viewportHeight + scrollY - tooltipRect.height)
    );

    setPosition({ x: newX, y: newY });
    setHasDragged(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    } else {
      document.body.style.userSelect = "";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  useEffect(() => {
    if (
      x !== undefined &&
      y !== undefined &&
      tooltipRef.current &&
      !isDragging &&
      !hasDragged
    ) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = Math.min(
        document.documentElement.clientWidth,
        window.innerWidth
      );
      const viewportHeight = Math.min(
        document.documentElement.clientHeight,
        window.innerHeight
      );
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;

      let newX = x;
      let newY = y;

      newX = Math.max(
        scrollX,
        Math.min(newX, viewportWidth + scrollX - tooltipRect.width)
      );
      newY = Math.max(
        scrollY,
        Math.min(newY, viewportHeight + scrollY - tooltipRect.height)
      );

      setPosition({ x: newX, y: newY });
    }
  }, [x, y, isDragging, hasDragged]);

  // positivity 값에 따른 색상과 텍스트 결정
  const getRelationStyle = (positivity) => {
    // 색상: RelationGraphMain.jsx 방식(HSL 그라데이션)
    const h = (120 * (positivity + 1)) / 2; // -1~1 → 0~120
    const color = `hsl(${h}, 70%, 45%)`;
    // 텍스트 분류는 기존 방식 유지
    if (positivity > 0.6) return { color, text: "긍정적" };
    if (positivity > 0.3) return { color, text: "우호적" };
    if (positivity > -0.3) return { color, text: "중립적" };
    if (positivity > -0.6) return { color, text: "비우호적" };
    return { color, text: "부정적" };
  };

  const relationStyle = getRelationStyle(data.positivity);

  return (
    <div
      ref={tooltipRef}
      className={`edge-tooltip-container edge-tooltip-flip${viewMode === 'chart' ? ' flipped' : ''}`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 9999,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? "none" : "opacity 0.3s ease-in-out",
        cursor: isDragging ? "grabbing" : "grab",
        width: "380px",
        ...(style || {}),
        perspective: '1200px',
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="edge-tooltip-flip-inner" style={{ position: 'relative', width: '100%', minHeight: 400, height: 'auto', transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)', transformStyle: 'preserve-3d', transform: viewMode === 'chart' ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
        {/* 앞면 */}
        <div className="edge-tooltip-content edge-tooltip-front" style={{ backfaceVisibility: 'hidden', position: 'absolute', width: '100%', height: 'auto', minHeight: '100%', top: 0, left: 0 }}>
          <button
            onClick={onClose}
            className="tooltip-close-btn"
            onMouseDown={(e) => e.stopPropagation()}
          >
            &times;
          </button>
          {viewMode === "info" && (
            <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
              <div className="edge-tooltip-header" style={{ background: '#fff', borderBottom: 'none', padding: 20 }}>
                                 <div className="relation-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 10px', marginBottom: '10px' }}>
                   {(() => {
                     const relArr = Array.isArray(data.relation)
                       ? data.relation
                       : (typeof data.label === 'string' ? data.label.split(',').map(s => s.trim()).filter(Boolean) : []);
                     
                                           // 디버깅 로그 제거됨
                     
                     return relArr.map((relation, index) => (
                      <span
                        key={index}
                        className="relation-tag"
                        style={{
                          background: '#e3e6ef',
                          color: '#42506b',
                          borderRadius: '8px',
                          padding: '4px 12px',
                          fontSize: '13px',
                          fontWeight: 500,
                          display: 'inline-block',
                          lineHeight: 1.2,
                        }}
                      >
                        {relation}
                      </span>
                    ));
                  })()}
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
                              width: 80,
                              height: 24,
                              borderRadius: 6,
                              background,
                              opacity: 1,
                              transition: "background 0.3s",
                              border: "1.5px solid #e5e7eb",
                              boxSizing: "border-box",
                              marginBottom: 0,
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
                  padding: '20px',
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
                style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: 20, textAlign: "center" }}
              >
                <button
                  className="relation-change-chart-btn edge-tooltip-animated-btn"
                  style={{
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 22px',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
                    transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
                    margin: '0 auto',
                    display: 'inline-block',
                  }}
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
        {/* 뒷면 */}
        <div className="edge-tooltip-content edge-tooltip-back" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', position: 'absolute', width: '100%', height: 'auto', minHeight: '100%', top: 0, left: 0 }}>
          {viewMode === "chart" && (
            <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ margin: "10px 0 10px 0", fontWeight: 700, fontSize: 18, textAlign: "center" }}>
                관계 변화 그래프
              </h3>
              {loading ? (
                <div style={{ textAlign: "center", marginTop: 60, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  불러오는 중...
                </div>
              ) : (
                <div style={{ 
                  flex: 1, 
                  padding: '10px 0',
                  height: '800px',
                  overflowY: 'auto'
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
                          max: getMaxEventCount(safeMaxChapter),
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
              )}
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 10, marginBottom: 10, textAlign: "center" }}>
                x축: 챕터별 마지막/이벤트, y축: 관계 긍정도(-1~1)
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: 20, textAlign: "center" }}>
                <button
                  style={{
                    background: '#fff',
                    color: '#2563eb',
                    border: '1.5px solid #2563eb',
                    borderRadius: 8,
                    padding: '8px 22px',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
                    transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
                    margin: '0 auto',
                    display: 'inline-block',
                  }}
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

export default EdgeTooltip;

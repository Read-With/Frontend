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

// 관계 변화 데이터: 챕터별 마지막 이벤트 + 현재 챕터의 1~(eventNum-1)까지
function fetchRelationTimelineMulti(
  id1,
  id2,
  chapterNum,
  eventNum,
  maxChapter = 10
) {
  const lastEventNums = getChapterLastEventNums(maxChapter);
  console.log("[fetchRelationTimelineMulti] lastEventNums:", lastEventNums);

  const points = [];
  const labelInfo = [];
  // 이전 챕터: 각 챕터의 마지막 이벤트만
  for (let ch = 1; ch < chapterNum; ch++) {
    const lastEv = lastEventNums[ch - 1];
    if (lastEv === 0) continue;
    const filePath = `../../data/gatsby/chapter${ch}_relationships_event_${lastEv}.json`;
    const json = relationshipModules[filePath]?.default;
    if (!json) {
      console.warn(`[fetchRelationTimelineMulti] File not found:`, filePath);
      points.push(0);
      labelInfo.push(`챕터${ch} 마지막`);
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
        return (
          (rid1 === safeNum(id1) && rid2 === safeNum(id2)) ||
          (rid1 === safeNum(id2) && rid2 === safeNum(id1))
        );
      });
    if (found) {
      console.log(
        `[fetchRelationTimelineMulti] MATCH: ch${ch} lastEv${lastEv}`,
        found
      );
    } else {
      console.warn(
        `[fetchRelationTimelineMulti] NO MATCH for ${id1},${id2} in file`,
        filePath,
        (json.relations || []).map((r) => ({
          id1: r.id1 ?? r.source,
          id2: r.id2 ?? r.target,
        }))
      );
    }
    points.push(found ? found.positivity : 0); // 없으면 0으로!
    labelInfo.push(`챕터${ch} 마지막`);
  }
  // 현재 챕터: 1~(eventNum-1)까지, 단 eventNum이 1이면 1까지 보정
  const lastEv = Math.max(1, eventNum);
  for (let i = 1; i <= lastEv; i++) {
    const filePath = `../../data/gatsby/chapter${chapterNum}_relationships_event_${i}.json`;
    const json = relationshipModules[filePath]?.default;
    if (!json) {
      console.warn(`[fetchRelationTimelineMulti] File not found:`, filePath);
      points.push(0);
      labelInfo.push(`챕터${chapterNum} 이벤트${i}`);
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
        return (
          (rid1 === safeNum(id1) && rid2 === safeNum(id2)) ||
          (rid1 === safeNum(id2) && rid2 === safeNum(id1))
        );
      });
    if (found) {
      console.log(
        `[fetchRelationTimelineMulti] MATCH: ch${chapterNum} ev${i}`,
        found
      );
    } else {
      console.warn(
        `[fetchRelationTimelineMulti] NO MATCH for ${id1},${id2} in file`,
        filePath,
        (json.relations || []).map((r) => ({
          id1: r.id1 ?? r.source,
          id2: r.id2 ?? r.target,
        }))
      );
    }
    points.push(found ? found.positivity : 0); // 없으면 0으로!
    labelInfo.push(`챕터${chapterNum} 이벤트${i}`);
  }
  console.log(
    "[fetchRelationTimelineMulti] Final timeline:",
    points,
    labelInfo
  );
  return { points, labelInfo };
}

function EdgeTooltip({
  data,
  x,
  y,
  onClose,
  sourceNode,
  targetNode,
  inViewer = false,
  style,
  maxChapter,
  chapterNum = 1,
  eventNum = 1,
}) {
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
    console.log(
      "[EdgeTooltip] viewMode:",
      viewMode,
      "id1:",
      id1,
      "id2:",
      id2,
      "chapterNum:",
      chapterNum,
      "eventNum:",
      eventNum,
      "maxChapter:",
      safeMaxChapter
    );
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
      setTimeline(result.points);
      setLabels(result.labelInfo);
      setLoading(false);
      // 추가 로그
      console.log(
        "[EdgeTooltip] timeline:",
        result.points,
        "labels:",
        result.labelInfo
      );
      console.log(
        "[EdgeTooltip] timeline.length:",
        result.points.length,
        "labels.length:",
        result.labelInfo.length
      );
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
  const zIndexValue = inViewer ? 10000 : 9999;

  return (
    <div
      ref={tooltipRef}
      className={`edge-tooltip-container edge-tooltip-flip${viewMode === 'chart' ? ' flipped' : ''}`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: zIndexValue,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? "none" : "opacity 0.3s ease-in-out",
        cursor: isDragging ? "grabbing" : "grab",
        width: "380px",
        ...(style || {}),
        perspective: '1200px',
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="edge-tooltip-flip-inner" style={{ position: 'relative', width: '100%', minHeight: 320, transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)', transformStyle: 'preserve-3d', transform: viewMode === 'chart' ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
        {/* 앞면 */}
        <div className="edge-tooltip-content edge-tooltip-front" style={{ backfaceVisibility: 'hidden', position: 'absolute', width: '100%', height: 'auto', top: 0, left: 0 }}>
          <button
            onClick={onClose}
            className="tooltip-close-btn"
            onMouseDown={(e) => e.stopPropagation()}
          >
            &times;
          </button>
          {viewMode === "info" && (
            <>
              {/* === 현재 챕터/이벤트 번호 표시 === */}
              <div
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  marginBottom: 6,
                  fontWeight: 600,
                  textAlign: "right",
                }}
              ></div>
              <div className="edge-tooltip-header" style={{ background: '#fff', borderBottom: 'none', padding: 20 }}>
                <div className="relation-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 10px', marginBottom: '10px' }}>
                  {(() => {
                    const uniqueRelations = [];
                    const seen = new Set();
                    const relArr = Array.isArray(data.relation)
                      ? data.relation
                      : (typeof data.label === 'string' ? data.label.split(',').map(s => s.trim()).filter(Boolean) : []);
                    for (const rel of relArr) {
                      if (rel.includes(' ')) {
                        if (!seen.has(rel)) {
                          uniqueRelations.push(rel);
                          seen.add(rel);
                        }
                        continue;
                      }
                      const base = rel.length > 3 ? rel.slice(0, -1) : rel;
                      if (![...seen].some(s => s.startsWith(base))) {
                        uniqueRelations.push(rel);
                        seen.add(rel);
                      }
                    }
                    return uniqueRelations.map((relation, index) => (
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
              <div className="edge-tooltip-body">
                {data.explanation && (
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
                )}
              </div>
              <div
                className="edge-tooltip-actions"
                style={{ marginBottom: 10, textAlign: "center" }}
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
            </>
          )}
        </div>
        {/* 뒷면 */}
        <div className="edge-tooltip-content edge-tooltip-back" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', position: 'absolute', width: '100%', height: 'auto', top: 0, left: 0 }}>
          {viewMode === "chart" && (
            <div style={{ minHeight: 320 }}>
              <h3 style={{ margin: "10px 0 10px 0", fontWeight: 700, fontSize: 18, textAlign: "center" }}>
                관계 변화 그래프
              </h3>
              {loading ? (
                <div style={{ textAlign: "center", marginTop: 60 }}>
                  불러오는 중...
                </div>
              ) : (
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
                    scales: {
                      y: {
                        min: -1,
                        max: 1,
                        title: { display: true, text: "긍정도" },
                      },
                      x: { title: { display: true, text: "이벤트 순서" } },
                    },
                    plugins: { legend: { display: false } },
                  }}
                />
              )}
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 10, marginBottom: 10, textAlign: "center" }}>
                x축: 챕터별 마지막/이벤트, y축: 관계 긍정도(-1~1, 데이터 없으면 0)
              </div>
              <div style={{ marginTop: 4, marginBottom: 8, textAlign: "center" }}>
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

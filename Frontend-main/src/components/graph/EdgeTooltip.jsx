import React, { useState, useEffect, useRef } from "react";
import { Line } from "react-chartjs-2";
import "chart.js/auto";

// 관계 변화 데이터 불러오기 함수 (비교 시 모두 String 변환 + 콘솔 로그 추가)
async function fetchRelationTimeline(id1, id2, maxEventNum = 10) {
  const timeline = [];
  for (let i = 1; i <= maxEventNum; i++) {
    try {
      const url = `../data/gatsby/chapter1_relationships_event_${i}.json`;
      console.log(`[fetchRelationTimeline] Fetching:`, url);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[fetchRelationTimeline] Fetch failed:`, url);
        timeline.push(null);
        continue;
      }
      const json = await res.json();
      // relations 배열이 비어있는지 확인
      if (!json.relations || !Array.isArray(json.relations)) {
        console.warn(`[fetchRelationTimeline] No relations in:`, url, json);
        timeline.push(null);
        continue;
      }
      // 실제 비교 로그
      const found = json.relations.find((r) => {
        const match =
          (String(r.id1) === String(id1) && String(r.id2) === String(id2)) ||
          (String(r.id1) === String(id2) && String(r.id2) === String(id1));
        if (match) {
          console.log(`[fetchRelationTimeline] MATCH: event ${i}`, {
            r_id1: r.id1,
            r_id2: r.id2,
            id1,
            id2,
            positivity: r.positivity,
          });
        }
        return match;
      });
      if (!found) {
        // relations 전체를 로그로 찍어보기
        console.log(`[fetchRelationTimeline] No match for event ${i}`, {
          id1,
          id2,
          relations: json.relations.map((r) => ({ id1: r.id1, id2: r.id2 })),
        });
      }
      timeline.push(found ? found.positivity : null);
    } catch (e) {
      console.error(`[fetchRelationTimeline] Error:`, e);
      timeline.push(null);
    }
  }
  console.log(
    `[fetchRelationTimeline] Final timeline for (${id1}, ${id2}):`,
    timeline
  );
  return timeline;
}

function RelationChangeChartModal({
  open,
  onClose,
  id1,
  id2,
  maxEventNum = 10,
}) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetchRelationTimeline(id1, id2, maxEventNum).then((data) => {
        setTimeline(data);
        setLoading(false);
      });
    }
  }, [open, id1, id2, maxEventNum]);

  if (!open) return null;

  const data = {
    labels: timeline.map((_, idx) => `이벤트 ${idx + 1}`),
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
  };
  const options = {
    scales: {
      y: {
        min: -1,
        max: 1,
        title: { display: true, text: "긍정도" },
      },
      x: { title: { display: true, text: "이벤트 순서" } },
    },
    plugins: {
      legend: { display: false },
    },
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.18)",
        zIndex: 20000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          minWidth: 420,
          minHeight: 320,
          position: "relative",
          boxShadow: "0 6px 32px rgba(0,0,0,0.12)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            border: "none",
            background: "transparent",
            fontSize: 28,
            color: "#64748b",
            cursor: "pointer",
          }}
        >
          &times;
        </button>
        <h3 style={{ margin: "0 0 18px 0", fontWeight: 700, fontSize: 18 }}>
          관계 변화 그래프
        </h3>
        {loading ? (
          <div style={{ textAlign: "center", marginTop: 60 }}>
            불러오는 중...
          </div>
        ) : timeline.every((v) => v === null) ? (
          <div style={{ textAlign: "center", marginTop: 60, color: "#64748b" }}>
            이 인물 쌍의 관계 변화 데이터가 없습니다.
          </div>
        ) : (
          <Line data={data} options={options} />
        )}
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 16 }}>
          x축: 이벤트 순서, y축: 관계 긍정도(-1~1)
        </div>
      </div>
    </div>
  );
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
  maxEventNum = 10,
}) {
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const tooltipRef = useRef(null);

  // 관계 변화 그래프 모달 상태
  const [showRelationChart, setShowRelationChart] = useState(false);

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
    if (positivity > 0.6) return { color: "#15803d", text: "긍정적" };
    if (positivity > 0.3) return { color: "#059669", text: "우호적" };
    if (positivity > -0.3) return { color: "#6b7280", text: "중립적" };
    if (positivity > -0.6) return { color: "#dc2626", text: "비우호적" };
    return { color: "#991b1b", text: "부정적" };
  };

  const relationStyle = getRelationStyle(data.positivity);

  const zIndexValue = inViewer ? 10000 : 9999;

  // source/target을 반드시 String으로 변환 + 콘솔 로그
  const id1 = String(data.source);
  const id2 = String(data.target);
  console.log("[EdgeTooltip] EdgeTooltip opened for:", { id1, id2, data });

  return (
    <>
      <div
        ref={tooltipRef}
        className="edge-tooltip-container"
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
        }}
        onMouseDown={handleMouseDown}
      >
        <div className="edge-tooltip-content">
          <button
            onClick={onClose}
            className="tooltip-close-btn"
            onMouseDown={(e) => e.stopPropagation()}
          >
            &times;
          </button>
          <div className="edge-tooltip-header">
            <div className="relation-tags">
              {data.label.split(", ").map((relation, index) => (
                <span
                  key={index}
                  className="relation-tag"
                  style={{ backgroundColor: `${relationStyle.color}15` }}
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
                  {Math.round(data.weight * 10)}%
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
                  let p = data.positivity ?? 0;
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
          {/* === 관계 변화 그래프 버튼 추가 === */}
          <div
            className="edge-tooltip-actions"
            style={{ marginTop: 12, textAlign: "center" }}
          >
            <button
              className="relation-change-chart-btn"
              style={{
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 18px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                margin: "0 auto",
                display: "inline-block",
              }}
              onClick={() => setShowRelationChart(true)}
            >
              관계 변화 그래프
            </button>
          </div>
        </div>
      </div>
      {/* === 관계 변화 그래프 모달 === */}
      <RelationChangeChartModal
        open={showRelationChart}
        onClose={() => setShowRelationChart(false)}
        id1={id1}
        id2={id2}
        maxEventNum={maxEventNum}
      />
    </>
  );
}

export default EdgeTooltip;

import React, { useState, useEffect } from "react";
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
    // 이전 챕터들의 모든 마지막 이벤트 수집
    for (let ch = firstAppearance.chapter; ch < chapterNum; ch++) {
      const lastEv = lastEventNums[ch - 1];
      const filePath = `../../data/gatsby/chapter${ch}_relationships_event_${lastEv}.json`;
      const json = relationshipModules[filePath]?.default;
      
      if (!json) {
        points.push(0);
        labelInfo.push(`챕터${ch}`);
      } else {
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
        labelInfo.push(`챕터${ch}`);
      }
    }
    
    // 현재 챕터: 전체 이벤트 (1번부터 마지막 이벤트까지)
    const currentLastEv = lastEventNums[chapterNum - 1];
    for (let i = 1; i <= currentLastEv; i++) {
      const filePath = `../../data/gatsby/chapter${chapterNum}_relationships_event_${i}.json`;
      const json = relationshipModules[filePath]?.default;
      
      if (!json) {
        points.push(0);
        labelInfo.push(`E${i}`);
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
  
  return { points, labelInfo };
}

function GraphSidebar({
  activeTooltip,
  onClose,
  chapterNum = 1,
  eventNum = 1,
  maxChapter = 10,
  hasNoRelations = false,
}) {
  const [viewMode, setViewMode] = useState("info");
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);

  // source/target을 safeNum으로 변환
  const id1 = safeNum(activeTooltip?.data?.source);
  const id2 = safeNum(activeTooltip?.data?.target);

  useEffect(() => {
    if (viewMode === "chart" && activeTooltip?.type === "edge") {
      setLoading(true);
      const result = fetchRelationTimelineMulti(
        id1,
        id2,
        chapterNum,
        eventNum,
        maxChapter
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
  }, [viewMode, id1, id2, chapterNum, eventNum, maxChapter, activeTooltip]);

  // positivity 값에 따른 색상과 텍스트 결정
  const getRelationStyle = (positivity) => {
    const h = (120 * (positivity + 1)) / 2; // -1~1 → 0~120
    const color = `hsl(${h}, 70%, 45%)`;
    if (positivity > 0.6) return { color, text: "긍정적" };
    if (positivity > 0.3) return { color, text: "우호적" };
    if (positivity > -0.3) return { color, text: "중립적" };
    if (positivity > -0.6) return { color, text: "비우호적" };
    return { color, text: "부정적" };
  };

  // 관계가 없을 때 안내 메시지 표시 (activeTooltip이 없어도 표시)
  if (hasNoRelations) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "440px",
          height: "100vh",
          background: "#fff",
          borderLeft: "1px solid #e5e7eb",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.15)",
          zIndex: 1000,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            height: "70px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            background: "#f8fafc",
          }}
        >
          <h3 style={{ 
            margin: 0, 
            fontSize: "20px", 
            fontWeight: 700, 
            color: "#374151",
            letterSpacing: "0.5px"
          }}>
            관계 정보
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "24px",
              cursor: "pointer",
              color: "#6b7280",
              padding: "4px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseOver={(e) => e.currentTarget.style.color = "#374151"}
            onMouseOut={(e) => e.currentTarget.style.color = "#6b7280"}
          >
            ×
          </button>
        </div>

        {/* 안내 메시지 */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '20px',
            color: '#6C8EFF',
            fontWeight: '600',
            textAlign: 'center'
          }}>
            관계가 없습니다
          </div>
          <div style={{
            fontSize: '14px',
            color: '#64748b',
            textAlign: 'center',
            maxWidth: '300px',
            lineHeight: '1.5'
          }}>
            현재 챕터에서 선택한 이벤트에는<br />
            등장 인물 간의 관계 정보가 없습니다.
          </div>
        </div>
      </div>
    );
  }

  // activeTooltip이 없어도 hasNoRelations가 true면 사이드바를 표시
  if (!activeTooltip && !hasNoRelations) return null;

  // activeTooltip이 없고 hasNoRelations가 true인 경우는 이미 위에서 처리됨
  const data = activeTooltip.data;
  const relationStyle = getRelationStyle(data.positivity);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "440px",
        height: "100vh",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.15)",
        zIndex: 1000,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        animation: "slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          height: "70px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "#f8fafc",
        }}
      >
        <h3 style={{ 
          margin: 0, 
          fontSize: "20px", 
          fontWeight: 700, 
          color: "#374151",
          letterSpacing: "0.5px"
        }}>
          {activeTooltip.type === "node" ? "인물 정보" : "관계 정보"}
        </h3>
                 <button
           onClick={onClose}
           style={{
             background: "#fff",
             border: "1px solid #e5e7eb",
             fontSize: "18px",
             cursor: "pointer",
             color: "#6b7280",
             padding: "8px",
             borderRadius: "50%",
             width: "36px",
             height: "36px",
             display: "flex",
             alignItems: "center",
             justifyContent: "center",
           }}
           onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'}
           onMouseOut={e => e.currentTarget.style.background = '#fff'}
         >
           ×
         </button>
      </div>

      {/* 내용 */}
      <div style={{ 
        flex: 1, 
        overflow: "auto", 
        padding: "24px",
        background: "#fff",
      }}>
        {activeTooltip.type === "node" ? (
          <NodeInfo data={data} />
        ) : (
          <EdgeInfo 
            data={data} 
            relationStyle={relationStyle}
            viewMode={viewMode}
            setViewMode={setViewMode}
            timeline={timeline}
            labels={labels}
            loading={loading}
            maxChapter={maxChapter}
            hasNoRelations={hasNoRelations}
          />
        )}
      </div>

      <style jsx="true">{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// 노드 정보 컴포넌트
function NodeInfo({ data }) {
  return (
    <div>
      <div style={{ 
        marginBottom: "24px",
        padding: "20px",
        background: "#f8fafc",
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
      }}>
        <h4 style={{ 
          margin: "0 0 12px 0", 
          fontSize: "18px", 
          fontWeight: 700,
          color: "#374151"
        }}>
          {data.label}
        </h4>
        {data.description && (
          <p style={{ 
            margin: 0, 
            fontSize: "14px", 
            color: "#6b7280", 
            lineHeight: 1.6,
          }}>
            {data.description}
          </p>
        )}
      </div>
      
      {data.main && (
        <div style={{ 
          background: "#fef3c7", 
          padding: "12px 16px", 
          borderRadius: "12px",
          marginBottom: "24px",
          border: "1px solid #fde68a"
        }}>
          <span style={{ 
            fontSize: "14px", 
            color: "#92400e", 
            fontWeight: 600,
          }}>
            주요 인물
          </span>
        </div>
      )}
    </div>
  );
}

// 엣지 정보 컴포넌트
function EdgeInfo({ data, relationStyle, viewMode, setViewMode, timeline, labels, loading, maxChapter = 10, hasNoRelations = false }) {
  return (
    <div>
      {viewMode === "info" ? (
        <div>
          {/* 관계 태그 */}
          <div style={{ marginBottom: "24px" }}>
            <h4 style={{ 
              margin: "0 0 12px 0", 
              fontSize: "16px", 
              fontWeight: 700, 
              color: "#374151",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              관계 유형
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
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
                     style={{
                       background: '#e5e7eb',
                       color: '#374151',
                       borderRadius: '20px',
                       padding: '6px 12px',
                       fontSize: '12px',
                       fontWeight: 600,
                       cursor: 'default',
                     }}
                     onMouseOver={e => e.currentTarget.style.background = '#d1d5db'}
                     onMouseOut={e => e.currentTarget.style.background = '#e5e7eb'}
                   >
                     {relation}
                   </span>
                ));
              })()}
            </div>
          </div>

          {/* 관계 긍정도 */}
          <div style={{ marginBottom: "24px" }}>
            <h4 style={{ 
              margin: "0 0 12px 0", 
              fontSize: "16px", 
              fontWeight: 700, 
              color: "#374151",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              관계 긍정도
            </h4>
            <div style={{ 
              background: "#f8fafc",
              padding: "16px",
              borderRadius: "12px",
              border: "1px solid #e5e7eb"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                <span style={{ 
                  color: relationStyle.color, 
                  fontWeight: 700, 
                  fontSize: "16px",
                }}>
                  {relationStyle.text}
                </span>
                <span style={{ 
                  color: "#6b7280", 
                  fontSize: "14px",
                  fontWeight: 600,
                  background: "#e5e7eb",
                  padding: "4px 8px",
                  borderRadius: "6px"
                }}>
                  {data.positivity !== undefined ? `${Math.round(data.positivity * 100)}%` : "N/A"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "4px", height: "24px" }}>
                {(() => {
                  let p = Math.abs(data.positivity ?? 0);
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
                          flex: 1,
                          height: "100%",
                          borderRadius: "6px",
                          background,
                          border: "1px solid #e5e7eb",
                          transition: "all 0.3s ease",
                        }}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          {/* 설명 */}
          {data.explanation && (
            <div style={{ marginBottom: "24px" }}>
              <h4 style={{ 
                margin: "0 0 12px 0", 
                fontSize: "16px", 
                fontWeight: 700, 
                color: "#374151",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                관계 설명
              </h4>
              <div style={{ 
                borderLeft: `4px solid ${relationStyle.color}`, 
                paddingLeft: "16px",
                background: "#f8fafc",
                padding: "16px",
                borderRadius: "12px",
                border: "1px solid #e5e7eb"
              }}>
                <strong style={{ 
                  display: "block", 
                  marginBottom: "8px", 
                  fontSize: "15px",
                  color: "#374151",
                  fontWeight: 600
                }}>
                  {data.explanation.split("|")[0]}
                </strong>
                {data.explanation.split("|")[1] && (
                  <p style={{ 
                    margin: 0, 
                    fontSize: "14px", 
                    color: "#6b7280", 
                    lineHeight: 1.6 
                  }}>
                    {data.explanation.split("|")[1]}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 그래프 보기 버튼 */}
                     <button
             onClick={() => setViewMode("chart")}
             style={{
               background: '#2563eb',
               color: '#fff',
               border: 'none',
               borderRadius: '12px',
               padding: '16px 24px',
               fontWeight: 700,
               fontSize: '15px',
               cursor: 'pointer',
               width: '100%',
               marginTop: '24px',
               boxShadow: '0 4px 16px rgba(37, 99, 235, 0.2)',
             }}
             onMouseOver={e => e.currentTarget.style.background = '#3b82f6'}
             onMouseOut={e => e.currentTarget.style.background = '#2563eb'}
           >
             관계 변화 그래프 보기
           </button>
        </div>
      ) : (
        <div>
          <h4 style={{ 
            margin: "0 0 24px 0", 
            fontSize: "18px", 
            fontWeight: 700, 
            color: "#374151", 
            textAlign: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px"
          }}>
            관계 변화 그래프
          </h4>
          
          {loading ? (
            <div style={{ 
              textAlign: "center", 
              padding: "60px 0",
              background: "#f8fafc",
              borderRadius: "12px",
              color: "#6b7280",
              fontWeight: 600,
              border: "1px solid #e5e7eb"
            }}>
              불러오는 중...
            </div>
          ) : (timeline.length === 0 || hasNoRelations) ? (
            <div style={{ 
              height: "400px", 
              marginBottom: "24px",
              background: "#fff",
              borderRadius: "12px",
              padding: "12px",
              boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
              border: "1px solid #e5e7eb",
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{
                fontSize: '20px',
                color: '#6C8EFF',
                fontWeight: '600',
                textAlign: 'center'
              }}>
                관계가 없습니다
              </div>
              <div style={{
                fontSize: '14px',
                color: '#64748b',
                textAlign: 'center',
                maxWidth: '300px',
                lineHeight: '1.5'
              }}>
                현재 챕터에서 선택한 이벤트에는<br />
                등장 인물 간의 관계 정보가 없습니다.
              </div>
            </div>
          ) : (
            <div style={{ 
              height: "400px", 
              marginBottom: "24px",
              background: "#fff",
              borderRadius: "12px",
              padding: "12px",
              boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
              border: "1px solid #e5e7eb",
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
                      backgroundColor: "rgba(37, 99, 235, 0.1)",
                      fill: true,
                      tension: 0.4,
                      spanGaps: true,
                      borderWidth: 3,
                      pointBackgroundColor: (context) => {
                        // Chart.js에서 라벨을 가져오는 방법 수정
                        const label = context.chart.data.labels[context.dataIndex] || '';
                        // 현재 챕터의 이벤트는 파란색, 이전 챕터는 회색
                        if (label.startsWith('E')) {
                          return "#2563eb"; // 파란색 (현재 챕터)
                        } else {
                          return "#9ca3af"; // 회색 (이전 챕터)
                        }
                      },
                      pointBorderColor: "#fff",
                      pointBorderWidth: 2,
                      pointRadius: 6,
                      pointHoverRadius: 8,
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
                      title: { 
                        display: true, 
                        text: "긍정도",
                        font: { weight: 'bold' }
                      },
                      grid: {
                        color: 'rgba(0,0,0,0.1)',
                        drawBorder: false,
                      }
                    },
                    x: {
                      title: {
                        display: true,
                        text: "이벤트 순서",
                        font: { weight: 'bold' }
                      },
                      min: 0,
                      max: getMaxEventCount(maxChapter),
                      ticks: {
                        stepSize: 1
                      },
                      grid: {
                        color: 'rgba(0,0,0,0.1)',
                        drawBorder: false,
                      }
                    },
                  },
                  plugins: { 
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: 'rgba(37, 99, 235, 0.9)',
                      titleColor: '#fff',
                      bodyColor: '#fff',
                      borderColor: '#2563eb',
                      borderWidth: 1,
                      cornerRadius: 8,
                    }
                  },
                }}
                style={{ height: '150px' }}
              />
            </div>
          )}
          
                     <div style={{ 
             fontSize: "12px", 
             color: "#64748b", 
             textAlign: "center", 
             marginBottom: "24px",
             background: "#f8fafc",
             padding: "12px",
             borderRadius: "8px",
             border: "1px solid #e5e7eb"
           }}>
             <div style={{ fontSize: "11px", lineHeight: "1.4" }}>
               x축: 챕터별 이벤트, y축: 관계 긍정도(-1~1)
             </div>
           </div>
          
                                           <button
              onClick={() => setViewMode("info")}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                padding: '16px 24px',
                fontWeight: 700,
                fontSize: '15px',
                cursor: 'pointer',
                width: '100%',
                boxShadow: '0 4px 16px rgba(37, 99, 235, 0.2)',
              }}
              onMouseOver={e => e.currentTarget.style.background = '#3b82f6'}
              onMouseOut={e => e.currentTarget.style.background = '#2563eb'}
            >
              관계 정보로 돌아가기
            </button>
        </div>
      )}
    </div>
  );
}

export default GraphSidebar; 
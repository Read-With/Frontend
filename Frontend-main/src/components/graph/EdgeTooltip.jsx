// React와 필요한 라이브러리들을 import
import React, { useState, useEffect, useRef } from "react";
import { FaProjectDiagram, FaArrowLeft } from "react-icons/fa";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import "./RelationGraph.css";

// Chart.js 컴포넌트 등록 (차트 사용을 위해 필요)
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// JSON 파일들을 import.meta.glob으로 한 번에 가져오기
// 모든 이벤트 관계 데이터 파일을 동적으로 로드
const eventRelationModules = import.meta.glob(
  "/src/data/*/[0-9][0-9]_ev*_relations.json",
  { eager: true }
);

/**
 * EdgeTooltip 컴포넌트
 * 간선(관계) 클릭 시 표시되는 툴팁으로, 관계 정보와 변화 그래프를 보여줌
 */
function EdgeTooltip({
  data, // 간선의 데이터 (positivity, weight, explanation 등)
  x, // 툴팁 표시 x 좌표
  y, // 툴팁 표시 y 좌표
  onClose, // 툴팁 닫기 콜백 함수
  sourceNode, // 관계의 시작 노드
  targetNode, // 관계의 끝 노드
  inViewer = false, // 뷰어 모드 여부
  style, // 추가 스타일
  filename, // 현재 파일명 (책 구분용)
}) {
  // 상태 관리
  const [position, setPosition] = useState({ x: 200, y: 200 }); // 툴팁 위치
  const [showContent, setShowContent] = useState(false); // 컨텐츠 표시 여부
  const [isDragging, setIsDragging] = useState(false); // 드래그 중 여부
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 }); // 드래그 오프셋
  const [hasDragged, setHasDragged] = useState(false); // 드래그 했는지 여부
  const [isFlipped, setIsFlipped] = useState(false); // 앞/뒷면 전환 상태
  const [relationData, setRelationData] = useState([]); // 관계 변화 데이터
  const [isLoading, setIsLoading] = useState(false); // 로딩 상태
  const tooltipRef = useRef(null); // 툴팁 DOM 참조

  // 컴포넌트 마운트 시 초기화
  useEffect(() => {
    setShowContent(true);
    console.log("🔍 EdgeTooltip mounted");
    console.log("Props:", { sourceNode, targetNode, filename });
    console.log("eventRelationModules:", eventRelationModules);
  }, []);

  /**
   * 관계 변화 데이터를 로드하는 함수
   * 모든 이벤트에서 두 인물 간의 관계 변화를 추적
   */
  const loadRelationData = () => {
    console.log("🔍 loadRelationData 호출됨");
    console.log("sourceNode:", sourceNode);
    console.log("targetNode:", targetNode);
    console.log("filename:", filename);

    // DOM Element 객체에서 실제 ID 추출
    let actualSourceNode = sourceNode;
    let actualTargetNode = targetNode;

    // DOM Element 객체인 경우 ID 추출
    if (typeof sourceNode === "object" && sourceNode.id) {
      actualSourceNode = sourceNode.id();
      console.log("🔧 Extracted sourceNode ID:", actualSourceNode);
    }
    if (typeof targetNode === "object" && targetNode.id) {
      actualTargetNode = targetNode.id();
      console.log("🔧 Extracted targetNode ID:", actualTargetNode);
    }

    // filename이 없을 때 기본값 설정
    const actualFilename = filename || "gatsby.epub";
    console.log("Final values:", {
      actualSourceNode,
      actualTargetNode,
      actualFilename,
    });

    // 필수 데이터 검증
    if (!actualSourceNode || !actualTargetNode) {
      console.log("❌ 필수 데이터 누락");
      return;
    }

    setIsLoading(true);

    try {
      const relationHistory = [];

      // filename에서 숫자 2자리 추출 (예: '01', '02' 등)
      const match = actualFilename.match(/(\d{2})/);
      const bookNumber = match ? match[1] : "01";
      console.log("📖 bookNumber (수정됨):", bookNumber);

      // import.meta.glob으로 가져온 모듈들을 순회
      const relevantModules = Object.entries(eventRelationModules)
        .filter(([path]) => {
          const isRelevant = path.includes(`/src/data/${bookNumber}/`);
          console.log(`🔍 Checking path: ${path}, relevant: ${isRelevant}`);
          return isRelevant;
        })
        .sort(([pathA], [pathB]) => {
          // 이벤트 번호로 정렬
          const eventNumA = parseInt(pathA.match(/_ev(\d+)_/)?.[1] || "0");
          const eventNumB = parseInt(pathB.match(/_ev(\d+)_/)?.[1] || "0");
          return eventNumA - eventNumB;
        });

      console.log(
        "📂 relevantModules (수정 후):",
        relevantModules.map(([path]) => path)
      );

      let lastPositivity = null; // 직전 이벤트의 긍정도 저장

      // 각 이벤트에서 관계 데이터 추출
      relevantModules.forEach(([path, module]) => {
        // 파일명에서 이벤트 번호 추출
        const eventMatch = path.match(/_ev(\d+)_/);
        const eventNum = eventMatch ? parseInt(eventMatch[1]) : 0;

        console.log(`🎯 Processing event ${eventNum} from ${path}`);

        const eventData = module.default || module;
        console.log(`📊 Event ${eventNum} data:`, eventData);

        // 해당 인물들 간의 관계 찾기
        const relation = eventData.relations?.find((rel) => {
          const match =
            (rel.id1 === parseFloat(actualSourceNode) &&
              rel.id2 === parseFloat(actualTargetNode)) ||
            (rel.id1 === parseFloat(actualTargetNode) &&
              rel.id2 === parseFloat(actualSourceNode));

          if (match) {
            console.log(`✅ Found relation in event ${eventNum}:`, rel);
          }
          return match;
        });

        let currentPositivity;
        let currentWeight;
        let currentExplanation;
        let hasRelation = false;

        if (relation) {
          // 관계가 존재하는 경우
          currentPositivity = relation.positivity;
          currentWeight = relation.weight;
          currentExplanation = relation.explanation || "관계 정보 없음";
          lastPositivity = currentPositivity; // 마지막 긍정도 업데이트
          hasRelation = true;
          console.log(`✅ Found relation in event ${eventNum}:`, relation);
        } else {
          // 관계가 없는 경우 직전 이벤트의 긍정도 유지
          if (lastPositivity !== null) {
            currentPositivity = lastPositivity;
            currentWeight = 0.5; // 기본 가중치
            currentExplanation = "이전 관계 유지";
            console.log(
              `🔄 No relation in event ${eventNum}, using last positivity: ${lastPositivity}`
            );
          } else {
            // 첫 번째 이벤트에서 관계가 없는 경우 중립으로 설정
            currentPositivity = 0;
            currentWeight = 0.1;
            currentExplanation = "관계 없음";
            lastPositivity = 0;
            console.log(`❌ No relation in event ${eventNum}, setting neutral`);
          }
        }

        // 관계 히스토리에 추가
        const relationItem = {
          event: eventNum,
          positivity: currentPositivity,
          weight: currentWeight,
          explanation: currentExplanation,
          eventTitle: eventData.title || `이벤트 ${eventNum}`,
          hasRelation: hasRelation,
        };

        console.log(`➕ Adding relation for event ${eventNum}:`, relationItem);
        relationHistory.push(relationItem);
      });

      console.log("📈 Final relation history:", relationHistory);
      setRelationData(relationHistory);
    } catch (error) {
      console.error("❌ 관계 데이터 로드 실패:", error);
      setRelationData([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 마우스 다운 이벤트 핸들러 (드래그 시작)
  const handleMouseDown = (e) => {
    // 닫기 버튼이나 액션 버튼 클릭 시 드래그 방지
    if (
      e.target.closest(".tooltip-close-btn") ||
      e.target.closest(".action-button")
    )
      return;

    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // 마우스 이동 이벤트 핸들러 (드래그 중)
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

    // 새로운 위치 계산
    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    // 화면 경계 내로 제한
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

  // 마우스 업 이벤트 핸들러 (드래그 종료)
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 드래그 관련 이벤트 리스너 등록/해제
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none"; // 텍스트 선택 방지
    } else {
      document.body.style.userSelect = "";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // 초기 위치 설정 (props로 받은 x, y 좌표 기반)
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

      // 화면 경계 내로 제한
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

  /**
   * positivity 값에 따른 관계 스타일 결정
   * @param {number} positivity - 관계 긍정도 (-1 ~ 1)
   * @returns {object} 색상과 텍스트 정보
   */
  const getRelationStyle = (positivity) => {
    if (positivity > 0.6) return { color: "#15803d", text: "긍정적" };
    if (positivity > 0.3) return { color: "#059669", text: "우호적" };
    if (positivity > -0.3) return { color: "#6b7280", text: "중립적" };
    if (positivity > -0.6) return { color: "#dc2626", text: "비우호적" };
    return { color: "#991b1b", text: "부정적" };
  };

  const relationStyle = getRelationStyle(data.positivity);

  // 관계 변화 그래프 버튼 클릭 핸들러
  const handleRelationGraphClick = () => {
    console.log("🎯 관계 변화 그래프 버튼 클릭됨");
    console.log("현재 isFlipped:", isFlipped);

    if (!isFlipped) {
      console.log("📊 데이터 로드 시작");
      loadRelationData(); // 그래프 데이터 로드
    }
    setIsFlipped(!isFlipped); // 앞/뒷면 전환
  };

  // 차트 데이터 구성
  const chartData = {
    labels: relationData.map((item) => `이벤트 ${item.event}`),
    datasets: [
      {
        label: `${sourceNode} - ${targetNode} 관계의 긍정도`,
        data: relationData.map((item) => item.positivity),
        borderColor: "#5B7BA0",
        backgroundColor: "rgba(91, 123, 160, 0.1)",
        borderWidth: 2,
        pointBackgroundColor: relationData.map((item) => {
          const style = getRelationStyle(item.positivity);
          return style.color;
        }),
        pointBorderColor: relationData.map((item) =>
          item.hasRelation ? "#fff" : "#999"
        ),
        pointBorderWidth: 2,
        pointRadius: relationData.map((item) => (item.hasRelation ? 6 : 4)),
        pointStyle: relationData.map((item) =>
          item.hasRelation ? "circle" : "triangle"
        ),
        tension: 0.3,
        fill: true,
      },
    ],
  };

  // 차트 옵션 설정
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: {
          font: {
            size: 12,
          },
        },
      },
      tooltip: {
        callbacks: {
          title: function (context) {
            const dataIndex = context[0].dataIndex;
            const item = relationData[dataIndex];
            return item.eventTitle || `이벤트 ${item.event}`;
          },
          afterLabel: function (context) {
            const dataIndex = context.dataIndex;
            const item = relationData[dataIndex];
            const labels = [
              `가중치: ${item.weight.toFixed(1)}`, // 원본 값으로 표시
              `설명: ${item.explanation.split("|")[0]}`,
            ];
            if (!item.hasRelation) {
              labels.push("(이전 관계 유지)");
            }
            return labels;
          },
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: "이벤트 순서",
          font: {
            size: 12,
            weight: "bold",
          },
        },
        grid: {
          display: true,
          color: "rgba(0, 0, 0, 0.1)",
        },
      },
      y: {
        title: {
          display: true,
          text: "관계 긍정도",
          font: {
            size: 12,
            weight: "bold",
          },
        },
        min: -1,
        max: 1,
        grid: {
          display: true,
          color: "rgba(0, 0, 0, 0.1)",
        },
        ticks: {
          callback: function (value) {
            if (value > 0.6) return "매우 긍정적";
            if (value > 0.3) return "긍정적";
            if (value > -0.3) return "중립적";
            if (value > -0.6) return "부정적";
            return "매우 부정적";
          },
        },
      },
    },
  };

  // z-index 값 설정 (뷰어 모드에 따라 다르게)
  const zIndexValue = inViewer ? 10000 : 9999;

  console.log(
    "🎨 Rendering EdgeTooltip, isFlipped:",
    isFlipped,
    "relationData length:",
    relationData.length
  );

  // 툴팁 렌더링
  return (
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
        width: isFlipped ? "600px" : "380px",
        height: isFlipped ? "450px" : "auto",
        ...(style || {}),
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="edge-tooltip-content">
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          className="tooltip-close-btn"
          onMouseDown={(e) => e.stopPropagation()}
        >
          &times;
        </button>

        {!isFlipped ? (
          // 앞면 - 기본 관계 정보 표시
          <>
            <div className="edge-tooltip-header">
              {/* 관계 태그 표시 */}
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

              {/* 관계 긍정도 표시 */}
              <div className="relation-weight">
                <div className="weight-header">
                  <span
                    className="weight-label"
                    style={{ color: relationStyle.color }}
                  >
                    {relationStyle.text}
                  </span>
                  <span className="weight-value">
                    {data.positivity.toFixed(1)} {/* 원본 positivity 값 표시 */}
                  </span>
                </div>

                {/* 단계별 바 표시 (positivity 기반) */}
                <div className="weight-steps">
                  {[0, 1, 2, 3, 4].map((step) => {
                    const stepValue = (step / 4) * 2 - 1; // -1 ~ 1 범위로 변환 (-1, -0.5, 0, 0.5, 1)
                    const isComplete = data.positivity >= stepValue;
                    const isCurrent =
                      step === Math.round(((data.positivity + 1) / 2) * 4);

                    return (
                      <div
                        key={step}
                        className={`weight-step ${
                          isComplete ? "complete" : ""
                        } ${isCurrent ? "current" : ""}`}
                      >
                        <div
                          className="weight-fill"
                          style={{
                            backgroundColor: relationStyle.color,
                            width: isComplete ? "100%" : "0%",
                          }}
                        />
                        <div className="step-label">
                          {step === 0 && "매우 부정적"}
                          {step === 1 && "부정적"}
                          {step === 2 && "중립적"}
                          {step === 3 && "긍정적"}
                          {step === 4 && "매우 긍정적"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="edge-tooltip-body">
              {/* 관계 설명 */}
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

              {/* 디버깅을 위한 임시 정보 */}
              <div style={{ fontSize: "10px", color: "#999", margin: "5px 0" }}>
                Debug: isFlipped={isFlipped.toString()}, showContent=
                {showContent.toString()}
              </div>

              {/* 액션 버튼 */}
              <div className="tooltip-actions">
                <button
                  className="action-button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("🎯 관계 변화 그래프 버튼 클릭됨!");
                    console.log("현재 isFlipped:", isFlipped);

                    if (!isFlipped) {
                      console.log("📊 데이터 로드 시작");
                      loadRelationData();
                    }
                    setIsFlipped(!isFlipped);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("🖱️ 버튼 마우스 다운");
                  }}
                  style={{
                    cursor: "pointer",
                    pointerEvents: "auto",
                    zIndex: 1000,
                    backgroundColor: "#5B7BA0",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                  }}
                >
                  <FaProjectDiagram className="button-icon" />
                  관계 변화 그래프
                </button>
              </div>
            </div>
          </>
        ) : (
          // 뒷면 - 관계 변화 그래프 표시
          <div className="relation-graph-view">
            <div className="relation-graph-header">
              <h3
                style={{
                  margin: "0 0 15px 0",
                  fontSize: "16px",
                  fontWeight: "bold",
                }}
              >
                {sourceNode} - {targetNode} 관계 변화
              </h3>
            </div>

            <div
              className="relation-graph-chart"
              style={{ height: "300px", marginBottom: "15px" }}
            >
              {isLoading ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "#666",
                    fontSize: "14px",
                  }}
                >
                  관계 데이터를 로드하는 중...
                </div>
              ) : relationData.length > 0 ? (
                <Line data={chartData} options={chartOptions} />
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "#666",
                    fontSize: "14px",
                  }}
                >
                  관계 변화 데이터가 없습니다.
                </div>
              )}
            </div>

            {/* 뒤로 가기 버튼 */}
            <div className="tooltip-actions">
              <button
                className="action-button back-btn"
                onClick={handleRelationGraphClick}
                style={{ cursor: "pointer" }}
              >
                <FaArrowLeft className="button-icon" />
                뒤로
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EdgeTooltip;

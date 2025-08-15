import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { FaFileAlt, FaComments, FaArrowLeft } from "react-icons/fa";
import "./RelationGraph.css";

// === glob import: 반드시 data/gatsby 하위 전체 관계 파일 import ===
const relationshipModules = import.meta.glob(
  "../../data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);

// 챕터별 마지막 이벤트 번호 구하기
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

function GraphNodeTooltip({
  data,
  x,
  y,
  nodeCenter,
  onClose,
  inViewer = false,
  style,
  chapterNum,
  eventNum,
  maxChapter = 10
}) {
  console.log("=== GraphNodeTooltip props ===");
  console.log("data:", data);
  console.log("chapterNum:", chapterNum);
  console.log("eventNum:", eventNum);
  console.log("maxChapter:", maxChapter);
  console.log("inViewer:", inViewer);
  console.log("=== props 끝 ===");

  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  
  // 그래프 단독 페이지 여부 판단 (URL 경로로 판단)
  const isGraphPage = location.pathname.includes('/user/graph/');

  // 데이터가 중첩되어 있는 경우 처리
  const [nodeData, setNodeData] = useState(data.data || data);
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isFlipped, setIsFlipped] = useState(false);
  const [isNodeAppeared, setIsNodeAppeared] = useState(false); // 노드 등장 여부 - 기본값을 false로 설정
  const tooltipRef = useRef(null);

  // 뷰포트 경계 체크 및 위치 조정 함수
  const adjustPositionToViewport = (x, y) => {
    if (!tooltipRef.current) return { x, y };

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

    // 뷰포트 경계 체크 및 조정
    newX = Math.max(
      scrollX,
      Math.min(newX, viewportWidth + scrollX - tooltipRect.width)
    );
    newY = Math.max(
      scrollY,
      Math.min(newY, viewportHeight + scrollY - tooltipRect.height)
    );

    return { x: newX, y: newY };
  };

  // 노드 등장 여부 확인 함수
  const checkNodeAppearance = useCallback(() => {
    console.log("=== checkNodeAppearance 시작 ===");
    console.log("data:", data);
    console.log("chapterNum:", chapterNum);
    console.log("eventNum:", eventNum);
    console.log("isGraphPage:", isGraphPage);
    console.log("maxChapter:", maxChapter);
    
    // 기본값을 false로 설정
    setIsNodeAppeared(false);
    
    if (!data) {
      console.log("data가 없음 - isNodeAppeared를 false로 설정");
      return;
    }
    
    if (!chapterNum || chapterNum <= 0) {
      console.log("chapterNum이 없거나 0 이하 - isNodeAppeared를 false로 설정");
      return;
    }

    let targetEventNum = eventNum;
    
    // 그래프 단독 페이지이거나 eventNum이 0인 경우: 해당 챕터의 마지막 이벤트 사용
    if (isGraphPage || !eventNum || eventNum === 0) {
      const lastEventNums = getChapterLastEventNums(maxChapter);
      targetEventNum = lastEventNums[chapterNum - 1] || 1;
      console.log("targetEventNum 계산됨:", targetEventNum);
    }

    // JSON 파일 경로 생성
    const filePath = `../../data/gatsby/chapter${chapterNum}_relationships_event_${targetEventNum}.json`;
    console.log("찾는 파일 경로:", filePath);
    const json = relationshipModules[filePath]?.default;
    console.log("JSON 데이터:", json);

    // 노드 ID를 문자열로 변환하여 비교
    const nodeId = String(data.id);
    console.log("찾는 노드 ID:", nodeId);
    // relations 기반 등장 여부 판별
    if (!json || !json.relations) {
      console.log("JSON 파일이 없거나 relations가 없음 - isNodeAppeared를 false로 설정");
      setNodeData({ id: data.id, label: data.label });
      setIsNodeAppeared(false);
      return;
    }
    const appeared = json.relations.some(
      rel => String(rel.id1) === nodeId || String(rel.id2) === nodeId
    );
    if (appeared) {
      console.log("노드가 relations에 등장함");
      setIsNodeAppeared(true);
    } else {
      console.log("노드가 relations에 등장하지 않음");
      setNodeData({ id: data.id, label: data.label });
      setIsNodeAppeared(false);
    }
    console.log("=== checkNodeAppeared 끝 ===");
  }, [data, chapterNum, eventNum, isGraphPage, maxChapter]);

  // 노드 등장 여부 확인
  useEffect(() => {
    console.log("=== useEffect 호출됨 ===");
    console.log("의존성 변경됨:", { 
      dataId: data?.id, 
      chapterNum, 
      eventNum, 
      isGraphPage, 
      maxChapter 
    });
    console.log("checkNodeAppearance 함수 호출 전");
    checkNodeAppearance();
    console.log("checkNodeAppearance 함수 호출 후");
  }, [data?.id, chapterNum, eventNum, isGraphPage, maxChapter]);

  // 컴포넌트 마운트 시에도 한 번 실행
  useEffect(() => {
    console.log("=== 컴포넌트 마운트 시 checkNodeAppearance 실행 ===");
    checkNodeAppearance();
  }, []);

  // 툴팁 초기화
  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
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

  const handleMouseMove = (e) => {
    if (!isDragging) return;

    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    // 뷰포트 경계 체크 및 조정
    const adjustedPosition = adjustPositionToViewport(newX, newY);
    setPosition(adjustedPosition);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (x !== undefined && y !== undefined && tooltipRef.current) {
      const adjustedPosition = adjustPositionToViewport(x, y);
      setPosition(adjustedPosition);
    }
  }, [x, y]);

  // 초기 위치 설정 시에도 뷰포트 경계 체크
  useEffect(() => {
    if (tooltipRef.current && position.x === 200 && position.y === 200) {
      const adjustedPosition = adjustPositionToViewport(position.x, position.y);
      if (adjustedPosition.x !== position.x || adjustedPosition.y !== position.y) {
        setPosition(adjustedPosition);
      }
    }
  }, [position.x, position.y]);

  const handleChatClick = () => {
    if (nodeData.label) {
      // 뷰어 내에서 사용하는 경우 현재 filename을 사용
      const bookFilename = filename || "unknown";
      navigate(`/user/character-chat/${bookFilename}/${nodeData.label}`, {
        state: {
          book: {
            title: bookFilename
              .replace(".epub", "")
              .replace(/([A-Z])/g, " $1")
              .trim(),
          },
        },
      });
    }
  };

  const handleSummaryClick = () => {
    setIsFlipped(!isFlipped);
  };

  // 요약 데이터 - 7줄 분량으로 설정
  const summaryData = {
    summary: nodeData.label
      ? `${nodeData.label}은(는) ${
          nodeData.description || "작품의 중요한 인물입니다."
        }\n\n` +
        `이 인물은 작품의 중심 서사를 이끌어가는 핵심적인 역할을 담당합니다.\n\n` +
        `주로 1장, 3장, 5장에서 중요한 장면에 등장하며, 작품의 주제를 표현합니다.\n\n` +
        `이 인물의 행동과 선택은 작품의 결말에 직접적인 영향을 미칩니다.`
      : "인물에 대한 요약 정보가 없습니다.",
  };

  // 뷰어 내에서 사용할 때는 z-index를 더 높게 설정
  const zIndexValue = inViewer ? 10000 : 9999;

  console.log("=== 렌더링 시작 ===");
  console.log("isNodeAppeared:", isNodeAppeared);
  console.log("nodeData:", nodeData);
  console.log("=== 렌더링 끝 ===");

  // 노드가 현재 챕터/이벤트에서 등장하지 않는 경우 등장하지 않음 메시지 표시
  if (!isNodeAppeared) {
    return (
      <div
        ref={tooltipRef}
        className="graph-node-tooltip"
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          zIndex: zIndexValue,
          opacity: showContent ? 1 : 0,
          transition: isDragging ? "none" : "opacity 0.3s",
          cursor: isDragging ? "grabbing" : "grab",
          width: 400,
          minHeight: 200,
          background: "#fff",
          borderRadius: 20,
          boxShadow:
            "0 8px 32px rgba(79,109,222,0.13), 0 1.5px 8px rgba(0,0,0,0.04)",
          padding: 0,
          border: "1.5px solid #e5e7eb",
          ...(style || {}),
        }}
        onMouseDown={handleMouseDown}
      >
        <button
          onClick={onClose}
          className="tooltip-close-btn"
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            fontSize: 22,
            color: "#bfc8e2",
            background: "none",
            border: "none",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          &times;
        </button>
        
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 30px",
            textAlign: "center",
            minHeight: "200px",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "#f3f4f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
              border: "2px solid #e5e7eb",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="20" fill="#d1d5db" />
              <ellipse cx="20" cy="16" rx="8" ry="8" fill="#9ca3af" />
              <ellipse cx="20" cy="32" rx="12" ry="6" fill="#9ca3af" />
            </svg>
          </div>
          
          <h3
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#374151",
              marginBottom: 8,
            }}
          >
            {nodeData.common_name || nodeData.label}
          </h3>
          
          <p
            style={{
              fontSize: 16,
              color: "#6b7280",
              lineHeight: 1.5,
              marginBottom: 0,
            }}
          >
            아직 등장하지 않은 인물입니다
          </p>
          
          <p
            style={{
              fontSize: 14,
              color: "#9ca3af",
              lineHeight: 1.4,
              marginTop: 8,
            }}
          >
            {isGraphPage 
              ? `챕터 ${chapterNum}에서는 등장하지 않습니다`
              : `챕터 ${chapterNum} 이벤트 ${eventNum || '현재'}에서는 등장하지 않습니다`
            }
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={tooltipRef}
      className={`graph-node-tooltip ${isFlipped ? "flipped" : ""}`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: zIndexValue,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? "none" : "opacity 0.3s, transform 0.6s",
        cursor: isDragging ? "grabbing" : "grab",
        transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        transformStyle: "preserve-3d",
        width: 500,
        minHeight: 340,
        background: "#fff",
        borderRadius: 20,
        boxShadow:
          "0 8px 32px rgba(79,109,222,0.13), 0 1.5px 8px rgba(0,0,0,0.04)",
        padding: 0,
        border: "1.5px solid #e5e7eb",
        ...(style || {}),
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 앞면 - 기본 정보 */}
      <div
        className="tooltip-content business-card tooltip-front"
        style={{
          backfaceVisibility: "hidden",
          position: isFlipped ? "absolute" : "relative",
          width: "100%",
          height: "100%",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          display: "flex",
          flexDirection: "column",
          padding: 0,
        }}
      >
        <button
          onClick={onClose}
          className="tooltip-close-btn"
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            fontSize: 22,
            color: "#bfc8e2",
            background: "none",
            border: "none",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          &times;
        </button>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            padding: "32px 0 0 0",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            background: "linear-gradient(90deg, #e3eafe 0%, #f8fafc 100%)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              gap: 24,
              width: "100%",
            }}
          >
            <div
              className="profile-image-placeholder"
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: "#e6e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                marginLeft: 24,
                boxShadow: "0 2px 8px rgba(108,142,255,0.10)",
              }}
            >
              <div
                // 캐릭터 이미지 추가
                className="profile-img"
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  width: 64,
                  height: 64,
                  margin: "0 auto 12px auto",
                  borderRadius: "50%",
                  background: "#f4f4f4",
                }}
              >
                {nodeData.image ? (
                  <img
                    src={nodeData.image}
                    alt={nodeData.label || "character"}
                    style={{
                      width: 100,
                      height: 100,
                      objectFit: "cover",
                      borderRadius: "50%",
                      border: "2px solid #e0e0e0",
                      background: "#faf7f2",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                    }}
                  />
                ) : (
                  // 이미지가 없을 때 기본 silhouette 아이콘
                  <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                    <circle cx="28" cy="28" r="28" fill="#e5e7eb" />
                    <ellipse cx="28" cy="22" rx="12" ry="12" fill="#bdbdbd" />
                    <ellipse cx="28" cy="44" rx="18" ry="10" fill="#bdbdbd" />
                  </svg>
                )}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "center",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 24,
                    color: "#22336b",
                    letterSpacing: 0.5,
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {nodeData.common_name || nodeData.label}
                </span>
                {nodeData.main_character && (
                  <span
                    style={{
                      background:
                        "linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)",
                      color: "#fff",
                      borderRadius: 14,
                      fontSize: 13,
                      padding: "3px 12px",
                      marginLeft: 2,
                      fontWeight: 700,
                      boxShadow: "0 2px 8px rgba(79,109,222,0.13)",
                    }}
                  >
                    주요 인물
                  </span>
                )}
              </div>
              {nodeData.names && Array.isArray(nodeData.names) && nodeData.names.length > 0 && (
                <div
                  style={{
                    marginTop: 2,
                    marginBottom: 2,
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    justifyContent: "flex-start",
                  }}
                >
                  {nodeData.names
                    .filter(name => name !== nodeData.common_name)
                    .map((name, i) => (
                      <span
                        key={i}
                        style={{
                          background: "#f3f4f6",
                          color: "#4b5563",
                          borderRadius: 12,
                          fontSize: 13,
                          padding: "3px 12px",
                          border: "1px solid #e5e7eb",
                          fontWeight: 500,
                        }}
                      >
                        {name}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <hr
          style={{
            margin: "18px 0 0 0",
            border: 0,
            borderTop: "1.5px solid #f0f2f8",
          }}
        />
        <div
          className="business-card-description"
          style={{
            color: "#333",
            fontSize: 16,
            minHeight: 56,
            margin: "22px 32px 0 32px",
            textAlign: "left",
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          {nodeData.description && nodeData.description.trim() ? (
            nodeData.description
          ) : (
            <span style={{ color: "#bbb" }}>설명 정보가 없습니다.</span>
          )}
        </div>
        <hr
          style={{
            margin: "18px 0 0 0",
            border: 0,
            borderTop: "1.5px solid #f0f2f8",
          }}
        />
        <div style={{ flex: 1, marginBottom: 20 }} />
      </div>
    </div>
  );
}

export default GraphNodeTooltip;

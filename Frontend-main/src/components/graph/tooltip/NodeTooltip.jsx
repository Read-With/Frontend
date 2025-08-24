import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useLocation } from "react-router-dom";
import { processRelations, processRelationTags } from "../../../utils/relationUtils";
import { highlightText } from "../../../utils/search";
import { getChapterLastEventNums, getFolderKeyFromFilename } from "../../../utils/graphData";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition";
import { useClickOutside } from "../../../hooks/useClickOutside";
import "../RelationGraph.css";  

// === glob import: 반드시 data/gatsby 하위 전체 관계 파일 import ===
const relationshipModules = import.meta.glob(
  "/src/data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);

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
  maxChapter = 10,
  searchTerm = "", // 검색어 prop 추가
  elements = [] // 현재 로드된 elements 추가
}) {
  const { filename } = useParams();
  const location = useLocation();
  
  // 그래프 단독 페이지 여부 판단 (URL 경로로 판단)
  const isGraphPage = location.pathname.includes('/user/graph/');

  // 데이터가 중첩되어 있는 경우 처리
  const [nodeData, setNodeData] = useState(() => {
    // data가 직접 노드 데이터인 경우
    if (data && (data.id || data.label)) {
      return data;
    }
    // data.data가 있는 경우 (중첩된 구조)
    if (data && data.data) {
      return data.data;
    }
    // 기본값
    return { id: data?.id, label: data?.label };
  });
  const [isFlipped, setIsFlipped] = useState(false);
  const [isNodeAppeared, setIsNodeAppeared] = useState(false);
  const [error, setError] = useState(null);

  // useTooltipPosition 훅 사용
  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(x, y);

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

  // 노드 등장 여부 확인 함수
  const checkNodeAppearance = useCallback(() => {
    try {
      setIsNodeAppeared(false);
      setError(null);
      
      if (!data || !chapterNum || chapterNum <= 0) {
        // data가 직접 노드 데이터인 경우
        if (data && (data.id || data.label)) {
          setNodeData(data);
        } else if (data && data.data) {
          setNodeData(data.data);
        } else {
          setNodeData({ id: data?.id, label: data?.label });
        }
        return;
      }

      let targetEventNum = eventNum;
      
      // 그래프 단독 페이지이거나 eventNum이 0인 경우: 해당 챕터의 마지막 이벤트 사용
      if (isGraphPage || !eventNum || eventNum === 0) {
        const folderKey = getFolderKeyFromFilename(filename || 'gatsby');
        const lastEventNums = getChapterLastEventNums(folderKey);
        targetEventNum = lastEventNums[chapterNum - 1] || 1;
      }

      // JSON 파일 경로 생성
      const filePath = `/src/data/gatsby/chapter${chapterNum}_relationships_event_${targetEventNum}.json`;
      const json = relationshipModules[filePath]?.default;

      // 노드 ID를 문자열로 변환하여 비교
      const nodeId = String(data.id || data.data?.id);
      
      // relations 기반 등장 여부 판별
      if (!json || !json.relations) {
        // 대안: elements에서 노드 등장 여부 확인
        if (elements && elements.length > 0) {
          const nodeId = String(data.id || data.data?.id);
          const appeared = elements.some(element => {
            if (element.data && element.data.source) return false; // edge는 제외
            return String(element.data?.id) === nodeId;
          });
          setIsNodeAppeared(appeared);
        } else {
          setIsNodeAppeared(false);
        }
        
        // data가 직접 노드 데이터인 경우
        if (data && (data.id || data.label)) {
          setNodeData(data);
        } else if (data && data.data) {
          setNodeData(data.data);
        } else {
          setNodeData({ id: data?.id, label: data?.label });
        }
        return;
      }
      
      // processRelations 유틸리티 사용
      const processedRelations = processRelations(json.relations);
      
      // 더 정확한 ID 비교를 위해 숫자로 변환하여 비교
      const nodeIdNum = parseFloat(nodeId);
      
      const appeared = processedRelations.some(rel => {
        const id1Num = parseFloat(rel.id1);
        const id2Num = parseFloat(rel.id2);
        const match = id1Num === nodeIdNum || id2Num === nodeIdNum;
        return match;
      });
      
      setIsNodeAppeared(appeared);
    } catch (err) {
      setError(err.message);
      setIsNodeAppeared(false);
    }
  }, [data, chapterNum, eventNum, isGraphPage, maxChapter, filename, elements]);

  // 노드 등장 여부 확인
  useEffect(() => {
    checkNodeAppearance();
  }, [data, chapterNum, eventNum, isGraphPage, maxChapter, filename, elements]);

  // 컴포넌트 마운트 시에도 한 번 실행
  useEffect(() => {
    checkNodeAppearance();
  }, []);

  const handleSummaryClick = useCallback(() => {
    setIsFlipped(!isFlipped);
  }, [isFlipped]);

  // 메모이제이션된 데이터 처리
  const processedNodeData = useMemo(() => {
    if (!nodeData) return null;
    
    return {
      ...nodeData,
      names: processRelationTags(nodeData.names || [], nodeData.common_name),
      displayName: nodeData.common_name || nodeData.label || "Unknown",
      hasImage: !!nodeData.image,
      isMainCharacter: !!nodeData.main_character,
      hasDescription: !!(nodeData.description && nodeData.description.trim())
    };
  }, [nodeData]);

  // 요약 데이터 - 7줄 분량으로 설정
  const summaryData = useMemo(() => ({
    summary: processedNodeData?.label
      ? `${processedNodeData.label}은(는) ${
          processedNodeData.description || "작품의 중요한 인물입니다."
        }\n\n` +
        `이 인물은 작품의 중심 서사를 이끌어가는 핵심적인 역할을 담당합니다.\n\n` +
        `주로 1장, 3장, 5장에서 중요한 장면에 등장하며, 작품의 주제를 표현합니다.\n\n` +
        `이 인물의 행동과 선택은 작품의 결말에 직접적인 영향을 미칩니다.`
      : "인물에 대한 요약 정보가 없습니다.",
  }), [processedNodeData]);

  // 뷰어 내에서 사용할 때는 z-index를 더 높게 설정
  const zIndexValue = inViewer ? 10000 : 9999;

  // 에러가 있는 경우 에러 메시지 표시
  if (error) {
    return (
      <div
        ref={tooltipRef}
        className="graph-node-tooltip error"
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          zIndex: zIndexValue,
          width: 300,
          minHeight: 150,
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          padding: "20px",
          border: "1px solid #ffcdd2",
          animation: "scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          ...(style || {}),
        }}
      >
        <div style={{ textAlign: "center", color: "#d32f2f" }}>
          <h4 style={{ margin: "0 0 10px 0" }}>오류가 발생했습니다</h4>
          <p style={{ margin: 0, fontSize: "14px" }}>{error}</p>
          <button
            onClick={onClose}
            style={{
              marginTop: "15px",
              padding: "8px 16px",
              background: "#d32f2f",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer"
            }}
          >
            닫기
          </button>
        </div>
      </div>
    );
  }

  // 노드가 현재 챕터/이벤트에서 등장하지 않는 경우 등장하지 않음 메시지 표시
  if (!isNodeAppeared) {
    return (
      <div
        ref={mergeRefs(tooltipRef, clickOutsideRef)}
        className="graph-node-tooltip"
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          zIndex: zIndexValue,
          opacity: showContent ? 1 : 0,
          transition: isDragging ? "none" : "opacity 0.3s",
          cursor: isDragging ? "grabbing" : "grab",
          width: 300,
          minHeight: 150,
          background: "#fff",
          borderRadius: 20,
          boxShadow:
            "0 8px 32px rgba(79,109,222,0.13), 0 1.5px 8px rgba(0,0,0,0.04)",
          padding: 0,
          border: "1.5px solid #e5e7eb",
          animation: "scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
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
            {searchTerm ? highlightText(processedNodeData?.displayName || "", searchTerm) : processedNodeData?.displayName}
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
      ref={mergeRefs(tooltipRef, clickOutsideRef)}
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
        animation: "fadeIn 0.4s ease-out",
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
                {processedNodeData?.hasImage ? (
                  <img
                    src={processedNodeData.image}
                    alt={processedNodeData.displayName || "character"}
                    style={{
                      width: 100,
                      height: 100,
                      objectFit: "cover",
                      borderRadius: "50%",
                      border: "2px solid #e0e0e0",
                      background: "#faf7f2",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'block';
                    }}
                  />
                ) : null}
                {/* 이미지가 없을 때 기본 silhouette 아이콘 */}
                <svg 
                  width="56" 
                  height="56" 
                  viewBox="0 0 56 56" 
                  fill="none"
                  style={{ display: processedNodeData?.hasImage ? 'none' : 'block' }}
                >
                  <circle cx="28" cy="28" r="28" fill="#e5e7eb" />
                  <ellipse cx="28" cy="22" rx="12" ry="12" fill="#bdbdbd" />
                  <ellipse cx="28" cy="44" rx="18" ry="10" fill="#bdbdbd" />
                </svg>
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
                  {searchTerm ? highlightText(processedNodeData?.displayName || "", searchTerm) : processedNodeData?.displayName}
                </span>
                {processedNodeData?.isMainCharacter && (
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
              {processedNodeData?.names && processedNodeData.names.length > 0 && (
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
                  {processedNodeData.names
                    .filter(name => name !== processedNodeData.common_name)
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
                        {searchTerm ? highlightText(name, searchTerm) : name}
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
          {processedNodeData?.hasDescription ? (
            searchTerm ? highlightText(processedNodeData.description, searchTerm) : processedNodeData.description
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

export default React.memo(GraphNodeTooltip);

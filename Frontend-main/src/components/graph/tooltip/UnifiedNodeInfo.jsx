import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useLocation } from "react-router-dom";
import { processRelations, processRelationTags } from "../../../utils/relationUtils.js";
import { highlightText } from "../../../utils/searchUtils.jsx";
import { getChapterLastEventNums, getFolderKeyFromFilename, getEventDataByIndex } from "../../../utils/graphData.js";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition.js";
import { useClickOutside } from "../../../hooks/useClickOutside.js";
import { useRelationData } from "../../../hooks/useRelationData.js";
import { safeNum } from "../../../utils/relationUtils.js";
import "../RelationGraph.css";

/**
 * 통합 노드 정보 컴포넌트
 * @param {object} props - 컴포넌트 props
 * @param {string} props.displayMode - 'tooltip' | 'sidebar' 표시 모드
 * @param {object} props.data - 노드 데이터
 * @param {number} props.x - 툴팁 모드에서의 X 좌표
 * @param {number} props.y - 툴팁 모드에서의 Y 좌표
 * @param {object} props.nodeCenter - 노드 중심 좌표
 * @param {function} props.onClose - 닫기 핸들러
 * @param {boolean} props.inViewer - 뷰어 내 사용 여부
 * @param {object} props.style - 추가 스타일
 * @param {number} props.chapterNum - 현재 챕터 번호
 * @param {number} props.eventNum - 현재 이벤트 번호
 * @param {number} props.maxChapter - 최대 챕터 수
 * @param {string} props.searchTerm - 검색어
 * @param {array} props.elements - 현재 로드된 elements
 * @param {boolean} props.isSearchActive - 검색 상태
 * @param {array} props.filteredElements - 검색된 요소들
 * @param {string} props.filename - 파일명
 */
function UnifiedNodeInfo({
  displayMode = 'tooltip', // 'tooltip' | 'sidebar'
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
  searchTerm = "",
  elements = [],
  isSearchActive = false,
  filteredElements = [],
  filename,
}) {
  const { filename: urlFilename } = useParams();
  const location = useLocation();
  const actualFilename = filename || urlFilename;
  
  // 그래프 단독 페이지 여부 판단
  const isGraphPage = location.pathname.includes('/user/graph/');

  // 데이터가 중첩되어 있는 경우 처리
  const [nodeData, setNodeData] = useState(() => {
    if (data && (data.id || data.label)) {
      return data;
    }
    if (data && data.data) {
      return data.data;
    }
    return { id: data?.id, label: data?.label };
  });

  // data prop이 변경될 때 nodeData 업데이트
  useEffect(() => {
    if (data && (data.id || data.label)) {
      setNodeData(data);
    } else if (data && data.data) {
      setNodeData(data.data);
    } else {
      setNodeData({ id: data?.id, label: data?.label });
    }
  }, [data]);
  
  const [isFlipped, setIsFlipped] = useState(false);
  const [isNodeAppeared, setIsNodeAppeared] = useState(false);
  const [error, setError] = useState(null);
  const [showSummary, setShowSummary] = useState(false);

  // 툴팁 모드에서만 위치 관리 훅 사용
  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(x, y);

  // 외부 클릭 감지 훅 - 툴팁 모드에서만 사용
  const clickOutsideRef = useClickOutside(() => {
    if (onClose) onClose();
  }, displayMode === 'tooltip');

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

  // 관계 데이터 관리 (슬라이드바 모드에서 사용)
  const id1 = safeNum(nodeData?.id);
  const id2 = safeNum(nodeData?.id);
  const { fetchData } = useRelationData('standalone', id1, id2, chapterNum, eventNum, maxChapter, actualFilename);

  // 노드 등장 여부 확인 함수
  const checkNodeAppearance = useCallback(() => {
    try {
      setIsNodeAppeared(false);
      setError(null);
      
      if (!data || !chapterNum || chapterNum <= 0) {
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
      
      if (isGraphPage || !eventNum || eventNum === 0) {
        const folderKey = getFolderKeyFromFilename(actualFilename);
        const lastEventNums = getChapterLastEventNums(folderKey);
        targetEventNum = lastEventNums[chapterNum - 1] || 1;
      }

      const folderKey = getFolderKeyFromFilename(actualFilename);
      const json = getEventDataByIndex(folderKey, chapterNum, targetEventNum);

      const nodeId = String(data.id || data.data?.id);
      
      if (!json || !json.relations) {
        if (elements && elements.length > 0) {
          const appeared = elements.some(element => {
            if (element.data && element.data.source) return false;
            return String(element.data?.id) === nodeId;
          });
          setIsNodeAppeared(appeared);
        } else {
          setIsNodeAppeared(false);
        }
        
        if (data && (data.id || data.label)) {
          setNodeData(data);
        } else if (data && data.data) {
          setNodeData(data.data);
        } else {
          setNodeData({ id: data?.id, label: data?.label });
        }
        return;
      }
      
      const processedRelations = processRelations(json.relations);
      const nodeIdNum = parseFloat(nodeId);
      
      const appeared = processedRelations.some(rel => {
        const id1Num = parseFloat(rel.id1);
        const id2Num = parseFloat(rel.id2);
        return id1Num === nodeIdNum || id2Num === nodeIdNum;
      });
      
      setIsNodeAppeared(appeared);
    } catch (err) {
      setError(err.message);
      setIsNodeAppeared(false);
    }
  }, [data, chapterNum, eventNum, isGraphPage, maxChapter, actualFilename, elements]);

  // 노드 등장 여부 확인
  useEffect(() => {
    checkNodeAppearance();
  }, [checkNodeAppearance]);

  // 슬라이드바 모드에서 관계 데이터 가져오기
  useEffect(() => {
    if (displayMode === 'sidebar' && nodeData && nodeData.id) {
      fetchData();
    }
  }, [displayMode, nodeData, fetchData]);

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

  // 요약 데이터
  const summaryData = useMemo(() => ({
    summary: processedNodeData?.label
      ? `${processedNodeData.label}은(는) 작품의 핵심 인물 중 하나입니다.\n\n` +
        `이 인물은 작품의 중심 서사를 이끌어가는 중요한 역할을 담당하며, 주로 1장, 3장, 5장에서 중요한 장면에 등장합니다.\n\n` +
        `특히 작품의 주제를 표현하는 데 있어 핵심적인 역할을 하며, 다른 인물들과의 관계를 통해 작품의 깊이를 더합니다.\n\n` +
        `이 인물의 행동과 선택은 작품의 결말에 직접적인 영향을 미치며, 독자들에게 깊은 인상을 남깁니다.\n\n` +
        `작품 전체를 관통하는 이 인물의 성장과 변화는 독자들에게 감동과 교훈을 전달합니다.`
      : "인물에 대한 요약 정보가 없습니다.",
  }), [processedNodeData]);

  // 모드별 z-index 설정
  const zIndexValue = inViewer ? 10000 : 9999;

  // 에러가 있는 경우 에러 메시지 표시
  if (error) {
    const errorContent = (
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
    );

    if (displayMode === 'tooltip') {
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
          {errorContent}
        </div>
      );
    } else {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: "40px 20px",
            textAlign: "center",
            color: "#d32f2f",
          }}
        >
          {errorContent}
        </div>
      );
    }
  }

  // 노드가 현재 챕터/이벤트에서 등장하지 않는 경우
  if (!isNodeAppeared) {
    const notAppearedContent = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: displayMode === 'tooltip' ? "40px 30px" : "40px 20px",
          textAlign: "center",
          minHeight: displayMode === 'tooltip' ? "200px" : "auto",
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
    );

    if (displayMode === 'tooltip') {
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
            boxShadow: "0 8px 32px rgba(79,109,222,0.13), 0 1.5px 8px rgba(0,0,0,0.04)",
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
          {notAppearedContent}
        </div>
      );
    } else {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: "40px 20px",
            textAlign: "center",
            color: "#6b7280",
          }}
        >
          {notAppearedContent}
        </div>
      );
    }
  }

  // 기본 노드 정보 콘텐츠
  const nodeInfoContent = (
    <div
      className={`tooltip-content business-card tooltip-front`}
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
      {/* X 버튼 - 툴팁과 슬라이드바 모드 모두에서 표시 */}
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
                    background: "linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)",
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
      
      {/* 검색 상태에서 연결 정보 표시 */}
      {isSearchActive && filteredElements.length > 0 && (
        <div
          style={{
            margin: "16px 32px 0 32px",
            padding: "12px 16px",
            background: "#f8f9fc",
            borderRadius: "8px",
            border: "1px solid #e3e6ef",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#6C8EFF",
              marginBottom: "8px",
            }}
          >
            🔍 검색 결과 연결 정보
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#42506b",
              lineHeight: 1.4,
            }}
          >
            이 인물과 연결된 {filteredElements.filter(el => 
              el.data.source && 
              (el.data.source === processedNodeData?.id || el.data.target === processedNodeData?.id)
            ).length}개의 관계가 검색 결과에 포함되어 있습니다.
          </div>
        </div>
      )}
      
      <hr
        style={{
          margin: "18px 0 0 0",
          border: 0,
          borderTop: "1.5px solid #f0f2f8",
        }}
      />
      <div style={{ flex: 1, marginBottom: 20 }} />
    </div>
  );

  // 툴팁 모드 렌더링
  if (displayMode === 'tooltip') {
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
          width: 420,
          minHeight: 340,
          background: "#fff",
          borderRadius: 20,
          boxShadow: "0 8px 32px rgba(79,109,222,0.13), 0 1.5px 8px rgba(0,0,0,0.04)",
          padding: 0,
          border: "1.5px solid #e5e7eb",
          animation: "fadeIn 0.4s ease-out",
          ...(style || {}),
        }}
        onMouseDown={handleMouseDown}
      >
        {nodeInfoContent}
      </div>
    );
  }

  // 슬라이드바 모드 렌더링
  if (displayMode === 'sidebar') {
  return (
    <div
      style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
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
          padding: '24px 24px 16px 24px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '0',
          }}>
            {/* 인물 이름과 배지 */}
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '4px',
              flex: 1,
            }}>
              <span style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#111827',
                letterSpacing: '-0.025em',
              }}>
                {searchTerm ? highlightText(processedNodeData?.displayName || "", searchTerm) : processedNodeData?.displayName}
              </span>
              {processedNodeData?.isMainCharacter && (
                <span style={{
                  background: 'linear-gradient(135deg, #4F6DDE 0%, #6fa7ff 100%)',
                  color: '#fff',
                  borderRadius: '12px',
                  fontSize: '12px',
                  padding: '4px 12px',
                  fontWeight: '600',
                  boxShadow: '0 2px 4px rgba(79,109,222,0.2)',
                }}>
                  주요 인물
                </span>
              )}
            </div>
            
            <button
              onClick={onClose}
              aria-label="사이드바 닫기"
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                color: '#6b7280',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
                width: '40px',
                height: '40px',
                marginLeft: '16px',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#f3f4f6';
                e.currentTarget.style.color = '#374151';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = '#6b7280';
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = '#f3f4f6';
                e.currentTarget.style.color = '#374151';
                e.currentTarget.style.outline = '2px solid #2563eb';
                e.currentTarget.style.outlineOffset = '2px';
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = '#6b7280';
                e.currentTarget.style.outline = 'none';
              }}
            >
              닫기
            </button>
          </div>
        </div>

        {/* 사이드바 본문 */}
        <div 
          className="sidebar-content"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '0 24px',
          }}
        >
          <div style={{ padding: '24px 0' }}>
            {/* 통합 프로필 및 설명 섹션 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '24px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              {/* 프로필 이미지 */}
              <div style={{
                textAlign: 'center',
                marginBottom: '20px',
              }}>
                <div
                  style={{
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    background: '#e6e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto',
                    boxShadow: '0 4px 12px rgba(108,142,255,0.15)',
                    overflow: 'hidden',
                  }}
                >
                  {processedNodeData?.hasImage ? (
                    <img
                      src={processedNodeData.image}
                      alt={processedNodeData.displayName || "character"}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: '50%',
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                      }}
                    />
                  ) : null}
                  <svg 
                    width="80" 
                    height="80" 
                    viewBox="0 0 80 80" 
                    fill="none"
                    style={{ display: processedNodeData?.hasImage ? 'none' : 'block' }}
                  >
                    <circle cx="40" cy="40" r="40" fill="#e5e7eb" />
                    <ellipse cx="40" cy="32" rx="16" ry="16" fill="#bdbdbd" />
                    <ellipse cx="40" cy="56" rx="24" ry="12" fill="#bdbdbd" />
                  </svg>
                </div>
                
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: '#111827',
                  margin: '0 0 8px 0',
                  letterSpacing: '-0.025em',
                }}>
                  {searchTerm ? highlightText(processedNodeData?.displayName || "", searchTerm) : processedNodeData?.displayName}
                </h4>
                
                {processedNodeData?.names && processedNodeData.names.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    justifyContent: 'center',
                    marginTop: '12px',
                  }}>
                    {processedNodeData.names
                      .filter(name => name !== processedNodeData.common_name)
                      .map((name, i) => (
                        <span
                          key={i}
                          style={{
                            background: '#f3f4f6',
                            color: '#4b5563',
                            borderRadius: '12px',
                            fontSize: '13px',
                            padding: '4px 12px',
                            border: '1px solid #e5e7eb',
                            fontWeight: '500',
                          }}
                        >
                          {searchTerm ? highlightText(name, searchTerm) : name}
                        </span>
                      ))}
                  </div>
                )}
              </div>

              {/* 인물 설명 */}
              {processedNodeData?.hasDescription && (
                <div style={{
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '20px',
                }}>
                  <div style={{
                    borderLeft: '4px solid #2563eb',
                    paddingLeft: '20px',
                  }}>
                    <p style={{
                      margin: 0,
                      fontSize: '14px',
                      lineHeight: '1.6',
                      color: '#374151',
                      letterSpacing: '-0.01em',
                    }}>
                      {searchTerm ? highlightText(processedNodeData.description, searchTerm) : processedNodeData.description}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 검색 결과 연결 정보 */}
            {isSearchActive && filteredElements.length > 0 && (
              <div 
                className="sidebar-card"
                style={{
                  background: '#fff',
                  borderRadius: '12px',
                  padding: '24px',
                  marginBottom: '24px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <h4 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#111827',
                  margin: '0 0 16px 0',
                  letterSpacing: '-0.025em',
                }}>
                  검색 결과 연결 정보
                </h4>
                <div style={{
                  background: '#f8f9fc',
                  borderRadius: '8px',
                  padding: '16px',
                  border: '1px solid #e3e6ef',
                }}>
                  <p style={{
                    margin: 0,
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: '#42506b',
                    letterSpacing: '-0.01em',
                  }}>
                    이 인물과 연결된 {filteredElements.filter(el => 
                      el.data.source && 
                      (el.data.source === processedNodeData?.id || el.data.target === processedNodeData?.id)
                    ).length}개의 관계가 검색 결과에 포함되어 있습니다.
                  </p>
                </div>
              </div>
            )}

            {/* 요약 섹션 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '16px',
                padding: '28px',
                marginBottom: '24px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {!showSummary ? (
                <div style={{
                  textAlign: 'center',
                  padding: '32px 20px',
                  position: 'relative',
                }}>
                  {/* 배경 장식 요소 */}
                  <div style={{
                    position: 'absolute',
                    top: '-20px',
                    right: '-20px',
                    width: '80px',
                    height: '80px',
                    background: 'linear-gradient(135deg, rgba(79,109,222,0.05) 0%, rgba(111,167,255,0.05) 100%)',
                    borderRadius: '50%',
                    zIndex: 0,
                  }} />
                  <div style={{
                    position: 'absolute',
                    bottom: '-30px',
                    left: '-30px',
                    width: '100px',
                    height: '100px',
                    background: 'linear-gradient(135deg, rgba(79,109,222,0.03) 0%, rgba(111,167,255,0.03) 100%)',
                    borderRadius: '50%',
                    zIndex: 0,
                  }} />
                  
                  <div style={{
                    position: 'relative',
                    zIndex: 1,
                  }}>
                    <h4 style={{
                      fontSize: '18px',
                      fontWeight: '700',
                      color: '#111827',
                      margin: '0 0 12px 0',
                      letterSpacing: '-0.025em',
                    }}>
                      스포일러 주의
                    </h4>
                    
                    <p style={{
                      fontSize: '15px',
                      color: '#6b7280',
                      margin: '0 0 28px 0',
                      lineHeight: '1.6',
                      maxWidth: '280px',
                      marginLeft: 'auto',
                      marginRight: 'auto',
                    }}>
                      이 인물의 상세한 요약 정보를 확인하시겠습니까?
                    </p>
                    
                    <div style={{
                      display: 'flex',
                      gap: '12px',
                      justifyContent: 'center',
                      flexWrap: 'wrap',
                    }}>
                      <button
                        onClick={() => setShowSummary(true)}
                        style={{
                          background: 'linear-gradient(135deg, #4F6DDE 0%, #6fa7ff 100%)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '14px 28px',
                          fontSize: '15px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: '0 4px 12px rgba(79,109,222,0.25)',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 8px 20px rgba(79,109,222,0.35)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(79,109,222,0.25)';
                        }}
                      >
                        <span style={{ position: 'relative', zIndex: 1 }}>
                          요약 정보 보기
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  position: 'relative',
                }}>
                  {/* 헤더 섹션 */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '24px',
                    paddingBottom: '16px',
                    borderBottom: '2px solid #f3f4f6',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}>
                      <h4 style={{
                        fontSize: '18px',
                        fontWeight: '700',
                        color: '#111827',
                        margin: 0,
                        letterSpacing: '-0.025em',
                      }}>
                        인물 요약
                      </h4>
                    </div>
                    
                    <button
                      onClick={() => setShowSummary(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '18px',
                        color: '#6b7280',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '8px',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = '#f3f4f6';
                        e.currentTarget.style.color = '#374151';
                        e.currentTarget.style.transform = 'scale(1.1)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = 'none';
                        e.currentTarget.style.color = '#6b7280';
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                    >
                      닫기
                    </button>
                  </div>
                  
                  {/* 요약 내용 */}
                  <div style={{
                    background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                    borderRadius: '12px',
                    padding: '20px',
                    border: '1px solid #e2e8f0',
                    position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      left: '0',
                      right: '0',
                      height: '4px',
                      background: 'linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)',
                      borderRadius: '12px 12px 0 0',
                    }} />
                    
                    <p style={{
                      margin: 0,
                      fontSize: '15px',
                      lineHeight: '1.7',
                      color: '#374151',
                      letterSpacing: '-0.01em',
                      whiteSpace: 'pre-wrap',
                      textAlign: 'justify',
                    }}>
                      {summaryData.summary}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  );
  }
}

export default React.memo(UnifiedNodeInfo);

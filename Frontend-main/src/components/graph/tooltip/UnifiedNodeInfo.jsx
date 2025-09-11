import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useLocation } from "react-router-dom";
import { processRelations, processRelationTags } from "../../../utils/relationUtils.js";
import { getChapterLastEventNums, getFolderKeyFromFilename, getEventDataByIndex, getDetectedMaxChapter } from "../../../utils/graphData.js";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition.js";
import { useClickOutside } from "../../../hooks/useClickOutside.js";
import { useRelationData } from "../../../hooks/useRelationData.js";
import { safeNum } from "../../../utils/relationUtils.js";
import { mergeRefs } from "../../../utils/styles/animations.js";
import { COLORS, createButtonStyle, createAdvancedButtonHandlers, ANIMATION_VALUES, unifiedNodeTooltipStyles, unifiedNodeAnimations } from "../../../utils/styles/styles.js";
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
  maxChapter,
  searchTerm = "",
  elements = [],
  isSearchActive = false,
  filteredElements = [],
  filename,
  currentEvent = null,
  prevValidEvent = null,
  events = [],
}) {
  const { filename: urlFilename } = useParams();
  const location = useLocation();
  const actualFilename = filename || urlFilename;

  // 그래프 단독 페이지 여부 판단
  const isGraphPage = location.pathname.includes('/user/graph/');

  // maxChapter를 동적으로 계산
  const folderKey = getFolderKeyFromFilename(actualFilename);
  const dynamicMaxChapter = maxChapter || getDetectedMaxChapter(folderKey);

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
  const { position, showContent, isDragging, justFinishedDragging, tooltipRef, handleMouseDown } = useTooltipPosition(x, y);

  // 외부 클릭 감지 훅 - 툴팁 모드에서만 사용, 드래그 후 클릭 무시
  const clickOutsideRef = useClickOutside(() => {
    if (onClose) onClose();
  }, displayMode === 'tooltip', true);

  // 관계 데이터 관리 (슬라이드바 모드에서 사용)
  const id1 = safeNum(nodeData?.id);
  const id2 = safeNum(nodeData?.id);
  const { fetchData } = useRelationData('standalone', id1, id2, chapterNum, eventNum, dynamicMaxChapter, actualFilename);

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
    if (isGraphPage || !eventNum || eventNum === 0) {
      const lastEventNums = getChapterLastEventNums(folderKey);
      return { eventNum: lastEventNums[chapterNum - 1] || 1 };
    }
    
    return { eventNum: eventNum || 0 };
  }, [currentEvent, prevValidEvent, isGraphPage, eventNum, chapterNum, folderKey]);

  // 노드 등장 여부 확인 함수 (ViewerTopBar 방식 적용)
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

      // ViewerTopBar와 동일한 방식으로 이벤트 정보 가져오기
      const unifiedEventInfo = getUnifiedEventInfo();
      const targetEventNum = unifiedEventInfo.eventNum;

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
  }, [data, chapterNum, getUnifiedEventInfo, isGraphPage, dynamicMaxChapter, actualFilename, elements]);

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
  const zIndexValue = inViewer ? 99999 : 99999;

  // 에러가 있는 경우 에러 메시지 표시
  if (error) {
    const errorContent = (
      <div style={{ textAlign: "center", color: COLORS.error }}>
        <h4 style={{ margin: "0 0 0.5rem 0" }}>오류가 발생했습니다</h4>
        <p style={{ margin: 0, fontSize: "0.875rem" }}>{error}</p>
        <button
          onClick={onClose}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            background: COLORS.error,
            color: "white",
            border: "none",
            borderRadius: "0.5rem",
            cursor: "pointer",
            ...createButtonStyle(ANIMATION_VALUES, 'default')
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
            ...unifiedNodeTooltipStyles.errorContainer,
            left: position.x,
            top: position.y,
            zIndex: zIndexValue,
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
          padding: displayMode === 'tooltip' ? "2.5rem 1.5rem" : "2.5rem 1rem",
          textAlign: "center",
          minHeight: displayMode === 'tooltip' ? "12.5rem" : "auto",
        }}
      >
        <div
          style={{
            width: "5rem",
            height: "5rem",
            borderRadius: "50%",
            background: COLORS.backgroundLight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1.25rem",
            border: `0.125rem solid ${COLORS.border}`,
          }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill={COLORS.border} />
            <ellipse cx="20" cy="16" rx="8" ry="8" fill={COLORS.textSecondary} />
            <ellipse cx="20" cy="32" rx="12" ry="6" fill={COLORS.textSecondary} />
          </svg>
        </div>

        <h3
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: COLORS.textPrimary,
            marginBottom: "0.5rem",
          }}
        >
          {processedNodeData?.displayName}
        </h3>

        <p
          style={{
            fontSize: "1rem",
            color: COLORS.textSecondary,
            lineHeight: 1.5,
            marginBottom: 0,
          }}
        >
          아직 등장하지 않은 인물입니다
        </p>

        <p
          style={{
            fontSize: "0.875rem",
            color: COLORS.textSecondary,
            lineHeight: 1.4,
            marginTop: "0.5rem",
          }}
        >
          {(() => {
            const unifiedEventInfo = getUnifiedEventInfo();
            if (unifiedEventInfo.name) {
              return `챕터 ${chapterNum} 이벤트 "${unifiedEventInfo.name}"에서는 등장하지 않습니다`;
            } else if (unifiedEventInfo.eventNum) {
              return `챕터 ${chapterNum} 이벤트 ${unifiedEventInfo.eventNum}에서는 등장하지 않습니다`;
            } else {
              return `챕터 ${chapterNum}에서는 등장하지 않습니다`;
            }
          })()}
        </p>
      </div>
    );

    if (displayMode === 'tooltip') {
      return (
        <div
          ref={mergeRefs(tooltipRef, clickOutsideRef)}
          className="graph-node-tooltip"
          style={{
            ...unifiedNodeTooltipStyles.notAppearedContainer,
            left: position.x,
            top: position.y,
            zIndex: zIndexValue,
            opacity: showContent ? 1 : 0,
            transition: unifiedNodeAnimations.tooltipSimpleTransition(isDragging),
            cursor: isDragging ? "grabbing" : "grab",
            ...(style || {}),
          }}
          onMouseDown={handleMouseDown}
        >
          <button
            onClick={onClose}
            className="tooltip-close-btn"
            style={{
              ...createButtonStyle(ANIMATION_VALUES, 'tooltipClose'),
              top: "1.125rem",
              right: "1.125rem",
              fontSize: "1.375rem",
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
            padding: "2.5rem 1rem",
            textAlign: "center",
            color: COLORS.textSecondary,
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
        height: "auto",
        minHeight: "17.5rem",
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
        style={createButtonStyle(ANIMATION_VALUES, 'tooltipClose')}
      >
        &times;
      </button>
      
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          padding: "1.75rem 0 0 0",
          borderTopLeftRadius: "0.9375rem",
          borderTopRightRadius: "0.9375rem",
          background: "linear-gradient(90deg, #e3eafe 0%, #f8fafc 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            gap: "1.3125rem",
            width: "100%",
          }}
        >
          <div
            className="profile-image-placeholder"
            style={{
              width: "4.6875rem",
              height: "4.6875rem",
              borderRadius: "50%",
              background: "#e6e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "0.75rem",
              marginLeft: "1.3125rem",
              boxShadow: "0 0.125rem 0.5rem rgba(108,142,255,0.10)",
            }}
          >
            <div
              className="profile-img"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "3rem",
                height: "3rem",
                margin: "0 auto 0.5625rem auto",
                borderRadius: "50%",
                background: "#f4f4f4",
              }}
            >
              {processedNodeData?.hasImage ? (
                <img
                  src={processedNodeData.image}
                  alt={processedNodeData.displayName || "character"}
                  style={{
                    width: "4.6875rem",
                    height: "4.6875rem",
                    objectFit: "cover",
                    borderRadius: "50%",
                    border: "0.125rem solid #e0e0e0",
                    background: "#faf7f2",
                    boxShadow: "0 0.125rem 0.5rem rgba(0,0,0,0.03)",
                  }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'block';
                  }}
                />
              ) : null}
              <svg 
                width="42" 
                height="42" 
                viewBox="0 0 42 42" 
                fill="none"
                style={{ display: processedNodeData?.hasImage ? 'none' : 'block' }}
              >
                <circle cx="21" cy="21" r="21" fill="#e5e7eb" />
                <ellipse cx="21" cy="16" rx="9" ry="9" fill="#bdbdbd" />
                <ellipse cx="21" cy="33" rx="13" ry="7" fill="#bdbdbd" />
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
                gap: "0.5rem",
                marginTop: "0.75rem",
                marginBottom: "0.1875rem",
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: "1.25rem",
                  color: COLORS.textPrimary,
                  letterSpacing: "0.03125rem",
                  maxWidth: "10.3125rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {processedNodeData?.displayName}
              </span>

              {processedNodeData?.isMainCharacter && (
                <span
                  style={{
                    background: `linear-gradient(90deg, ${COLORS.primary} 0%, ${COLORS.primary} 100%)`,
                    color: "#fff",
                    borderRadius: "0.6875rem",
                    fontSize: "0.75rem",
                    padding: "0.125rem 0.5625rem",
                    marginLeft: "0.125rem",
                    fontWeight: 700,
                    boxShadow: `0 0.125rem 0.5rem ${COLORS.primary}26`,
                  }}
                >
                  주요 인물
                </span>
              )}
            </div>

            {processedNodeData?.names && processedNodeData.names.length > 0 && (
              <div
                style={{
                  marginTop: "0.125rem",
                  marginBottom: "0.125rem",
                  display: "flex",
                  gap: "0.3125rem",
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
                        background: COLORS.backgroundLight,
                        color: COLORS.textPrimary,
                        borderRadius: "0.5625rem",
                        fontSize: "0.75rem",
                        padding: "0.125rem 0.5625rem",
                        border: `0.0625rem solid ${COLORS.border}`,
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
          margin: "0.875rem 0 0 0",
          border: 0,
          borderTop: "0.0625rem solid #f0f2f8",
        }}
      />
      
      <div
        className="business-card-description"
        style={{
          color: "#333",
          fontSize: "0.875rem",
          minHeight: "2.625rem",
          margin: "1.3125rem 1.75rem 0 1.75rem",
          textAlign: "left",
          lineHeight: 1.6,
          fontWeight: 400,
        }}
      >
        {processedNodeData?.hasDescription ? (
          processedNodeData.description
        ) : (
          <span style={{ color: COLORS.textSecondary }}>설명 정보가 없습니다.</span>
        )}
      </div>
      
      {/* 검색 상태에서 연결 정보 표시 */}
      {isSearchActive && filteredElements.length > 0 && (
        <div
          style={{
            margin: "1rem 2rem 0 2rem",
            padding: "0.75rem 1rem",
            background: COLORS.backgroundLight,
            borderRadius: "0.375rem",
            border: `0.0625rem solid ${COLORS.borderLight}`,
          }}
        >
          <div
            style={{
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: COLORS.primary,
              marginBottom: "0.375rem",
            }}
          >
            🔍 검색 결과 연결 정보
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: COLORS.textPrimary,
              lineHeight: 1.4,
            }}
          >
            {filteredElements.filter(el => 
              el.data.source && 
              (el.data.source === processedNodeData?.id || el.data.target === processedNodeData?.id)
            ).length}개의 관계가 검색 결과에 포함되어 있습니다.
          </div>
        </div>
      )}
      
      <hr
        style={{
          margin: "0.875rem 0 0 0",
          border: 0,
          borderTop: "0.0625rem solid #f0f2f8",
        }}
      />
      <div style={{ flex: 1, marginBottom: "1.25rem" }} />
    </div>
  );

  // 툴팁 모드 렌더링
  if (displayMode === 'tooltip') {
    return (
      <div
        ref={mergeRefs(tooltipRef, clickOutsideRef)}
        className={`graph-node-tooltip ${isFlipped ? "flipped" : ""}`}
        style={{
          ...unifiedNodeTooltipStyles.tooltipContainer,
          left: position.x,
          top: position.y,
          zIndex: zIndexValue,
          opacity: showContent ? 1 : 0,
          transition: unifiedNodeAnimations.tooltipComplexTransition(isDragging),
          cursor: isDragging ? "grabbing" : "grab",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
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
        style={unifiedNodeTooltipStyles.sidebarContainer}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        tabIndex={0}
      >
        {/* 사이드바 헤더 */}
        <div style={{
          padding: '1.5rem 1.5rem 1rem 1.5rem',
          borderBottom: '0.0625rem solid #e5e7eb',
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
              gap: '0.25rem',
              flex: 1,
            }}>
              <span style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: COLORS.textPrimary,
                letterSpacing: '-0.025em',
              }}>
                {processedNodeData?.displayName}
              </span>
              {processedNodeData?.isMainCharacter && (
                <span style={{
                  background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primary} 100%)`,
                  color: '#fff',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.75rem',
                  fontWeight: '600',
                  boxShadow: `0 0.125rem 0.25rem ${COLORS.primary}33`,
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
                fontSize: '1.5rem',
                color: COLORS.textSecondary,
                cursor: 'pointer',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: unifiedNodeAnimations.buttonHoverTransition,
                width: '2.5rem',
                height: '2.5rem',
                marginLeft: '1rem',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = COLORS.backgroundLight;
                e.currentTarget.style.color = COLORS.textPrimary;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = COLORS.textSecondary;
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = COLORS.backgroundLight;
                e.currentTarget.style.color = COLORS.textPrimary;
                e.currentTarget.style.outline = `0.125rem solid ${COLORS.primary}`;
                e.currentTarget.style.outlineOffset = '0.125rem';
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = COLORS.textSecondary;
                e.currentTarget.style.outline = 'none';
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* 사이드바 본문 */}
        <div 
          className="sidebar-content"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '0 1.5rem',
          }}
        >
          <div style={{ padding: '1.5rem 0' }}>
            {/* 통합 프로필 및 설명 섹션 */}
            <div 
              className="sidebar-card"
              style={{
                background: COLORS.background,
                borderRadius: '0.75rem',
                padding: '1.5rem',
                marginBottom: '1.5rem',
                border: `0.0625rem solid ${COLORS.border}`,
                boxShadow: '0 0.0625rem 0.1875rem rgba(0,0,0,0.05)',
              }}
            >
              {/* 프로필 이미지 */}
              <div style={{
                textAlign: 'center',
                marginBottom: '1.25rem',
              }}>
                <div
                  style={{
                    width: '7.5rem',
                    height: '7.5rem',
                    borderRadius: '50%',
                    background: '#e6e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1.25rem auto',
                    boxShadow: '0 0.25rem 0.75rem rgba(108,142,255,0.15)',
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
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  color: COLORS.textPrimary,
                  margin: '0 0 0.5rem 0',
                  letterSpacing: '-0.025em',
                }}>
                  {processedNodeData?.displayName}
                </h4>
                
                {processedNodeData?.names && processedNodeData.names.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    justifyContent: 'center',
                    marginTop: '0.75rem',
                  }}>
                    {processedNodeData.names
                      .filter(name => name !== processedNodeData.common_name)
                      .map((name, i) => (
                        <span
                          key={i}
                          style={{
                            background: COLORS.backgroundLight,
                            color: COLORS.textPrimary,
                            borderRadius: '0.75rem',
                            fontSize: '0.8125rem',
                            padding: '0.25rem 0.75rem',
                            border: `0.0625rem solid ${COLORS.border}`,
                            fontWeight: '500',
                          }}
                        >
                          {name}
                        </span>
                      ))}
                  </div>
                )}
              </div>

              {/* 인물 설명 */}
              {processedNodeData?.hasDescription && (
                <div style={{
                  borderTop: '0.0625rem solid #e5e7eb',
                  paddingTop: '1.25rem',
                }}>
                  <div style={{
                    borderLeft: '0.25rem solid #2563eb',
                    paddingLeft: '1.25rem',
                  }}>
                    <p style={{
                      margin: 0,
                      fontSize: '0.875rem',
                      lineHeight: '1.6',
                      color: COLORS.textPrimary,
                      letterSpacing: '-0.01em',
                    }}>
                      {processedNodeData.description}
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
                  background: COLORS.background,
                  borderRadius: '0.75rem',
                  padding: '1.5rem',
                  marginBottom: '1.5rem',
                  border: `0.0625rem solid ${COLORS.border}`,
                  boxShadow: '0 0.0625rem 0.1875rem rgba(0,0,0,0.05)',
                }}
              >
                <h4 style={{
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: COLORS.textPrimary,
                  margin: '0 0 1rem 0',
                  letterSpacing: '-0.025em',
                }}>
                  검색 결과 연결 정보
                </h4>
                <div style={{
                  background: '#f8f9fc',
                  borderRadius: '0.5rem',
                  padding: '1rem',
                  border: '0.0625rem solid #e3e6ef',
                }}>
                  <p style={{
                    margin: 0,
                    fontSize: '0.875rem',
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
                background: COLORS.background,
                borderRadius: '1rem',
                padding: '1.75rem',
                marginBottom: '1.5rem',
                border: `0.0625rem solid ${COLORS.border}`,
                boxShadow: '0 0.125rem 0.5rem rgba(0,0,0,0.06), 0 0.0625rem 0.1875rem rgba(0,0,0,0.1)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {!showSummary ? (
                <div style={{
                  textAlign: 'center',
                  padding: '2rem 1.25rem',
                  position: 'relative',
                }}>
                  {/* 배경 장식 요소 */}
                  <div style={{
                    position: 'absolute',
                    top: '-1.25rem',
                    right: '-1.25rem',
                    width: '5rem',
                    height: '5rem',
                    background: `linear-gradient(135deg, ${COLORS.primary}0D 0%, ${COLORS.primary}0D 100%)`,
                    borderRadius: '50%',
                    zIndex: 0,
                  }} />
                  <div style={{
                    position: 'absolute',
                    bottom: '-1.875rem',
                    left: '-1.875rem',
                    width: '6.25rem',
                    height: '6.25rem',
                    background: `linear-gradient(135deg, ${COLORS.primary}08 0%, ${COLORS.primary}08 100%)`,
                    borderRadius: '50%',
                    zIndex: 0,
                  }} />
                  
                  <div style={{
                    position: 'relative',
                    zIndex: 1,
                  }}>
                    <h4 style={{
                      fontSize: '1.125rem',
                      fontWeight: '700',
                      color: COLORS.textPrimary,
                      margin: '0 0 0.75rem 0',
                      letterSpacing: '-0.025em',
                    }}>
                      스포일러 주의
                    </h4>
                    
                    <p style={{
                      fontSize: '0.9375rem',
                      color: COLORS.textSecondary,
                      margin: '0 0 1.75rem 0',
                      lineHeight: '1.6',
                      maxWidth: '17.5rem',
                      marginLeft: 'auto',
                      marginRight: 'auto',
                    }}>
                      이 인물의 상세한 요약 정보를 확인하시겠습니까?
                    </p>
                    
                    <div style={{
                      display: 'flex',
                      gap: '0.75rem',
                      justifyContent: 'center',
                      flexWrap: 'wrap',
                    }}>
                      <button
                        onClick={() => setShowSummary(true)}
                        style={createButtonStyle(ANIMATION_VALUES, 'primaryAdvanced')}
                        {...createAdvancedButtonHandlers('primaryAdvanced')}
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
                    marginBottom: '1.5rem',
                    paddingBottom: '1rem',
                    borderBottom: `0.125rem solid ${COLORS.backgroundLight}`,
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}>
                      <h4 style={{
                        fontSize: '1.125rem',
                        fontWeight: '700',
                        color: COLORS.textPrimary,
                        margin: 0,
                        letterSpacing: '-0.025em',
                      }}>
                        인물 요약
                      </h4>
                    </div>
                    
                    <button
                      onClick={() => setShowSummary(false)}
                      style={createButtonStyle(ANIMATION_VALUES, 'close')}
                      {...createAdvancedButtonHandlers('close')}
                    >
                      &times;
                    </button>
                  </div>
                  
                  {/* 요약 내용 */}
                  <div style={{
                    background: `linear-gradient(135deg, ${COLORS.backgroundLighter} 0%, ${COLORS.backgroundLight} 100%)`,
                    borderRadius: '0.75rem',
                    padding: '1.25rem',
                    border: `0.0625rem solid ${COLORS.border}`,
                    position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      left: '0',
                      right: '0',
                      height: '0.25rem',
                      background: `linear-gradient(90deg, ${COLORS.primary} 0%, ${COLORS.primary} 100%)`,
                      borderRadius: '0.75rem 0.75rem 0 0',
                    }} />
                    
                    <p style={{
                      margin: 0,
                      fontSize: '0.9375rem',
                      lineHeight: '1.7',
                      color: COLORS.textPrimary,
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


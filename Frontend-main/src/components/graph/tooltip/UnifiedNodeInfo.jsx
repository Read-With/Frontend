import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useLocation } from "react-router-dom";
import { processRelations, processRelationTags } from "../../../utils/relationUtils.js";
import { getChapterLastEventNums, getFolderKeyFromFilename, getEventDataByIndex, getDetectedMaxChapter, getCharacterPerspectiveSummary } from "../../../utils/graphData.js";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition.js";
import { useClickOutside } from "../../../hooks/useClickOutside.js";
import { useRelationData } from "../../../hooks/useRelationData.js";
import { safeNum } from "../../../utils/relationUtils.js";
import { mergeRefs } from "../../../utils/styles/animations.js";
import { COLORS, createButtonStyle, ANIMATION_VALUES, unifiedNodeTooltipStyles, unifiedNodeAnimations } from "../../../utils/styles/styles.js";
import { extractRadarChartData, getPositivityColor, getPositivityLabel } from "../../../utils/radarChartUtils.js";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
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
  onClose,
  inViewer = false,
  style,
  chapterNum,
  eventNum,
  maxChapter,
  elements = [],
  isSearchActive = false,
  filteredElements = [],
  filename,
  currentEvent = null,
  prevValidEvent = null,
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

  const [isNodeAppeared, setIsNodeAppeared] = useState(false);
  const [error, setError] = useState(null);
  const [isWarningExpanded, setIsWarningExpanded] = useState(false); // 경고 화면 펼침 여부
  const [showSummary, setShowSummary] = useState(false); // 실제 내용 표시 여부
  const [isModalOpen, setIsModalOpen] = useState(false); // 확대 화면 모달 상태
  const [hoveredItem, setHoveredItem] = useState(null); // 호버된 아이템
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 }); // 호버 위치
  const [language, setLanguage] = useState('ko');
  const [isLanguageChanging, setIsLanguageChanging] = useState(false);
  const [previousDescription, setPreviousDescription] = useState('');

  // 모달 핸들러
  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setHoveredItem(null); // 모달 닫을 때 호버 상태 초기화
  }, []);

  // 마우스 오버 핸들러
  const handleMouseEnter = useCallback((name, event) => {
    setHoveredItem(name);
    setHoverPosition({
      x: event.clientX,
      y: event.clientY
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredItem(null);
  }, []);

  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && isModalOpen) {
        handleCloseModal();
      }
    };

    if (isModalOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, handleCloseModal]);

  // 인물이 변경될 때마다 모든 상태 초기화
  useEffect(() => {
    setIsWarningExpanded(false);
    setShowSummary(false);
    setIsModalOpen(false);
    setHoveredItem(null);
  }, [nodeData?.id]);


  // 툴팁 모드에서만 위치 관리 훅 사용
  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(x, y);

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


  // 언어 전환 핸들러
  const handleLanguageToggle = useCallback(() => {
    setIsLanguageChanging(true);
    setTimeout(() => {
      setLanguage(prev => prev === 'ko' ? 'en' : 'ko');
      setTimeout(() => {
        setIsLanguageChanging(false);
      }, 200);
    }, 200);
  }, []);

  // 메모이제이션된 데이터 처리
  const processedNodeData = useMemo(() => {
    if (!nodeData) return null;

    return {
      ...nodeData,
      names: processRelationTags(nodeData.names || [], nodeData.common_name),
      displayName: nodeData.common_name || nodeData.label || "Unknown",
      hasImage: !!nodeData.image,
      isMainCharacter: !!nodeData.main_character,
    };
  }, [nodeData]);

  // 언어에 따라 description을 동적으로 계산 (기본값은 항상 한글)
  const currentDescription = useMemo(() => {
    if (!nodeData) return '';
    
    // 기본적으로 한글 우선, 언어 설정에 따라 전환
    const description = language === 'ko' 
      ? (nodeData.description_ko || nodeData.description || '') 
      : (nodeData.description || '');
    
    return description;
  }, [nodeData, language]);


  // 언어 전환 시 이전 description 저장
  useEffect(() => {
    if (!isLanguageChanging && currentDescription) {
      setPreviousDescription(currentDescription);
    }
  }, [currentDescription, isLanguageChanging]);

  // 실제 표시할 description (번역 중일 때는 이전 값 유지)
  const displayDescription = isLanguageChanging ? previousDescription : currentDescription;
  const displayHasDescription = !!(displayDescription && displayDescription.trim());

  // 요약 데이터 - perspective summaries에서 가져오기
  const summaryData = useMemo(() => {
    if (!processedNodeData?.label) {
      return { summary: "인물에 대한 요약 정보가 없습니다." };
    }

    // 현재 챕터 정보 가져오기
    const currentChapter = chapterNum || 1;
    const folderKey = getFolderKeyFromFilename(actualFilename);
    
    // perspective summary 가져오기
    const perspectiveSummary = getCharacterPerspectiveSummary(
      folderKey, 
      currentChapter, 
      processedNodeData.label
    );

    if (perspectiveSummary) {
      return { summary: perspectiveSummary };
    }

    // perspective summary가 없는 경우 기본 메시지
    return { 
      summary: `${processedNodeData.label}에 대한 ${currentChapter}장 관점 요약이 아직 준비되지 않았습니다.` 
    };
  }, [processedNodeData, chapterNum, actualFilename]);

  // 레이더 차트 데이터 추출
  const radarChartData = useMemo(() => {
    if (!nodeData?.id || !chapterNum || displayMode !== 'sidebar') {
      return [];
    }

    if (!elements || elements.length === 0) {
      return [];
    }

    try {
      const unifiedEventInfo = getUnifiedEventInfo();
      const targetEventNum = unifiedEventInfo.eventNum;
      
      const json = getEventDataByIndex(folderKey, chapterNum, targetEventNum);
      
      if (!json || !json.relations) {
        return [];
      }

      const processedRelations = processRelations(json.relations);
      const chartData = extractRadarChartData(nodeData.id, processedRelations, elements, 8);
      
      return chartData;
    } catch (err) {
      console.error('레이더 차트 데이터 추출 오류:', err);
      return [];
    }
  }, [nodeData?.id, chapterNum, displayMode, folderKey, elements, eventNum, isGraphPage]);

  // 데이터 Map 생성 (빠른 검색용)
  const dataMap = useMemo(() => {
    const map = new Map();
    radarChartData.forEach(item => {
      map.set(item.name, item);
    });
    return map;
  }, [radarChartData]);

  // 축 라벨 커스터마이징
  const renderPolarAngleAxis = ({ payload, x, y, cx }) => {
    const dataPoint = dataMap.get(payload.value);
    const color = (dataPoint && dataPoint.positivity !== undefined) 
      ? getPositivityColor(dataPoint.positivity) 
      : COLORS.textPrimary;
    const isHovered = hoveredItem === payload.value;
    
    return (
      <text
        x={x}
        y={y}
        textAnchor={x > cx ? 'start' : 'end'}
        fill={isHovered ? color : COLORS.textPrimary}
        fontSize={isHovered ? 13 : 12}
        fontWeight={isHovered ? 600 : 500}
        style={{ transition: 'all 0.2s ease' }}
      >
        {payload.value}
      </text>
    );
  };

  // 호버된 아이템의 데이터 가져오기
  const hoveredData = useMemo(() => {
    if (!hoveredItem) return null;
    return dataMap.get(hoveredItem);
  }, [hoveredItem, dataMap]);

  // 커스텀 Dot 렌더링 (각 점을 positivity에 따라 다른 색상으로)
  const CustomDot = React.memo((props) => {
    const { cx, cy, payload } = props;
    
    if (!payload || !cx || !cy) {
      return null;
    }
    
    const fullData = dataMap.get(payload.name) || payload;
    const color = getPositivityColor(fullData.positivity);
    const isHovered = hoveredItem === payload.name;
    const radius = isHovered ? 8 : 5;
    
    return (
      <g>
        {/* 투명한 큰 원 - 호버 감지용 */}
        <circle
          cx={cx}
          cy={cy}
          r={15}
          fill="transparent"
          style={{ cursor: 'pointer', pointerEvents: 'all' }}
          onMouseEnter={(e) => handleMouseEnter(fullData.name, e)}
          onMouseLeave={handleMouseLeave}
        />
        {/* 실제 표시되는 점 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={color}
          style={{ transition: 'r 0.2s ease' }}
        />
      </g>
    );
  });

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
        position: "relative",
        width: "100%",
        height: "auto",
        minHeight: "17.5rem",
        transform: "rotateY(0deg)",
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
      
      {/* 언어 전환 버튼 - 툴팁 모드 */}
      <button
        onClick={handleLanguageToggle}
        aria-label="언어 전환"
        disabled={isLanguageChanging}
        style={{
          position: 'absolute',
          top: '14px',
          right: '56px',
          background: COLORS.backgroundLight,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '6px',
          padding: '4px 12px',
          fontSize: '13px',
          fontWeight: '600',
          color: COLORS.primary,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          zIndex: 2,
        }}
        onMouseEnter={(e) => {
          e.target.style.background = COLORS.primaryLight;
        }}
        onMouseLeave={(e) => {
          e.target.style.background = COLORS.backgroundLight;
        }}
      >
        {language === 'ko' ? 'EN' : 'KO'}
      </button>
      
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          padding: "1.75rem 0 0 0",
          borderTopLeftRadius: "0.9375rem",
          borderTopRightRadius: "0.9375rem",
          background: "#f1f5f9",
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
                    background: COLORS.primary,
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
        {displayHasDescription ? (
          <span style={{ 
            opacity: isLanguageChanging ? 0.25: 1,
            transition: 'opacity 0.2s ease'
          }}>
            {displayDescription}
          </span>
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
        className={`graph-node-tooltip`}
        style={{
          ...unifiedNodeTooltipStyles.tooltipContainer,
          left: position.x,
          top: position.y,
          zIndex: zIndexValue,
          opacity: showContent ? 1 : 0,
          transition: unifiedNodeAnimations.tooltipComplexTransition(isDragging),
          cursor: isDragging ? "grabbing" : "grab",
          transform: "rotateY(0deg)",
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
            alignItems: 'center',
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
                  background: COLORS.primary,
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
            
            {/* 언어 전환 버튼 */}
            <button
              onClick={handleLanguageToggle}
              aria-label="언어 전환"
              disabled={isLanguageChanging}
              style={{
                background: COLORS.backgroundLight,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '6px',
                padding: '0 12px',
                height: '2.5rem',
                fontSize: '13px',
                fontWeight: '600',
                color: COLORS.primary,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                marginRight: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => {
                e.target.style.background = COLORS.primaryLight;
              }}
              onMouseLeave={(e) => {
                e.target.style.background = COLORS.backgroundLight;
              }}
            >
              {language === 'ko' ? 'EN' : 'KO'}
            </button>
            
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
                background: '#fff',
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
              {displayHasDescription && (
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
                      opacity: isLanguageChanging ? 0.25 : 1,
                      transition: 'opacity 0.2s ease',
                    }}>
                      {displayDescription}
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
                    해당 인물과 연결된 {filteredElements.filter(el => 
                      el.data.source && 
                      (el.data.source === processedNodeData?.id || el.data.target === processedNodeData?.id)
                    ).length}개의 관계가 검색 결과에 포함되어 있습니다.
                  </p>
                </div>
              </div>
            )}

            {/* 요약 섹션 - 3단계 접근 방식 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '0.75rem',
                marginBottom: '1.5rem',
                border: `0.0625rem solid ${COLORS.border}`,
                boxShadow: '0 0.0625rem 0.1875rem rgba(0,0,0,0.05)',
                overflow: 'hidden',
              }}
              role="region"
              aria-label="인물 시점 요약"
            >
              {/* 1단계: 접힌 제목 헤더 */}
              <button
                onClick={() => {
                  if (showSummary || isWarningExpanded) {
                    // 펼쳐진 상태 → 언제나 접기
                    setShowSummary(false);
                    setIsWarningExpanded(false);
                  } else {
                    // 접힌 상태 → 경고 화면 펼침
                    setIsWarningExpanded(true);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '1.5rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: (isWarningExpanded || showSummary) ? `0.0625rem solid ${COLORS.border}` : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!showSummary) {
                    e.currentTarget.style.background = COLORS.backgroundLight;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <h4 style={{
                  fontSize: '1rem',
                  fontWeight: '700',
                  color: COLORS.textPrimary,
                  margin: 0,
                  letterSpacing: '-0.025em',
                  textAlign: 'left',
                }}>
                  해당 인물 시점의 요약
                </h4>
                
                <span style={{
                  fontSize: '1.25rem',
                  transform: (isWarningExpanded || showSummary) ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.3s ease',
                  display: 'inline-block',
                  color: COLORS.primary,
                  flexShrink: 0,
                }}>
                  ▼
                </span>
              </button>
              
              {/* 2단계: 경고 화면 */}
              <div style={{
                maxHeight: (isWarningExpanded && !showSummary) ? '350px' : '0',
                opacity: (isWarningExpanded && !showSummary) ? 1 : 0,
                overflow: 'hidden',
                transition: 'max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease-in-out',
                transitionDelay: (isWarningExpanded && !showSummary) ? '0.15s' : '0s',
              }}>
                <div style={{
                  padding: '2rem 1.5rem 1.5rem 1.5rem',
                  textAlign: 'center',
                }}>
                  {/* 경고 아이콘 */}
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '1rem',
                    animation: (isWarningExpanded && !showSummary) ? 'fadeIn 0.4s ease-in-out, pulse 2s ease-in-out 0.4s infinite' : 'none',
                  }}>
                    ⚠️
                  </div>
                  
                  {/* 경고 제목 */}
                  <h3 style={{
                    fontSize: '1.25rem',
                    fontWeight: '700',
                    color: '#f59e0b',
                    margin: '0 0 0.75rem 0',
                    letterSpacing: '-0.025em',
                    animation: (isWarningExpanded && !showSummary) ? 'fadeIn 0.4s ease-in-out' : 'none',
                  }}>
                    스포일러 포함
                  </h3>
                  
                  {/* 경고 설명 */}
                  <p style={{
                    fontSize: '0.9375rem',
                    lineHeight: '1.7',
                    color: COLORS.textPrimary,
                    letterSpacing: '-0.01em',
                    whiteSpace: 'pre-wrap',
                    margin: '0 0 1.5rem 0',
                    animation: (isWarningExpanded && !showSummary) ? 'fadeIn 0.4s ease-in-out' : 'none',
                  }}>
                    스토리의 중요한 내용을 담고 있습니다.
                    <br />
                    내용을 확인하시겠습니까?
                  </p>
                  
                  {/* 버튼 그룹 */}
                  <div style={{
                    display: 'flex',
                    gap: '1rem',
                    justifyContent: 'center',
                    alignItems: 'center',
                    animation: (isWarningExpanded && !showSummary) ? 'fadeIn 0.4s ease-in-out' : 'none',
                  }}>
                    {/* 취소 버튼 - 경고 화면 접기 */}
                    <button
                      onClick={() => setIsWarningExpanded(false)}
                      aria-label="접기"
                      title="접기"
                      style={{
                        padding: '0.625rem 1.25rem',
                        background: '#fff',
                        color: COLORS.textSecondary,
                        border: `0.0625rem solid ${COLORS.border}`,
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        minWidth: '6rem',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = COLORS.backgroundLight;
                        e.currentTarget.style.borderColor = COLORS.textSecondary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#fff';
                        e.currentTarget.style.borderColor = COLORS.border;
                      }}
                    >
                      취소
                    </button>
                    
                    {/* 확인 버튼 */}
                    <button
                      onClick={() => setShowSummary(true)}
                      aria-label="스포일러 내용 확인하기"
                      style={{
                        padding: '0.625rem 1.25rem',
                        background: COLORS.primary,
                        color: '#fff',
                        border: 'none',
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 0.125rem 0.375rem rgba(37, 99, 235, 0.3)',
                        minWidth: '9rem',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#1d4ed8';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 0.375rem 0.75rem rgba(37, 99, 235, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = COLORS.primary;
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 0.125rem 0.375rem rgba(37, 99, 235, 0.3)';
                      }}
                    >
                      확인하고 보기
                    </button>
                  </div>
                </div>
              </div>
              
              {/* 3단계: 실제 요약 내용 */}
              <div 
                style={{
                  maxHeight: showSummary ? '800px' : '0',
                  opacity: showSummary ? 1 : 0,
                  overflow: 'hidden',
                  transition: 'max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease-in-out',
                  transitionDelay: showSummary ? '0.15s' : '0s',
                  willChange: showSummary ? 'max-height, opacity' : 'auto',
                }}
                aria-hidden={!showSummary}
              >
                <div style={{
                  padding: '1.5rem',
                  borderLeft: `0.25rem solid ${COLORS.primary}`,
                }}>
                  <p style={{
                    margin: 0,
                    fontSize: '0.9375rem',
                    lineHeight: '1.7',
                    color: COLORS.textPrimary,
                    letterSpacing: '-0.01em',
                    whiteSpace: 'pre-wrap',
                    animation: showSummary ? 'fadeIn 0.4s ease-in-out' : 'none',
                  }}>
                    {summaryData.summary}
                  </p>
                </div>
              </div>
            </div>

            {/* 관계 분석 레이더 차트 섹션 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '0.75rem',
                marginBottom: '1.5rem',
                border: `0.0625rem solid ${COLORS.border}`,
                boxShadow: '0 0.0625rem 0.1875rem rgba(0,0,0,0.05)',
                overflow: 'hidden',
              }}
              role="region"
              aria-label="관계 분석"
            >
              {/* 헤더 버튼 */}
              <button
                onClick={handleOpenModal}
                style={{
                  width: '100%',
                  padding: '1.5rem',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = COLORS.backgroundLight;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <h4 style={{
                    fontSize: '1rem',
                    fontWeight: '700',
                    color: COLORS.textPrimary,
                    margin: 0,
                    letterSpacing: '-0.025em',
                  }}>
                    인물 관계 분석
                  </h4>
                  <p style={{
                    fontSize: '0.8rem',
                    color: COLORS.textSecondary,
                    margin: '0.5rem 0 0 0',
                    lineHeight: '1.5',
                  }}>
                    {processedNodeData?.displayName}와 연결된 인물들과의 관계를 시각화합니다
                  </p>
                </div>
                
                <span style={{
                  fontSize: '1.25rem',
                  display: 'inline-block',
                  color: COLORS.primary,
                  flexShrink: 0,
                  marginLeft: '1rem',
                }}>
                  +
                </span>
              </button>

            </div>
          </div>
        </div>

        {/* 확대 화면 모달 */}
        {isModalOpen && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              zIndex: 999999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem',
            }}
            onClick={handleCloseModal}
          >
            <div
              style={{
                background: '#ffffff',
                borderRadius: '1rem',
                padding: '2rem',
                maxWidth: '90vw',
                maxHeight: '90vh',
                width: '800px',
                height: '600px',
                position: 'relative',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                display: 'flex',
                flexDirection: 'column',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.5rem',
                  paddingBottom: '1rem',
                  borderBottom: `2px solid ${COLORS.borderLight}`,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: COLORS.textPrimary,
                  }}
                >
                  관계도 - 확대화면
                </h2>
                <button
                  onClick={handleCloseModal}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.5rem',
                    color: COLORS.textSecondary,
                    cursor: 'pointer',
                    padding: '0.5rem',
                    borderRadius: '0.375rem',
                    transition: 'all 0.2s ease',
                    width: '2rem',
                    height: '2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = COLORS.backgroundLight;
                    e.target.style.color = COLORS.textPrimary;
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'none';
                    e.target.style.color = COLORS.textSecondary;
                  }}
                >
                  ×
                </button>
              </div>

              {/* 확대된 차트 */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {radarChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart 
                      data={radarChartData} 
                      margin={{ top: 20, right: 30, bottom: 20, left: 30 }}
                      style={{ outline: 'none' }}
                    >
                      <style>{`
                        svg:focus {
                          outline: none !important;
                        }
                        svg *:focus {
                          outline: none !important;
                        }
                        * {
                          animation: none !important;
                          transition: none !important;
                        }
                      `}</style>
                      <PolarGrid stroke={COLORS.border} />
                      <PolarAngleAxis 
                        dataKey="name" 
                        tick={renderPolarAngleAxis}
                      />
                      <PolarRadiusAxis 
                        angle={90} 
                        domain={[0, 100]} 
                        tick={{ fontSize: 11, fill: COLORS.textSecondary }}
                        tickCount={5}
                        tickFormatter={(value) => {
                          const normalized = (value / 50) - 1;
                          return normalized.toFixed(1);
                        }}
                      />
                      <Radar
                        name={processedNodeData?.displayName}
                        dataKey="normalizedValue"
                        stroke="#9ca3af"
                        fill="#e5e7eb"
                        fillOpacity={0.2}
                        strokeWidth={2}
                        dot={(dotProps) => {
                          const { key, ...propsWithoutKey } = dotProps;
                          return <CustomDot key={key} {...propsWithoutKey} />;
                        }}
                        isAnimationActive={false}
                        animationBegin={0}
                        animationDuration={0}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{
                    padding: '2rem',
                    textAlign: 'center',
                    color: COLORS.textSecondary,
                    fontSize: '0.875rem',
                  }}>
                    표시할 관계 데이터가 없습니다.
                  </div>
                )}

                {/* 마우스 오버 정보창 */}
                {hoveredData && (
                  <div
                    style={{
                      position: 'fixed',
                      left: `${hoverPosition.x + 10}px`,
                      top: `${hoverPosition.y - 10}px`,
                      padding: '1.25rem 1.5rem',
                      background: 'rgba(255, 255, 255, 0.98)',
                      border: `2px solid ${getPositivityColor(hoveredData.positivity)}`,
                      borderRadius: '0.75rem',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)',
                      zIndex: 999999,
                      backdropFilter: 'blur(8px)',
                      pointerEvents: 'none',
                      minWidth: '320px',
                      maxWidth: '400px',
                      minHeight: '160px',
                    }}
                  >
                    {/* 인물 이름 */}
                    <div style={{ 
                      fontWeight: '700', 
                      fontSize: '1rem', 
                      marginBottom: '0.5rem', 
                      color: COLORS.textPrimary,
                    }}>
                      {hoveredData.fullName || hoveredData.name}
                    </div>
                    
                    {/* 관계도 점수 */}
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      background: 'linear-gradient(135deg, #f8f9fc 0%, #ffffff 100%)',
                      borderRadius: '0.375rem',
                      border: '1px solid #e3e6ef'
                    }}>
                      <span style={{ 
                        fontSize: '0.75rem',
                        color: getPositivityColor(hoveredData.positivity),
                        fontWeight: '600',
                      }}>
                        {getPositivityLabel(hoveredData.positivity || 0)}
                      </span>
                      <span style={{ 
                        fontWeight: '700', 
                        color: getPositivityColor(hoveredData.positivity), 
                        fontSize: '1.25rem',
                      }}>
                        {Math.round((hoveredData.positivity || 0) * 100)}%
                      </span>
                    </div>
                    
                    {hoveredData.relationTags && hoveredData.relationTags.length > 0 && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${COLORS.borderLight}` }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                          {hoveredData.relationTags.slice(0, 6).map((tag, i) => (
                            <span
                              key={i}
                              style={{
                                background: COLORS.backgroundLight,
                                color: COLORS.textPrimary,
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.375rem',
                                fontSize: '0.75rem',
                                border: `1px solid ${COLORS.border}`,
                                fontWeight: '500',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                          {hoveredData.relationTags.length > 6 && (
                            <span style={{ fontSize: '0.75rem', color: COLORS.textSecondary, alignSelf: 'center' }}>
                              +{hoveredData.relationTags.length - 6}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

export default React.memo(UnifiedNodeInfo);
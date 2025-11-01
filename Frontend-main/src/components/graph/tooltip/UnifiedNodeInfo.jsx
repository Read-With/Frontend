import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { processRelations, processRelationTags } from "../../../utils/relationUtils.js";
import { getChapterLastEventNums, getFolderKeyFromFilename, getEventDataByIndex, getDetectedMaxChapter, getCharacterPerspectiveSummary } from "../../../utils/graphData.js";
import { useTooltipPosition } from "../../../hooks/useTooltipPosition.js";
import { useClickOutside } from "../../../hooks/useClickOutside.js";
import { useRelationData } from "../../../hooks/useRelationData.js";
import { safeNum } from "../../../utils/relationUtils.js";
import { mergeRefs } from "../../../utils/styles/animations.js";
import { COLORS, createButtonStyle, ANIMATION_VALUES, unifiedNodeTooltipStyles, unifiedNodeAnimations } from "../../../utils/styles/styles.js";
import { extractRadarChartData, getPositivityColor, getPositivityLabel, getConnectionStatus } from "../../../utils/radarChartUtils.js";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import "../RelationGraph.css";
import "./UnifiedNodeInfo.css";

function UnifiedNodeInfo({
  displayMode = 'tooltip', // 'tooltip' | 'sidebar'
  data,
  x,
  y,
  onClose,
  chapterNum,
  eventNum,
  maxChapter,
  elements = [],
  filename,
  currentEvent = null,
  prevValidEvent = null,
  povSummaries = null, // API에서 가져온 관점 요약 데이터
  apiMacroData = null, // API 거시 그래프 데이터
  apiFineData = null, // API 세밀 그래프 데이터
}) {
  const { filename: urlFilename } = useParams();
  const actualFilename = filename || urlFilename;

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
    // 즉시 호버 상태 해제
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
  const nodeId = safeNum(nodeData?.id);
  const { fetchData } = useRelationData('standalone', nodeId, nodeId, chapterNum, eventNum, dynamicMaxChapter, actualFilename);

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
    if (!eventNum || eventNum === 0) {
      const lastEventNums = getChapterLastEventNums(folderKey);
      return { eventNum: lastEventNums[chapterNum - 1] || 1 };
    }
    
    return { eventNum: eventNum || 0 };
  }, [currentEvent, prevValidEvent, eventNum, chapterNum, folderKey]);

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
  }, [data, chapterNum, getUnifiedEventInfo, dynamicMaxChapter, actualFilename, elements]);

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

  // 한글 description만 표시
  const currentDescription = useMemo(() => {
    if (!nodeData) return '';
    return nodeData.description_ko || nodeData.description || '';
  }, [nodeData]);

  const displayDescription = currentDescription;
  const displayHasDescription = !!(displayDescription && displayDescription.trim());

  // 요약 데이터 - API 또는 로컬 데이터에서 가져오기
  const summaryData = useMemo(() => {
    if (!processedNodeData?.label) {
      return { summary: "인물에 대한 요약 정보가 없습니다." };
    }

    // API 관점 요약 데이터가 있는 경우 우선 사용
    if (povSummaries && povSummaries.povSummaries) {
      const characterName = processedNodeData.label;
      const characterSummary = povSummaries.povSummaries.find(
        summary => summary.characterName === characterName
      );
      
      if (characterSummary && characterSummary.summaryText) {
        return { summary: characterSummary.summaryText };
      }
    }

    // API 데이터가 없는 경우 로컬 데이터 사용
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
  }, [processedNodeData, chapterNum, actualFilename, povSummaries]);

  // 레이더 차트 데이터 추출 (API 데이터 우선 사용)
  const radarChartData = useMemo(() => {
    if (!nodeData?.id || !chapterNum || displayMode !== 'sidebar') {
      return [];
    }

    // API 데이터가 있는 경우 우선 사용
    if (apiMacroData || apiFineData) {
      try {
        const apiData = apiMacroData || apiFineData;
        if (apiData && apiData.relations && apiData.characters) {
          // API 데이터에서 관계 정보 추출
          const relations = apiData.relations;
          const characters = apiData.characters;
          
          
          // 캐릭터 ID를 이름으로 매핑하는 맵 생성
          const characterMap = {};
          const nameToIdMap = {};
          characters.forEach(char => {
            const charName = char.common_name || char.name;
            characterMap[char.id] = charName;
            nameToIdMap[charName] = char.id;
          });
          
          // 현재 노드의 ID를 API 데이터 형식에 맞게 변환
          const currentNodeId = nodeData.id;
          let targetNodeId = currentNodeId;
          
          // nodeData.id가 문자열인 경우 (로컬 데이터), 숫자 ID로 변환
          if (typeof currentNodeId === 'string') {
            const charName = nodeData.label || nodeData.common_name;
            targetNodeId = nameToIdMap[charName] || currentNodeId;
          }
          
          // API 데이터를 로컬 형식으로 변환 (중복 제거 포함)
          const relationMap = new Map(); // 중복 관계를 하나로 처리하기 위한 맵
          
          relations.forEach(rel => {
            // 현재 노드가 관계에 포함되어 있는지 확인
            const isCurrentNodeId1 = rel.id1 === targetNodeId;
            const isCurrentNodeId2 = rel.id2 === targetNodeId;
            
            if (isCurrentNodeId1 || isCurrentNodeId2) {
              // 관계의 고유 키 생성 (순서에 관계없이)
              const key1 = `${rel.id1}-${rel.id2}`;
              const key2 = `${rel.id2}-${rel.id1}`;
              
              // 이미 처리된 관계가 아닌 경우만 추가
              if (!relationMap.has(key1) && !relationMap.has(key2)) {
                // extractRadarChartData는 id1/id2를 기대하므로 ID를 그대로 사용
                relationMap.set(key1, {
                  id1: rel.id1,
                  id2: rel.id2,
                  relation: rel.relation || ['관계'],
                  count: rel.count || 1,
                  positivity: rel.positivity || 0
                });
              }
            }
          });
          
          // 최종 관계 데이터 (중복 제거됨)
          const finalRelations = Array.from(relationMap.values());
          
          // extractRadarChartData는 id1/id2 형식을 기대하므로 ID로 직접 전달
          const chartData = extractRadarChartData(targetNodeId, finalRelations, elements, 8);
          
          
          return chartData;
        }
      } catch (err) {
        console.error('API 레이더 차트 데이터 추출 오류:', err);
      }
    }

    // API 데이터가 없는 경우 로컬 데이터 사용 (정제된 데이터 적용)
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

      // 로컬 데이터도 중복 제거 적용
      const relationMap = new Map();
      
      
      json.relations.forEach((rel, index) => {
        // id1/id2 또는 source/target 모두 지원
        const source = rel.id1 ?? rel.source;
        const target = rel.id2 ?? rel.target;
        
        
        if (!source || !target) {
          console.warn('유효하지 않은 관계 데이터:', rel);
          return;
        }
        
        // 관계의 고유 키 생성 (순서에 관계없이)
        const key1 = `${source}-${target}`;
        const key2 = `${target}-${source}`;
        
        // 이미 처리된 관계가 아닌 경우만 추가
        if (!relationMap.has(key1) && !relationMap.has(key2)) {
          relationMap.set(key1, {
            source: source,
            target: target,
            relation: rel.relation,
            strength: rel.strength || 1,
            positivity: rel.positivity || 0
          });
        }
      });
      
      // 정제된 로컬 관계 데이터
      const finalRelations = Array.from(relationMap.values());
      
      // 현재 이벤트에 등장하는 캐릭터 ID만 필터링
      const currentEventCharacterIds = new Set();
      finalRelations.forEach(rel => {
        currentEventCharacterIds.add(String(rel.source));
        currentEventCharacterIds.add(String(rel.target));
      });
      
      // 현재 이벤트에 등장하는 캐릭터만 필터링
      const filteredElements = elements.filter(el => {
        if (el.data.source) return false; // 엣지는 제외
        const nodeId = String(el.data.id);
        return currentEventCharacterIds.has(nodeId);
      });
      
      const chartData = extractRadarChartData(nodeData.id, finalRelations, filteredElements, 8);
      
      return chartData;
    } catch (err) {
      console.error('레이더 차트 데이터 추출 오류:', err);
      return [];
    }
  }, [nodeData?.id, chapterNum, displayMode, folderKey, elements, eventNum, apiMacroData, apiFineData]);

  // 연결 상태 확인
  const connectionStatus = useMemo(() => {
    return getConnectionStatus(radarChartData);
  }, [radarChartData]);

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
        fontSize={isHovered ? 18 : 16}
        fontWeight={isHovered ? 700 : 600}
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
    
    // 마우스 감지 영역 크기 (실제 점 크기의 3배)
    const hoverRadius = Math.max(15, radius * 3);
    
    
    // 마우스 이벤트 핸들러
    const handleMouseEnterDot = useCallback((e) => {
      e.stopPropagation();
      handleMouseEnter(fullData.name, e);
    }, [fullData.name, handleMouseEnter]);
    
    const handleMouseLeaveDot = useCallback((e) => {
      e.stopPropagation();
      handleMouseLeave();
    }, [handleMouseLeave]);
    
    return (
      <g>
        {/* 투명한 원 - 호버 감지용 (동적 크기) */}
        <circle
          cx={cx}
          cy={cy}
          r={hoverRadius}
          fill="transparent"
          style={{ 
            cursor: 'pointer', 
            pointerEvents: 'all',
            zIndex: 10
          }}
          onMouseEnter={handleMouseEnterDot}
          onMouseLeave={handleMouseLeaveDot}
        />
        {/* 실제 표시되는 점 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={color}
          stroke={isHovered ? '#fff' : 'none'}
          strokeWidth={isHovered ? 2 : 0}
          style={{ 
            transition: 'all 0.2s ease',
            pointerEvents: 'none' // 마우스 이벤트는 투명한 원에서만 처리
          }}
        />
      </g>
    );
  });

  // z-index 설정
  const zIndexValue = 99999;

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

  // 거시 그래프 모드에서는 등장 여부 체크를 하지 않음
  const isGraphOnlyPage = window.location.pathname.includes('/user/graph/');
  
  // 노드가 현재 챕터/이벤트에서 등장하지 않는 경우 (거시 그래프가 아닌 경우에만)
  if (!isGraphOnlyPage && !isNodeAppeared) {
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
            wordBreak: 'keep-all',
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
            wordBreak: 'keep-all',
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
          wordBreak: 'keep-all',
        }}
      >
        {displayHasDescription ? (
          <span>
            {displayDescription}
          </span>
        ) : (
          <span style={{ color: COLORS.textSecondary }}>설명 정보가 없습니다.</span>
        )}
      </div>
      
      
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
          padding: '1rem 1rem 0.75rem 1rem',
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
            
            <button
              onClick={onClose}
              aria-label="사이드바 닫기"
              className="sidebar-close-btn"
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
            padding: '0 1rem',
          }}
        >
          <div style={{ padding: '1rem 0' }}>
            {/* 통합 프로필 및 설명 섹션 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '0.75rem',
                padding: '1rem',
                marginBottom: '1rem',
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
              <div style={{
                borderTop: '0.0625rem solid #e5e7eb',
                paddingTop: '1.25rem',
                minHeight: displayHasDescription ? 'auto' : '0',
                height: displayHasDescription ? 'auto' : '0',
                overflow: 'hidden',
                transition: 'height 0.3s ease, min-height 0.3s ease',
              }}>
                {displayHasDescription && (
                  <div style={{
                    borderLeft: '0.25rem solid #5C6F5C',
                    paddingLeft: '1.25rem',
                  }}>
                    <p style={{
                      margin: 0,
                      fontSize: '0.875rem',
                      lineHeight: '1.6',
                      color: COLORS.textPrimary,
                      letterSpacing: '-0.01em',
                      wordBreak: 'keep-all',
                    }}>
                      {displayDescription}
                    </p>
                  </div>
                )}
              </div>
            </div>


            {/* 요약 섹션 - 3단계 접근 방식 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '0.75rem',
                padding: '1rem',
                marginBottom: '1rem',
                border: `0.0625rem solid ${COLORS.border}`,
                boxShadow: '0 0.0625rem 0.1875rem rgba(0,0,0,0.05)',
                overflow: 'hidden',
                position: 'relative',
                minHeight: '70px',
                height: (isWarningExpanded && !showSummary) ? '440px' : 
                       showSummary ? 'auto' : '60px',
                transition: 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
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
                className="summary-toggle-btn"
                style={{
                  borderBottom: 'none',
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
                  margin: '0.25rem 0 0.25rem 0',
                  letterSpacing: '-0.025em',
                  textAlign: 'left',
                  lineHeight: '1.2',
                  flex: 1,
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
                  marginLeft: '0.5rem',
                  lineHeight: '1',
                }}>
                  ▼
                </span>
              </button>
              
              {/* 2단계: 경고 화면 */}
              <div style={{
                height: (isWarningExpanded && !showSummary) ? '350px' : '0',
                opacity: (isWarningExpanded && !showSummary) ? 1 : 0,
                overflow: 'hidden',
                transition: 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease-in-out',
                transitionDelay: (isWarningExpanded && !showSummary) ? '0.15s' : '0s',
              }}>
                <div style={{
                  padding: '1.5rem 1rem 1rem 1rem',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '300px',
                }}>
                  
                   {/* 경고 제목 */}
                   <h3 style={{
                     fontSize: '1.25rem',
                     fontWeight: '700',
                     color: COLORS.textPrimary,
                     margin: '0 0 0.75rem 0',
                     letterSpacing: '-0.025em',
                     textAlign: 'center',
                     width: '100%',
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
                    margin: '0 0 1rem 0',
                    wordBreak: 'keep-all',
                    textAlign: 'center',
                    width: '100%',
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
                    width: '100%',
                    flexWrap: 'wrap',
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
                        boxShadow: '0 0.125rem 0.375rem rgba(92, 111, 92, 0.3)',
                        minWidth: '9rem',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#4A5A4A';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 0.375rem 0.75rem rgba(92, 111, 92, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = COLORS.primary;
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 0.125rem 0.375rem rgba(92, 111, 92, 0.3)';
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
                  height: showSummary ? 'auto' : '0',
                  opacity: showSummary ? 1 : 0,
                  overflow: 'hidden',
                  transition: 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease-in-out',
                  transitionDelay: showSummary ? '0.15s' : '0s',
                }}
                aria-hidden={!showSummary}
              >
                <div style={{
                  marginTop: '1rem',
                  marginBottom: '0.5rem',
                }}>
                   <div style={{
                     borderLeft: `0.25rem solid ${COLORS.primary}`,
                     paddingLeft: '1.25rem',
                   }}>
                   <p style={{
                     margin: 0,
                     fontSize: '0.95rem',
                     lineHeight: '2.0',
                     color: COLORS.textPrimary,
                     letterSpacing: '-0.01em',
                     whiteSpace: 'pre-wrap',
                     wordBreak: 'keep-all',
                     background: 'rgba(247, 250, 252, 0.8)',
                     borderRadius: '0.5rem',
                     animation: showSummary ? 'fadeIn 0.4s ease-in-out' : 'none',
                   }}>
                     {summaryData.summary}
                   </p>
                   </div>
                </div>
              </div>
            </div>

            {/* 관계 분석 레이더 차트 섹션 */}
            <div 
              className="sidebar-card"
              style={{
                background: '#fff',
                borderRadius: '0.75rem',
                marginBottom: '1rem',
                border: `0.0625rem solid ${COLORS.border}`,
                boxShadow: '0 0.0625rem 0.1875rem rgba(0,0,0,0.05)',
                overflow: 'hidden',
                minHeight: '40px', // 최소 높이 줄임
                height: 'auto',
              }}
              role="region"
              aria-label="관계 분석"
            >
              {/* 헤더 버튼 */}
              <button
                onClick={handleOpenModal}
                className="relation-analysis-btn"
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
                    margin: '0.25rem 0 0.25rem 0',
                    letterSpacing: '-0.025em',
                    lineHeight: '1.2',
                  }}>
                    인물 관계 분석
                  </h4>
                  <p style={{
                    fontSize: '0.8rem',
                    color: COLORS.textSecondary,
                    margin: 0,
                    lineHeight: '1.4',
                    wordBreak: 'keep-all',
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
            className="modal-overlay"
            onClick={handleCloseModal}
          >
            <div
              className="modal-container"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div className="modal-header">
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
                  className="modal-close-btn"
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
               <div style={{ 
                 flex: 1, 
                 display: 'flex', 
                 alignItems: 'stretch', 
                 justifyContent: 'stretch',
                 minHeight: 0,
                 overflow: 'hidden'
               }}>
                 {connectionStatus.status === 'sufficient_connections' ? (
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
                        tick={{ fontSize: 14, fill: COLORS.textSecondary, fontWeight: 600 }}
                        tickCount={5}
                        tickFormatter={(value) => {
                          // normalizedValue (0-100)를 원래 positivity (-1~1)로 역변환
                          const originalValue = ((value / 100) * 2) - 1;
                          return originalValue.toFixed(1);
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
                 ) : connectionStatus.status === 'few_connections' ? (
                   <div style={{
                     padding: '1rem',
                     background: COLORS.backgroundLight,
                     borderRadius: '0.75rem',
                     border: `1px solid ${COLORS.border}`,
                     width: '100%',
                     height: '100%',
                     display: 'flex',
                     flexDirection: 'column',
                     alignItems: 'center',
                     justifyContent: 'flex-start',
                     textAlign: 'center',
                     overflowY: 'auto',
                     paddingTop: '2rem'
                   }}>
                    {radarChartData.length > 0 && (
                        <div style={{ 
                          background: COLORS.background,
                          borderRadius: '0.75rem',
                          border: `1px solid ${COLORS.borderLight}`,
                          padding: '0.5rem',
                          width: '100%',
                          maxWidth: '500px'
                        }}>
                         <div style={{ 
                           fontSize: '1.2rem', 
                           fontWeight: '700', 
                           marginBottom: '1rem',
                           color: COLORS.textPrimary,
                           textAlign: 'center'
                         }}>
                           연결된 인물
                         </div>
                        
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '1rem'
                        }}>
                          {radarChartData.map((item, index) => (
                             <div key={index} style={{ 
                               display: 'grid',
                               gridTemplateColumns: '1fr auto',
                               gridTemplateRows: 'auto auto',
                               gap: '0.75rem',
                               padding: '1rem',
                               background: '#ffffff',
                               borderRadius: '0.5rem',
                               border: `1px solid ${COLORS.borderLight}`,
                               fontSize: '1rem',
                               boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                             }}>
                               {/* 인물 이름 (왼쪽 위) */}
                               <div style={{ 
                                 display: 'flex', 
                                 alignItems: 'center', 
                                 gap: '1rem'
                               }}>
                                 <div style={{
                                   width: '14px',
                                   height: '14px',
                                   borderRadius: '50%',
                                   background: getPositivityColor(item.positivity)
                                 }} />
                                 <span style={{ 
                                   color: COLORS.textPrimary,
                                   fontWeight: '700',
                                   fontSize: '1.1rem'
                                 }}>
                                   {item.name}
                                 </span>
                               </div>
                               
                               {/* 관계도 정보 (오른쪽 위) */}
                               <div style={{ 
                                 display: 'flex',
                                 alignItems: 'center',
                                 gap: '1rem'
                               }}>
                                 <span style={{ 
                                   color: getPositivityColor(item.positivity),
                                   fontWeight: '700',
                                   padding: '0.5rem 0.75rem',
                                   background: `${getPositivityColor(item.positivity)}20`,
                                   borderRadius: '0.5rem',
                                   fontSize: '0.9rem'
                                 }}>
                                   {getPositivityLabel(item.positivity)}
                                 </span>
                                 
                                 <div style={{
                                   fontSize: '1.1rem',
                                   color: COLORS.textSecondary,
                                   fontWeight: '700',
                                   padding: '0.5rem 0.75rem',
                                   background: COLORS.backgroundLight,
                                   borderRadius: '0.5rem'
                                 }}>
                                   {Math.round(item.positivity * 100)}%
                                 </div>
                               </div>
                               
                               {/* 관계 태그 (왼쪽 아래, 전체 너비) */}
                               {item.relationTags && item.relationTags.length > 0 && (
                                 <div style={{ 
                                   display: 'flex', 
                                   flexWrap: 'wrap', 
                                   gap: '0.75rem',
                                   gridColumn: '1 / -1'
                                 }}>
                                   {item.relationTags.map((tag, tagIndex) => (
                                     <span
                                       key={tagIndex}
                                       style={{
                                         background: COLORS.backgroundLight,
                                         color: COLORS.textPrimary,
                                         padding: '0.25rem 0.5rem',
                                         borderRadius: '0.5rem',
                                         fontSize: '0.8rem',
                                         border: `1px solid ${COLORS.border}`,
                                         fontWeight: '600',
                                       }}
                                     >
                                       {tag}
                                     </span>
                                   ))}
                                 </div>
                               )}
                            </div>
                          ))}
                        </div>
                        
                        <div style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          background: COLORS.backgroundLight,
                          borderRadius: '0.5rem',
                          border: '1px solid #e5e7eb',
                          textAlign: 'center'
                        }}>
                          <div                           style={{
                            fontSize: '0.9rem',
                            color: COLORS.textPrimary,
                            fontWeight: '600',
                            lineHeight: '1.4',
                            wordBreak: 'keep-all'
                          }}>
                            <div>현재 연결된 인물이 적어 그리드 차트로 표시하기 어려운 상황입니다.</div>
                            <div>더 풍부한 관계 분석을 위해 다른 챕터나 이벤트를 확인해보시기 바랍니다.</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                 ) : (
                   <div style={{
                     padding: '1rem',
                     background: COLORS.backgroundLight,
                     borderRadius: '0.75rem',
                     border: `1px solid ${COLORS.border}`,
                     width: '100%',
                     height: '100%',
                     display: 'flex',
                     flexDirection: 'column',
                     alignItems: 'center',
                     justifyContent: 'flex-start',
                     textAlign: 'center',
                     overflowY: 'auto',
                     paddingTop: '2rem'
                   }}>
                     <div style={{
                       padding: '1rem',
                       background: COLORS.background,
                       borderRadius: '0.5rem',
                       border: '1px solid #e5e7eb'
                     }}>
                       <div style={{
                         fontSize: '0.8rem',
                         color: COLORS.textSecondary,
                         lineHeight: '1.4',
                         wordBreak: 'keep-all'
                       }}>
                         다른 인물을 선택하거나 다른 챕터를 확인해보세요.
                       </div>
                     </div>
                  </div>
                )}

                {/* 마우스 오버 정보창 */}
                {hoveredData && (
                  <div
                    className="hover-tooltip"
                    style={{
                      position: 'fixed',
                      left: `${Math.min(hoverPosition.x + 15, window.innerWidth - 350)}px`,
                      top: `${Math.max(hoverPosition.y - 15, 10)}px`,
                      zIndex: 10000,
                      pointerEvents: 'auto',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      opacity: 1,
                      transform: 'scale(1)',
                      background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                      borderRadius: '12px',
                      padding: '16px',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.05)',
                      border: `1px solid ${getPositivityColor(hoveredData.positivity)}20`,
                      backdropFilter: 'blur(10px)',
                      minWidth: '250px',
                      maxWidth: '350px'
                    }}
                    onMouseEnter={() => {
                      // 툴팁에 마우스가 들어오면 호버 상태 유지
                    }}
                    onMouseLeave={() => {
                      // 툴팁에서 마우스가 나가면 즉시 툴팁 숨김
                      setHoveredItem(null);
                    }}
                  >
                     {/* 인물 이름 */}
                     <div style={{ 
                       fontWeight: '800', 
                       fontSize: '1.1rem', 
                       marginBottom: '12px', 
                       color: COLORS.textPrimary,
                       letterSpacing: '-0.02em',
                       display: 'flex',
                       alignItems: 'center',
                       gap: '8px'
                     }}>
                       <div style={{
                         width: '8px',
                         height: '8px',
                         borderRadius: '50%',
                         background: getPositivityColor(hoveredData.positivity),
                         flexShrink: 0
                       }} />
                       {hoveredData.name}
                     </div>
                    
                     {/* 관계도 점수 */}
                     <div style={{ 
                       display: 'flex', 
                       alignItems: 'center',
                       justifyContent: 'space-between',
                       padding: '12px 16px',
                       background: `linear-gradient(135deg, ${getPositivityColor(hoveredData.positivity)}15 0%, ${getPositivityColor(hoveredData.positivity)}08 100%)`,
                       borderRadius: '10px',
                       border: `1px solid ${getPositivityColor(hoveredData.positivity)}30`,
                       marginBottom: '12px'
                     }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ 
                          fontSize: '0.8rem',
                          color: getPositivityColor(hoveredData.positivity),
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          {getPositivityLabel(hoveredData.positivity || 0)}
                        </span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <span style={{ 
                          fontWeight: '800', 
                          color: getPositivityColor(hoveredData.positivity), 
                          fontSize: '1.5rem',
                          lineHeight: 1
                        }}>
                          {Math.round((hoveredData.positivity || 0) * 100)}
                        </span>
                        <span style={{ 
                          fontWeight: '700', 
                          color: getPositivityColor(hoveredData.positivity), 
                          fontSize: '1rem',
                          lineHeight: 1
                        }}>
                          %
                        </span>
                      </div>
                    </div>
                    
                     {hoveredData.relationTags && hoveredData.relationTags.length > 0 && (
                       <div style={{ 
                         marginTop: '8px', 
                         paddingTop: '12px', 
                         borderTop: `1px solid ${COLORS.borderLight}40`
                       }}>
                         <div style={{ 
                           fontSize: '0.8rem', 
                           color: COLORS.textSecondary, 
                           marginBottom: '8px',
                           fontWeight: '600',
                           display: 'flex',
                           alignItems: 'center',
                           gap: '6px'
                         }}>
                           <div style={{
                             width: '4px',
                             height: '4px',
                             borderRadius: '50%',
                             background: COLORS.textSecondary
                           }} />
                           관계 태그
                         </div>
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                           {hoveredData.relationTags.map((tag, i) => (
                             <span
                               key={i}
                               style={{
                                 background: COLORS.backgroundLight,
                                 color: COLORS.textPrimary,
                                 padding: '4px 8px',
                                 borderRadius: '6px',
                                 fontSize: '0.7rem',
                                 border: `1px solid ${COLORS.border}`,
                                 fontWeight: '500',
                                 textTransform: 'uppercase',
                                 letterSpacing: '0.3px'
                               }}
                             >
                               {tag}
                             </span>
                           ))}
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
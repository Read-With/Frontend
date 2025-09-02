import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes, FaBars, FaChevronLeft } from 'react-icons/fa';

import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import GraphSidebar from "./tooltip/GraphSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getNodeSize as getNodeSizeUtil, getEdgeStyle as getEdgeStyleUtil, getWideLayout } from "../../utils/styles/graphStyles";
import { ANIMATION_VALUES } from "../../utils/styles/animations";
import { sidebarStyles, topBarStyles, containerStyles, graphStyles } from "../../utils/styles/styles.js";
import { useGraphSearch } from '../../hooks/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/useGraphDataLoader.js';
import { useLocalStorageNumber } from '../../hooks/useLocalStorage.js';
import useGraphInteractions from "../../hooks/useGraphInteractions";

const getNodeSize = () => getNodeSizeUtil('graph');
const getEdgeStyle = () => getEdgeStyleUtil('graph');

// 독립 인물 버튼 스타일
const isolatedButtonStyles = {
  button: (hideIsolated) => ({
    height: 30,
    padding: '0 16px',
    borderRadius: 8,
    border: '1.5px solid #e3e6ef',
    background: hideIsolated ? '#f8f9fc' : '#EEF2FF',
    color: hideIsolated ? '#6C8EFF' : '#22336b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: hideIsolated ? 'none' : '0 2px 8px rgba(108,142,255,0.15)',
    minWidth: '140px',
    justifyContent: 'center',
  }),
  dot: (hideIsolated) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: hideIsolated ? '#6C8EFF' : '#22336b',
    opacity: hideIsolated ? 0.6 : 1,
  }),
  hover: {
    background: '#f8f9fc',
    color: '#6C8EFF',
    transform: 'scale(1.05)'
  },
  default: {
    background: '#fff',
    color: '#22336b',
    transform: 'scale(1)'
  }
};

// 레이아웃 스타일
const layoutStyles = {
  container: {
    width: '100vw',
    height: '100vh', // 전체 화면 높이 사용
    background: '#f4f7fb',
    overflow: 'hidden',
    display: 'flex',
    marginTop: 0 // 상단 마진 제거
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column'
  },
  graphContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%'
  }
};

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  
  // 상태 관리
  const [currentChapter, setCurrentChapter] = useLocalStorageNumber('lastGraphChapter', 1);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  
  // refs
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const prevChapterNum = useRef();
  const prevEventNum = useRef();
  
  // 데이터 로딩
  const {
    elements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum,
    maxChapter,
    loading,
    error
  } = useGraphDataLoader(filename, currentChapter);
  
  // 검색 기능
  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    isResetFromSearch,
    suggestions,
    showSuggestions,
    selectedIndex,
    selectSuggestion,
    handleKeyDown,
    closeSuggestions,
    handleSearchSubmit,
    clearSearch,
    setSearchTerm, // setSearchTerm 추가
  } = useGraphSearch(elements, null, currentChapterData);

  // 제안 생성을 위한 별도 함수 (실제 검색은 실행하지 않음)
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    // 제안 생성을 위해 searchTerm만 업데이트 (실제 검색은 실행하지 않음)
    setSearchTerm(searchTerm);
  }, [setSearchTerm]);

  // 노드/간선 클릭 시 중앙 정렬 함수
  const centerElementBetweenSidebars = useCallback((elementId, elementType) => {
    const cy = cyRef.current;
    if (!cy) return;

    const element = cy.getElementById(elementId);
    if (!element.length) return;

    // 상단바 높이
    const topBarHeight = 54;
    
    // 챕터 사이드바 너비를 완전히 계산 (펼침/닫힘 상태 고려)
    const chapterSidebarWidth = isSidebarOpen ? 240 : 60;
    
    // 노드/간선 슬라이드바가 펼쳐진 후의 영역을 완전히 계산
    const tooltipSidebarWidth = 450;
    
    // 슬라이드바가 펼쳐진 후의 그래프 영역 너비를 완전히 계산 (상단바 제외)
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - tooltipSidebarWidth;
    
    // 슬라이드바가 펼쳐진 후의 그래프 영역 높이를 완전히 계산 (상단바 제외)
    const availableGraphHeight = window.innerHeight - topBarHeight;
    
    // 그래프 영역의 정중앙 위치를 완전히 계산 (슬라이드바 영역 제외, 상단바 제외)
    // 왼쪽으로 약간 조정 (전체 너비의 10%만큼 왼쪽으로)
    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;
    
    // 위쪽으로 약간 조정 (전체 높이의 15%만큼 위쪽으로)
    const topOffset = availableGraphHeight * 0.15;
    const centerY = topBarHeight + (availableGraphHeight / 2) - topOffset;
    
    // 요소의 현재 위치
    const elementPos = element.position();
    
    // 요소를 완전히 계산된 중앙으로 이동시키기 위한 pan 계산
    const targetX = centerX - elementPos.x;
    const targetY = centerY - elementPos.y; // Y축도 상단바를 고려한 중앙으로 이동
    
    // 부드러운 애니메이션으로 이동 (완전히 계산된 위치로)
    cy.animate({
      pan: { x: targetX, y: targetY },
      duration: 800,
      easing: 'ease-out-cubic'
    });
  }, [isSidebarOpen]);

  // 특정 좌표를 기준으로 중앙 정렬하는 함수
  const centerElementAtPosition = useCallback((targetX, targetY) => {
    const cy = cyRef.current;
    if (!cy) return;

    // 상단바 높이
    const topBarHeight = 54;
    
    // 챕터 사이드바 너비를 완전히 계산 (펼침/닫힘 상태 고려)
    const chapterSidebarWidth = isSidebarOpen ? 240 : 60;
    
    // 노드/간선 슬라이드바가 펼쳐진 후의 영역을 완전히 계산
    const tooltipSidebarWidth = 450;
    
    // 슬라이드바가 펼쳐진 후의 그래프 영역 너비를 완전히 계산 (상단바 제외)
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - tooltipSidebarWidth;
    
    // 슬라이드바가 펼쳐진 후의 그래프 영역 높이를 완전히 계산 (상단바 제외)
    const availableGraphHeight = window.innerHeight - topBarHeight;
    
    // 그래프 영역의 정중앙 위치를 완전히 계산 (슬라이드바 영역 제외, 상단바 제외)
    // 왼쪽으로 약간 조정 (전체 너비의 10%만큼 왼쪽으로)
    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;
    
    // 위쪽으로 약간 조정 (전체 높이의 15%만큼 위쪽으로)
    const topOffset = availableGraphHeight * 0.15;
    const centerY = topBarHeight + (availableGraphHeight / 2) - topOffset;
    
    // 목표 좌표를 중앙으로 이동시키기 위한 pan 계산
    const panX = centerX - targetX;
    const panY = centerY - targetY;
    
    // 부드러운 애니메이션으로 이동 (완전히 계산된 위치로)
    cy.animate({
      pan: { x: panX, y: panY },
      duration: 800,
      easing: 'ease-out-cubic'
    });
  }, [isSidebarOpen]);

  // 툴팁 핸들러
  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
    
    // 노드 클릭 시 중앙 정렬
    centerElementBetweenSidebars(node.id(), 'node');
  }, [centerElementBetweenSidebars]);

  const onShowEdgeTooltip = useCallback(({ edge, absoluteX, absoluteY }) => {
    setActiveTooltip({
      type: 'edge',
      id: edge.id(),
      x: absoluteX,
      y: absoluteY,
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
    });
    
    // 간선 클릭 시 간선의 중점(1:1 내분점)을 기준으로 중앙 정렬
    const sourcePos = edge.source().position();
    const targetPos = edge.target().position();
    
    // 간선의 중점 계산 (1:1 내분점)
    const edgeCenterX = (sourcePos.x + targetPos.x) / 2;
    const edgeCenterY = (sourcePos.y + targetPos.y) / 2;
    
    // 간선의 중점을 기준으로 중앙 정렬
    centerElementAtPosition(edgeCenterX, edgeCenterY);
  }, [centerElementBetweenSidebars, centerElementAtPosition]);

  const onClearTooltip = useCallback(() => {
    // X 버튼과 동일한 방식으로 처리
    setForceClose(true);
    // 애니메이션 시작과 동시에 activeTooltip 상태 초기화
    setActiveTooltip(null);
    setIsSidebarClosing(false);
    setForceClose(false);
  }, []);

  // 슬라이드바 애니메이션 시작 함수
  const handleStartClosing = useCallback(() => {
    setIsSidebarClosing(true);
  }, []);

  // 그래프 인터랙션 훅
  const {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
    clearAll,
  } = useGraphInteractions({
    cyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
    isSearchActive,
    filteredElements,
  });

  // 그래프 초기화 함수 (clearAll이 정의된 후에 정의)
  const handleClearGraph = useCallback(() => {
    clearAll();
  }, [clearAll]);

  // elements 정렬 및 필터링
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  const finalElements = useMemo(() => {
    if (isSearchActive && filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    return sortedElements;
  }, [isSearchActive, filteredElements, sortedElements]);

  // 그래프 스타일 및 레이아웃
  const nodeSize = getNodeSize();
  const edgeStyle = getEdgeStyle();
  const stylesheet = useMemo(
    () => createGraphStylesheet(nodeSize, edgeStyle, edgeLabelVisible, 15),
    [nodeSize, edgeStyle, edgeLabelVisible]
  );
  const layout = useMemo(() => getWideLayout(), []);

  // 로딩 상태 관리 (챕터 변경 시에는 로딩 상태를 활성화하지 않음)
  useEffect(() => {
    // 챕터 변경 시에는 로딩 상태를 활성화하지 않음 (깜빡임 방지)
    prevChapterNum.current = currentChapter;
    prevEventNum.current = eventNum;
  }, [currentChapter, eventNum]);

  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  // 사이드바 상태 변경 시 활성 요소 재중앙 정렬 (챕터 사이드바 상태 변경 시에만)
  useEffect(() => {
    if (activeTooltip && cyRef.current && !isSidebarClosing) {
      const elementId = activeTooltip.id;
      const elementType = activeTooltip.type;
      
      // 챕터 사이드바 상태 변경 시에만 재중앙 정렬 실행
      const animationDuration = 700; // 사이드바 애니메이션 시간
      setTimeout(() => {
        // 사이드바 상태가 완전히 변경된 후 중앙 정렬 실행
        centerElementBetweenSidebars(elementId, elementType);
      }, animationDuration + 100);
    }
  }, [isSidebarOpen, centerElementBetweenSidebars]); // activeTooltip 의존성 제거

  // 이벤트 핸들러
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  const handleChapterSelect = useCallback((chapter) => {
    if (chapter !== currentChapter) {
      setCurrentChapter(chapter);
    }
  }, [currentChapter, setCurrentChapter]);

  const toggleHideIsolated = useCallback(() => {
    setHideIsolated(prev => !prev);
  }, []);

  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible(prev => !prev);
  }, []);

  const handleBackToViewer = useCallback(() => {
    navigate(`/user/viewer/${filename}`);
  }, [navigate, filename]);

  const handleMouseEnter = useCallback((e) => {
    Object.assign(e.target.style, isolatedButtonStyles.hover);
  }, []);

  const handleMouseLeave = useCallback((e) => {
    Object.assign(e.target.style, isolatedButtonStyles.default);
  }, []);

  // 슬라이드바 외부 영역 클릭 시 닫힘 핸들러
  const handleGlobalClick = useCallback((e) => {
    // 슬라이드바가 열려있지 않으면 처리하지 않음
    if (!activeTooltip || isSidebarClosing) return;
    
    // 클릭된 요소가 슬라이드바 내부인지 확인
    const sidebarElement = document.querySelector('[data-testid="graph-sidebar"]') || 
                          document.querySelector('.graph-sidebar') ||
                          e.target.closest('[data-testid="graph-sidebar"]') ||
                          e.target.closest('.graph-sidebar');
    
    // 슬라이드바 내부 클릭이면 처리하지 않음
    if (sidebarElement && sidebarElement.contains(e.target)) {
      return;
    }
    
    // 슬라이드바 외부 클릭이면 슬라이드바 닫기
    // 이벤트 전파 중단
    e.stopPropagation();
    
    // 클릭과 동시에 그래프 초기화
    clearAll();
    // 0.1초 후에 슬라이드바 애니메이션 시작
    setTimeout(() => {
      setForceClose(true);
    }, 100);
  }, [activeTooltip, isSidebarClosing, clearAll]);

  // 그래프 영역 클릭 핸들러 (기존 로직 유지)
  const handleCanvasClick = useCallback((e) => {
    // 노드나 간선 클릭이 아닌 배경 클릭인 경우에만 처리
    if (e.target === e.currentTarget) {
      // 이벤트 전파 중단
      e.stopPropagation();
      
      // 슬라이드바가 열려있으면 닫기
      if (activeTooltip && !isSidebarClosing) {
        // 클릭과 동시에 그래프 초기화
        clearAll();
        // 0.1초 후에 슬라이드바 애니메이션 시작
        setTimeout(() => {
          setForceClose(true);
        }, 100);
      }
    }
  }, [activeTooltip, isSidebarClosing, clearAll]);

  // 전역 클릭 이벤트 리스너 등록
  useEffect(() => {
    if (activeTooltip && !isSidebarClosing) {
      const handleDocumentClick = (e) => {
        // 그래프 캔버스 영역 내부 클릭은 무시 (드래그/클릭 구분 로직이 처리)
        const graphCanvas = e.target.closest('.graph-canvas-area');
        if (graphCanvas) return;
        
        handleGlobalClick(e);
      };
      
      // 약간의 지연을 두어 이벤트 버블링 순서 보장
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleDocumentClick, true);
      }, 10);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('click', handleDocumentClick, true);
      };
    }
  }, [activeTooltip, isSidebarClosing, handleGlobalClick]);

  // 챕터 목록 메모이제이션
  const chapterList = useMemo(() => 
    Array.from({ length: maxChapter }, (_, i) => i + 1), 
    [maxChapter]
  );

  // 로딩 상태 렌더링
  if (isGraphLoading) {
    return (
      <div style={containerStyles.loading}>
        <div>그래프 로딩 중...</div>
        <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
          관계 데이터를 불러오고 있습니다.
        </div>
      </div>
    );
  }

  // 데이터 없음 상태 렌더링
  if (!elements || elements.length === 0) {
    return (
      <div style={containerStyles.error}>
        <div>데이터가 없습니다</div>
        <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
          이 챕터에는 표시할 관계 데이터가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f4f7fb', overflow: 'hidden' }}>
      {/* 상단 컨트롤 바 - 사이드바 옆에 위치 */}
      <div style={{ 
        ...topBarStyles.container, 
        position: 'fixed', 
        top: 0, 
        left: isSidebarOpen ? '240px' : '60px', // 사이드바 너비만큼 여백
        right: 0,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`
      }}>
        <div style={topBarStyles.leftSection}>
          <GraphControls
            searchTerm={searchTerm}
            onSearchSubmit={handleSearchSubmit}
            onClearSearch={clearSearch}
            onGenerateSuggestions={handleGenerateSuggestions}
            suggestions={suggestions}
            showSuggestions={showSuggestions}
            selectedIndex={selectedIndex}
            onSelectSuggestion={selectSuggestion}
            onKeyDown={handleKeyDown}
            onCloseSuggestions={closeSuggestions}
            isSearchActive={isSearchActive}
          />
          
          <button
            onClick={toggleHideIsolated}
            style={isolatedButtonStyles.button(hideIsolated)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            title={hideIsolated ? '독립 인물을 표시합니다' : '독립 인물을 숨깁니다'}
          >
            <div style={isolatedButtonStyles.dot(hideIsolated)} />
            {hideIsolated ? '독립 인물 표시' : '독립 인물 숨기기'}
          </button>
          
          <EdgeLabelToggle
            visible={edgeLabelVisible}
            onToggle={toggleEdgeLabel}
          />
        </div>

        <div style={topBarStyles.rightSection}>
          {/* 뷰어로 돌아가기 버튼은 고정 위치로 이동했으므로 여기서는 제거 */}
        </div>
      </div>

      {/* 고정된 뷰어로 돌아가기 버튼 - 항상 우측 상단에 위치 */}
      <div style={{
        position: 'fixed',
        top: '12px',
        right: '24px',
        zIndex: 10002,
        pointerEvents: 'auto'
      }}>
        <button
          onClick={handleBackToViewer}
          style={{
            ...topBarStyles.backButton,
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(2px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            border: '1.5px solid rgba(227, 230, 239, 0.8)'
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <FaTimes />
          뷰어로 돌아가기
        </button>
      </div>

      {/* 사이드바 - 왼쪽 고정 위치 */}
      <div 
        data-testid="chapter-sidebar"
        style={{
          ...sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES),
          position: 'fixed',
          top: 0, // 맨 위에서 시작
          left: 0,
          height: '100vh', // 전체 높이 사용
          marginTop: 0
        }}
      >
        <div style={sidebarStyles.header}>
          <button
            onClick={toggleSidebar}
            style={sidebarStyles.toggleButton(ANIMATION_VALUES)}
            title={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          >
            {isSidebarOpen ? <FaChevronLeft /> : <FaBars />}
          </button>
          <span style={sidebarStyles.title(isSidebarOpen, ANIMATION_VALUES)}>
            챕터 선택
          </span>
        </div>

        <div style={sidebarStyles.chapterList}>
          {chapterList.map((chapter) => (
            <button
              key={chapter}
              onClick={() => handleChapterSelect(chapter)}
              style={sidebarStyles.chapterButton(currentChapter === chapter, isSidebarOpen, ANIMATION_VALUES)}
              title={!isSidebarOpen ? `Chapter ${chapter}` : ''}
            >
              <span style={sidebarStyles.chapterNumber(currentChapter === chapter, ANIMATION_VALUES)}>
                {chapter}
              </span>
              <span style={sidebarStyles.chapterText(isSidebarOpen, ANIMATION_VALUES)}>
                Chapter {chapter}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 그래프 영역 - 상단바 아래에 직접 배치 */}
      <div style={{
        position: 'fixed',
        top: 0, // 맨 위에서 시작
        left: isSidebarOpen ? '240px' : '60px', // 사이드바 너비만큼 여백
        right: 0,
        bottom: 0,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
        overflow: 'hidden'
      }}>
        <div style={graphStyles.graphPageContainer}>
          <div style={graphStyles.graphPageInner}>
            {activeTooltip && (
              <GraphSidebar
                activeTooltip={activeTooltip}
                onClose={onClearTooltip}
                onStartClosing={handleStartClosing}
                onClearGraph={handleClearGraph}
                forceClose={forceClose}
                chapterNum={currentChapter}
                eventNum={eventNum}
                maxChapter={maxChapter}
                filename={filename}
                elements={elements}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                searchTerm={searchTerm}
              />
            )}
            <div className="graph-canvas-area" onClick={handleCanvasClick} style={graphStyles.graphArea}>
              <CytoscapeGraphUnified
                elements={finalElements}
                newNodeIds={newNodeIds}
                stylesheet={stylesheet}
                layout={layout}
                cyRef={cyRef}
                nodeSize={nodeSize}
                fitNodeIds={fitNodeIds}
                searchTerm={searchTerm}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                onShowNodeTooltip={onShowNodeTooltip}
                onShowEdgeTooltip={onShowEdgeTooltip}
                onClearTooltip={onClearTooltip}
                selectedNodeIdRef={selectedNodeIdRef}
                selectedEdgeIdRef={selectedEdgeIdRef}
                strictBackgroundClear={true}
                isResetFromSearch={isResetFromSearch}
              />

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;
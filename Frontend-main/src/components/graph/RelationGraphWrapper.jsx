import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import GraphSidebar from "./tooltip/GraphSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getNodeSize, getEdgeStyle, getWideLayout } from "../../utils/styles/graphStyles";
import { ANIMATION_VALUES } from "../../utils/styles/animations";
import { sidebarStyles, topBarStyles, containerStyles, graphStyles } from "../../utils/styles/styles.js";

const COLORS = {
  primary: '#6C8EFF',
  primaryLight: '#EEF2FF',
  textPrimary: '#22336b',
  textSecondary: '#6c757d',
  border: '#e5e7eb',
  borderLight: '#e3e6ef',
  background: '#fff',
  backgroundLight: '#f8f9fc',
  backgroundLighter: '#f8fafc',
  error: '#ef4444',
  success: '#10b981',
  warning: '#f59e0b',
};
import { useGraphSearch } from '../../hooks/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/useGraphDataLoader.js';
import { useLocalStorageNumber } from '../../hooks/useLocalStorage.js';
import useGraphInteractions from "../../hooks/useGraphInteractions";

const getNodeSizeForGraph = () => getNodeSize('graph');
const getEdgeStyleForGraph = () => getEdgeStyle('graph');

// 독립 인물 버튼 스타일 (첨부파일 기준 구조 유지, 중앙화된 색상 사용)
const isolatedButtonStyles = {
  button: (hideIsolated) => ({
    height: 30,
    padding: '0 16px',
    borderRadius: 8,
    border: `1.5px solid ${COLORS.borderLight}`,
    background: hideIsolated ? COLORS.backgroundLight : COLORS.primaryLight,
    color: hideIsolated ? COLORS.primary : COLORS.textPrimary,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: hideIsolated ? 'none' : `0 2px 8px ${COLORS.primary}26`,
    minWidth: '140px',
    justifyContent: 'center',
  }),
  dot: (hideIsolated) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: hideIsolated ? COLORS.primary : COLORS.textPrimary,
    opacity: hideIsolated ? 0.6 : 1,
  }),
  hover: {
    background: COLORS.backgroundLight,
    color: COLORS.primary,
    transform: 'scale(1.05)'
  },
  default: {
    background: COLORS.background,
    color: COLORS.textPrimary,
    transform: 'scale(1)'
  }
};

// 레이아웃 스타일 (첨부파일 기준 구조 유지, 중앙화된 색상 사용)
const layoutStyles = {
  container: {
    width: '100vw',
    height: '100vh',
    background: COLORS.backgroundLighter,
    overflow: 'hidden',
    display: 'flex',
    marginTop: 0
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
    setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  // 제안 생성을 위한 별도 함수
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    setSearchTerm(searchTerm);
  }, [setSearchTerm]);

  // 노드/간선 클릭 시 중앙 정렬 함수
  const centerElementBetweenSidebars = useCallback((elementId, elementType) => {
    const cy = cyRef.current;
    if (!cy) return;

    const element = cy.getElementById(elementId);
    if (!element.length) return;

    const topBarHeight = 54;
    const chapterSidebarWidth = isSidebarOpen ? 240 : 60;
    const tooltipSidebarWidth = 450;
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - tooltipSidebarWidth;
    const availableGraphHeight = window.innerHeight - topBarHeight;
    
    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;
    
    const topOffset = availableGraphHeight * 0.15;
    const centerY = topBarHeight + (availableGraphHeight / 2) - topOffset;
    
    const elementPos = element.position();
    const targetX = centerX - elementPos.x;
    const targetY = centerY - elementPos.y;
    
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

    const topBarHeight = 54;
    const chapterSidebarWidth = isSidebarOpen ? 240 : 60;
    const tooltipSidebarWidth = 450;
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - tooltipSidebarWidth;
    const availableGraphHeight = window.innerHeight - topBarHeight;
    
    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;
    
    const topOffset = availableGraphHeight * 0.15;
    const centerY = topBarHeight + (availableGraphHeight / 2) - topOffset;
    
    const panX = centerX - targetX;
    const panY = centerY - targetY;
    
    cy.animate({
      pan: { x: panX, y: panY },
      duration: 800,
      easing: 'ease-out-cubic'
    });
  }, [isSidebarOpen]);

  // 툴팁 핸들러
  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
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
    
    const sourcePos = edge.source().position();
    const targetPos = edge.target().position();
    const edgeCenterX = (sourcePos.x + targetPos.x) / 2;
    const edgeCenterY = (sourcePos.y + targetPos.y) / 2;
    
    centerElementAtPosition(edgeCenterX, edgeCenterY);
  }, [centerElementBetweenSidebars, centerElementAtPosition]);

  const onClearTooltip = useCallback(() => {
    setForceClose(true);
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

  // 그래프 초기화 함수
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
  const nodeSize = getNodeSizeForGraph();
  const edgeStyle = getEdgeStyleForGraph();
  const stylesheet = useMemo(
    () => createGraphStylesheet(nodeSize, edgeStyle, edgeLabelVisible),
    [nodeSize, edgeStyle, edgeLabelVisible]
  );
  const layout = useMemo(() => getWideLayout(), []);

  // 로딩 상태 관리
  useEffect(() => {
    prevChapterNum.current = currentChapter;
    prevEventNum.current = eventNum;
  }, [currentChapter, eventNum]);

  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  // 사이드바 상태 변경 시 활성 요소 재중앙 정렬
  useEffect(() => {
    if (activeTooltip && cyRef.current && !isSidebarClosing) {
      const elementId = activeTooltip.id;
      const elementType = activeTooltip.type;
      
      const animationDuration = 700;
      setTimeout(() => {
        centerElementBetweenSidebars(elementId, elementType);
      }, animationDuration + 100);
    }
  }, [isSidebarOpen, centerElementBetweenSidebars]);

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
    if (!activeTooltip || isSidebarClosing) return;
    
    // 드래그 후 클릭인지 확인
    const isDragEndEvent = e.detail && e.detail.type === 'dragend';
    if (isDragEndEvent) return;
    
    const sidebarElement = document.querySelector('[data-testid="graph-sidebar"]') || 
                          document.querySelector('.graph-sidebar') ||
                          e.target.closest('[data-testid="graph-sidebar"]') ||
                          e.target.closest('.graph-sidebar');
    
    if (sidebarElement && sidebarElement.contains(e.target)) {
      return;
    }
    
    e.stopPropagation();
    clearAll();
    setTimeout(() => {
      setForceClose(true);
    }, 100);
  }, [activeTooltip, isSidebarClosing, clearAll]);

  // 그래프 영역 클릭 핸들러
  const handleCanvasClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      
      // 드래그 후 클릭인지 확인
      const isDragEndEvent = e.detail && e.detail.type === 'dragend';
      if (isDragEndEvent) return;
      
      if (activeTooltip && !isSidebarClosing) {
        clearAll();
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
        const graphCanvas = e.target.closest('.graph-canvas-area');
        if (graphCanvas) return;
        
        handleGlobalClick(e);
      };

      const handleDragEnd = (e) => {
        // 드래그 완료 이벤트를 클릭 이벤트로 변환하지 않도록 처리
        e.preventDefault();
        e.stopPropagation();
      };
      
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleDocumentClick, true);
        document.addEventListener('dragend', handleDragEnd, true);
      }, 10);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('click', handleDocumentClick, true);
        document.removeEventListener('dragend', handleDragEnd, true);
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
        <div style={{ fontSize: '14px', color: COLORS.textSecondary, marginTop: '8px' }}>
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
        <div style={{ fontSize: '14px', color: COLORS.textSecondary, marginTop: '8px' }}>
          이 챕터에는 표시할 관계 데이터가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLORS.backgroundLighter, overflow: 'hidden' }}>
      {/* 상단 컨트롤 바 */}
      <div style={{ 
        ...topBarStyles.container, 
        position: 'fixed', 
        top: 0, 
        left: isSidebarOpen ? '240px' : '60px',
        right: 0,
        zIndex: 10000,
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
        </div>
      </div>

      {/* 뷰어로 돌아가기 버튼 */}
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
            background: `${COLORS.background}f2`,
            backdropFilter: 'blur(2px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            border: `1.5px solid ${COLORS.borderLight}cc`
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span className="material-symbols-outlined">close</span>
          뷰어로 돌아가기
        </button>
      </div>

      {/* 챕터 사이드바 */}
      <div 
        data-testid="chapter-sidebar"
        style={{
          ...sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES),
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          marginTop: 0
        }}
      >
        <div style={sidebarStyles.header}>
          <button
            onClick={toggleSidebar}
            style={sidebarStyles.toggleButton(ANIMATION_VALUES)}
            title={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          >
            {isSidebarOpen ? <span className="material-symbols-outlined">chevron_left</span> : <span className="material-symbols-outlined">menu</span>}
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

      {/* 그래프 영역 */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: isSidebarOpen ? '240px' : '60px',
        right: 0,
        bottom: 0,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
        overflow: 'hidden'
      }}>
        <div style={graphStyles.graphPageContainer}>
          <div style={graphStyles.graphPageInner}>
            {(activeTooltip || isSidebarClosing) && (
              <GraphSidebar
                activeTooltip={activeTooltip}
                onClose={() => {
                  setActiveTooltip(null);
                  setForceClose(false);
                  setIsSidebarClosing(false);
                }}
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
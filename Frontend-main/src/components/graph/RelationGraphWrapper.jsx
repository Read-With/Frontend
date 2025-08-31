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
import { rippleUtils } from "../../utils/styles/animations";
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
    height: 'calc(100vh - 54px)', // 상단바 높이만큼 제외
    background: '#f4f7fb',
    overflow: 'hidden',
    display: 'flex',
    marginTop: '54px' // 상단바 아래에서 시작
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
  const [ripples, setRipples] = useState([]);
  
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
    handleSearchSubmit,
    clearSearch,
  } = useGraphSearch(elements, null, currentChapterData);

  // 툴팁 핸들러
  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
  }, []);

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
  }, []);

  const onClearTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  // 그래프 인터랙션 훅
  const {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
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

  // 로딩 상태 관리
  useEffect(() => {
    if (currentChapter !== prevChapterNum.current || eventNum !== prevEventNum.current) {
      setIsGraphLoading(true);
      prevChapterNum.current = currentChapter;
      prevEventNum.current = eventNum;
    }
  }, [currentChapter, eventNum]);

  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

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

  const handleCanvasClick = useCallback((e) => {
    const container = e.currentTarget;
    const ripple = rippleUtils.createRipple(e, container);
    setRipples((prev) => [...prev, ripple]);
    rippleUtils.removeRippleAfter(setRipples, ripple.id);
  }, []);

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
            elements={elements}
            currentChapterData={currentChapterData}
            searchTerm={searchTerm}
            onSearchSubmit={handleSearchSubmit}
            onClearSearch={clearSearch}
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
          <button
            onClick={handleBackToViewer}
            style={{
              ...topBarStyles.backButton,
              marginRight: '24px'
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <FaTimes />
            뷰어로 돌아가기
          </button>
        </div>
      </div>

      {/* 사이드바 - 왼쪽 고정 위치 */}
      <div style={{
        ...sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES),
        position: 'fixed',
        top: 0, // 맨 위에서 시작
        left: 0,
        height: '100vh', // 전체 높이 사용
        marginTop: 0
      }}>
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
              />
              {ripples.map((ripple) => (
                <div
                  key={ripple.id}
                  className="cytoscape-ripple"
                  style={rippleUtils.getRippleStyle(ripple)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;
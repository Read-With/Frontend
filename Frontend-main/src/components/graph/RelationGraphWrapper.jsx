import React, { useState, useEffect, useCallback, useMemo } from "react";
import StandaloneRelationGraph from "./RelationGraph_Graphpage";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes, FaBars, FaChevronLeft } from 'react-icons/fa';

import { SEARCH_LAYOUT } from '../../utils/graphStyles';
import { ANIMATION_VALUES } from '../../utils/animations';
import { useGraphSearch } from '../../hooks/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/useGraphDataLoader.js';
import { sidebarStyles, topBarStyles, containerStyles } from '../../utils/styles';

// 스타일 정의
const styles = {
  isolatedButton: (hideIsolated) => ({
    height: 36,
    padding: '0 16px',
    borderRadius: 8,
    border: '1.5px solid #e3e6ef',
    background: hideIsolated ? '#f8f9fc' : '#EEF2FF',
    color: hideIsolated ? '#6C8EFF' : '#22336b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: `all ${ANIMATION_VALUES.DURATION.FAST} ease`,
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: hideIsolated ? 'none' : '0 2px 8px rgba(108,142,255,0.15)',
    minWidth: '140px',
    justifyContent: 'center',
  }),
  isolatedDot: (hideIsolated) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: hideIsolated ? '#6C8EFF' : '#22336b',
    opacity: hideIsolated ? 0.6 : 1,
  }),
  container: {
    width: '100vw',
    height: '100vh',
    background: '#f4f7fb',
    overflow: 'hidden',
    display: 'flex'
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
  },
  buttonHover: {
    background: '#f8f9fc',
    color: '#6C8EFF',
    transform: 'scale(1.05)'
  },
  buttonDefault: {
    background: '#fff',
    color: '#22336b',
    transform: 'scale(1)'
  }
};

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  
  const [currentChapter, setCurrentChapter] = useState(() => {
    const saved = localStorage.getItem('lastGraphChapter');
    return saved ? Number(saved) : 1;
  });
  const [hideIsolated, setHideIsolated] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  
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
  
  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    handleSearchSubmit,
    clearSearch,
  } = useGraphSearch(elements, null, currentChapterData);

  // 챕터 변경 시 localStorage에 저장
  useEffect(() => {
    localStorage.setItem('lastGraphChapter', currentChapter.toString());
  }, [currentChapter]);

  // 사이드바 토글 함수
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  // 챕터 선택 함수
  const handleChapterSelect = useCallback((chapter) => {
    if (chapter !== currentChapter) {
      setCurrentChapter(chapter);
    }
  }, [currentChapter]);

  // 독립 인물 토글 함수
  const toggleHideIsolated = useCallback(() => {
    setHideIsolated(prev => !prev);
  }, []);

  // 간선 라벨 토글 함수
  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible(prev => !prev);
  }, []);

  // 뷰어로 돌아가기 함수
  const handleBackToViewer = useCallback(() => {
    navigate(`/user/viewer/${filename}`);
  }, [navigate, filename]);

  // 마우스 이벤트 핸들러
  const handleMouseEnter = useCallback((e) => {
    Object.assign(e.target.style, styles.buttonHover);
  }, []);

  const handleMouseLeave = useCallback((e) => {
    Object.assign(e.target.style, styles.buttonDefault);
  }, []);

  // 챕터 목록 메모이제이션
  const chapterList = useMemo(() => 
    Array.from({ length: maxChapter }, (_, i) => i + 1), 
    [maxChapter]
  );

  // 렌더링 상태 결정
  const renderState = useMemo(() => {
    if (loading) return 'loading';
    if (error) return 'error';
    if (maxEventNum > 0 && elements.length > 0) return 'graph';
    return 'loading-events';
  }, [loading, error, maxEventNum, elements.length]);

  return (
    <div style={styles.container}>
      {/* 사이드바 */}
      <div style={sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES)}>
        {/* 사이드바 헤더 */}
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

        {/* 챕터 목록 */}
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

      {/* 메인 콘텐츠 영역 */}
      <div style={styles.mainContent}>
        {/* 상단바: 검색, 독립 인물 버튼, 닫기 버튼 */}
        <div 
          style={topBarStyles.container}
          onWheel={e => e.preventDefault()}
        >
          {/* 왼쪽 영역: 검색 컨트롤 + 독립 인물 토글 */}
          <div style={topBarStyles.leftControls}>
            
            {/* 그래프 검색 기능 */}
            <GraphControls
              elements={elements}
              currentChapterData={currentChapterData}
              searchTerm={searchTerm}
              onSearchSubmit={handleSearchSubmit}
              onClearSearch={clearSearch}
            />
            
            {/* 간선 라벨 스위치 토글 */}
            <EdgeLabelToggle
              isVisible={edgeLabelVisible}
              onToggle={toggleEdgeLabel}
            />
            
            {/* 독립 인물 버튼 */}
            <button
              onClick={toggleHideIsolated}
              style={styles.isolatedButton(hideIsolated)}
              title={hideIsolated ? '독립 인물을 표시합니다' : '독립 인물을 숨깁니다'}
            >
              <div style={styles.isolatedDot(hideIsolated)} />
              {hideIsolated ? '독립 인물 표시' : '독립 인물 숨기기'}
            </button>
          </div>
          
          {/* 오른쪽 영역: 뷰어로 돌아가기 */}
          <div style={topBarStyles.rightControls}>
            <button
              onClick={handleBackToViewer}
              style={topBarStyles.closeButton(ANIMATION_VALUES)}
              title="뷰어로 돌아가기"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <FaTimes />
            </button>
          </div>
        </div>

        {/* 그래프 본문 */}
        <div style={styles.graphContainer}>
          {renderState === 'loading' && (
            <div style={containerStyles.loading}>
              그래프 데이터를 불러오는 중...
            </div>
          )}
          {renderState === 'error' && (
            <div style={containerStyles.error}>
              {error}
            </div>
          )}
          {renderState === 'loading-events' && (
            <div style={containerStyles.loading}>
              이벤트 정보를 불러오는 중...
            </div>
          )}
          {renderState === 'graph' && (
            <StandaloneRelationGraph 
              elements={elements} 
              newNodeIds={newNodeIds}
              maxChapter={maxChapter}
              edgeLabelVisible={edgeLabelVisible}
              fitNodeIds={fitNodeIds}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;
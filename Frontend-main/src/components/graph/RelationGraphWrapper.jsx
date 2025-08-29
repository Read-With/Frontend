import React, { useState, useEffect } from "react";
import StandaloneRelationGraph from "./RelationGraph_Graphpage";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes, FaBars, FaChevronLeft } from 'react-icons/fa';

import { DEFAULT_LAYOUT, SEARCH_LAYOUT } from '../../utils/graphStyles';
import { ANIMATION_VALUES } from '../../utils/animations';
import { useGraphSearch } from '../../hooks/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/useGraphDataLoader.js';
import { sidebarStyles, topBarStyles, containerStyles } from '../../utils/styles';

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  
  const [currentChapter, setCurrentChapter] = useState(() => {
    const saved = localStorage.getItem('lastGraphChapter');
    return saved ? Number(saved) : 1;
  });
  const [hideIsolated, setHideIsolated] = useState(true);
  const [graphViewState, setGraphViewState] = useState(null);
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
  
  // 레이아웃 상태
  const [currentLayout, setCurrentLayout] = useState(DEFAULT_LAYOUT);

  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    handleSearchSubmit,
    clearSearch,
  } = useGraphSearch(elements, (searchState) => {
    if (searchState.isSearchActive && searchState.filteredElements.length > 0) {
      setCurrentLayout(SEARCH_LAYOUT);
    } else {
      setCurrentLayout(DEFAULT_LAYOUT);
    }
  }, currentChapterData);

  // 사이드바 외부 클릭 감지 - 비활성화 (버튼으로만 제어)
  // const sidebarRef = useClickOutside(() => {
  //   if (isSidebarOpen) {
  //     setIsSidebarOpen(false);
  //   }
  // }, isSidebarOpen);

  // 챕터 변경 시 localStorage에 저장
  useEffect(() => {
    localStorage.setItem('lastGraphChapter', currentChapter.toString());
  }, [currentChapter]);

  // 사이드바 토글 함수
  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // 챕터 선택 함수
  const handleChapterSelect = (chapter) => {
    if (chapter !== currentChapter) {
      setCurrentChapter(chapter);
    }
  };

  // 독립 인물 버튼 스타일
  const isolatedButtonStyle = {
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
  };

  const isolatedDotStyle = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: hideIsolated ? '#6C8EFF' : '#22336b',
    opacity: hideIsolated ? 0.6 : 1,
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f4f7fb', overflow: 'hidden', display: 'flex' }}>
      {/* 사이드바 */}
      <div 
        style={sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES)}
      >
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
          {Array.from({ length: maxChapter }, (_, i) => i + 1).map((chapter) => (
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 상단바: 검색, 독립 인물 버튼, 닫기 버튼 */}
        <div 
          style={topBarStyles.container}
          onWheel={e => e.preventDefault()}
        >
          {/* 왼쪽 영역: 검색 컨트롤 + 독립 인물 토글 */}
          <div style={topBarStyles.leftControls}>
            
            {/* 그래프 검색 기능 - viewer 페이지와 동일하게 props 전달 */}
            <GraphControls
              elements={elements}
              currentChapterData={currentChapterData}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              onSearchSubmit={handleSearchSubmit}
              onClearSearch={clearSearch}
            />
            
            {/* 간선 라벨 스위치 토글 */}
            <EdgeLabelToggle
              isVisible={edgeLabelVisible}
              onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
            />
            
            {/* 독립 인물 버튼 */}
            <button
              onClick={() => setHideIsolated(!hideIsolated)}
              style={isolatedButtonStyle}
              title={hideIsolated ? '독립 인물을 표시합니다' : '독립 인물을 숨깁니다'}
            >
              <div style={isolatedDotStyle} />
              {hideIsolated ? '독립 인물 표시' : '독립 인물 숨기기'}
            </button>
          </div>
          
          {/* 오른쪽 영역: 뷰어로 돌아가기 */}
          <div style={topBarStyles.rightControls}>
            <button
              onClick={() => navigate(`/user/viewer/${filename}`)}
              style={topBarStyles.closeButton(ANIMATION_VALUES)}
              title="뷰어로 돌아가기"
              onMouseEnter={(e) => {
                e.target.style.background = '#f8f9fc';
                e.target.style.color = '#6C8EFF';
                e.target.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#fff';
                e.target.style.color = '#22336b';
                e.target.style.transform = 'scale(1)';
              }}
            >
              <FaTimes />
            </button>
          </div>
        </div>

        {/* 그래프 본문 */}
        <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
          {loading ? (
            <div style={containerStyles.loading}>
              그래프 데이터를 불러오는 중...
            </div>
          ) : error ? (
            <div style={containerStyles.error}>
              {error}
            </div>
          ) : maxEventNum > 0 && elements.length > 0 ? (
            <StandaloneRelationGraph 
              elements={elements} 
              inViewer={false}
              fullScreen={true}
              graphViewState={graphViewState}
              setGraphViewState={setGraphViewState}
              chapterNum={currentChapter}
              eventNum={eventNum}
              hideIsolated={hideIsolated}
              maxEventNum={maxEventNum}
              newNodeIds={newNodeIds}
              maxChapter={maxChapter}
              edgeLabelVisible={edgeLabelVisible}
              fitNodeIds={fitNodeIds}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
              layout={currentLayout}
              loading={loading}
            />
          ) : (
            <div style={containerStyles.loading}>
              이벤트 정보를 불러오는 중...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;
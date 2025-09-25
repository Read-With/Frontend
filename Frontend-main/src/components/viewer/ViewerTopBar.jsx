import React, { useCallback, useState, useEffect, useMemo } from 'react';
import GraphControls from '../graph/GraphControls';
import EdgeLabelToggle from '../graph/tooltip/EdgeLabelToggle';
import { getChapterEventCount } from '../../utils/graphData';

// 공통 스타일 상수들
const LOADING_STYLE = {
  display: "inline-block",
  padding: "4px 16px",
  borderRadius: 16,
  background: "#f3f4f6",
  color: "#9ca3af",
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid #e3e6ef",
};

const CHAPTER_STYLE = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 16,
  background: "#EEF2FF",
  color: "#22336b",
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid #e3e6ef",
};

const EVENT_NUMBER_STYLE = {
  display: "inline-block",
  padding: "4px 16px",
  borderRadius: 16,
  background: "#4F6DDE",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 2px 8px rgba(79,109,222,0.13)",
  transition: "transform 0.3s, background 0.3s",
};

const EVENT_NAME_STYLE = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 12,
  background: "#f8f9fc",
  color: "#22336b",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid #e3e6ef",
  maxWidth: "200px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const PROGRESS_BAR_CONTAINER_STYLE = {
  width: 120,
  height: 6,
  background: "#e3e6ef",
  borderRadius: 3,
  overflow: "hidden",
};

const PROGRESS_BAR_FILL_STYLE = {
  height: "100%",
  background: "linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)",
  borderRadius: 3,
  transition: "width 0.4s cubic-bezier(.4,2,.6,1)",
};

const ViewerTopBar = ({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
}) => {

  const {
    navigate,
    filename,
    book,
    viewerRef
  } = viewerState;
  
  const {
    currentChapter,
    maxChapter,
    currentEvent,
    prevValidEvent,
    prevEvent,
    events,
    graphFullScreen,
    edgeLabelVisible,
    loading: isGraphLoading
  } = graphState;
  
  const {
    setCurrentChapter,
    setGraphFullScreen,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage
  } = graphActions;

  
  const {
    searchTerm,
    isSearchActive,
    elements = [],
    currentChapterData = null,
    suggestions = [],
    showSuggestions = false,
    selectedIndex = -1
  } = searchState;
  
  const {
    onSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions,
    selectSuggestion,
    handleKeyDown
  } = searchActions;

  // 현재 이벤트 정보를 실시간으로 추적
  const [currentEventInfo, setCurrentEventInfo] = React.useState(null);
  const [currentProgressWidth, setCurrentProgressWidth] = React.useState("0%");

  // 프로그레스 계산 함수 (단순화)
  const calculateProgress = useCallback((eventToShow, events, currentChapter) => {
    // 1. chapterProgress가 있는 경우 (가장 정확한 방법)
    if (eventToShow.chapterProgress !== undefined) {
      return Math.min(eventToShow.chapterProgress, 100);
    }
    
    // 2. events 배열이 있는 경우
    if (events && events.length > 0) {
      const currentEventIndex = events.findIndex(e => e.eventNum === eventToShow.eventNum);
      
      if (currentEventIndex >= 0) {
        const isLastEvent = currentEventIndex === events.length - 1;
        return isLastEvent ? 100 : (currentEventIndex / (events.length - 1)) * 100;
      }
    }
    
    // 3. eventNum만 있는 경우
    if (eventToShow.eventNum !== undefined) {
      try {
        const totalEvents = getChapterEventCount(currentChapter);
        return eventToShow.eventNum >= totalEvents - 1 ? 100 : 
               Math.min((eventToShow.eventNum / (totalEvents - 1)) * 100, 100);
      } catch (error) {
        const fallbackTotalEvents = 20;
        return Math.min((eventToShow.eventNum / (fallbackTotalEvents - 1)) * 100, 100);
      }
    }
    
    return 0;
  }, [currentChapter]);
  
  // 이벤트 정보 실시간 업데이트 (단순화된 버전)
  React.useEffect(() => {
    const eventToShow = currentEvent || prevValidEvent;
    
    if (eventToShow) {
      // 챕터 불일치 체크
      if (eventToShow.chapter && eventToShow.chapter !== currentChapter) {
        setCurrentEventInfo(null);
        return;
      }
      
      const eventInfo = {
        eventNum: eventToShow.eventNum ?? 0,
        name: eventToShow.name || eventToShow.event_name || ""
      };
      setCurrentEventInfo(eventInfo);
      
      // 단순화된 프로그레스 계산
      const progressPercentage = calculateProgress(eventToShow, events, currentChapter);
      const progressWidth = `${Math.round(progressPercentage * 100) / 100}%`;
      setCurrentProgressWidth(progressWidth);
    } else {
      setCurrentEventInfo(null);
      setCurrentProgressWidth("0%");
    }
  }, [currentEvent, prevValidEvent, events, currentChapter, calculateProgress]);
  
  // 이벤트 기반 챕터 감지 (성능 최적화)
  React.useEffect(() => {
    const handleChapterChange = (event) => {
      if (event.detail && event.detail.chapter !== currentChapter) {
        setCurrentChapter(event.detail.chapter);
      }
    };
    
    // 커스텀 이벤트 리스너 등록
    window.addEventListener('chapterChange', handleChapterChange);
    
    return () => {
      window.removeEventListener('chapterChange', handleChapterChange);
    };
  }, [currentChapter, setCurrentChapter]);
  
  // 제안 생성을 위한 별도 함수 (실제 검색은 실행하지 않음)
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    // onGenerateSuggestions prop을 사용하여 제안 생성
    if (onGenerateSuggestions) {
      onGenerateSuggestions(searchTerm);
    }
  }, [onGenerateSuggestions]);

  // 공통 컴포넌트들 (메모이제이션 적용)
  const ChapterEventInfo = useMemo(() => {
    if (isGraphLoading || !currentEventInfo) {
      return (
        <span style={LOADING_STYLE}>
          로딩중...
        </span>
      );
    }

    return (
      <>
        {/* 챕터 정보 */}
        <span style={CHAPTER_STYLE}>
          Chapter {currentChapter}
        </span>

        {/* 이벤트 정보 */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* 이벤트 번호 */}
          <span
            style={{
              ...EVENT_NUMBER_STYLE,
              transform:
                prevEvent &&
                (currentEvent || prevValidEvent) &&
                prevEvent.eventNum !== (currentEvent || prevValidEvent).eventNum
                  ? "scale(1.12)"
                  : "scale(1)",
            }}
          >
            Event {currentEventInfo?.eventNum || 0}
          </span>
          
          {/* 이벤트 이름 */}
          {currentEventInfo?.name && (
            <span
              style={EVENT_NAME_STYLE}
              title={currentEventInfo.name}
            >
              {currentEventInfo.name}
            </span>
          )}
          
          {/* 프로그레스 바 */}
          <div style={PROGRESS_BAR_CONTAINER_STYLE}>
            <div
              style={{
                ...PROGRESS_BAR_FILL_STYLE,
                width: currentProgressWidth,
              }}
            />
          </div>
        </div>
      </>
    );
  }, [isGraphLoading, currentEventInfo, currentChapter, currentProgressWidth, prevEvent, currentEvent, prevValidEvent]);

  const renderGraphControls = useCallback(() => (
    <GraphControls
      onSearchSubmit={onSearchSubmit}
      onGenerateSuggestions={handleGenerateSuggestions}
      searchTerm={searchTerm}
      isSearchActive={isSearchActive}
      onClearSearch={clearSearch}
      elements={elements}
      currentChapterData={currentChapterData}
      onCloseSuggestions={closeSuggestions}
      suggestions={suggestions}
      showSuggestions={showSuggestions}
      selectedIndex={selectedIndex}
      onSelectSuggestion={selectSuggestion}
      onKeyDown={handleKeyDown}
    />
  ), [onSearchSubmit, handleGenerateSuggestions, searchTerm, isSearchActive, clearSearch, elements, currentChapterData, closeSuggestions, suggestions, showSuggestions, selectedIndex, selectSuggestion, handleKeyDown]);

  const renderToggleButtons = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginRight: 24,
      }}
    >
      <EdgeLabelToggle
        visible={edgeLabelVisible}
        onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
      />
      
      {/* 3단계 필터링 드롭다운 */}
      <select
        value={filterStage}
        onChange={(e) => setFilterStage(Number(e.target.value))}
        style={{
          height: 28,
          padding: '0 12px',
          borderRadius: 6,
          border: `1.5px solid ${filterStage > 0 ? '#4F6DDE' : '#e3e6ef'}`,
          background: filterStage > 0 ? '#4F6DDE' : '#fff',
          color: filterStage > 0 ? '#fff' : '#22336b',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.18s ease',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: filterStage > 0 ? '0 2px 8px rgba(79,109,222,0.13)' : '0 2px 8px rgba(108,142,255,0.07)',
          justifyContent: 'center',
          minWidth: 100,
        }}
        title="필터링 단계 선택"
      >
        <option value={0} style={{ color: '#22336b', background: '#fff' }}>
          전체 보기
        </option>
        <option value={1} style={{ color: '#22336b', background: '#fff' }}>
          주요 인물만 보기
        </option>
        <option value={2} style={{ color: '#22336b', background: '#fff' }}>
          주요 인물로 보기
        </option>
      </select>
    </div>
  );
  
  return (
    <>
      {/* 상단바 1: 전체화면 모드일 때 모든 기능이 통합된 상단바 */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          width: "100%",
          marginBottom: 0,
          gap: 0,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 0,
          justifyContent: "space-between", // space-between 유지
          borderBottom: graphFullScreen ? "1px solid #e3e6ef" : "none", // 전체화면일 때만 하단 테두리
        }}
      >
        {/* 왼쪽 영역: < 버튼 + 초기화 (분할화면일 때) */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginRight: 36,
          }}
        >
          {/* < 전체화면 버튼 */}
          <button
            onClick={() => {
              if (graphFullScreen) {
                // 그래프 전체화면 -> 분할 화면으로 전환
                graphActions.setGraphFullScreen(false);
              } else {
                // 분할 화면 -> 그래프 전체화면으로 전환
                graphActions.setGraphFullScreen(true);
              }
            }}
            style={{
              height: 28,
              width: 28,
              minWidth: 28,
              minHeight: 28,
              borderRadius: "6px",
              border: "1.5px solid #e3e6ef",
              background: "#fff",
              color: "#22336b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
              transition:
                "background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s",
            }}
            title={graphFullScreen ? "분할 화면으로 전환" : "그래프 전체화면으로 전환"}
          >
            {graphFullScreen ? ">" : "<"}
          </button>

          {/* 인물 검색 기능 */}
          {renderGraphControls()}
        </div>

        {/* 중앙 영역: 챕터 + 이벤트 정보 (전체화면일 때만) */}
        {graphFullScreen && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
            }}
          >
            {ChapterEventInfo}
          </div>
        )}

        {/* 오른쪽 영역: 토글 버튼 */}
        {renderToggleButtons()}
      </div>
      
      {/* 상단바 2: 챕터 + 이벤트 정보 (분할화면일 때만) */}
      {!graphFullScreen && (
        <div
          style={{
            height: 40,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            width: "100%",
            marginBottom: 0,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 0,
            justifyContent: "center",
            borderTop: "1px solid #e3e6ef",
            borderBottom: "1px solid #e3e6ef",
          }}
        >
          {ChapterEventInfo}
        </div>
      )}
    </>
  );
};

export default ViewerTopBar;

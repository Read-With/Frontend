import React, { useCallback, useState, useEffect, useMemo } from 'react';
import GraphControls from '../graph/GraphControls';
import EdgeLabelToggle from '../graph/tooltip/EdgeLabelToggle';
import { getChapterEventCount, getFolderKeyFromFilename } from '../../utils/graphData';
import { getCachedChapterEvents } from '../../utils/common/chapterEventCache';
import { getChapterData } from '../../utils/common/manifestCache';

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
  background: "#E8F5E8",
  color: "#5C6F5C",
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid #e3e6ef",
};

const EVENT_NUMBER_STYLE = {
  display: "inline-block",
  padding: "4px 16px",
  borderRadius: 16,
  background: "#5C6F5C",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 2px 8px rgba(92,111,92,0.13)",
  transition: "transform 0.3s, background 0.3s",
};

const EVENT_NAME_STYLE = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 12,
  background: "#f8f9fc",
  color: "#5C6F5C",
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
  background: "linear-gradient(90deg, #5C6F5C 0%, #6B7B6B 100%)",
  borderRadius: 3,
  transition: "width 0.4s cubic-bezier(.4,2,.6,1)",
};

const ViewerTopBar = ({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
  isFromLibrary = false,
  previousPage = null,
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
    loading: isGraphLoading,
    maxChapterEvents
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

  const [currentEventInfo, setCurrentEventInfo] = React.useState(null);
  const [currentProgressWidth, setCurrentProgressWidth] = React.useState("0%");
  const [hasInitialData, setHasInitialData] = React.useState(false);

  const bookId = useMemo(() => {
    if (book && typeof book.id === 'number') {
      return book.id;
    }
    return null;
  }, [book]);

  const folderKey = useMemo(() => {
    if (!filename) return null;
    try {
      return getFolderKeyFromFilename(filename);
    } catch (error) {
      return null;
    }
  }, [filename]);
  
  const getTotalEventsForChapter = useCallback((eventsList, chapter) => {
    let totalEvents = 0;

    if (Array.isArray(eventsList) && eventsList.length > 0) {
      const maxFromEvents = eventsList.reduce((maxValue, evt) => {
        const eventNumber = Number(evt?.eventIdx ?? evt?.eventNum ?? evt?.idx ?? evt?.id ?? 0);
        return Number.isFinite(eventNumber) ? Math.max(maxValue, eventNumber) : maxValue;
      }, 0);
      totalEvents = Math.max(totalEvents, maxFromEvents);
      totalEvents = Math.max(totalEvents, eventsList.length);
    }

    if (bookId) {
      const cached = getCachedChapterEvents(bookId, chapter);
      if (cached) {
        if (Number.isFinite(cached.maxEventIdx)) {
          totalEvents = Math.max(totalEvents, cached.maxEventIdx);
        }
        if (Array.isArray(cached.events) && cached.events.length > 0) {
          const maxCached = cached.events.reduce((maxValue, evt) => {
            const eventNumber = Number(evt?.eventIdx ?? evt?.idx ?? evt?.eventNum ?? evt?.id ?? 0);
            return Number.isFinite(eventNumber) ? Math.max(maxValue, eventNumber) : maxValue;
          }, 0);
          totalEvents = Math.max(totalEvents, maxCached);
          totalEvents = Math.max(totalEvents, cached.events.length);
        }
      }

      const manifestChapter = getChapterData(bookId, chapter);
      if (manifestChapter?.events && manifestChapter.events.length > 0) {
        const maxManifest = manifestChapter.events.reduce((maxValue, evt) => {
          const eventNumber = Number(evt?.eventIdx ?? evt?.idx ?? evt?.eventNum ?? evt?.id ?? 0);
          return Number.isFinite(eventNumber) ? Math.max(maxValue, eventNumber) : maxValue;
        }, 0);
        totalEvents = Math.max(totalEvents, maxManifest);
        totalEvents = Math.max(totalEvents, manifestChapter.events.length);
      }
    }

    if (folderKey) {
      const localCount = getChapterEventCount(chapter, folderKey);
      totalEvents = Math.max(totalEvents, localCount);
    }

    if (!Number.isFinite(totalEvents) || totalEvents <= 0) {
      totalEvents = 0;
    }

    return totalEvents;
  }, [bookId, folderKey]);

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
      const eventNumber = Number(eventToShow.eventNum ?? eventToShow.eventIdx ?? 0);
      const totalEvents = getTotalEventsForChapter(events, currentChapter);

      if (!Number.isFinite(eventNumber) || eventNumber <= 0) {
        return 0;
      }

      if (!Number.isFinite(totalEvents) || totalEvents <= 0) {
        return Math.min(eventNumber * 100, 100);
      }

      const adjustedTotal = Math.max(totalEvents, eventNumber, 1);

      if (adjustedTotal <= 1) {
        return eventNumber >= adjustedTotal ? 100 : 0;
      }

      const clampedEventNumber = Math.min(eventNumber, adjustedTotal);
      const progressRatio = (clampedEventNumber - 1) / (adjustedTotal - 1);
      return Math.min(Math.max(progressRatio * 100, 0), 100);
    }
    
    return 0;
  }, [getTotalEventsForChapter]);
  
  React.useEffect(() => {
    const eventToShow = currentEvent || prevValidEvent;
    
    if (eventToShow) {
      if (eventToShow.chapter && eventToShow.chapter !== currentChapter) {
        return;
      }
      
      const eventInfo = {
        eventNum: eventToShow.eventNum ?? 0,
        name: eventToShow.name || eventToShow.event_name || ""
      };
      setCurrentEventInfo(eventInfo);
      
      if (!hasInitialData) {
        setHasInitialData(true);
      }
      
      const progressPercentage = calculateProgress(eventToShow, events, currentChapter);
      const progressWidth = `${Math.round(progressPercentage * 100) / 100}%`;
      setCurrentProgressWidth(progressWidth);
    } else if (!hasInitialData) {
      setCurrentEventInfo(null);
      setCurrentProgressWidth("0%");
    }
  }, [currentEvent, prevValidEvent, events, currentChapter, calculateProgress, hasInitialData]);
  
  React.useEffect(() => {
    const handleChapterChange = (event) => {
      if (event.detail && event.detail.chapter !== currentChapter) {
        setCurrentChapter(event.detail.chapter);
      }
    };
    
    window.addEventListener('chapterChange', handleChapterChange);
    
    return () => {
      window.removeEventListener('chapterChange', handleChapterChange);
    };
  }, [currentChapter, setCurrentChapter]);
  
  React.useEffect(() => {
    setHasInitialData(false);
  }, [currentChapter]);
  
  // 제안 생성을 위한 별도 함수 (실제 검색은 실행하지 않음)
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    // onGenerateSuggestions prop을 사용하여 제안 생성
    if (onGenerateSuggestions) {
      onGenerateSuggestions(searchTerm);
    }
  }, [onGenerateSuggestions]);

  const ChapterEventInfo = useMemo(() => {
    const shouldShowLoading = isGraphLoading && !hasInitialData;
    
    if (shouldShowLoading) {
      return (
        <span style={LOADING_STYLE}>
          로딩중...
        </span>
      );
    }

    const displayEventInfo = currentEventInfo || (hasInitialData ? { eventNum: 0, name: "" } : null);
    
    if (!displayEventInfo) {
      return (
        <span style={LOADING_STYLE}>
          로딩중...
        </span>
      );
    }

    return (
      <>
        <span style={CHAPTER_STYLE}>
          Chapter {currentChapter}
        </span>

        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
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
            Event {displayEventInfo.eventNum}
          </span>
          
          {displayEventInfo.name && (
            <span
              style={EVENT_NAME_STYLE}
              title={displayEventInfo.name}
            >
              {displayEventInfo.name}
            </span>
          )}
          
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
  }, [isGraphLoading, currentEventInfo, currentChapter, currentProgressWidth, prevEvent, currentEvent, prevValidEvent, hasInitialData]);

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
          height: 32,
          padding: '0 12px',
          borderRadius: 8,
          border: `1px solid ${filterStage > 0 ? '#5C6F5C' : '#e5e7eb'}`,
          background: filterStage > 0 ? '#5C6F5C' : '#fff',
          color: filterStage > 0 ? '#fff' : '#5C6F5C',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: filterStage > 0 ? '0 2px 8px rgba(92,111,92,0.25)' : '0 2px 8px rgba(0,0,0,0.1)',
          justifyContent: 'center',
          minWidth: 120,
        }}
        title="필터링 단계 선택"
      >
        <option value={0} style={{ color: '#5C6F5C', background: '#fff' }}>
          모두 보기
        </option>
        <option value={1} style={{ color: '#5C6F5C', background: '#fff' }}>
          주요 인물만 보기
        </option>
        <option value={2} style={{ color: '#5C6F5C', background: '#fff' }}>
          주요 인물과 보기
        </option>
      </select>
    </div>
  );
  
  return (
    <>
      {/* 상단바 1: 전체화면 모드일 때 모든 기능이 통합된 상단바 */}
      <div
        style={{
          height: 44,
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
            height: 44,
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

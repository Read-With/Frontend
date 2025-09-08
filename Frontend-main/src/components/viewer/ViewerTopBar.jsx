import React, { useCallback } from 'react';
import GraphControls from '../graph/GraphControls';
import EdgeLabelToggle from '../graph/tooltip/EdgeLabelToggle';
import { getChapterEventCount } from '../../utils/graphData';

const ViewerTopBar = ({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
}) => {
  // 그룹화된 상태에서 개별 값들 추출
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
    hideIsolated,
    loading: isGraphLoading
  } = graphState;
  
  const {
    setCurrentChapter,
    setGraphFullScreen,
    setEdgeLabelVisible,
    setHideIsolated
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
  
  // 이벤트 정보 실시간 업데이트 (개선된 버전)
  React.useEffect(() => {
    const eventToShow = currentEvent || prevValidEvent;
    
    if (eventToShow) {
      const eventInfo = {
        eventNum: eventToShow.eventNum ?? 0,
        name: eventToShow.name || eventToShow.event_name || ""
      };
      setCurrentEventInfo(eventInfo);
      
      // 프로그레스 바 너비 실시간 계산 - 마지막 이벤트에서 100%가 되도록 수정
      let progressPercentage = 0;
      
      // 1. chapterProgress가 있는 경우 (가장 정확한 방법)
      if (eventToShow.chapterProgress !== undefined) {
        progressPercentage = Math.min(eventToShow.chapterProgress, 100);
      }
      // 2. events 배열이 있는 경우
      else if (events && eventToShow && events.length > 0) {
        const currentEventIndex = events.findIndex(e => e.eventNum === eventToShow.eventNum);
        
        // 마지막 이벤트를 넘어선 경우 100%로 설정
        if (currentEventIndex === -1 && eventToShow.progress === 100) {
          progressPercentage = 100;
        }
        // 정상적인 이벤트 인덱스가 있는 경우
        else if (currentEventIndex >= 0) {
          // 마지막 이벤트인지 확인
          const isLastEvent = currentEventIndex === events.length - 1;
          
          if (isLastEvent) {
            // 마지막 이벤트인 경우 100%로 설정
            progressPercentage = 100;
          } else {
            // 이벤트 내 진행률도 고려 (마지막 이벤트가 아닌 경우만)
            const baseProgress = (currentEventIndex / (events.length - 1)) * 100;
            const eventProgress = eventToShow.progress || 0;
            const eventWeight = 100 / events.length; // 각 이벤트가 차지하는 비중
            
            progressPercentage = Math.min(baseProgress + (eventProgress * eventWeight / 100), 100);
          }
        }
        // 첫 이벤트보다 앞선 경우
        else if (currentEventIndex === -1 && eventToShow.progress === 0) {
          progressPercentage = 0;
        }
      }
      // 3. events가 없지만 eventNum이 있는 경우 - 챕터 내 이벤트 진행률 추정
      else if (eventToShow && eventToShow.eventNum !== undefined) {
        try {
          const totalEvents = getChapterEventCount(currentChapter);
          // 마지막 이벤트인 경우 100%로 설정
          if (eventToShow.eventNum >= totalEvents - 1) {
            progressPercentage = 100;
          } else {
            progressPercentage = Math.min((eventToShow.eventNum / (totalEvents - 1)) * 100, 100);
          }
        } catch (error) {
          // 에러 발생 시 기본값 사용
          const fallbackTotalEvents = 20;
          progressPercentage = Math.min((eventToShow.eventNum / (fallbackTotalEvents - 1)) * 100, 100);
        }
      }
      
      const progressWidth = `${Math.round(progressPercentage * 100) / 100}%`;
      setCurrentProgressWidth(progressWidth);
    } else {
      // 이벤트 정보가 없을 때 초기화
      setCurrentEventInfo(null);
      setCurrentProgressWidth("0%");
    }
  }, [currentEvent, prevValidEvent, events, currentChapter]);
  
  // 실시간으로 현재 챕터 감지
  React.useEffect(() => {
    const checkCurrentChapter = () => {
      if (window.currentChapter && window.currentChapter !== currentChapter) {
        setCurrentChapter(window.currentChapter);
      }
    };
    
    // 주기적으로 현재 챕터 확인
    const interval = setInterval(checkCurrentChapter, 1000);
    
    return () => clearInterval(interval);
  }, [currentChapter, setCurrentChapter]);
  
  // 제안 생성을 위한 별도 함수 (실제 검색은 실행하지 않음)
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    // onGenerateSuggestions prop을 사용하여 제안 생성
    if (onGenerateSuggestions) {
      onGenerateSuggestions(searchTerm);
    }
  }, [onGenerateSuggestions]);

  // 중복 제거를 위한 공통 컴포넌트 렌더링 함수들
  const renderGraphControls = () => (
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
  );

  const renderToggleButtons = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        marginRight: 24,
      }}
    >
      <EdgeLabelToggle
        visible={edgeLabelVisible}
        onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
      />
      <button
        onClick={() => setHideIsolated((v) => !v)}
        style={{
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
        }}
        title={hideIsolated ? '독립 인물을 표시합니다' : '독립 인물을 숨깁니다'}
      >
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: hideIsolated ? '#6C8EFF' : '#22336b',
          opacity: hideIsolated ? 0.6 : 1,
        }} />
        {hideIsolated ? '독립 인물 표시' : '독립 인물 숨기기'}
      </button>
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
            gap: 12, // 12px 간격
            marginRight: 36, // 오른쪽 영역과의 간격
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
              gap: 16, // 16px 간격
            }}
          >
            {isGraphLoading || !currentEventInfo ? (
              /* 로딩 중일 때 통합 표시 */
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 16px",
                  borderRadius: 16,
                  background: "#f3f4f6",
                  color: "#9ca3af",
                  fontSize: 14,
                  fontWeight: 600,
                  border: "1px solid #e3e6ef",
                }}
              >
                로딩중...
              </span>
            ) : (
              /* 로딩 완료 시 chapter와 event 정보 표시 */
              <>
                {/* 챕터 정보 표시 */}
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    borderRadius: 16,
                    background: "#EEF2FF",
                    color: "#22336b",
                    fontSize: 14,
                    fontWeight: 600,
                    border: "1px solid #e3e6ef",
                  }}
                >
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
                      display: "inline-block",
                      padding: "4px 16px",
                      borderRadius: 16,
                      background: "#4F6DDE",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      boxShadow: "0 2px 8px rgba(79,109,222,0.13)",
                      transition: "transform 0.3s, background 0.3s",
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
                  
                  {/* 이벤트 이름 (있는 경우에만 표시) */}
                  {currentEventInfo?.name && (
                    <span
                      style={{
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
                      }}
                      title={currentEventInfo.name}
                    >
                      {currentEventInfo.name}
                    </span>
                  )}
                  
                  {/* 프로그레스 바 */}
                  <div
                    style={{
                      width: 120,
                      height: 6,
                      background: "#e3e6ef",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: currentProgressWidth,
                        height: "100%",
                        background: "linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)",
                        borderRadius: 3,
                        transition: "width 0.4s cubic-bezier(.4,2,.6,1)",
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 오른쪽 영역: 토글 + 독립 인물 버튼 */}
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
          {isGraphLoading || !currentEventInfo ? (
            /* 로딩 중일 때 통합 표시 */
            <span
              style={{
                display: "inline-block",
                padding: "4px 16px",
                borderRadius: 16,
                background: "#f3f4f6",
                color: "#9ca3af",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid #e3e6ef",
              }}
            >
              로딩중...
            </span>
          ) : (
            /* 로딩 완료 시 chapter와 event 정보 표시 */
            <>
              {/* 챕터 정보 표시 */}
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: 16,
                  background: "#EEF2FF",
                  color: "#22336b",
                  fontSize: 14,
                  fontWeight: 600,
                  border: "1px solid #e3e6ef",
                }}
              >
                Chapter {currentChapter}
              </span>

              {/* 이벤트 정보 */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  marginLeft: 12,
                }}
              >
                {/* 이벤트 번호 */}
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 16px",
                    borderRadius: 16,
                    background: "#4F6DDE",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    boxShadow: "0 2px 8px rgba(79,109,222,0.13)",
                    transition: "transform 0.3s, background 0.3s",
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
                
                {/* 이벤트 이름 (있는 경우에만 표시) */}
                {currentEventInfo?.name && (
                  <span
                    style={{
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
                    }}
                    title={currentEventInfo.name}
                  >
                    {currentEventInfo.name}
                  </span>
                )}
                
                {/* 프로그레스 바 */}
                <div
                  style={{
                    width: 120,
                    height: 6,
                    background: "#e3e6ef",
                    borderRadius: 3,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: currentProgressWidth,
                      height: "100%",
                      background: "linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)",
                      borderRadius: 3,
                      transition: "width 0.4s cubic-bezier(.4,2,.6,1)",
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default ViewerTopBar;

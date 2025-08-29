import React from 'react';
import GraphControls from '../graph/GraphControls';
import EdgeLabelToggle from '../graph/tooltip/EdgeLabelToggle';

const ViewerTopBar = ({
  // 상단바 1 props
  navigate,
  filename,
  currentChapter,
  setCurrentChapter,
  maxChapter,
  book,
  viewerRef,
  currentEvent,
  prevValidEvent,
  prevEvent,
  events,
  graphFullScreen,
  setGraphFullScreen,
  
  // 상단바 2 props
  edgeLabelVisible,
  setEdgeLabelVisible,
  hideIsolated,
  setHideIsolated,
  onSearchSubmit,
  searchTerm,
  isSearchActive,
  clearSearch,
  elements = [], // 그래프 요소들 (검색 제안용)
  currentChapterData = null, // 현재 챕터의 캐릭터 데이터
}) => {
  // 현재 이벤트 정보를 실시간으로 추적
  const [currentEventInfo, setCurrentEventInfo] = React.useState(null);
  const [currentProgressWidth, setCurrentProgressWidth] = React.useState("0%");
  
  // 이벤트 정보 실시간 업데이트
  React.useEffect(() => {
    const eventToShow = currentEvent || prevValidEvent;
    
    if (eventToShow) {
      setCurrentEventInfo({
        eventNum: eventToShow.eventNum ?? 0,
        name: eventToShow.name || ""
      });
      
      // 프로그레스 바 너비 실시간 계산
      if (events && eventToShow && events.length > 0) {
        const currentEventIndex = events.findIndex(e => e.eventNum === eventToShow.eventNum);
        const progressPercentage = currentEventIndex >= 0 
          ? Math.min(((currentEventIndex + 1) / events.length) * 100, 100)
          : 0;
        const progressWidth = `${progressPercentage}%`;
        setCurrentProgressWidth(progressWidth);
      } else if (eventToShow && eventToShow.eventNum) {
        // events가 없지만 eventNum이 있는 경우
        const progressWidth = `${Math.min((eventToShow.eventNum / 20) * 100, 100)}%`;
        setCurrentProgressWidth(progressWidth);
      } else {
        setCurrentProgressWidth("0%");
      }
    }
  }, [currentEvent, prevValidEvent, events]);
  
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
                setGraphFullScreen(false);
              } else {
                // 분할 화면 -> 그래프 전체화면으로 전환
                setGraphFullScreen(true);
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



          {/* 인물 검색 기능 (분할화면일 때도 왼쪽 영역에 포함) */}
          {!graphFullScreen && (
            <GraphControls
              onSearchSubmit={onSearchSubmit}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              onClearSearch={clearSearch}
              elements={elements}
              currentChapterData={currentChapterData}
            />
          )}
          
          {/* 인물 검색 기능 (전체화면일 때만 왼쪽 영역에 포함) */}
          {graphFullScreen && (
            <GraphControls
              onSearchSubmit={onSearchSubmit}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              onClearSearch={clearSearch}
              elements={elements}
              currentChapterData={currentChapterData}
            />
          )}
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
          </div>
        )}

        {/* 오른쪽 영역: 토글 + 독립 인물 버튼 (분할화면일 때도 표시) */}
        {!graphFullScreen && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 16, // 16px 간격
              marginRight: 24, // 오른쪽 공백 추가
            }}
          >
            {/* 간선 라벨 스위치 토글 */}
            <EdgeLabelToggle
              visible={edgeLabelVisible}
              onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
            />

            {/* 독립 인물 버튼 */}
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
        )}

        {/* 오른쪽 영역: 토글 + 독립 인물 버튼 (전체화면일 때만 표시) */}
        {graphFullScreen && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 16, // 16px 간격
              marginRight: 24, // 오른쪽 공백 추가
            }}
          >
            {/* 간선 라벨 스위치 토글 */}
            <EdgeLabelToggle
              visible={edgeLabelVisible}
              onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
            />

            {/* 독립 인물 버튼 */}
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
        )}
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
        </div>
      )}
    </>
  );
};

export default ViewerTopBar;

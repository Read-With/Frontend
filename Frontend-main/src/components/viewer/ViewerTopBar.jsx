import React from 'react';
import { FaSyncAlt } from 'react-icons/fa';
import GraphControls from '../graph/GraphControls';
import EdgeLabelToggle from '../common/EdgeLabelToggle';

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
      if (events && eventToShow) {
        const progressWidth = `${((eventToShow.eventNum || 0) / (events.length + 1)) * 100}%`;
        setCurrentProgressWidth(progressWidth);
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
      {/* 상단바 1: 전체화면 버튼 + 챕터 드롭다운 + 이벤트 정보 + 프로그레스 바 */}
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
          justifyContent: "space-between",
        }}
      >
        {/* 왼쪽 그룹: 전체화면 버튼 + 챕터 정보 */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* < 전체화면 버튼 */}
          <button
            onClick={() => {
              console.log('Button clicked! Current graphFullScreen:', graphFullScreen);
              if (graphFullScreen) {
                // 그래프 전체화면 -> 분할 화면으로 전환
                console.log('Switching to split view');
                setGraphFullScreen(false);
              } else {
                // 분할 화면 -> 그래프 전체화면으로 전환
                console.log('Switching to full screen graph');
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
          
          {/* 챕터 정보 표시 */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* 챕터 번호 */}
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
            
            {/* 초기화(새로고침) 버튼 */}
            <button
              onClick={() => window.location.reload()}
              title="초기화"
              style={{
                height: 28,
                width: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: "1px solid #bfc8e2",
                background: "#f4f7fb",
                color: "#4F6DDE",
                fontSize: 16,
                cursor: "pointer",
                transition: "background 0.18s",
                outline: "none",
                boxShadow: "none",
                padding: 0,
              }}
            >
              <FaSyncAlt />
            </button>
          </div>
        </div>

                 {/* 중간 그룹: 이벤트 정보 표시 */}
         <div
           style={{
             display: "flex",
             flexDirection: "row",
             alignItems: "center",
             gap: 12,
             flex: 1,
             justifyContent: "center",
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
      
      {/* 상단바 2: 인물 검색 기능 (왼쪽) + 간선 라벨 토글 + 독립 인물 버튼 (오른쪽) */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          width: "100%",
          marginBottom: 0,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 0,
          justifyContent: "space-between",
          borderTop: "1px solid #e3e6ef",
          borderBottom: "1px solid #e3e6ef",
        }}
      >
        {/* 왼쪽 영역: 인물 검색 기능 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <GraphControls
            onSearchSubmit={onSearchSubmit}
          />
        </div>

        {/* 오른쪽 영역: 간선 라벨 토글 + 독립 인물 버튼 */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          {/* 간선 라벨 스위치 토글 */}
          <EdgeLabelToggle
            isVisible={edgeLabelVisible}
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
      </div>
    </>
  );
};

export default ViewerTopBar;

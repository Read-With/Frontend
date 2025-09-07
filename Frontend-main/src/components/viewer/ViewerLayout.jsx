import React, { useEffect } from 'react';
import ViewerToolbar from './epub/ViewerToolbar';
import ViewerProgressBar from './epub/ViewerProgressbar';

const ViewerLayout = ({
  children,
  progress,
  setProgress,
  showControls,
  onPrev,
  onNext,
  onAddBookmark,
  onToggleBookmarkList,
  onOpenSettings,
  onSliderChange,
  currentPage,
  totalPages,
  showGraph,
  onToggleGraph,
  rightSideContent,
  pageMode,
  graphFullScreen
}) => {

  // 그래프 표시 상태가 변경될 때 창 크기 변경 이벤트 발생시키기
  useEffect(() => {
    // 창 크기 변경 이벤트를 발생시켜 EPUB 뷰어가 크기를 재조정하도록 함
    const resizeEvent = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
    
    return () => {
      window.clearTimeout(resizeEvent);
    };
  }, [showGraph, graphFullScreen]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 상단 Toolbar - 파란색 상단바 (그래프 전체화면일 때 투명하게 숨김) */}
      <div style={{
        opacity: graphFullScreen ? 0 : 1,
        visibility: graphFullScreen ? 'hidden' : 'visible',
        transition: 'opacity 0.3s ease, visibility 0.3s ease',
        height: graphFullScreen ? '60px' : 'auto', // 전체화면일 때 높이 유지
        flexShrink: 0,
      }}>
        <ViewerToolbar
          showControls={showControls}
          onPrev={onPrev}
          onNext={onNext}
          onAddBookmark={onAddBookmark}
          onToggleBookmarkList={onToggleBookmarkList}
          onOpenSettings={onOpenSettings}
          onToggleGraph={onToggleGraph}
          showGraph={showGraph}
          pageMode={pageMode}
        />
      </div>

      {/* 본문 영역 - 좌우로 나눔 */}
      <div
        className="flex-1 overflow-hidden flex"
        style={{
          backgroundColor: '#fdfdfd',
        }}
      >
        {/* 왼쪽: EPUB 뷰어 */}
                 <div 
           className={`h-full overflow-hidden`}
           style={{
             width: showGraph && !graphFullScreen ? '50%' : graphFullScreen ? '0%' : '100%',
             borderRight: showGraph && !graphFullScreen ? '1px solid #e2e8f0' : 'none',
             display: graphFullScreen ? 'none' : 'block',
             minWidth: graphFullScreen ? '0px' : 'auto'
         }}
         data-graph-fullscreen={graphFullScreen}
       >
        {children}
        </div>
        
        {/* 오른쪽: 그래프 (조건부 렌더링) */}
        {showGraph && (
                     <div 
             className={`h-full overflow-hidden bg-white`}
             style={{ 
               width: graphFullScreen ? '100%' : '50%',
               position: 'relative',
               boxShadow: graphFullScreen ? 'none' : '-2px 0 10px rgba(0, 0, 0, 0.05)',
               paddingBottom: '3rem',
               minWidth: graphFullScreen ? '100%' : '50%',
                              ...(graphFullScreen && {
                  display: 'block'
                })
             }}
             data-graph-fullscreen={graphFullScreen}
           >
                         {graphFullScreen ? (
               <div style={{ 
                 width: '100%', 
                 height: '100%',
                 backgroundColor: 'white'
               }}>
                 {rightSideContent}
               </div>
             ) : (
               rightSideContent
             )}
          </div>
        )}
      </div>

      {/* 하단 ProgressBar - 파란색 하단바 (그래프 전체화면일 때 투명하게 숨김) */}
      <div style={{
        opacity: graphFullScreen ? 0 : 1,
        visibility: graphFullScreen ? 'hidden' : 'visible',
        transition: 'opacity 0.3s ease, visibility 0.3s ease',
        height: graphFullScreen ? '80px' : 'auto', // 전체화면일 때 높이 유지 (ProgressBar 높이 + 마진)
        flexShrink: 0,
      }}>
        <ViewerProgressBar
          showControls={showControls}
          progress={progress}
          setProgress={setProgress}
          onSliderChange={onSliderChange}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
};

export default ViewerLayout;
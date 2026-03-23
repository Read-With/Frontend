import React, { useEffect } from 'react';
import ViewerToolbar from './ui/ViewerToolbar';
import ViewerProgressBar from './ui/ViewerProgressbar';

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
  graphFullScreen,
  isFromLibrary = false,
  previousPage = null,
}) => {

  useEffect(() => {
    // 그래프 표시/레이아웃 변경 시 뷰어 리사이즈
    // pageMode(단면/양면) 변경 시 레이아웃 재계산
    const resizeEvent = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
    
    return () => {
      window.clearTimeout(resizeEvent);
    };
  }, [showGraph, graphFullScreen, pageMode]);

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
          isFromLibrary={isFromLibrary}
          previousPage={previousPage}
        />
      </div>

      {/* 본문 영역 - 좌우로 나눔 */}
      <div
        className="flex-1 overflow-hidden flex"
        style={{
          backgroundColor: '#fdfdfd',
        }}
      >
        {/* 왼쪽: 뷰어 (XHTML) */}
                 <div 
           className={`h-full overflow-hidden relative`}
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
               paddingBottom: '0',
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
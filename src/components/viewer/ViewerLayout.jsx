import React, { useEffect } from 'react';
import ViewerToolbar from './epub/ViewerToolbar';
import ViewerProgressBar from './epub/ViewerProgressbar';

const ViewerLayout = ({
  children,
  darkMode,
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
  pageMode
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
  }, [showGraph]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 상단 Toolbar */}
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

      {/* 본문 영역 - 좌우로 나눔 */}
      <div
        className="flex-1 overflow-hidden flex"
        style={{
          backgroundColor: darkMode ? '#121212' : '#fdfdfd',
        }}
      >
        {/* 왼쪽: EPUB 뷰어 */}
        <div 
          className={`${showGraph ? 'w-1/2' : 'w-full'} h-full overflow-hidden transition-all duration-300`}
          style={{
            borderRight: showGraph ? '1px solid #e2e8f0' : 'none'
        }}
      >
        {children}
        </div>
        
        {/* 오른쪽: 그래프 (조건부 렌더링) */}
        {showGraph && (
          <div 
            className="w-1/2 h-full overflow-hidden transition-all duration-300 bg-white graph-area"
            style={{ 
              position: 'relative',
              boxShadow: '-2px 0 10px rgba(0, 0, 0, 0.05)',
              paddingBottom: '3rem'
            }}
          >
            {rightSideContent}
          </div>
        )}
      </div>

      {/* 하단 ProgressBar 반드시 추가! */}
      <ViewerProgressBar
        showControls={showControls}
        progress={progress}
        setProgress={setProgress}
        darkMode={darkMode}
        onSliderChange={onSliderChange}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  );
};

export default ViewerLayout;

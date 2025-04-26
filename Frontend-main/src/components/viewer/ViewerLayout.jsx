import React from 'react';
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
  onSliderChange,
}) => {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 상단 Toolbar */}
      <ViewerToolbar
        showControls={showControls}
        onPrev={onPrev}
        onNext={onNext}
        onAddBookmark={onAddBookmark}
        onToggleBookmarkList={onToggleBookmarkList}
      />

      {/* 본문 영역 */}
      <div
        className="flex-1 overflow-hidden"
        style={{
          backgroundColor: darkMode ? '#121212' : '#fdfdfd',
        }}
      >
        {children}
      </div>

      {/* 하단 ProgressBar 반드시 추가! */}
      <ViewerProgressBar
        showControls={showControls}
        progress={progress}
        setProgress={setProgress}
        darkMode={darkMode}
        onSliderChange={onSliderChange}
      />
    </div>
  );
};

export default ViewerLayout;

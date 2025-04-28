import React from 'react';

const ViewerProgressBar = ({
  showControls,
  progress = 0,
  setProgress,
  darkMode,
  onSliderChange,
  currentPage = 1,
  totalPages = 1,
}) => (
  <div
    className={`w-full h-12 z-20 p-3 flex justify-between items-center shadow-md
      transition-opacity duration-300
      ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}
      ${darkMode ? 'bg-viewer-dark-bg' : 'bg-viewer-light-bg'}`}
    style={{ backdropFilter: 'blur(4px)' }}
  >
    {/* 좌측: 현재 페이지 / 전체 페이지 */}
    <span className="font-semibold text-gray-700 dark:text-gray-100">
      {currentPage} / {totalPages}
    </span>

    {/* 중앙: 슬라이더 */}
    <input
      type="range"
      min="0"
      max="100"
      value={Math.max(0, Math.min(progress, 100))}
      onChange={e => {
        const value = Number(e.target.value);
        if (setProgress) setProgress(value);
        if (onSliderChange) onSliderChange(value);
      }}
      className="w-2/3"
      aria-label="진행률 슬라이더"
    />

    {/* 우측: 진행률 % */}
    <span className="font-medium text-blue-600 dark:text-blue-400">
      {Math.max(0, Math.min(progress, 100))}%
    </span>
  </div>
);

export default ViewerProgressBar;

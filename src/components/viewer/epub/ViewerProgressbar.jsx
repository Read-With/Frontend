import React from 'react';

const ViewerProgressBar = ({ showControls, progress, setProgress, darkMode, onSliderChange }) => (
  <div
    className={`w-full h-12 z-20 p-3 flex justify-between items-center shadow-md
      transition-opacity duration-300
      ${showControls ? 'opacity-100' : 'opacity-0'}
      ${darkMode ? 'bg-viewer-dark-bg' : 'bg-viewer-light-bg'}`}
    style={{ backdropFilter: 'blur(4px)' }}
  >
    <span>{progress}%</span>
    <input
      type="range"
      min="0"
      max="100"
      value={progress}
      onChange={e => {
        const value = Number(e.target.value);
        setProgress(value);
        if (onSliderChange) onSliderChange(value);
      }}
      className="w-2/3"
    />
  </div>
);

export default ViewerProgressBar;

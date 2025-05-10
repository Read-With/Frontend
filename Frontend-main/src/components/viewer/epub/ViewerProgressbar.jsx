import React from 'react';

const barColor = '#4F6DDE';
const barBg = '#e7eaf7';
const thumbColor = '#fff';
const thumbBorder = '#4F6DDE';
const thumbShadow = '0 2px 8px rgba(79,109,222,0.13)';

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
    className={`w-full z-20 px-6 py-2 flex justify-between items-center shadow-md transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    style={{
      backdropFilter: 'blur(8px)',
      background: darkMode ? 'rgba(34, 51, 107, 0.92)' : 'rgba(255,255,255,0.92)',
      borderRadius: 16,
      boxShadow: '0 2px 16px rgba(79,109,222,0.10)',
      margin: '0.5rem auto 0.5rem auto',
      maxWidth: 700,
    }}
  >
    {/* 좌측: 현재 페이지 / 전체 페이지 */}
    <span style={{ fontWeight: 700, color: darkMode ? '#fff' : '#22336b', fontSize: '1.08rem', minWidth: 70 }}>
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
      style={{
        width: '60%',
        accentColor: barColor,
        height: 6,
        borderRadius: 8,
        background: barBg,
        boxShadow: '0 1px 6px rgba(79,109,222,0.07)',
        outline: 'none',
        appearance: 'none',
      }}
      aria-label="진행률 슬라이더"
      className="progressbar-slider"
    />

    {/* 우측: 진행률 % */}
    <span style={{ fontWeight: 700, color: barColor, fontSize: '1.08rem', minWidth: 60, textAlign: 'right' }}>
      {Math.max(0, Math.min(progress, 100))}%
    </span>
    <style>{`
      .progressbar-slider::-webkit-slider-runnable-track {
        height: 6px;
        border-radius: 8px;
        background: ${barBg};
      }
      .progressbar-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: ${thumbColor};
        border: 2.5px solid ${thumbBorder};
        box-shadow: ${thumbShadow};
        margin-top: -4px;
        transition: border 0.18s, box-shadow 0.18s;
      }
      .progressbar-slider:focus::-webkit-slider-thumb {
        border: 2.5px solid #22336b;
        box-shadow: 0 0 0 4px #bfc8e6;
      }
      .progressbar-slider::-moz-range-thumb {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: ${thumbColor};
        border: 2.5px solid ${thumbBorder};
        box-shadow: ${thumbShadow};
        transition: border 0.18s, box-shadow 0.18s;
      }
      .progressbar-slider:focus::-moz-range-thumb {
        border: 2.5px solid #22336b;
        box-shadow: 0 0 0 4px #bfc8e6;
      }
      .progressbar-slider::-ms-thumb {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: ${thumbColor};
        border: 2.5px solid ${thumbBorder};
        box-shadow: ${thumbShadow};
        transition: border 0.18s, box-shadow 0.18s;
      }
      .progressbar-slider:focus::-ms-thumb {
        border: 2.5px solid #22336b;
        box-shadow: 0 0 0 4px #bfc8e6;
      }
      .progressbar-slider::-ms-fill-lower {
        background: ${barBg};
        border-radius: 8px;
      }
      .progressbar-slider::-ms-fill-upper {
        background: ${barBg};
        border-radius: 8px;
      }
      .progressbar-slider:focus {
        outline: none;
      }
      .progressbar-slider {
        outline: none;
      }
    `}</style>
  </div>
);

export default ViewerProgressBar;

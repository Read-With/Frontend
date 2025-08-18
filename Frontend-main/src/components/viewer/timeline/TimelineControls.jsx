import React, { useState, useRef, useEffect } from 'react';
import { FaLock, FaUnlock, FaChevronDown, FaCheck, FaBookmark, FaClock } from 'react-icons/fa';

const TimelineControls = ({ 
  currentChapter, 
  totalChapters, 
  onChapterChange,
  readChapters,
  buttonStyle = {},
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  return (
    <div className="relative">
      <div className="header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <button
          className="flex items-center gap-2"
          onClick={() => setDropdownOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
          style={buttonStyle}
          onMouseOver={e => { e.currentTarget.style.background = '#EEF2FF'; }}
          onMouseOut={e => { e.currentTarget.style.background = buttonStyle.background || '#fff'; }}
        >
          <span>챕터 {currentChapter}</span>
          <FaChevronDown className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        <button className="close-btn" style={{ marginLeft: 'auto' }}>×</button>
      </div>
      {dropdownOpen && (
        <div className="absolute left-0 mt-2 w-72 max-h-80 overflow-y-auto z-50 bg-white border border-gray-200 rounded-xl shadow-2xl py-2 animate-slide-up" style={{fontSize: '1rem', boxShadow: '0 8px 32px rgba(0,0,0,0.15)'}}>
          <div className="px-4 py-2 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <FaBookmark className="text-blue-500" />
              챕터 선택
            </h3>
          </div>
          
          {Array.from({ length: totalChapters }, (_, i) => i + 1).map((chapter) => {
            const isLocked = !readChapters.includes(chapter);
            const isCurrent = currentChapter === chapter;
            const chapterProgress = Math.floor(Math.random() * 100); // 임시 진행률
            
            return (
              <button
                key={chapter}
                onClick={() => { if (!isLocked) { onChapterChange(chapter); setDropdownOpen(false); } }}
                className={`w-full text-left p-4 flex items-center gap-3 transition-all duration-200 group ${
                  isCurrent
                    ? 'bg-blue-50 border-l-4 border-blue-500'
                    : isLocked
                      ? 'bg-gray-50 cursor-not-allowed opacity-60'
                      : 'hover:bg-gray-50 cursor-pointer'
                }`}
                role="option"
                aria-selected={isCurrent}
                disabled={isLocked}
                title={isLocked ? '아직 읽지 않은 챕터입니다' : `챕터 ${chapter}로 이동`}
              >
                {/* 왼쪽: 상태 아이콘 */}
                <div className="flex-shrink-0">
                  {isLocked ? (
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                      <FaLock className="text-gray-400 text-sm" />
                    </div>
                  ) : isCurrent ? (
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center animate-enhanced-pulse">
                      <FaCheck className="text-white text-sm" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                      <FaCheck className="text-green-600 text-sm" />
                    </div>
                  )}
                </div>

                {/* 중앙: 챕터 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold ${
                      isCurrent ? 'text-blue-700' : isLocked ? 'text-gray-400' : 'text-gray-800'
                    }`}>
                      챕터 {chapter}
                    </span>
                    {!isLocked && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <FaClock />
                        {chapterProgress}%
                      </span>
                    )}
                  </div>
                  
                  {isLocked ? (
                    <p className="text-xs text-gray-400">아직 읽지 않은 챕터</p>
                  ) : (
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          isCurrent ? 'bg-blue-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${chapterProgress}%` }}
                      ></div>
                    </div>
                  )}
                </div>

                {/* 오른쪽: 추가 정보 */}
                {isCurrent && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-enhanced-pulse"></div>
                  </div>
                )}
              </button>
            );
          })}
          
          {/* 푸터 */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
            <div className="flex justify-between items-center text-xs text-gray-600">
              <span>읽은 챕터: {readChapters.length}/{totalChapters}</span>
              <span>{Math.round((readChapters.length / totalChapters) * 100)}% 완료</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimelineControls; 
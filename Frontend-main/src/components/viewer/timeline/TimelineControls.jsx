import React, { useState, useRef, useEffect } from 'react';
import { FaLock, FaUnlock, FaChevronDown } from 'react-icons/fa';

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
        <div className="absolute left-0 mt-2 w-56 max-h-72 overflow-y-auto z-50 bg-white border border-[#6C8EFF] rounded-lg shadow-lg py-2" style={{fontSize: '1.08rem', boxShadow: '0 4px 18px #6C8EFF22', border: '2px solid #6C8EFF'}}>
          {Array.from({ length: totalChapters }, (_, i) => i + 1).map((chapter) => {
            const isLocked = !readChapters.includes(chapter);
            return (
              <button
                key={chapter}
                onClick={() => { if (!isLocked) { onChapterChange(chapter); setDropdownOpen(false); } }}
                className={`w-full text-left px-5 py-3 rounded-lg flex items-center gap-3 text-base font-medium focus:outline-none transition-all duration-200 ${
                  currentChapter === chapter
                    ? 'bg-[#EEF2FF] text-[#22336b] border-l-4 border-[#6C8EFF] font-bold shadow'
                    : isLocked
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'hover:bg-[#EEF2FF] text-[#22336b] cursor-pointer'
                }`}
                role="option"
                aria-selected={currentChapter === chapter}
                disabled={isLocked}
                title={isLocked ? '아직 읽지 않은 챕터입니다' : ''}
                style={{ fontSize: '1.08rem', padding: '0.9rem 1.2rem', borderBottom: '1px solid #f0f0f0', background: currentChapter === chapter ? '#EEF2FF' : isLocked ? '#f7f7fa' : '#fff', color: isLocked ? '#bfc8e6' : '#22336b', opacity: isLocked ? 0.7 : 1, pointerEvents: isLocked ? 'none' : 'auto' }}
              >
                {isLocked && (
                  <>
                    <FaLock className="text-gray-400" style={{ marginLeft: 16, marginRight: 10 }} />
                    <span style={{ fontSize: '0.98rem', color: '#bfc8e6', marginLeft: 2 }}>잠김</span>
                  </>
                )}
                {!isLocked && (
                  <FaUnlock className="text-[#6C8EFF]" style={{ marginLeft: 16, marginRight: 10 }} />
                )}
                챕터 {chapter}
                {isLocked && (
                  <span style={{
                    fontSize: '0.93rem',
                    color: '#bfc8e6',
                    marginLeft: 8,
                    background: '#f0f2f7',
                    border: '1px solid #e7eaf7',
                    borderRadius: 6,
                    padding: '2px 8px',
                    marginTop: 2,
                    display: 'inline-block',
                  }}>
                    아직 읽지 않은 챕터입니다
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TimelineControls; 
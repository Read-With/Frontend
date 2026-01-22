import React from 'react';
import PropTypes from 'prop-types';
import { sidebarStyles } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/animations';

function ChapterSidebar({
  isSidebarOpen,
  onToggleSidebar,
  chapterList,
  currentChapter,
  onChapterSelect,
}) {
  return (
    <div
      data-testid="chapter-sidebar"
      style={{
        ...sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES),
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        marginTop: 0,
      }}
    >
      <div style={sidebarStyles.header}>
        <button
          onClick={onToggleSidebar}
          style={sidebarStyles.toggleButton(ANIMATION_VALUES)}
          title={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          aria-label={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          aria-expanded={isSidebarOpen}
        >
          {isSidebarOpen ? (
            <span className="material-symbols-outlined">chevron_left</span>
          ) : (
            <span className="material-symbols-outlined">menu</span>
          )}
        </button>
        <span style={sidebarStyles.title(isSidebarOpen, ANIMATION_VALUES)}>챕터 선택</span>
      </div>

      <div style={sidebarStyles.chapterList}>
        {chapterList.map((chapter) => (
          <button
            key={chapter}
            onClick={() => onChapterSelect(chapter)}
            style={sidebarStyles.chapterButton(currentChapter === chapter, isSidebarOpen, ANIMATION_VALUES)}
            title={!isSidebarOpen ? `Chapter ${chapter}` : ''}
            aria-label={`Chapter ${chapter} 선택`}
            aria-pressed={currentChapter === chapter}
          >
            <span style={sidebarStyles.chapterNumber(currentChapter === chapter, ANIMATION_VALUES)}>
              {chapter}
            </span>
            <span style={sidebarStyles.chapterText(isSidebarOpen, ANIMATION_VALUES)}>Chapter {chapter}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

ChapterSidebar.propTypes = {
  isSidebarOpen: PropTypes.bool.isRequired,
  onToggleSidebar: PropTypes.func.isRequired,
  chapterList: PropTypes.arrayOf(PropTypes.number).isRequired,
  currentChapter: PropTypes.number.isRequired,
  onChapterSelect: PropTypes.func.isRequired,
};

export default ChapterSidebar;

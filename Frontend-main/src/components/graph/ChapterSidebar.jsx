import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { sidebarStyles } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/styles';
import { GRAPH_LAYOUT_CONSTANTS, getChapterTitleParts } from './graphShared';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';

function manifestBookTitle(manifestBookId, manifestHint) {
  if (manifestHint && typeof manifestHint === 'object') {
    const t = String(manifestHint?.book?.title ?? manifestHint?.title ?? '').trim();
    if (t) return t;
  }
  if (manifestBookId == null) return '';
  const m = getManifestFromCache(manifestBookId);
  return String(m?.book?.title ?? m?.title ?? '').trim();
}

function rowChapterLabels(manifestBookId, idx, bookTitle, manifestHint) {
  const idxStr = Number.isFinite(idx) && idx >= 1 ? String(idx) : '—';
  const { raw, display } = getChapterTitleParts(manifestBookId, idx, bookTitle, manifestHint);
  if (!display) {
    return {
      display: `제${idxStr}장`,
      tooltip: manifestBookId == null || !Number.isFinite(idx) || idx < 1 ? idxStr : `챕터 ${idxStr}`,
    };
  }
  return {
    display,
    tooltip: `챕터 ${idxStr} — ${raw}`,
  };
}

function ChapterSidebar({
  isSidebarOpen,
  onToggleSidebar,
  chapterList,
  currentChapter,
  onChapterSelect,
  manifestBookId = null,
  manifestHint = null,
}) {
  const bookTitle = useMemo(
    () => manifestBookTitle(manifestBookId, manifestHint),
    [manifestBookId, manifestHint],
  );
  const { OPEN_WIDTH: sidebarOpenW, CLOSED_WIDTH: sidebarClosedW } = GRAPH_LAYOUT_CONSTANTS.SIDEBAR;

  const chapterItems = useMemo(
    () => chapterList.map((chapter) => {
      const { display: label, tooltip } = rowChapterLabels(
        manifestBookId,
        chapter,
        bookTitle,
        manifestHint,
      );
      return { chapter, label, tooltip };
    }),
    [chapterList, manifestBookId, bookTitle, manifestHint],
  );

  return (
    <div
      data-testid="chapter-sidebar"
      style={{
        ...sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES),
        width: isSidebarOpen ? `${sidebarOpenW}px` : `${sidebarClosedW}px`,
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
        {chapterItems.map(({ chapter, label, tooltip }) => {
          return (
            <button
              key={chapter}
              onClick={() => onChapterSelect(chapter)}
              style={sidebarStyles.chapterButton(currentChapter === chapter, isSidebarOpen, ANIMATION_VALUES)}
              title={tooltip}
              aria-label={`${label} 선택`}
              aria-pressed={currentChapter === chapter}
            >
              <span style={sidebarStyles.chapterNumber(currentChapter === chapter, ANIMATION_VALUES)}>
                {chapter}
              </span>
              <span
                style={{
                  ...sidebarStyles.chapterText(isSidebarOpen, ANIMATION_VALUES),
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
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
  manifestBookId: PropTypes.number,
  manifestHint: PropTypes.object,
};

export default ChapterSidebar;

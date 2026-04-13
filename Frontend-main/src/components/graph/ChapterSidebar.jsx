import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { sidebarStyles } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/animations';
import { getChapterData, getManifestFromCache } from '../../utils/common/cache/manifestCache';
import {
  formatChapterBadgeFromTitle,
  formatChapterTocNumericLine,
  stripRedundantBookTitlePrefix,
} from '../../utils/viewer/chapterTitleDisplay';

function manifestBookTitle(manifestBookId) {
  if (manifestBookId == null) return '';
  const m = getManifestFromCache(manifestBookId);
  return String(m?.book?.title ?? m?.title ?? '').trim();
}

function rowChapterLabels(manifestBookId, idx, bookTitle) {
  const idxStr = Number.isFinite(idx) && idx >= 1 ? String(idx) : '—';
  if (manifestBookId == null || !Number.isFinite(idx) || idx < 1) {
    return { display: formatChapterTocNumericLine(idxStr, idxStr), tooltip: idxStr };
  }
  const ch = getChapterData(manifestBookId, idx);
  const t = String(ch?.title ?? '').trim();
  if (!t) {
    return { display: formatChapterTocNumericLine(idxStr, idxStr), tooltip: idxStr };
  }
  const forBadge = stripRedundantBookTitlePrefix(t, bookTitle);
  const part = formatChapterBadgeFromTitle(forBadge);
  return { display: formatChapterTocNumericLine(part, idxStr), tooltip: t };
}

function ChapterSidebar({
  isSidebarOpen,
  onToggleSidebar,
  chapterList,
  currentChapter,
  onChapterSelect,
  manifestBookId = null,
}) {
  const bookTitle = useMemo(() => manifestBookTitle(manifestBookId), [manifestBookId]);

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
        {chapterList.map((chapter) => {
          const { display: label, tooltip } = rowChapterLabels(manifestBookId, chapter, bookTitle);
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
};

export default ChapterSidebar;

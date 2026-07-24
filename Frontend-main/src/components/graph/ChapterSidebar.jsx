import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { buildChapterSidebarItems } from '../../utils/graph/graphCore.js';
import { useIsNarrowViewport } from '../../hooks/graph/useGraphViewState.js';
import './RelationGraph.css';

function buildChapterRowMeta({ selected, reading, noGraph }) {
  const parts = [];
  if (selected) parts.push('그래프 보는 중');
  else if (reading) parts.push('본문 읽는 중');
  if (noGraph) parts.push('관계 데이터 없음');
  return parts.join(' · ');
}

/**
 * 그래프 단독 페이지 왼쪽 챕터 레일/드로어
 */
export default function ChapterSidebar({
  isSidebarOpen,
  onToggleSidebar,
  onCloseSidebar,
  chapterList,
  currentChapter,
  onChapterSelect,
  manifestBookId = null,
  bookTitle = '',
  manifestHint = null,
  userCurrentChapter = null,
}) {
  const isNarrow = useIsNarrowViewport();
  const listRef = useRef(null);
  const selectedRef = useRef(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  const chapterItems = useMemo(
    () => buildChapterSidebarItems(chapterList, manifestBookId, bookTitle, manifestHint),
    [chapterList, manifestBookId, bookTitle, manifestHint]
  );

  useEffect(() => {
    if (!isSidebarOpen) return;
    const el = selectedRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [currentChapter, isSidebarOpen, chapterItems]);

  useEffect(() => {
    setFocusIndex(-1);
  }, [isSidebarOpen]);

  const selectChapter = useCallback(
    (chapter) => {
      onChapterSelect?.(chapter);
      if (isNarrow) onCloseSidebar?.();
    },
    [isNarrow, onChapterSelect, onCloseSidebar]
  );

  const onListKeyDown = useCallback(
    (event) => {
      if (!chapterItems.length) return;
      const max = chapterItems.length - 1;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusIndex((i) => (i < 0 ? 0 : Math.min(max, i + 1)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusIndex((i) => (i < 0 ? max : Math.max(0, i - 1)));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setFocusIndex(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setFocusIndex(max);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const idx =
          focusIndex >= 0
            ? focusIndex
            : chapterItems.findIndex((it) => it.chapter === currentChapter);
        const item = chapterItems[idx];
        if (!item) return;
        event.preventDefault();
        selectChapter(item.chapter);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isSidebarOpen) onToggleSidebar?.();
      }
    },
    [chapterItems, focusIndex, currentChapter, selectChapter, isSidebarOpen, onToggleSidebar]
  );

  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return;
    const option = listRef.current.querySelector(`[data-focus-index="${focusIndex}"]`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const toggleLabel = isSidebarOpen ? '챕터 목록 접기' : '챕터 목록 펼치기';
  const railClass = [
    'graph-chapter-rail',
    isSidebarOpen ? 'is-open' : 'is-collapsed',
    isNarrow ? 'is-narrow' : 'is-wide',
  ].join(' ');

  return (
    <>
      {isNarrow && isSidebarOpen ? (
        <button
          type="button"
          className="graph-chapter-rail-scrim"
          aria-label="챕터 목록 닫기"
          onClick={() => onCloseSidebar?.() ?? onToggleSidebar?.()}
        />
      ) : null}

      {isNarrow && !isSidebarOpen ? (
        <button
          type="button"
          className="graph-chapter-rail-fab"
          onClick={onToggleSidebar}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={false}
        >
          <span className="material-symbols-outlined" aria-hidden>
            menu_book
          </span>
        </button>
      ) : null}

      <aside
        data-testid="chapter-sidebar"
        className={railClass}
        aria-label="챕터 목록"
      >
        <div className="graph-chapter-rail-header">
          <button
            type="button"
            className="graph-chapter-rail-toggle"
            onClick={onToggleSidebar}
            title={toggleLabel}
            aria-label={toggleLabel}
            aria-expanded={isSidebarOpen}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {isSidebarOpen ? 'chevron_left' : 'chevron_right'}
            </span>
          </button>
          {isSidebarOpen ? (
            <div className="graph-chapter-rail-heading">
              <span className="graph-chapter-rail-title">챕터</span>
              {bookTitle ? (
                <span className="graph-chapter-rail-book" title={bookTitle}>
                  {bookTitle}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          ref={listRef}
          className="graph-chapter-rail-list"
          role="listbox"
          aria-label="챕터 목록"
          tabIndex={0}
          onKeyDown={onListKeyDown}
        >
          {chapterItems.map((item, index) => {
            const selected = item.chapter === currentChapter;
            const reading = userCurrentChapter != null && item.chapter === userCurrentChapter;
            const noGraph = item.hasGraph === false;
            const focused = focusIndex === index;
            const meta = buildChapterRowMeta({
              selected,
              reading,
              noGraph,
            });
            const statusHint = [
              selected ? '그래프 보는 중' : null,
              !selected && reading ? '본문 읽는 중' : null,
              noGraph ? '관계 데이터 없음' : null,
            ]
              .filter(Boolean)
              .join(', ');

            return (
              <button
                key={item.chapter}
                type="button"
                role="option"
                data-focus-index={index}
                ref={selected ? selectedRef : undefined}
                className={[
                  'graph-chapter-rail-item',
                  selected ? 'is-selected' : '',
                  reading ? 'is-reading' : '',
                  noGraph ? 'is-empty' : '',
                  focused ? 'is-focused' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`${item.label}${statusHint ? `, ${statusHint}` : ''} 선택`}
                aria-selected={selected}
                aria-current={selected ? 'page' : undefined}
                onClick={() => selectChapter(item.chapter)}
                onMouseEnter={() => setFocusIndex(index)}
              >
                <span className="graph-chapter-rail-num" aria-hidden>
                  {item.chapter}
                </span>
                {isSidebarOpen ? (
                  <span className="graph-chapter-rail-copy">
                    <span className="graph-chapter-rail-label">{item.label}</span>
                    {meta ? (
                      <span className="graph-chapter-rail-meta">
                        {reading && !selected ? (
                          <span className="graph-chapter-rail-dot is-reading" aria-hidden />
                        ) : null}
                        {meta}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  reading ? (
                    <span className="graph-chapter-rail-dot is-reading is-rail" title="본문 읽는 중" />
                  ) : null
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}

ChapterSidebar.propTypes = {
  isSidebarOpen: PropTypes.bool.isRequired,
  onToggleSidebar: PropTypes.func.isRequired,
  onCloseSidebar: PropTypes.func,
  chapterList: PropTypes.arrayOf(PropTypes.number).isRequired,
  currentChapter: PropTypes.number.isRequired,
  onChapterSelect: PropTypes.func.isRequired,
  manifestBookId: PropTypes.number,
  bookTitle: PropTypes.string,
  manifestHint: PropTypes.object,
  userCurrentChapter: PropTypes.number,
};

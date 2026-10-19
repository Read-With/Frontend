import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { getChapterData } from '../../../utils/common/cache/manifestCache';
import {
  formatChapterOrdinalLabel,
  resolveChapterTitleMeta,
  stripSharedListPrefix,
  stripChapterOrdinalPrefix,
} from '../../../utils/common/chapterLabel';
import { useIsNarrowViewport } from '../../../hooks/common/hooksShared';
import { stepIndex } from '../../../utils/common/valueUtils';
import { joinClasses } from '../../../utils/common/domUtils';
import '../styles/graph.css';

/** 챕터 사이드바 목록용 항목 */
function buildChapterSidebarItems(chapterList, manifestBookId, bookTitle, manifestHint) {
  const rows = chapterList.map((chapter) => {
    const chData =
      manifestBookId != null && Number.isFinite(chapter) && chapter >= 1
        ? getChapterData(manifestBookId, chapter, manifestHint ?? undefined)
        : null;
    const meta = resolveChapterTitleMeta(chData, bookTitle, chapter);
    const events = Array.isArray(chData?.events) ? chData.events : null;
    // manifest에 events가 있을 때만 판정. 없으면 unknown(표시만, dim 안 함)
    const hasGraph = events == null ? null : events.length > 0;
    const fallback = formatChapterOrdinalLabel(chapter);

    return {
      chapter,
      label: meta.display || fallback,
      hasGraph,
    };
  });

  const stripped = stripSharedListPrefix(rows.map((row) => row.label), bookTitle);
  return rows.map((row, index) => {
    const base = stripped[index] || formatChapterOrdinalLabel(row.chapter);
    const label = stripChapterOrdinalPrefix(base, row.chapter) || base;
    return { ...row, label };
  });
}

const META_READING = '본문 읽는 중';
const META_NO_GRAPH = '관계 데이터 없음';

/** 목록 키 → 다음 포커스 인덱스 */
const LIST_NAV_KEYS = {
  ArrowDown: (i, n) => stepIndex(i, n, 1),
  ArrowUp: (i, n) => stepIndex(i, n, -1),
  Home: () => 0,
  End: (_, n) => n - 1,
};

function buildChapterRowMeta({ reading, noGraph }) {
  return [reading && META_READING, noGraph && META_NO_GRAPH].filter(Boolean).join(' · ');
}

const optionId = (chapter) => `chapter-sidebar-option-${chapter}`;

/**
 * listbox 키보드 포커스(aria-activedescendant): 화살표·Home·End 이동, Enter/Space 선택, Escape 닫기.
 * 포커스가 없으면 현재 챕터에서 시작. 레일을 열고 닫으면 포커스 초기화
 */
function useChapterListFocus({ listRef, items, currentChapter, isOpen, onSelect, onEscape }) {
  const [focusIndex, setFocusIndex] = useState(-1);
  const currentIndex = () => items.findIndex((it) => it.chapter === currentChapter);

  useEffect(() => {
    setFocusIndex(-1);
  }, [isOpen]);

  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return;
    listRef.current.querySelector(`[data-focus-index="${focusIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, listRef]);

  const onFocus = () => {
    setFocusIndex((i) => (i >= 0 ? i : Math.max(0, currentIndex())));
  };

  const onKeyDown = (event) => {
    if (!items.length) return;

    const nav = LIST_NAV_KEYS[event.key];
    if (nav) {
      event.preventDefault();
      setFocusIndex((i) => nav(i, items.length));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const item = items[focusIndex >= 0 ? focusIndex : currentIndex()];
      if (!item) return;
      event.preventDefault();
      onSelect(item.chapter);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isOpen) onEscape?.();
    }
  };

  const activeDescendant = items[focusIndex] ? optionId(items[focusIndex].chapter) : undefined;
  return { focusIndex, setFocusIndex, onFocus, onKeyDown, activeDescendant };
}

/** 펼침: 번호 + 제목 + 메타(읽는 중·데이터 없음) / 접힘: 번호 + 읽는 중 점 */
function ChapterRailItem({ item, index, expanded, selected, reading, focused, selectedRef, onSelect, onHover }) {
  const noGraph = item.hasGraph === false;
  const showReading = reading && !selected;
  const meta = buildChapterRowMeta({ reading: showReading, noGraph });

  return (
    <button
      id={optionId(item.chapter)}
      type="button"
      role="option"
      data-focus-index={index}
      ref={selected ? selectedRef : undefined}
      tabIndex={-1}
      className={joinClasses(
        'graph-chapter-rail-item',
        selected && 'is-selected',
        noGraph && 'is-empty',
        focused && 'is-focused',
      )}
      aria-label={`${item.label}${meta ? `, ${meta}` : ''} 선택`}
      aria-selected={selected}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onSelect(item.chapter)}
      onMouseEnter={() => onHover(index)}
    >
      <span className="graph-chapter-rail-num" aria-hidden>
        {item.chapter}
      </span>
      {expanded ? (
        <span className="graph-chapter-rail-copy">
          <span className="graph-chapter-rail-label">{item.label}</span>
          {meta ? (
            <span className="graph-chapter-rail-meta">
              {showReading ? <span className="graph-chapter-rail-dot" aria-hidden /> : null}
              {meta}
            </span>
          ) : null}
        </span>
      ) : reading ? (
        <span className="graph-chapter-rail-dot is-rail" title={META_READING} />
      ) : null}
    </button>
  );
}

/** 좁은 화면: 열렸을 땐 배경(scrim), 닫혔을 땐 여는 플로팅 버튼 */
function NarrowRailControls({ isOpen, toggleLabel, onToggle, onClose }) {
  if (isOpen) {
    return (
      <button type="button" className="graph-chapter-rail-scrim" aria-label="챕터 목록 닫기" onClick={onClose} />
    );
  }
  return (
    <button
      type="button"
      className="graph-chapter-rail-fab"
      onClick={onToggle}
      title={toggleLabel}
      aria-label={toggleLabel}
      aria-expanded={false}
    >
      <BookOpen size={20} aria-hidden />
    </button>
  );
}

/**
 * 그래프 단독 페이지 왼쪽 챕터 레일/드로어
 */
/** memo: 그래프 페이지의 검색·툴팁 변경마다 챕터 목록 전체를 다시 렌더하지 않음 */
export default memo(function ChapterSidebar({
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

  const chapterItems = useMemo(
    () => buildChapterSidebarItems(chapterList, manifestBookId, bookTitle, manifestHint),
    [chapterList, manifestBookId, bookTitle, manifestHint]
  );

  // 열 때·챕터가 바뀔 때 선택된 챕터가 보이도록 스크롤
  useEffect(() => {
    const el = selectedRef.current;
    if (!isSidebarOpen || !el) return undefined;
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [currentChapter, isSidebarOpen, chapterItems]);

  const selectChapter = useCallback(
    (chapter) => {
      onChapterSelect?.(chapter);
      if (isNarrow) onCloseSidebar?.();
    },
    [isNarrow, onChapterSelect, onCloseSidebar]
  );

  const listFocus = useChapterListFocus({
    listRef,
    items: chapterItems,
    currentChapter,
    isOpen: isSidebarOpen,
    onSelect: selectChapter,
    onEscape: onToggleSidebar,
  });

  const toggleLabel = isSidebarOpen ? '챕터 목록 접기' : '챕터 목록 펼치기';

  return (
    <>
      {isNarrow ? (
        <NarrowRailControls
          isOpen={isSidebarOpen}
          toggleLabel={toggleLabel}
          onToggle={onToggleSidebar}
          onClose={onCloseSidebar}
        />
      ) : null}

      <aside
        data-testid="chapter-sidebar"
        className={joinClasses(
          'graph-chapter-rail',
          isSidebarOpen ? 'is-open' : 'is-collapsed',
          isNarrow && 'is-narrow',
        )}
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
            {isSidebarOpen ? <ChevronLeft size={20} aria-hidden /> : <ChevronRight size={20} aria-hidden />}
          </button>
          {isSidebarOpen ? <span className="graph-chapter-rail-title">챕터</span> : null}
        </div>

        <div
          ref={listRef}
          className="graph-chapter-rail-list"
          role="listbox"
          aria-label="챕터 목록"
          tabIndex={0}
          onKeyDown={listFocus.onKeyDown}
          onFocus={listFocus.onFocus}
          aria-activedescendant={listFocus.activeDescendant}
        >
          {chapterItems.map((item, index) => (
            <ChapterRailItem
              key={item.chapter}
              item={item}
              index={index}
              expanded={isSidebarOpen}
              selected={item.chapter === currentChapter}
              reading={userCurrentChapter != null && item.chapter === userCurrentChapter}
              focused={listFocus.focusIndex === index}
              selectedRef={selectedRef}
              onSelect={selectChapter}
              onHover={listFocus.setFocusIndex}
            />
          ))}
        </div>
      </aside>
    </>
  );
});

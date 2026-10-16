import { memo, useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useBookmarks } from '../hooks/bookmarkHooks';
import {
  bookmarkBorders,
  colorOptions,
  getColorKey,
  parseBookmarkLocation,
  formatBookmarkLocatorDetail,
  bookmarkToResumeAnchor,
  groupBookmarksByChapter,
} from '../utils/bookmarkUtils';
import { userViewerPath, userViewerBookmarksPath, userViewerReadingPath } from '../utils/common/urlUtils';
import { resolveChapterIndex, errorUtils, formatRelativeTime, truncateWithEllipsis } from '../utils/common/valueUtils';
import { resolveServerBookId } from '../utils/common/bookNormalize';
import { formatChapterOrdinalLabel } from '../utils/common/chapterLabel';
import ConfirmDialog from '../components/common/ConfirmDialog';
import './BookmarksPage.css';

const sameId = (a, b) => String(a) === String(b);

const getHighlightSnippet = (bookmark) => {
  const text = bookmark?.highlightText || bookmark?.textSnippet;
  return truncateWithEllipsis(text, 180);
};

const parseMemoEntries = (memo) =>
  typeof memo === 'string' && memo
    ? memo.split('\n').map((e) => e.trim()).filter(Boolean)
    : [];

const serializeMemoEntries = (entries) =>
  (entries || []).map((e) => e.trim()).filter(Boolean).join('\n');


/** 검색 대상 문자열: 위치·메모·구절·챕터 표기 */
function buildBookmarkHaystack(bookmark, serverBookId) {
  const chapter = resolveChapterIndex(bookmark.startLocator);
  return [
    parseBookmarkLocation(bookmark, serverBookId),
    formatBookmarkLocatorDetail(bookmark, serverBookId),
    bookmark.memo,
    bookmark.highlightText,
    bookmark.textSnippet,
    bookmark.chapterTitle,
    chapter != null ? `${formatChapterOrdinalLabel(chapter)} 챕터 ${chapter} 제${chapter}장` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function resolveStateBookTitle(book) {
  const raw = book?.title || book?.name || book?.bookTitle;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * 툴바 실제 높이를 --bm-toolbar-height 로 동기화 (sticky 오프셋용).
 * callback ref라 툴바가 붙는 순간에만 관찰 — 로딩·오류 분기를 deps로 넘길 필요 없음 (React 19 ref cleanup)
 */
const syncToolbarHeightRef = (toolbar) => {
  const page = toolbar?.closest('.bm-page');
  if (!page) return undefined;

  const syncToolbarHeight = () => {
    const next = `${Math.ceil(toolbar.getBoundingClientRect().height)}px`;
    if (page.style.getPropertyValue('--bm-toolbar-height') !== next) {
      page.style.setProperty('--bm-toolbar-height', next);
    }
  };

  syncToolbarHeight();
  const observer = new ResizeObserver(syncToolbarHeight);
  observer.observe(toolbar);
  window.addEventListener('resize', syncToolbarHeight);
  window.addEventListener('orientationchange', syncToolbarHeight);

  return () => {
    observer.disconnect();
    window.removeEventListener('resize', syncToolbarHeight);
    window.removeEventListener('orientationchange', syncToolbarHeight);
  };
};

const onEnter = (handler) => (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handler();
  }
};

const stopRow = (e) => e.stopPropagation();

function PagePanel({ title, description, children }) {
  return (
    <div className="bm-page">
      <div className="bm-shell bm-shell--narrow">
        <div className="bm-panel">
          <p className="bm-panel-title">{title}</p>
          <p className="bm-panel-desc">{description}</p>
          <div className="bm-panel-actions">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MemoEntry({ entry, isEditing, editText, disabled, actions }) {
  if (isEditing) {
    return (
      <>
        <input
          className="bm-input"
          value={editText}
          onChange={(e) => actions.changeEditText(e.target.value)}
          onKeyDown={onEnter(actions.saveEdit)}
          autoFocus
          disabled={disabled}
          placeholder="비우면 메모가 삭제됩니다"
        />
        <button type="button" className="bm-btn bm-btn-primary" disabled={disabled} onClick={actions.saveEdit}>
          저장
        </button>
        <button type="button" className="bm-btn bm-btn-ghost" disabled={disabled} onClick={actions.cancelEdit}>
          취소
        </button>
      </>
    );
  }
  return (
    <>
      <span className="bm-memo-text">{entry}</span>
      <button type="button" className="bm-btn-text" disabled={disabled} onClick={actions.startEdit}>
        수정
      </button>
      <button
        type="button"
        className="bm-btn-text bm-btn-text-danger"
        disabled={disabled}
        onClick={actions.deleteEntry}
      >
        삭제
      </button>
    </>
  );
}

/** 펼쳐진 행의 메모·색상 패널. editing·composerText는 이 행에만 속함 (null = 닫힘) */
function BookmarkPanel({ bookmark, colorKey, memoEntries, editing, composerText, isMutating, actions }) {

  return (
    <div className="bm-row-panel" onClick={stopRow}>
      <div className="bm-memo-block">
        <div className="bm-memo-list">
          {memoEntries.length > 0 ? (
            memoEntries.map((entry, entryIndex) => (
              <div key={`${bookmark.id}-memo-${entryIndex}`} className="bm-memo-entry">
                <MemoEntry
                  entry={entry}
                  isEditing={editing?.entryIndex === entryIndex}
                  editText={editing?.text ?? ''}
                  disabled={isMutating}
                  actions={{
                    changeEditText: actions.changeEditText,
                    saveEdit: actions.saveEdit,
                    cancelEdit: actions.cancelEdit,
                    startEdit: () => actions.startEdit(entryIndex, entry),
                    deleteEntry: () => actions.deleteEntry(bookmark.id, entryIndex),
                  }}
                />
              </div>
            ))
          ) : (
            <span className="bm-memo-empty">메모가 비어 있습니다.</span>
          )}
        </div>

        {composerText != null ? (
          <div className="bm-memo-composer">
            <input
              className="bm-input"
              value={composerText}
              onChange={(e) => actions.changeComposerText(e.target.value)}
              onKeyDown={onEnter(() => actions.addMemo(bookmark.id))}
              placeholder="메모를 입력하세요"
              disabled={isMutating}
            />
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              disabled={isMutating}
              onClick={() => actions.addMemo(bookmark.id)}
            >
              추가
            </button>
            <button type="button" className="bm-btn bm-btn-ghost" disabled={isMutating} onClick={actions.closeComposer}>
              닫기
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="bm-btn-text bm-btn-memo-add"
            disabled={isMutating}
            onClick={actions.openComposer}
          >
            메모 추가
          </button>
        )}
      </div>

      <div className="bm-row-footer">
        <div className="bm-color-row" role="group" aria-label="북마크 색상">
          <span className="bm-color-label">색상</span>
          {colorOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`bm-color-swatch${colorKey === option.key ? ' is-active' : ''}`}
              title={option.label}
              disabled={isMutating}
              aria-label={option.label}
              aria-pressed={colorKey === option.key}
              style={{
                '--bm-swatch-bg': option.color,
                '--bm-swatch-border': option.border,
              }}
              onClick={() => actions.setColor(bookmark.id, option.color)}
            />
          ))}
        </div>

        <button
          type="button"
          className="bm-btn-danger"
          disabled={isMutating}
          onClick={() => actions.requestDelete(bookmark.id)}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

/** memo: 메모 입력 중에는 펼쳐진 행만 다시 렌더 (다른 행의 위치 라벨·메모 파싱 반복 방지) */
const BookmarkRow = memo(function BookmarkRow({ bookmark, serverBookId, isExpanded, isMutating, onOpen, onToggle, renderPanel }) {
  const colorKey = getColorKey(bookmark.color);
  const highlight = getHighlightSnippet(bookmark);
  const memoEntries = parseMemoEntries(bookmark.memo);
  const created = bookmark.createdAt || bookmark.created_at;
  const locationLabel = parseBookmarkLocation(bookmark, serverBookId);
  const memoExtra = memoEntries.length > 1 ? memoEntries.length - 1 : 0;

  return (
    <article
      className={`bm-row${isExpanded ? ' is-expanded' : ''}`}
      style={{ '--bm-accent-bar': bookmarkBorders[colorKey] }}
    >
      <div className="bm-row-main">
        <button
          type="button"
          className="bm-row-open"
          aria-label={`${locationLabel || '북마크'} 본문으로 이동`}
          onClick={() => onOpen(bookmark)}
        />
        <span className="bm-row-accent" aria-hidden="true" />
        <div className="bm-row-body">
          <p className={`bm-quote${highlight ? '' : ' is-empty'}`}>
            {highlight || '표시할 구절 없음'}
          </p>
          <div className="bm-row-meta">
            {locationLabel ? <span>{locationLabel}</span> : null}
            {locationLabel && created ? <span className="bm-meta-dot">·</span> : null}
            {created ? <time dateTime={created}>{formatRelativeTime(created)}</time> : null}
          </div>
          {memoEntries.length > 0 && !isExpanded ? (
            <p className="bm-memo-preview">
              <span className="bm-memo-preview-text">{memoEntries[0] || ''}</span>
              {memoExtra > 0 ? <span className="bm-memo-extra">+{memoExtra}</span> : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="bm-row-more"
          aria-label={isExpanded ? '메모·색상 닫기' : '메모·색상 열기'}
          aria-expanded={isExpanded}
          disabled={isMutating}
          onClick={(e) => {
            stopRow(e);
            onToggle(bookmark.id);
          }}
        >
          <span aria-hidden="true">{isExpanded ? '−' : '⋯'}</span>
        </button>
      </div>

      {isExpanded ? renderPanel({ bookmark, colorKey, memoEntries }) : null}
    </article>
  );
});

function BookmarksEmpty({ isFiltered, onClearSearch, onBackToViewer }) {
  return (
    <div className="bm-empty">
      <p className="bm-empty-title">
        {isFiltered ? '검색 결과가 없습니다' : '저장된 북마크가 없습니다'}
      </p>
      <p className="bm-empty-desc">
        {isFiltered ? '다른 검색어로 다시 찾아보세요.' : '뷰어에서 구절을 표시하면 여기에 모입니다.'}
      </p>
      <div className="bm-panel-actions">
        {isFiltered ? (
          <button type="button" className="bm-btn bm-btn-ghost" onClick={onClearSearch}>
            검색 지우기
          </button>
        ) : (
          <button type="button" className="bm-btn bm-btn-primary" onClick={onBackToViewer}>
            뷰어로 돌아가기
          </button>
        )}
      </div>
    </div>
  );
}

function ChapterToc({ groups, onJump }) {
  return (
    <nav className="bm-toc" aria-label="챕터로 이동">
      <p className="bm-toc-heading">챕터</p>
      <ul className="bm-toc-list">
        {groups.map((group) => (
          <li key={group.key}>
            <button type="button" className="bm-toc-item" onClick={() => onJump(group.key)}>
              <span className="bm-toc-label">{group.label}</span>
              {group.title ? <span className="bm-toc-title">{group.title}</span> : null}
              <span className="bm-toc-count">{group.items.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function scrollToChapter(chapterKey) {
  const el = document.getElementById(`bm-chapter-${chapterKey}`);
  if (!el) return;
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

const BookmarksPage = () => {
  const { filename } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const cleanFilename = filename ? filename.replace(/^\//, '') : null;

  const serverBookId = useMemo(
    () => resolveServerBookId(location.state?.book, cleanFilename),
    [location.state?.book, cleanFilename]
  );

  const viewerPath = useMemo(
    () => (serverBookId != null ? userViewerPath(serverBookId) : '/mypage'),
    [serverBookId]
  );

  const [sortOrder, setSortOrder] = useState('recent');
  const [searchTerm, setSearchTerm] = useState('');
  // 메모 작성(composerText)·수정(editing)은 펼쳐진 행(expandedId)에만 존재 — null이면 닫힘
  const [expandedId, setExpandedId] = useState(null);
  const [composerText, setComposerText] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const toggleExpanded = useCallback((bookmarkId) => {
    setExpandedId((prev) => (prev != null && sameId(prev, bookmarkId) ? null : bookmarkId));
    setEditing(null);
    setComposerText(null);
  }, []);

  const collapseRow = (bookmarkId) => {
    if (expandedId == null || !sameId(expandedId, bookmarkId)) return;
    setExpandedId(null);
    setEditing(null);
    setComposerText(null);
  };

  useEffect(() => {
    if (serverBookId == null || !cleanFilename) return;
    const path = userViewerBookmarksPath(serverBookId);
    if (!path) return;
    if (String(cleanFilename) === String(serverBookId)) return;
    navigate(path, {
      replace: true,
      state: location.state,
    });
  }, [serverBookId, cleanFilename, navigate, location.state]);

  const {
    bookmarks,
    loading,
    loadError,
    isMutating,
    fetchBookmarks,
    removeBookmark,
    patchBookmark,
  } = useBookmarks(serverBookId);

  // 검색 문자열은 목록이 바뀔 때만 생성 — 키 입력마다 locator 파싱·포맷 반복하지 않음
  const bookmarkHaystacks = useMemo(
    () => (bookmarks || []).map((bookmark) => buildBookmarkHaystack(bookmark, serverBookId)),
    [bookmarks, serverBookId]
  );

  const filteredBookmarks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return bookmarks || [];
    return (bookmarks || []).filter((_, i) => bookmarkHaystacks[i].includes(term));
  }, [bookmarks, bookmarkHaystacks, searchTerm]);

  const chapterGroups = useMemo(
    () => groupBookmarksByChapter(filteredBookmarks, sortOrder, serverBookId),
    [filteredBookmarks, sortOrder, serverBookId]
  );

  const isFilteredView = searchTerm.trim().length > 0;
  const bookTitle = useMemo(() => resolveStateBookTitle(location.state?.book), [location.state?.book]);
  const bookmarkCount = (bookmarks ?? []).length;

  const goViewer = useCallback(
    (path, stateExtra = {}) => {
      const bookFromState = location.state?.book;
      const bookFallback =
        serverBookId != null ? { id: serverBookId, _bookId: serverBookId } : null;
      navigate(path || viewerPath, {
        state: {
          ...(location.state || {}),
          book: bookFromState || bookFallback,
          ...stateExtra,
        },
      });
    },
    [navigate, viewerPath, location.state, serverBookId]
  );

  const handleOpenBookmark = useCallback(
    (bookmark) => {
      const resumeAnchor = bookmarkToResumeAnchor(bookmark);
      if (!resumeAnchor) {
        errorUtils.logWarning('BookmarksPage', '북마크 위치 해석 실패', {
          action: 'open',
          bookId: serverBookId,
          bookmarkId: bookmark?.id,
        });
        toast.error('이 북마크의 위치를 찾을 수 없습니다.');
        return;
      }
      const chapter = resolveChapterIndex(resumeAnchor.startLocator) ?? 1;
      const path =
        serverBookId != null
          ? userViewerReadingPath(serverBookId, chapter, 1)
          : viewerPath;
      goViewer(path, { resumeAnchor });
    },
    [serverBookId, goViewer, viewerPath]
  );

  const updateMemoEntries = useCallback(
    async (bookmarkId, updater) => {
      if (isMutating) return { success: false };
      const target = (bookmarks || []).find((b) => sameId(b.id, bookmarkId));
      const next = updater(parseMemoEntries(target?.memo));
      return patchBookmark(bookmarkId, { memo: serializeMemoEntries(next) });
    },
    [bookmarks, isMutating, patchBookmark]
  );

  const handleDeleteBookmark = async (bookmarkId) => {
    if (isMutating) return;
    collapseRow(bookmarkId);
    await removeBookmark(bookmarkId);
    setDeleteConfirmId(null);
  };

  const handleAddMemo = async (bookmarkId) => {
    const text = (composerText ?? '').trim();
    if (!text) return;
    const result = await updateMemoEntries(bookmarkId, (entries) => [...entries, text]);
    if (result.success) setComposerText(null);
  };

  const handleEditMemoSave = async () => {
    if (expandedId == null || editing == null) return;
    const { entryIndex, text } = editing;
    const trimmed = text.trim();
    const result = await updateMemoEntries(expandedId, (entries) => {
      if (entryIndex < 0 || entryIndex >= entries.length) return entries;
      if (!trimmed) return entries.filter((_, i) => i !== entryIndex);
      const next = [...entries];
      next[entryIndex] = trimmed;
      return next;
    });
    if (result.success) setEditing(null);
  };

  const handleDeleteMemoEntry = async (bookmarkId, entryIndex) => {
    const result = await updateMemoEntries(bookmarkId, (entries) =>
      entries.filter((_, i) => i !== entryIndex)
    );
    if (result.success && editing?.entryIndex === entryIndex) setEditing(null);
  };

  const memoActions = {
    changeEditText: (text) => setEditing((prev) => (prev ? { ...prev, text } : prev)),
    saveEdit: handleEditMemoSave,
    cancelEdit: () => setEditing(null),
    startEdit: (entryIndex, text) => {
      setComposerText(null);
      setEditing({ entryIndex, text });
    },
    deleteEntry: handleDeleteMemoEntry,
    changeComposerText: setComposerText,
    addMemo: handleAddMemo,
    closeComposer: () => setComposerText(null),
    openComposer: () => {
      setEditing(null);
      setComposerText('');
    },
    setColor: (bookmarkId, color) => {
      if (!isMutating) patchBookmark(bookmarkId, { color });
    },
    requestDelete: setDeleteConfirmId,
  };

  // 매 렌더 새 함수 — 펼쳐진 행에만 넘겨 접힌 행의 memo가 깨지지 않게 함
  const renderPanel = ({ bookmark, colorKey, memoEntries }) => (
    <BookmarkPanel
      bookmark={bookmark}
      colorKey={colorKey}
      memoEntries={memoEntries}
      editing={editing}
      composerText={composerText}
      isMutating={isMutating}
      actions={memoActions}
    />
  );

  if (serverBookId == null) {
    return (
      <PagePanel
        title="유효한 책 정보를 찾을 수 없습니다"
        description="북마크는 숫자 bookId가 필요합니다. 서재에서 책을 다시 열어 주세요."
      >
        <button type="button" className="bm-btn bm-btn-primary" onClick={() => navigate('/mypage')}>
          서재로 이동
        </button>
      </PagePanel>
    );
  }

  if (loading) {
    return (
      <div className="bm-page bm-page--center">
        <div className="bm-shell bm-shell--narrow">
          <div className="bm-status" role="status" aria-live="polite">
            북마크를 불러오는 중...
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <PagePanel title="북마크를 불러오지 못했습니다" description={loadError}>
        <button type="button" className="bm-btn bm-btn-primary" onClick={() => fetchBookmarks()}>
          다시 시도
        </button>
        <button type="button" className="bm-btn bm-btn-ghost" onClick={() => goViewer()}>
          뷰어로 돌아가기
        </button>
      </PagePanel>
    );
  }

  return (
    <div className="bm-page">
      <div className={`bm-shell${chapterGroups.length > 0 ? '' : ' bm-shell--narrow'}`}>
        <header className="bm-header">
          <div className="bm-header-left">
            <div className="bm-header-copy">
              {bookTitle ? <p className="bm-eyebrow">북마크</p> : null}
              <h1 className="bm-title">{bookTitle || '북마크'}</h1>
            </div>
            <span className="bm-count">{bookmarkCount}개</span>
          </div>
        </header>

        <div className="bm-toolbar" ref={syncToolbarHeightRef}>
          <input
            className="bm-search-input"
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="메모·위치·구절 검색"
            aria-label="북마크 검색"
          />
          <div className="bm-toolbar-actions">
            <div className="bm-sort">
              <label className="bm-sort-label" htmlFor="bm-sort-select">
                정렬
              </label>
              <select
                id="bm-sort-select"
                className="bm-sort-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                aria-label="북마크 정렬"
                disabled={isMutating}
              >
                <option value="recent">최신순</option>
                <option value="oldest">오래된순</option>
                <option value="position">위치순</option>
              </select>
            </div>
            <button type="button" className="bm-btn-back" onClick={() => goViewer()}>
              뷰어로
            </button>
          </div>
        </div>

        {chapterGroups.length === 0 ? (
          <BookmarksEmpty
            isFiltered={isFilteredView}
            onClearSearch={() => setSearchTerm('')}
            onBackToViewer={() => goViewer()}
          />
        ) : (
          <div className="bm-body">
            <ChapterToc groups={chapterGroups} onJump={scrollToChapter} />

            <div className="bm-chapters">
              {chapterGroups.map((group) => (
                <section
                  key={group.key}
                  id={`bm-chapter-${group.key}`}
                  className="bm-chapter"
                >
                  <header className="bm-chapter-head">
                    <h2 className="bm-chapter-label">{group.label}</h2>
                    {group.title ? <span className="bm-chapter-title">{group.title}</span> : null}
                    <span className="bm-chapter-count">{group.items.length}</span>
                  </header>
                  <div className="bm-chapter-list">
                    {group.items.map((bookmark) => {
                      if (!bookmark) return null;
                      const isExpanded = expandedId != null && sameId(expandedId, bookmark.id);
                      return (
                        <BookmarkRow
                          key={bookmark.id}
                          bookmark={bookmark}
                          serverBookId={serverBookId}
                          isExpanded={isExpanded}
                          isMutating={isMutating}
                          onOpen={handleOpenBookmark}
                          onToggle={toggleExpanded}
                          renderPanel={isExpanded ? renderPanel : null}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirmId != null}
        busy={isMutating}
        title="북마크를 삭제할까요?"
        message="메모가 있다면 함께 삭제되며, 되돌릴 수 없습니다."
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => handleDeleteBookmark(deleteConfirmId)}
      />
    </div>
  );
};

export default BookmarksPage;

import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useBookmarks } from '../hooks/bookmarks/bookmarkHooks';
import {
  bookmarkBorders,
  colorOptions,
  getColorKey,
  formatRelativeTime,
  parseBookmarkLocation,
  formatBookmarkLocatorDetail,
  bookmarkToResumeAnchor,
  resolveBookmarkApiBookId,
  groupBookmarksByChapter,
} from '../utils/bookmarks/bookmarkUtils';
import { userViewerPath, userViewerBookmarksPath, userViewerReadingPath, errorUtils } from '../utils/common/urlUtils';
import { resolveChapterIndex } from '../utils/common/valueUtils';
import { formatFallbackChapterLabel } from '../utils/viewer/viewerCore';
import './BookmarksPage.css';

const sameId = (a, b) => String(a) === String(b);

const getHighlightSnippet = (bookmark) => {
  const text = bookmark?.highlightText || bookmark?.textSnippet;
  if (!text) return '';
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
};

const parseMemoEntries = (memo) =>
  typeof memo === 'string' && memo
    ? memo.split('\n').map((e) => e.trim()).filter(Boolean)
    : [];

const serializeMemoEntries = (entries) =>
  (entries || []).map((e) => e.trim()).filter(Boolean).join('\n');

const EMPTY_EDIT = { bookmarkId: null, entryIndex: null, text: '' };

const BookmarksPage = () => {
  const { filename } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const cleanFilename = filename ? filename.replace(/^\//, '') : null;

  const apiBookId = useMemo(
    () => resolveBookmarkApiBookId(location.state?.book, cleanFilename),
    [location.state?.book, cleanFilename]
  );

  const viewerPath = useMemo(
    () => (apiBookId != null ? userViewerPath(apiBookId) : '/mypage'),
    [apiBookId]
  );

  const [sortOrder, setSortOrder] = useState('recent');
  const [searchTerm, setSearchTerm] = useState('');
  const [composerId, setComposerId] = useState(null);
  const [composerText, setComposerText] = useState('');
  const [editingMemo, setEditingMemo] = useState(EMPTY_EDIT);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const pageRef = useRef(null);
  const toolbarRef = useRef(null);

  const closeComposer = () => {
    setComposerId(null);
    setComposerText('');
  };

  const collapseRow = (bookmarkId) => {
    if (expandedId != null && sameId(expandedId, bookmarkId)) setExpandedId(null);
    if (composerId != null && sameId(composerId, bookmarkId)) closeComposer();
    if (editingMemo.bookmarkId != null && sameId(editingMemo.bookmarkId, bookmarkId)) {
      setEditingMemo(EMPTY_EDIT);
    }
  };

  useEffect(() => {
    if (apiBookId == null || !cleanFilename) return;
    const path = userViewerBookmarksPath(apiBookId);
    if (!path) return;
    if (String(cleanFilename) === String(apiBookId)) return;
    navigate(path, {
      replace: true,
      state: location.state,
    });
  }, [apiBookId, cleanFilename, navigate, location.state]);

  const {
    bookmarks,
    loading,
    loadError,
    isMutating,
    fetchBookmarks,
    removeBookmark,
    patchBookmark,
  } = useBookmarks(apiBookId);

  const filteredBookmarks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return bookmarks || [];
    return (bookmarks || []).filter((bookmark) => {
      const chapter = resolveChapterIndex(bookmark.startLocator);
      const haystack = [
        parseBookmarkLocation(bookmark, apiBookId),
        formatBookmarkLocatorDetail(bookmark, apiBookId),
        bookmark.memo,
        bookmark.highlightText,
        bookmark.textSnippet,
        bookmark.chapterTitle,
        chapter != null ? `챕터 ${chapter}` : '',
        chapter != null ? formatFallbackChapterLabel(chapter) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [bookmarks, searchTerm, apiBookId]);

  const chapterGroups = useMemo(
    () => groupBookmarksByChapter(filteredBookmarks, sortOrder, apiBookId),
    [filteredBookmarks, sortOrder, apiBookId]
  );

  const isFilteredView = searchTerm.trim().length > 0;

  const bookTitle = useMemo(() => {
    const book = location.state?.book;
    const raw = book?.title || book?.name || book?.bookTitle;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }, [location.state?.book]);

  const bookmarkCount = (bookmarks ?? []).length;

  const goViewer = useCallback(
    (path, stateExtra = {}) => {
      const bookFromState = location.state?.book;
      const bookFallback =
        apiBookId != null ? { id: apiBookId, _bookId: apiBookId } : null;
      navigate(path || viewerPath, {
        state: {
          ...(location.state || {}),
          book: bookFromState || bookFallback,
          ...stateExtra,
        },
      });
    },
    [navigate, viewerPath, location.state, apiBookId]
  );

  const handleOpenBookmark = useCallback(
    (bookmark) => {
      const resumeAnchor = bookmarkToResumeAnchor(bookmark);
      if (!resumeAnchor) {
        errorUtils.logWarning('BookmarksPage', '북마크 위치 해석 실패', {
          action: 'open',
          bookId: apiBookId,
          bookmarkId: bookmark?.id,
        });
        toast.error('이 북마크의 위치를 찾을 수 없습니다.');
        return;
      }
      const chapter = resolveChapterIndex(resumeAnchor.startLocator) ?? 1;
      const path =
        apiBookId != null
          ? userViewerReadingPath(apiBookId, chapter, 1)
          : viewerPath;
      goViewer(path, { resumeAnchor });
    },
    [apiBookId, goViewer, viewerPath]
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

  useEffect(() => {
    if (!deleteConfirmId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDeleteConfirmId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteConfirmId]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const toolbar = toolbarRef.current;
    if (!page || !toolbar) return undefined;

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
  }, [loading, loadError, apiBookId]);

  const handleAddMemo = async (bookmarkId) => {
    const text = composerText.trim();
    if (!text) return;
    const result = await updateMemoEntries(bookmarkId, (entries) => [...entries, text]);
    if (result.success) closeComposer();
  };

  const handleEditMemoSave = async () => {
    const { bookmarkId, entryIndex, text } = editingMemo;
    if (bookmarkId == null || entryIndex == null) return;
    const trimmed = text.trim();
    const result = await updateMemoEntries(bookmarkId, (entries) => {
      if (entryIndex < 0 || entryIndex >= entries.length) return entries;
      if (!trimmed) return entries.filter((_, i) => i !== entryIndex);
      const next = [...entries];
      next[entryIndex] = trimmed;
      return next;
    });
    if (result.success) setEditingMemo(EMPTY_EDIT);
  };

  const handleDeleteMemoEntry = async (bookmarkId, entryIndex) => {
    const result = await updateMemoEntries(bookmarkId, (entries) =>
      entries.filter((_, i) => i !== entryIndex)
    );
    if (
      result.success &&
      editingMemo.bookmarkId != null &&
      sameId(editingMemo.bookmarkId, bookmarkId) &&
      editingMemo.entryIndex === entryIndex
    ) {
      setEditingMemo(EMPTY_EDIT);
    }
  };

  const stopRow = (e) => e.stopPropagation();

  const toggleExpanded = (bookmarkId) => {
    setExpandedId((prev) => (prev != null && sameId(prev, bookmarkId) ? null : bookmarkId));
    setEditingMemo(EMPTY_EDIT);
    closeComposer();
  };

  const scrollToChapter = useCallback((chapterKey) => {
    const el = document.getElementById(`bm-chapter-${chapterKey}`);
    if (!el) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const renderBookmark = (bookmark) => {
    if (!bookmark) return null;
    const colorKey = getColorKey(bookmark.color);
    const highlight = getHighlightSnippet(bookmark);
    const memoEntries = parseMemoEntries(bookmark.memo);
    const isExpanded = expandedId != null && sameId(expandedId, bookmark.id);
    const isComposerOpen = composerId != null && sameId(composerId, bookmark.id);
    const isEditingBookmark =
      editingMemo.bookmarkId != null && sameId(editingMemo.bookmarkId, bookmark.id);
    const created = bookmark.createdAt || bookmark.created_at;
    const locationLabel = parseBookmarkLocation(bookmark, apiBookId);
    const memoPreview = memoEntries[0] || '';
    const memoExtra = memoEntries.length > 1 ? memoEntries.length - 1 : 0;

    return (
      <article
        key={bookmark.id}
        className={`bm-row${isExpanded ? ' is-expanded' : ''}`}
        style={{
          '--bm-accent-bar': bookmarkBorders[colorKey],
        }}
      >
        <div
          className="bm-row-main"
        >
          <button
            type="button"
            className="bm-row-open"
            aria-label={`${locationLabel || '북마크'} 본문으로 이동`}
            onClick={() => handleOpenBookmark(bookmark)}
          />
          <span className="bm-row-accent" aria-hidden="true" />
          <div className="bm-row-body">
            <p className={`bm-quote${highlight ? '' : ' is-empty'}`}>
              {highlight || '표시할 구절 없음'}
            </p>
            <div className="bm-row-meta">
              {locationLabel ? <span>{locationLabel}</span> : null}
              {locationLabel && created ? <span className="bm-meta-dot">·</span> : null}
              {created ? (
                <time dateTime={created}>
                  {formatRelativeTime(created)}
                </time>
              ) : null}
            </div>
            {memoEntries.length > 0 && !isExpanded ? (
              <p className="bm-memo-preview">
                <span className="bm-memo-preview-text">{memoPreview}</span>
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
              toggleExpanded(bookmark.id);
            }}
          >
            <span aria-hidden="true">{isExpanded ? '−' : '⋯'}</span>
          </button>
        </div>

        {isExpanded ? (
          <div className="bm-row-panel" onClick={stopRow}>
            <div className="bm-memo-block">
              <div className="bm-memo-list">
                {memoEntries.length > 0 ? (
                  memoEntries.map((entry, entryIndex) => {
                    const isEditingEntry =
                      isEditingBookmark && editingMemo.entryIndex === entryIndex;
                    return (
                      <div key={`${bookmark.id}-memo-${entryIndex}`} className="bm-memo-entry">
                        {isEditingEntry ? (
                          <>
                            <input
                              className="bm-input"
                              value={editingMemo.text}
                              onChange={(e) =>
                                setEditingMemo((prev) => ({ ...prev, text: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleEditMemoSave();
                                }
                              }}
                              autoFocus
                              disabled={isMutating}
                              placeholder="비우면 메모가 삭제됩니다"
                            />
                            <button
                              type="button"
                              className="bm-btn bm-btn-primary"
                              disabled={isMutating}
                              onClick={handleEditMemoSave}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              className="bm-btn bm-btn-ghost"
                              disabled={isMutating}
                              onClick={() => setEditingMemo(EMPTY_EDIT)}
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="bm-memo-text">{entry}</span>
                            <button
                              type="button"
                              className="bm-btn-text"
                              disabled={isMutating}
                              onClick={() => {
                                closeComposer();
                                setEditingMemo({
                                  bookmarkId: bookmark.id,
                                  entryIndex,
                                  text: entry,
                                });
                              }}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="bm-btn-text bm-btn-text-danger"
                              disabled={isMutating}
                              onClick={() => handleDeleteMemoEntry(bookmark.id, entryIndex)}
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <span className="bm-memo-empty">메모가 비어 있습니다.</span>
                )}
              </div>

              {isComposerOpen ? (
                <div className="bm-memo-composer">
                  <input
                    className="bm-input"
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddMemo(bookmark.id);
                      }
                    }}
                    placeholder="메모를 입력하세요"
                    disabled={isMutating}
                  />
                  <button
                    type="button"
                    className="bm-btn bm-btn-primary"
                    disabled={isMutating}
                    onClick={() => handleAddMemo(bookmark.id)}
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    className="bm-btn bm-btn-ghost"
                    disabled={isMutating}
                    onClick={closeComposer}
                  >
                    닫기
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="bm-btn-text bm-btn-memo-add"
                  disabled={isMutating}
                  onClick={() => {
                    setEditingMemo(EMPTY_EDIT);
                    setComposerId(bookmark.id);
                    setComposerText('');
                  }}
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
                    onClick={() => {
                      if (!isMutating) patchBookmark(bookmark.id, { color: option.color });
                    }}
                  />
                ))}
              </div>

              <button
                type="button"
                className="bm-btn-danger"
                disabled={isMutating}
                onClick={() => setDeleteConfirmId(bookmark.id)}
              >
                삭제
              </button>
            </div>
          </div>
        ) : null}
      </article>
    );
  };

  if (apiBookId == null) {
    return (
      <div className="bm-page" ref={pageRef}>
        <div className="bm-shell bm-shell--narrow">
          <div className="bm-panel">
            <p className="bm-panel-title">유효한 책 정보를 찾을 수 없습니다</p>
            <p className="bm-panel-desc">
              북마크는 숫자 bookId가 필요합니다. 서재에서 책을 다시 열어 주세요.
            </p>
            <div className="bm-panel-actions">
              <button type="button" className="bm-btn bm-btn-primary" onClick={() => navigate('/mypage')}>
                서재로 이동
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bm-page bm-page--center" ref={pageRef}>
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
      <div className="bm-page" ref={pageRef}>
        <div className="bm-shell bm-shell--narrow">
          <div className="bm-panel">
            <p className="bm-panel-title">북마크를 불러오지 못했습니다</p>
            <p className="bm-panel-desc">{loadError}</p>
            <div className="bm-panel-actions">
              <button type="button" className="bm-btn bm-btn-primary" onClick={() => fetchBookmarks()}>
                다시 시도
              </button>
              <button type="button" className="bm-btn bm-btn-ghost" onClick={() => goViewer()}>
                뷰어로 돌아가기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bm-page" ref={pageRef}>
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

        <div className="bm-toolbar" ref={toolbarRef}>
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
          <div className="bm-empty">
            <p className="bm-empty-title">
              {isFilteredView ? '검색 결과가 없습니다' : '저장된 북마크가 없습니다'}
            </p>
            <p className="bm-empty-desc">
              {isFilteredView
                ? '다른 검색어로 다시 찾아보세요.'
                : '뷰어에서 구절을 표시하면 여기에 모입니다.'}
            </p>
            <div className="bm-panel-actions">
              {isFilteredView ? (
                <button
                  type="button"
                  className="bm-btn bm-btn-ghost"
                  onClick={() => setSearchTerm('')}
                >
                  검색 지우기
                </button>
              ) : (
                <button type="button" className="bm-btn bm-btn-primary" onClick={() => goViewer()}>
                  뷰어로 돌아가기
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="bm-body">
            <nav className="bm-toc" aria-label="챕터로 이동">
              <p className="bm-toc-heading">챕터</p>
              <ul className="bm-toc-list">
                {chapterGroups.map((group) => (
                  <li key={group.key}>
                    <button
                      type="button"
                      className="bm-toc-item"
                      onClick={() => scrollToChapter(group.key)}
                    >
                      <span className="bm-toc-label">{group.label}</span>
                      {group.title ? (
                        <span className="bm-toc-title">{group.title}</span>
                      ) : null}
                      <span className="bm-toc-count">{group.items.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

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
                    {group.items.map((bookmark) => renderBookmark(bookmark))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      {deleteConfirmId != null ? (
        <div className="bm-confirm-overlay" role="presentation" onClick={() => setDeleteConfirmId(null)}>
          <div
            className="bm-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bookmark-delete-title"
            aria-describedby="bookmark-delete-desc"
            onClick={stopRow}
          >
            <p id="bookmark-delete-title" className="bm-confirm-title">
              북마크를 삭제할까요?
            </p>
            <p id="bookmark-delete-desc" className="bm-confirm-desc">
              메모가 있다면 함께 삭제되며, 되돌릴 수 없습니다.
            </p>
            <div className="bm-confirm-actions">
              <button
                type="button"
                className="bm-btn bm-btn-ghost"
                onClick={() => setDeleteConfirmId(null)}
                disabled={isMutating}
              >
                취소
              </button>
              <button
                type="button"
                className="bm-btn bm-btn-confirm-delete"
                onClick={() => handleDeleteBookmark(deleteConfirmId)}
                disabled={isMutating}
                autoFocus
              >
                {isMutating ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BookmarksPage;

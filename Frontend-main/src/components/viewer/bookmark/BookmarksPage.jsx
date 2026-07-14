import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useBookmarks } from '../../../hooks/bookmarks/bookmarkHooks';
import {
  bookmarkColors,
  bookmarkBorders,
  colorOptions,
  getColorKey,
  formatRelativeTime,
  formatAbsoluteTime,
  parseBookmarkLocation,
  formatBookmarkLocatorDetail,
  bookmarkToResumeAnchor,
  resolveBookmarkApiBookId,
  sortBookmarks,
} from '../../../utils/bookmarks/bookmarkUtils';
import { userViewerPath, userViewerBookmarksPath, userViewerReadingPath } from '../../../utils/navigation/viewerPaths';
import { resolveChapterIndex } from '../../../utils/common/valueUtils';
import './BookmarksPage.css';

const sameId = (a, b) => String(a) === String(b);

const getHighlightSnippet = (bookmark) => {
  const text = bookmark?.highlightText || bookmark?.textSnippet;
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
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

  useEffect(() => {
    if (apiBookId == null || !cleanFilename) return;
    if (String(cleanFilename) === String(apiBookId)) return;
    navigate(userViewerBookmarksPath(apiBookId), {
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
  } = useBookmarks(apiBookId, { sortOrder });

  const displayedBookmarks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const list = !term
      ? bookmarks || []
      : (bookmarks || []).filter((bookmark) => {
          const chapter = resolveChapterIndex(bookmark.startLocator);
          const haystack = [
            parseBookmarkLocation(bookmark, apiBookId),
            formatBookmarkLocatorDetail(bookmark, apiBookId),
            bookmark.memo,
            bookmark.highlightText,
            bookmark.textSnippet,
            bookmark.chapterTitle,
            chapter != null ? `챕터 ${chapter}` : '',
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(term);
        });
    return sortBookmarks(list, sortOrder, apiBookId);
  }, [bookmarks, searchTerm, sortOrder, apiBookId]);

  const isFilteredView = searchTerm.trim().length > 0;

  const goViewer = useCallback(
    (path, stateExtra = {}) => {
      navigate(path || viewerPath, { state: { ...(location.state || {}), ...stateExtra } });
    },
    [navigate, viewerPath, location.state]
  );

  const handleOpenBookmark = useCallback(
    (bookmark) => {
      const resumeAnchor = bookmarkToResumeAnchor(bookmark);
      if (!resumeAnchor) {
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

  const clearMemoUiForBookmark = (bookmarkId) => {
    if (composerId != null && sameId(composerId, bookmarkId)) {
      setComposerId(null);
      setComposerText('');
    }
    if (editingMemo.bookmarkId != null && sameId(editingMemo.bookmarkId, bookmarkId)) {
      setEditingMemo(EMPTY_EDIT);
    }
  };

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
    clearMemoUiForBookmark(bookmarkId);
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

  const handleAddMemo = async (bookmarkId) => {
    const text = composerText.trim();
    if (!text) return;
    const result = await updateMemoEntries(bookmarkId, (entries) => [...entries, text]);
    if (result.success) {
      setComposerId(null);
      setComposerText('');
    }
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

  const renderBookmark = (bookmark) => {
    if (!bookmark) return null;
    const colorKey = getColorKey(bookmark.color);
    const highlight = getHighlightSnippet(bookmark);
    const memoEntries = parseMemoEntries(bookmark.memo);
    const isComposerOpen = composerId != null && sameId(composerId, bookmark.id);
    const isEditingBookmark =
      editingMemo.bookmarkId != null && sameId(editingMemo.bookmarkId, bookmark.id);
    const locatorLine = formatBookmarkLocatorDetail(bookmark, apiBookId);
    const created = bookmark.createdAt || bookmark.created_at;

    return (
      <div
        key={bookmark.id}
        className="bm-card"
        role="button"
        tabIndex={0}
        style={{
          '--bm-bg': bookmarkColors[colorKey],
          '--bm-border': bookmarkBorders[colorKey],
        }}
        onClick={() => handleOpenBookmark(bookmark)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpenBookmark(bookmark);
          }
        }}
      >
        <div className="bm-card-top">
          <div className="bm-card-loc">
            <div className="bm-card-loc-main">
              <span className="material-symbols-outlined bm-icon">auto_stories</span>
              <span className="bm-loc-title">{parseBookmarkLocation(bookmark, apiBookId)}</span>
            </div>
            {locatorLine ? <span className="bm-loc-detail">{locatorLine}</span> : null}
          </div>
          <div className="bm-card-time">
            <span className="bm-time-rel">{formatRelativeTime(created)}</span>
            <span className="bm-time-dot">•</span>
            <span className="bm-time-abs">{formatAbsoluteTime(created)}</span>
          </div>
        </div>

        {highlight && (
          <div className="bm-highlight">
            <span className="bm-highlight-label">하이라이트</span>
            {highlight}
          </div>
        )}

        <div className="bm-memo-block">
          <div className="bm-memo-row">
            <span className="material-symbols-outlined bm-icon-muted">sticky_note_2</span>
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
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setEditingMemo((prev) => ({ ...prev, text: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              e.stopPropagation();
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditMemoSave();
                            }}
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            className="bm-btn bm-btn-ghost"
                            disabled={isMutating}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingMemo(EMPTY_EDIT);
                            }}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              setComposerId(null);
                              setComposerText('');
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMemoEntry(bookmark.id, entryIndex);
                            }}
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
          </div>

          {isComposerOpen ? (
            <div className="bm-memo-composer">
              <input
                className="bm-input"
                value={composerText}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
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
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddMemo(bookmark.id);
                }}
              >
                추가
              </button>
              <button
                type="button"
                className="bm-btn bm-btn-ghost"
                disabled={isMutating}
                onClick={(e) => {
                  e.stopPropagation();
                  setComposerId(null);
                  setComposerText('');
                }}
              >
                닫기
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="bm-btn-pill"
              disabled={isMutating}
              onClick={(e) => {
                e.stopPropagation();
                setEditingMemo(EMPTY_EDIT);
                setComposerId((prev) => (prev != null && sameId(prev, bookmark.id) ? null : bookmark.id));
                setComposerText('');
              }}
            >
              메모 추가
            </button>
          )}
        </div>

        <div className="bm-card-footer">
          <div className="bm-color-row">
            {colorOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`bm-color-swatch${colorKey === option.key ? ' is-active' : ''}`}
                title={option.label}
                disabled={isMutating}
                style={{
                  '--bm-swatch-bg': option.color,
                  '--bm-swatch-border': option.border,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isMutating) patchBookmark(bookmark.id, { color: option.color });
                }}
              />
            ))}
          </div>

          <button
            type="button"
            className="bm-btn-danger"
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirmId(bookmark.id);
            }}
          >
            <span className="material-symbols-outlined">delete</span>
            삭제
          </button>
        </div>
      </div>
    );
  };

  if (apiBookId == null) {
    return (
      <div className="bm-page">
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
    );
  }

  if (loading) {
    return (
      <div className="bm-page">
        <div className="bm-status">북마크를 불러오는 중...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bm-page">
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
    );
  }

  return (
    <div className="bm-page">
      <div className="bm-header">
        <div className="bm-header-left">
          <h1 className="bm-title">북마크</h1>
          <span className="bm-count">{(bookmarks ?? []).length}개</span>
        </div>

        <div className="bm-header-right">
          <div className="bm-sort">
            <span className="bm-sort-label">정렬:</span>
            <select
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
            뷰어로 돌아가기
          </button>
        </div>
      </div>

      <div className="bm-search-row">
        <input
          className="bm-search-input"
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="메모·위치 검색"
          aria-label="북마크 검색"
        />
      </div>

      {displayedBookmarks.length === 0 ? (
        <div className="bm-empty bm-panel">
          <p>{isFilteredView ? '조건에 맞는 북마크가 없습니다.' : '저장된 북마크가 없습니다.'}</p>
          <p>{isFilteredView ? '검색어를 바꿔보세요.' : '책을 읽으면서 북마크를 추가해보세요!'}</p>
        </div>
      ) : (
        <div className="bm-list">{displayedBookmarks.map((bookmark) => renderBookmark(bookmark))}</div>
      )}

      {deleteConfirmId && (
        <div className="bm-confirm-overlay" role="presentation" onClick={() => setDeleteConfirmId(null)}>
          <div
            className="bm-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bookmark-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="bookmark-delete-title" className="bm-confirm-title">
              정말 삭제하시겠습니까?
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
                className="bm-btn bm-btn-danger"
                onClick={() => handleDeleteBookmark(deleteConfirmId)}
                disabled={isMutating}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarksPage;

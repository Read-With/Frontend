import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBookManifest, getBookProgress, deleteBookProgress } from '../../utils/api/api';
import { resolveProgressLocator } from '../../utils/common/valueUtils';
import { BOOKS_QUERY_KEY } from '../../hooks/books/bookHooks';
import {
  getManifestFromCache,
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
} from '../../utils/common/cache/manifestCache';
import {
  resolveLibraryReadingProgressPercent,
  formatLibraryRelativeDate,
} from '../../utils/library/libraryUtils';
import AuthenticatedImage from './AuthenticatedImage';
import {
  resolveServerBookId,
  stripRedundantBookTitlePrefix,
} from '../../utils/viewer/viewerCoreStateUtils';
import { USER_VIEWER_PREFIX, USER_GRAPH_PREFIX } from '../../utils/common/urlUtils';
import { toast } from 'react-toastify';
import './BookDetailModal.css';

const BookDetailModal = memo(({ book, isOpen, onClose, onDelete, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [bookDetails, setBookDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showMoreCharacters, setShowMoreCharacters] = useState(false);
  const [progressInfo, setProgressInfo] = useState(null);
  const [coverImgFailed, setCoverImgFailed] = useState(false);
  const [charactersPanelOpen, setCharactersPanelOpen] = useState(true);
  const [chaptersPanelOpen, setChaptersPanelOpen] = useState(true);
  const [bookDeleteConfirm, setBookDeleteConfirm] = useState(false);
  const [progressCacheTick, setProgressCacheTick] = useState(0);
  const closeButtonRef = useRef(null);
  const lastFocusRef = useRef(null);

  const characterLists = useMemo(() => {
    const raw = bookDetails?.characters;
    if (!raw?.length) {
      return { unique: [], sortedMain: [], sortedOther: [] };
    }
    const seen = new Set();
    const unique = raw.filter((character) => {
      if (seen.has(character.id)) return false;
      seen.add(character.id);
      return true;
    });
    const main = unique.filter((c) => c.isMainCharacter);
    const other = unique.filter((c) => !c.isMainCharacter);
    const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko');
    return {
      unique,
      sortedMain: [...main].sort(byName),
      sortedOther: [...other].sort(byName),
    };
  }, [bookDetails?.characters]);

  const serverBookId = resolveServerBookId(book);
  const bookIdStr = serverBookId != null ? String(serverBookId) : null;

  const progressLocator = useMemo(() => {
    const cached = serverBookId != null ? getProgressFromCache(serverBookId) : null;
    return resolveProgressLocator(cached || progressInfo);
  }, [serverBookId, progressInfo, progressCacheTick]);

  const readPercent = useMemo(
    () => resolveLibraryReadingProgressPercent(book),
    [book, progressCacheTick]
  );

  const libraryRelativeUpdated = book?.updatedAt
    ? formatLibraryRelativeDate(book.updatedAt)
    : '';
  const libraryUpdatedAtIso = (() => {
    if (!book?.updatedAt) return null;
    const d = new Date(book.updatedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  })();

  const fetchProgressInfo = useCallback(async () => {
    const serverBookId = resolveServerBookId(book);
    
    if (!serverBookId) {
      setProgressInfo(null);
      return;
    }

    try {
      const response = await getBookProgress(serverBookId);
      if (response.isSuccess && response.result) {
        setProgressInfo(response.result);
      } else {
        setProgressInfo(null);
      }
    } catch (err) {
      const msg = err?.message ?? '';
      if (!msg.includes('404') && !msg.includes('?? ? ????')) {
        console.error('Progress ??? ????? ??????:', err);
      }
      setProgressInfo(null);
    }
  }, [book]);

  const fetchBookDetails = useCallback(async () => {
    const serverBookId = resolveServerBookId(book);
    
    if (!serverBookId) {
      setBookDetails(book);
      return;
    }

    setLoading(true);
    setError(null);
    setBookDetails(book);

    try {
      const manifestData = await getBookManifest(serverBookId);
      
      if (manifestData && manifestData.isSuccess && manifestData.result) {
        // ???? manifest ??? ???? (???? ???? ????)
        const normalizedManifest = getManifestFromCache(serverBookId) || manifestData.result;
        
        // API ?? ??? ?? ??? ??
        const bookInfo = normalizedManifest.book || manifestData.result.book || {};
        setBookDetails({
          ...book,
          ...bookInfo,
          chapters: normalizedManifest.chapters || manifestData.result.chapters || [],
          characters: normalizedManifest.characters || manifestData.result.characters || [],
          progressMetadata: normalizedManifest.progressMetadata || manifestData.result.progressMetadata || {},
          ...(normalizedManifest.readerArtifacts || manifestData.result.readerArtifacts
            ? {
                readerArtifacts:
                  normalizedManifest.readerArtifacts || manifestData.result.readerArtifacts,
              }
            : {}),
        });
      } else {
        console.warn('API ??? ???? ?????:', manifestData);
        setBookDetails(book);
        setError('?? ?? ??? ??? ? ????. ?? ??? ?????.');
      }
    } catch (err) {
      console.error('? ??? ????? ??????:', err);
      const errorMessage = err?.message || '? ??? ????? ??????.';
      setError(errorMessage);
      setBookDetails(book);
    } finally {
      setLoading(false);
    }
  }, [book]);

  useEffect(() => {
    if (isOpen && book) {
      fetchBookDetails();
      fetchProgressInfo();
    }
  }, [isOpen, book, fetchBookDetails, fetchProgressInfo]);

  useEffect(() => {
    if (!isOpen || !bookIdStr) return undefined;
    const onUpd = (e) => {
      if (String(e.detail?.bookId) === bookIdStr) {
        setProgressCacheTick((t) => t + 1);
      }
    };
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, onUpd);
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, onUpd);
  }, [isOpen, bookIdStr]);

  useEffect(() => {
    if (isOpen && book) {
      setShowMoreCharacters(false);
    }
  }, [isOpen, book?.id]);

  useEffect(() => {
    setCoverImgFailed(false);
  }, [isOpen, book?.id, bookDetails?.coverImgUrl, book?.coverImgUrl]);

  useEffect(() => {
    if (!isOpen) {
      setBookDeleteConfirm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const len = bookDetails?.chapters?.length ?? 0;
    if (len > 12) {
      setChaptersPanelOpen(false);
    } else if (len > 0) {
      setChaptersPanelOpen(true);
    }
  }, [bookDetails?.id, bookDetails?.chapters?.length]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    lastFocusRef.current = document.activeElement;
    const id = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(id);
      const prev = lastFocusRef.current;
      if (prev instanceof HTMLElement && typeof prev.focus === 'function') {
        try {
          prev.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [isOpen]);

  const getBookIdentifier = useCallback(() => {
    const id = book?.id ?? resolveServerBookId(book);
    return id != null ? String(id) : '';
  }, [book]);

  const navigateToBookPage = useCallback(
    (pathPrefix) => {
      const id = getBookIdentifier();
      if (!id) {
        toast.error('? ??? ?? ??? ? ????.');
        return;
      }
      onClose();
      navigate(`${pathPrefix}/${id}`, { state: { book } });
    },
    [book, getBookIdentifier, onClose, navigate]
  );

  const handleReadClick = useCallback(() => navigateToBookPage(USER_VIEWER_PREFIX), [navigateToBookPage]);

  const handleGraphClick = useCallback(() => navigateToBookPage(USER_GRAPH_PREFIX), [navigateToBookPage]);

  const handleRetryFetch = useCallback(() => {
    fetchBookDetails();
    fetchProgressInfo();
  }, [fetchBookDetails, fetchProgressInfo]);

  // ?? ?? - useMutation + ??? ????
  const deleteProgressMutation = useMutation({
    mutationFn: (bookId) => deleteBookProgress(bookId),
    onMutate: async () => {
      // ??? ???? - ?? UI ??
      const previousProgress = progressInfo;
      setProgressInfo(null);
      return { previousProgress };
    },
    onSuccess: () => {
      toast.success('?? ??? ???????');
      // ? ?? ??? (??? ????)
      queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
    },
    onError: (err, variables, context) => {
      // ??
      if (context?.previousProgress) {
        setProgressInfo(context.previousProgress);
      }
      console.error('?? ?? ?? ??:', err);
      toast.error('?? ?? ??? ??????');
    },
  });

  const handleDeleteProgress = useCallback(async () => {
    const serverBookId = resolveServerBookId(book);
    
    if (!serverBookId || !progressInfo) {
      return;
    }

    if (
      !window.confirm(
        '??? ?? ??? ??????. ? ??? ??? ? ????. ??????'
      )
    ) {
      return;
    }

    try {
      await deleteProgressMutation.mutateAsync(serverBookId);
    } catch {
      // ??? onError?? ??
    }
  }, [book, progressInfo, deleteProgressMutation]);

  const handleConfirmDeleteBook = useCallback(async () => {
    if (!book || !book.id) {
      return;
    }

    try {
      if (onDelete) {
        await onDelete(book.id);
        toast.success('?? ???????');
        setBookDeleteConfirm(false);
        onClose();
      } else {
        toast.error('?? ??? ??? ? ????');
      }
    } catch (err) {
      console.error('? ?? ??:', err);
      toast.error('? ??? ??????');
    }
  }, [book, onDelete, onClose]);


  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== 'Escape' || !isOpen) {
        return;
      }
      if (bookDeleteConfirm) {
        setBookDeleteConfirm(false);
        return;
      }
      onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, bookDeleteConfirm]);

  if (!isOpen) return null;

  const coverSrc = bookDetails?.coverImgUrl || book?.coverImgUrl;
  const displayTitle = bookDetails?.title || book?.title || '?? ??';
  const chapterStripBookTitle = String(bookDetails?.title ?? book?.title ?? '').trim();
  const displayAuthor = bookDetails?.author || book?.author || '?? ?? ??';
  const coverInitial = (displayTitle || '?').trim().slice(0, 1) || '?';
  const currentChapterIndex = progressLocator?.chapterIndex;
  const isListView = viewMode === 'list';
  const hasProgress = readPercent > 0 || !!progressInfo;

  const coverBlock = (
    <div className="book-detail-cover-wrap">
      <div className="book-detail-cover">
        {coverSrc && !coverImgFailed ? (
          <AuthenticatedImage
            src={coverSrc}
            alt={displayTitle}
            onError={() => setCoverImgFailed(true)}
          />
        ) : null}
        {(!coverSrc || coverImgFailed) && (
          <div className="book-detail-cover-placeholder" aria-hidden="true">
            <span className="book-detail-cover-placeholder-letter">{coverInitial}</span>
          </div>
        )}
      </div>
    </div>
  );

  const titleBlock = (
    <div className="book-detail-title-row">
      <h2 id="book-detail-title" className="book-detail-title">
        {displayTitle}
      </h2>
      <span className="book-detail-author">{displayAuthor}</span>
    </div>
  );

  const progressSkeleton = (
    <div className="book-detail-skeleton" aria-hidden="true">
      <div className="book-detail-skeleton-line book-detail-skeleton-line--lg" />
      <div className="book-detail-skeleton-line book-detail-skeleton-line--sm" />
      <div className="book-detail-skeleton-card">
        <div className="book-detail-skeleton-meta-label" />
        <div className="book-detail-skeleton-progress-track">
          <div className="book-detail-skeleton-progress-fill" />
        </div>
      </div>
    </div>
  );

  const progressMeta = (
    <div
      className="book-detail-reader-meta book-detail-reader-meta--compact"
      role="region"
      aria-label="?? ??"
    >
      {readPercent > 0 && (
        <div className="book-detail-reader-progress-row">
          <div
            className="book-detail-reader-progress"
            role="progressbar"
            aria-valuenow={readPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${readPercent}% ??`}
            aria-label={`?? ?? ${readPercent}%`}
          >
            <div
              className="book-detail-reader-progress-fill"
              style={{ width: `${readPercent}%` }}
            />
          </div>
          <span className="book-detail-reader-progress-pct" aria-hidden="true">
            <span className="book-detail-reader-progress-pct-value">{readPercent}</span>%
          </span>
        </div>
      )}
      <div className="book-detail-reader-compact-foot">
        {libraryRelativeUpdated ? (
          <time
            className="book-detail-reader-compact-time"
            dateTime={libraryUpdatedAtIso ?? undefined}
            aria-label={`?? ???? ${libraryRelativeUpdated}`}
          >
            {libraryRelativeUpdated}
          </time>
        ) : progressInfo ? (
          <span className="book-detail-reader-compact-placeholder">?</span>
        ) : null}
        {progressInfo && (
          <button
            type="button"
            className="book-detail-reader-clear-progress"
            onClick={handleDeleteProgress}
            aria-label="?? ?? ??"
          >
            ?? ??
          </button>
        )}
      </div>
    </div>
  );

  const statusBlocks = (
    <>
      {loading && (
        <div className="book-detail-loading" role="status" aria-live="polite">
          <span className="book-detail-loading-dot" aria-hidden />
          ??? ???? ??
        </div>
      )}
      {error && (
        <div className="book-detail-error" role="alert" aria-live="assertive">
          <span className="book-detail-error-text">{error}</span>
          <button
            type="button"
            className="book-detail-error-retry"
            onClick={handleRetryFetch}
          >
            ?? ??
          </button>
        </div>
      )}
    </>
  );

  return (
    <div
      className="book-detail-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-detail-title"
      aria-describedby="book-detail-modal-desc"
    >
      <p id="book-detail-modal-desc" className="book-detail-modal-desc">
        ? ??? ??, ?? ??, ?? ??? ??? ??? ? ????.
      </p>
      <div
        className={`book-detail-content${isListView ? ' book-detail-content--list' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="book-detail-sheet-handle" aria-hidden="true" />
        <p className="book-detail-sheet-hint">?? ??? ??? ???</p>
        <button
          ref={closeButtonRef}
          className="book-detail-close-btn"
          onClick={onClose}
          aria-label="?? ??"
          type="button"
        >
          ?
        </button>

        <div className={`book-detail-header${isListView ? ' book-detail-header--list' : ''}`}>
          {coverBlock}
          <div className="book-detail-info">
            {titleBlock}
            {loading && !error && progressSkeleton}
            {!loading && hasProgress && progressMeta}
            {statusBlocks}
          </div>
        </div>

        <div className="book-detail-scroll">
          <div className="book-detail-body">
            {bookDetails && (
              <>

              {characterLists.unique.length > 0 && (
                <div className="book-detail-panel">
                  <div className="book-detail-panel-head">
                    <h3 className="book-detail-panel-title" id="book-detail-characters-heading">
                      ?? ??
                    </h3>
                    <div className="book-detail-panel-head-actions">
                      <span className="book-detail-panel-count">{characterLists.unique.length}?</span>
                      <button
                        type="button"
                        className="book-detail-panel-toggle"
                        onClick={() => setCharactersPanelOpen((o) => !o)}
                        aria-expanded={charactersPanelOpen}
                        aria-controls="book-detail-characters-region"
                        aria-labelledby="book-detail-characters-heading"
                      >
                        <span className="book-detail-panel-toggle-sr">
                          {charactersPanelOpen ? '?? ?? ??' : '?? ?? ???'}
                        </span>
                        <span className="book-detail-panel-chevron" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div
                    id="book-detail-characters-region"
                    className={
                      charactersPanelOpen
                        ? 'book-detail-panel-body book-detail-panel-body--open'
                        : 'book-detail-panel-body book-detail-panel-body--closed'
                    }
                    role="region"
                    aria-labelledby="book-detail-characters-heading"
                    aria-hidden={!charactersPanelOpen}
                  >
                    {characterLists.sortedMain.length > 0 && (
                      <ul className="book-detail-characters-list">
                        {characterLists.sortedMain.map((character) => (
                          <li
                            key={character.id ?? character.name}
                            className="book-detail-character-item main-character"
                          >
                            <div className="book-detail-character-main">
                              {character.profileImage ? (
                                <AuthenticatedImage
                                  className="book-detail-character-avatar"
                                  src={character.profileImage}
                                  alt=""
                                />
                              ) : (
                                <span
                                  className="book-detail-character-avatar book-detail-character-avatar--placeholder"
                                  aria-hidden
                                >
                                  {(character.name || '?').slice(0, 1)}
                                </span>
                              )}
                              <span className="character-name" title={character.name || undefined}>
                                {character.name}
                              </span>
                            </div>
                            <span className="character-badge" aria-label="?? ??">
                              ??
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {characterLists.sortedOther.length > 0 && (
                      <>
                        {showMoreCharacters && (
                          <ul className="book-detail-characters-list book-detail-characters-list--secondary">
                            {characterLists.sortedOther.map((character) => (
                              <li
                                key={character.id ?? character.name}
                                className="book-detail-character-item"
                              >
                                <div className="book-detail-character-main">
                                  {character.profileImage ? (
                                    <AuthenticatedImage
                                      className="book-detail-character-avatar"
                                      src={character.profileImage}
                                      alt=""
                                    />
                                  ) : (
                                    <span
                                      className="book-detail-character-avatar book-detail-character-avatar--placeholder"
                                      aria-hidden
                                    >
                                      {(character.name || '?').slice(0, 1)}
                                    </span>
                                  )}
                                  <span className="character-name" title={character.name || undefined}>
                                    {character.name}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          className="book-detail-more-btn"
                          onClick={() => setShowMoreCharacters(!showMoreCharacters)}
                          aria-expanded={showMoreCharacters}
                        >
                          {showMoreCharacters
                            ? '?? ?? ??'
                            : `?? ?? ??? ? ${characterLists.sortedOther.length}?`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {bookDetails.chapters && bookDetails.chapters.length > 0 && (
                <div className="book-detail-panel">
                  <div className="book-detail-panel-head">
                    <h3 className="book-detail-panel-title" id="book-detail-chapters-heading">
                      ??
                    </h3>
                    <div className="book-detail-panel-head-actions">
                      <span className="book-detail-panel-count">{bookDetails.chapters.length}??</span>
                      <button
                        type="button"
                        className="book-detail-panel-toggle"
                        onClick={() => setChaptersPanelOpen((o) => !o)}
                        aria-expanded={chaptersPanelOpen}
                        aria-controls="book-detail-chapters-region"
                        aria-labelledby="book-detail-chapters-heading"
                      >
                        <span className="book-detail-panel-toggle-sr">
                          {chaptersPanelOpen ? '?? ??' : '?? ???'}
                        </span>
                        <span className="book-detail-panel-chevron" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div
                    id="book-detail-chapters-region"
                    className={
                      chaptersPanelOpen
                        ? 'book-detail-panel-body book-detail-panel-body--open'
                        : 'book-detail-panel-body book-detail-panel-body--closed'
                    }
                    role="region"
                    aria-labelledby="book-detail-chapters-heading"
                    aria-hidden={!chaptersPanelOpen}
                  >
                    <ol className="book-detail-chapters-list">
                      {bookDetails.chapters.map((chapter, index) => {
                        const rawTitle = String(chapter.title ?? '').trim();
                        const idxNum = Number(chapter.idx);
                        const idxStr =
                          Number.isFinite(idxNum) && idxNum >= 1 ? String(idxNum) : '?';
                        const normalizedTitle = rawTitle
                          ? stripRedundantBookTitlePrefix(rawTitle, chapterStripBookTitle)
                          : '';
                        const chapterLine = normalizedTitle || rawTitle || `?? ${idxStr}`;
                        const chapterKey =
                          chapter.id ??
                          chapter.href ??
                          (Number.isFinite(idxNum) ? `ch-${idxNum}` : `ch-row-${index}`);
                        const isCurrent =
                          currentChapterIndex != null &&
                          Number.isFinite(idxNum) &&
                          idxNum === currentChapterIndex;
                        return (
                          <li
                            key={chapterKey}
                            className={
                              isCurrent
                                ? 'book-detail-chapter-item book-detail-chapter-item--current'
                                : 'book-detail-chapter-item'
                            }
                          >
                            <span className="book-detail-chapter-num">
                              {Number.isFinite(idxNum) ? idxNum : '?'}
                            </span>
                            <span
                              className="book-detail-chapter-title"
                              title={rawTitle || undefined}
                            >
                              {chapterLine}
                            </span>
                            {isCurrent ? (
                              <button
                                type="button"
                                className="book-detail-chapter-current-badge"
                                onClick={handleReadClick}
                                aria-label="?? ??"
                              >
                                ?? ??
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              )}

              </>
            )}
          </div>
        </div>

        <div className="book-detail-footer-stack">
          <div className="book-detail-actions book-detail-actions--footer">
          {bookDeleteConfirm ? (
            <div className="book-detail-delete-confirm" role="group" aria-label="???? ? ?? ??">
              <p className="book-detail-delete-confirm-text">
                ???? ? ?? ?????? ? ??? ??? ? ????.
              </p>
              <div className="book-detail-delete-confirm-actions">
                <button
                  type="button"
                  className="book-detail-text-action-btn book-detail-delete-confirm-cancel"
                  onClick={() => setBookDeleteConfirm(false)}
                >
                  ??
                </button>
                <button
                  type="button"
                  className="book-detail-danger-btn book-detail-danger-btn--solid book-detail-delete-confirm-submit"
                  onClick={handleConfirmDeleteBook}
                >
                  ??
                </button>
              </div>
            </div>
          ) : (
            <div className="book-detail-footer-row" role="group" aria-label="??? ? ?? ??">
              <button
                className="book-detail-secondary-btn"
                onClick={handleGraphClick}
                type="button"
                aria-label="?? ??? ???? ??"
              >
                ???
              </button>
              <button
                className="book-detail-danger-btn book-detail-danger-btn--inline"
                onClick={() => setBookDeleteConfirm(true)}
                type="button"
                aria-label="???? ? ? ??"
              >
                ???? ??
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
});

BookDetailModal.propTypes = {
  book: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list']),
};

BookDetailModal.displayName = 'BookDetailModal';

export default BookDetailModal;


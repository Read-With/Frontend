import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBookManifest, getBookProgress, deleteBookProgress } from '../../utils/api/booksApi';
import { resolveProgressLocator } from '../../utils/common/valueUtils';
import { BOOKS_QUERY_KEY } from '../../hooks/books/bookHooks';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import {
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
} from '../../utils/common/cache/progressCache';
import {
  resolveLibraryReadingProgressPercent,
  formatLibraryRelativeDate,
  attachLibraryModalChrome,
  dedupeAndSortCharacters,
  toLibraryIsoDateOrNull,
  libraryPanelBodyClass,
} from '../../utils/library/libraryUtils';
import {
  resolveServerBookId,
  stripRedundantBookTitlePrefix,
} from '../../utils/viewer/viewerCore';
import {
  USER_VIEWER_PREFIX,
  USER_GRAPH_PREFIX,
  fetchAuthenticatedAssetBlobUrl,
  isProtectedPublicAsset,
  sanitizeAssetUrl,
} from '../../utils/common/urlUtils';
import { toast } from 'react-toastify';
import './BookDetailModal.css';

async function resolveDisplaySrc(src) {
  const sanitized = sanitizeAssetUrl(src);
  if (!sanitized) return { displaySrc: null, failed: true };
  if (!isProtectedPublicAsset(sanitized)) {
    return { displaySrc: sanitized, failed: false };
  }
  const blobUrl = await fetchAuthenticatedAssetBlobUrl(sanitized);
  if (blobUrl) return { displaySrc: blobUrl, failed: false };
  return { displaySrc: null, failed: true };
}

export function AuthenticatedImage({
  src,
  alt = '',
  className,
  onError,
  onLoad,
  ...rest
}) {
  const [displaySrc, setDisplaySrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDisplaySrc(null);

    resolveDisplaySrc(src).then(({ displaySrc: nextSrc, failed: nextFailed }) => {
      if (cancelled) return;
      if (nextFailed) {
        setFailed(true);
        return;
      }
      setDisplaySrc(nextSrc);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (failed && onError) onError();
  }, [failed, onError]);

  if (failed || !displaySrc) {
    return null;
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      onError={onError}
      onLoad={onLoad}
      {...rest}
    />
  );
}

AuthenticatedImage.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  className: PropTypes.string,
  onError: PropTypes.func,
  onLoad: PropTypes.func,
};

function mergeBookWithManifest(book, manifestData) {
  const serverBookId = resolveServerBookId(book);
  const normalizedManifest = getManifestFromCache(serverBookId) || manifestData.result;
  const bookInfo = normalizedManifest.book || manifestData.result.book || {};
  return {
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
  };
}

function formatChapterRowMeta(chapter, bookTitle, index, currentChapterIndex) {
  const rawTitle = String(chapter.title ?? '').trim();
  const idxNum = Number(chapter.idx);
  const idxStr = Number.isFinite(idxNum) && idxNum >= 1 ? String(idxNum) : '?';
  const normalizedTitle = rawTitle
    ? stripRedundantBookTitlePrefix(rawTitle, bookTitle)
    : '';
  const chapterLine = normalizedTitle || rawTitle || `챕터 ${idxStr}`;
  const chapterKey =
    chapter.id ??
    chapter.href ??
    (Number.isFinite(idxNum) ? `ch-${idxNum}` : `ch-row-${index}`);
  const isCurrent =
    currentChapterIndex != null &&
    Number.isFinite(idxNum) &&
    idxNum === currentChapterIndex;
  return {
    rawTitle,
    idxNum,
    chapterLine,
    chapterKey,
    isCurrent,
    displayNum: Number.isFinite(idxNum) ? idxNum : '?',
  };
}

function CollapsiblePanelHeader({
  titleId,
  title,
  countLabel,
  isOpen,
  onToggle,
  controlsId,
  toggleOpenLabel,
  toggleClosedLabel,
}) {
  return (
    <div className="book-detail-panel-head">
      <h3 className="book-detail-panel-title" id={titleId}>
        {title}
      </h3>
      <div className="book-detail-panel-head-actions">
        <span className="book-detail-panel-count">{countLabel}</span>
        <button
          type="button"
          className="book-detail-panel-toggle"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={controlsId}
          aria-labelledby={titleId}
        >
          <span className="book-detail-panel-toggle-sr">
            {isOpen ? toggleOpenLabel : toggleClosedLabel}
          </span>
          <span className="book-detail-panel-chevron" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function CharacterRow({ character, isMain = false }) {
  return (
    <li
      className={
        isMain
          ? 'book-detail-character-item main-character'
          : 'book-detail-character-item'
      }
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
      {isMain ? (
        <span className="character-badge" aria-label="주요 인물">
          주연
        </span>
      ) : null}
    </li>
  );
}

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

  const characterLists = useMemo(
    () => dedupeAndSortCharacters(bookDetails?.characters),
    [bookDetails?.characters]
  );

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
  const libraryUpdatedAtIso = toLibraryIsoDateOrNull(book?.updatedAt);

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
      if (!msg.includes('404') && !msg.includes('찾을 수 없습니다')) {
        console.error('Progress 정보를 불러오는데 실패했습니다:', err);
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
        setBookDetails(mergeBookWithManifest(book, manifestData));
      } else {
        console.warn('API 응답이 성공하지 않았습니다:', manifestData);
        setBookDetails(book);
        setError('책의 상세 정보를 불러올 수 없습니다. 기본 정보만 표시됩니다.');
      }
    } catch (err) {
      console.error('책 정보를 불러오는데 실패했습니다:', err);
      const errorMessage = err?.message || '책 정보를 불러오는데 실패했습니다.';
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
        toast.error('책 정보가 없어 이동할 수 없습니다.');
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
      toast.success('독서 진도가 삭제되었습니다');
      // ? ?? ??? (??? ????)
      queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
    },
    onError: (err, variables, context) => {
      // ??
      if (context?.previousProgress) {
        setProgressInfo(context.previousProgress);
      }
      console.error('독서 진도 삭제 실패:', err);
      toast.error('독서 진도 삭제에 실패했습니다');
    },
  });

  const handleDeleteProgress = useCallback(async () => {
    const serverBookId = resolveServerBookId(book);
    
    if (!serverBookId || !progressInfo) {
      return;
    }

    if (
      !window.confirm(
        '저장된 독서 진도가 초기화됩니다. 이 작업은 되돌릴 수 없습니다. 계속할까요?'
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
        toast.success('책이 삭제되었습니다');
        setBookDeleteConfirm(false);
        onClose();
      } else {
        toast.error('삭제 기능을 사용할 수 없습니다');
      }
    } catch (err) {
      console.error('책 삭제 실패:', err);
      toast.error('책 삭제에 실패했습니다');
    }
  }, [book, onDelete, onClose]);


  const toggleCharactersPanel = useCallback(() => {
    setCharactersPanelOpen((o) => !o);
  }, []);

  const toggleChaptersPanel = useCallback(() => {
    setChaptersPanelOpen((o) => !o);
  }, []);

  const toggleShowMoreCharacters = useCallback(() => {
    setShowMoreCharacters((v) => !v);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    return attachLibraryModalChrome({
      onEscape: () => {
        if (bookDeleteConfirm) {
          setBookDeleteConfirm(false);
          return;
        }
        onClose();
      },
    });
  }, [isOpen, onClose, bookDeleteConfirm]);

  if (!isOpen) return null;

  const coverSrc = bookDetails?.coverImgUrl || book?.coverImgUrl;
  const displayTitle = bookDetails?.title || book?.title || '제목 없음';
  const chapterStripBookTitle = String(bookDetails?.title ?? book?.title ?? '').trim();
  const displayAuthor = bookDetails?.author || book?.author || '저자 정보 없음';
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
      aria-label="독서 진행"
    >
      {readPercent > 0 && (
        <div className="book-detail-reader-progress-row">
          <div
            className="book-detail-reader-progress"
            role="progressbar"
            aria-valuenow={readPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${readPercent}% 읽음`}
            aria-label={`읽기 진행 ${readPercent}%`}
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
            aria-label={`최근 업데이트 ${libraryRelativeUpdated}`}
          >
            {libraryRelativeUpdated}
          </time>
        ) : progressInfo ? (
          <span className="book-detail-reader-compact-placeholder">—</span>
        ) : null}
        {progressInfo && (
          <button
            type="button"
            className="book-detail-reader-clear-progress"
            onClick={handleDeleteProgress}
            aria-label="독서 진도 삭제"
          >
            진도 삭제
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
          정보를 불러오는 중…
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
            다시 시도
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
        책 표지와 제목, 독서 진도, 등장 인물과 목차를 확인할 수 있습니다.</p>
      <div
        className={`book-detail-content${isListView ? ' book-detail-content--list' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="book-detail-sheet-handle" aria-hidden="true" />
        <p className="book-detail-sheet-hint">바깥 영역을 누르면 닫혀요</p>
        <button
          ref={closeButtonRef}
          className="book-detail-close-btn"
          onClick={onClose}
          aria-label="모달 닫기"
          type="button"
        >
          ×
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
                  <CollapsiblePanelHeader
                    titleId="book-detail-characters-heading"
                    title="등장 인물"
                    countLabel={`${characterLists.unique.length}명`}
                    isOpen={charactersPanelOpen}
                    onToggle={toggleCharactersPanel}
                    controlsId="book-detail-characters-region"
                    toggleOpenLabel="등장 인물 접기"
                    toggleClosedLabel="등장 인물 펼치기"
                  />
                  <div
                    id="book-detail-characters-region"
                    className={libraryPanelBodyClass(charactersPanelOpen)}
                    role="region"
                    aria-labelledby="book-detail-characters-heading"
                    aria-hidden={!charactersPanelOpen}
                  >
                    {characterLists.sortedMain.length > 0 && (
                      <ul className="book-detail-characters-list">
                        {characterLists.sortedMain.map((character) => (
                          <CharacterRow
                            key={character.id ?? character.name}
                            character={character}
                            isMain
                          />
                        ))}
                      </ul>
                    )}

                    {characterLists.sortedOther.length > 0 && (
                      <>
                        {showMoreCharacters && (
                          <ul className="book-detail-characters-list book-detail-characters-list--secondary">
                            {characterLists.sortedOther.map((character) => (
                              <CharacterRow
                                key={character.id ?? character.name}
                                character={character}
                              />
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          className="book-detail-more-btn"
                          onClick={toggleShowMoreCharacters}
                          aria-expanded={showMoreCharacters}
                        >
                          {showMoreCharacters
                            ? '일반 인물 접기'
                            : `일반 인물 더보기 · ${characterLists.sortedOther.length}명`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {bookDetails.chapters && bookDetails.chapters.length > 0 && (
                <div className="book-detail-panel">
                  <CollapsiblePanelHeader
                    titleId="book-detail-chapters-heading"
                    title="목차"
                    countLabel={`${bookDetails.chapters.length}챕터`}
                    isOpen={chaptersPanelOpen}
                    onToggle={toggleChaptersPanel}
                    controlsId="book-detail-chapters-region"
                    toggleOpenLabel="목차 접기"
                    toggleClosedLabel="목차 펼치기"
                  />
                  <div
                    id="book-detail-chapters-region"
                    className={libraryPanelBodyClass(chaptersPanelOpen)}
                    role="region"
                    aria-labelledby="book-detail-chapters-heading"
                    aria-hidden={!chaptersPanelOpen}
                  >
                    <ol className="book-detail-chapters-list">
                      {bookDetails.chapters.map((chapter, index) => {
                        const {
                          rawTitle,
                          chapterLine,
                          chapterKey,
                          isCurrent,
                          displayNum,
                        } = formatChapterRowMeta(
                          chapter,
                          chapterStripBookTitle,
                          index,
                          currentChapterIndex,
                        );
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
                              {displayNum}
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
                                aria-label="이어 읽기"
                              >
                                이어 읽기
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
            <div className="book-detail-delete-confirm" role="group" aria-label="서재에서 책 삭제 확인">
              <p className="book-detail-delete-confirm-text">
                서재에서 이 책을 삭제할까요? 이 작업은 되돌릴 수 없습니다.</p>
              <div className="book-detail-delete-confirm-actions">
                <button
                  type="button"
                  className="book-detail-text-action-btn book-detail-delete-confirm-cancel"
                  onClick={() => setBookDeleteConfirm(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="book-detail-danger-btn book-detail-danger-btn--solid book-detail-delete-confirm-submit"
                  onClick={handleConfirmDeleteBook}
                >
                  삭제
                </button>
              </div>
            </div>
          ) : (
            <div className="book-detail-footer-row" role="group" aria-label="관계도 및 서재 삭제">
              <button
                className="book-detail-secondary-btn"
                onClick={handleGraphClick}
                type="button"
                aria-label="인물 관계도 페이지로 이동"
              >
                관계도
              </button>
              <button
                className="book-detail-danger-btn book-detail-danger-btn--inline"
                onClick={() => setBookDeleteConfirm(true)}
                type="button"
                aria-label="서재에서 이 책 삭제"
              >
                서재에서 삭제
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


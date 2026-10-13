import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBookManifest, getBookProgress, deleteBookProgress, fetchAuthenticatedAssetBlobUrl } from '../../utils/api/booksApi';
import { resolveProgressLocator, errorUtils, formatRelativeTime } from '../../utils/common/valueUtils';
import { BOOKS_QUERY_KEY } from '../../hooks/books/bookHooks';
import { useAsyncRequestGuard, useModalFocusTrap, useLatestRef } from '../../hooks/common/hooksShared';
import { getProgressFromCache, PROGRESS_CACHE_UPDATED_EVENT,} from '../../utils/common/cache/progressCache';
import {
  resolveLibraryReadingProgressPercent,
  attachLibraryModalChrome,
  dedupeAndSortCharacters,
  toLibraryIsoDateOrNull,
  libraryPanelBodyClass,
  HIDE_BOOK_COPY,
} from '../../utils/library/libraryUtils';
import {
  resolveServerBookId,
  resolveChapterTitleMeta,
} from '../../utils/viewer/viewerCore';
import {
  USER_VIEWER_PREFIX,
  USER_GRAPH_PREFIX,
  isProtectedPublicAsset,
  sanitizeAssetUrl,
} from '../../utils/common/urlUtils';
import { toast } from 'react-toastify';
import ConfirmDialog from './ConfirmDialog';
import './BookDetailModal.css';

async function resolveDisplaySrc(src) {
  const sanitized = sanitizeAssetUrl(src);
  if (!sanitized) return { displaySrc: null, failed: true };
  if (!isProtectedPublicAsset(sanitized)) {
    return { displaySrc: sanitized, failed: false };
  }
  try {
    const blobUrl = await fetchAuthenticatedAssetBlobUrl(sanitized);
    return blobUrl
      ? { displaySrc: blobUrl, failed: false }
      : { displaySrc: null, failed: true };
  } catch {
    return { displaySrc: null, failed: true };
  }
}

export function AuthenticatedImage({
  src,
  alt = '',
  className,
  fallback = null,
  onError,
  onLoad,
  ...rest
}) {
  const [displaySrc, setDisplaySrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDisplaySrc(null);

    void resolveDisplaySrc(src).then(({ displaySrc: nextSrc, failed: nextFailed }) => {
      if (cancelled) return;
      setFailed(nextFailed);
      if (!nextFailed) setDisplaySrc(nextSrc);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (failed) onErrorRef.current?.();
  }, [failed]);

  if (failed) return fallback;
  if (!displaySrc) return null;

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      onLoad={onLoad}
      {...rest}
    />
  );
}

function mergeBookWithManifest(book, manifestData) {
  const manifest = manifestData.result;
  return {
    ...book,
    ...(manifest.book || {}),
    chapters: manifest.chapters || [],
    characters: manifest.characters || [],
    progressMetadata: manifest.progressMetadata || {},
    ...(manifest.readerArtifacts ? { readerArtifacts: manifest.readerArtifacts } : {}),
  };
}

function formatChapterRowMeta(chapter, bookTitle, index, currentChapterIndex) {
  const meta = resolveChapterTitleMeta(chapter, bookTitle);
  const idxNum = Number(chapter.idx);
  const chapterKey =
    chapter.id ??
    chapter.href ??
    (Number.isFinite(idxNum) ? `ch-${idxNum}` : `ch-row-${index}`);
  const isCurrent =
    currentChapterIndex != null &&
    Number.isFinite(idxNum) &&
    idxNum === currentChapterIndex;
  return {
    rawTitle: meta.raw,
    idxNum,
    chapterLine: meta.display,
    chapterKey,
    isCurrent,
    displayNum: Number.isFinite(idxNum) ? idxNum : '?',
    status: meta.status,
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
  const avatarFallback = (
    <span
      className="book-detail-character-avatar book-detail-character-avatar--placeholder"
      aria-hidden
    >
      {(character.name || '?').slice(0, 1)}
    </span>
  );

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
            fallback={avatarFallback}
          />
        ) : (
          avatarFallback
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

/** 책 상세(manifest)·서버 진도 로드. 열릴 때와 book 변경 시 다시 불러옴 */
function useBookDetails(book, serverBookId, isOpen) {
  const [bookDetails, setBookDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progressInfo, setProgressInfo] = useState(null);
  // progressCache 갱신 시 재렌더 → 호출부가 getProgressFromCache를 다시 읽음
  const [, setProgressCacheTick] = useState(0);
  const { nextRequestId: nextDetailsRequestId, isStale: isDetailsRequestStale } = useAsyncRequestGuard();
  const { nextRequestId: nextProgressRequestId, isStale: isProgressRequestStale } = useAsyncRequestGuard();

  const fetchProgressInfo = useCallback(async () => {
    if (!serverBookId) {
      setProgressInfo(null);
      return;
    }

    const requestId = nextProgressRequestId();

    try {
      const response = await getBookProgress(serverBookId);
      if (isProgressRequestStale(requestId)) return;
      if (response.isSuccess && response.result) {
        setProgressInfo(response.result);
      } else {
        setProgressInfo(null);
      }
    } catch (err) {
      if (isProgressRequestStale(requestId)) return;
      const msg = err?.message ?? '';
      if (!msg.includes('404') && !msg.includes('찾을 수 없습니다')) {
        errorUtils.logError('BookDetailModal', err, { action: 'loadProgress' });
      }
      setProgressInfo(null);
    }
  }, [serverBookId, nextProgressRequestId, isProgressRequestStale]);

  const fetchBookDetails = useCallback(async () => {
    if (!serverBookId) {
      setBookDetails(book);
      return;
    }

    const requestId = nextDetailsRequestId();
    setLoading(true);
    setError(null);
    setBookDetails(book);

    try {
      const manifestData = await getBookManifest(serverBookId);
      if (isDetailsRequestStale(requestId)) return;

      if (manifestData && manifestData.isSuccess && manifestData.result) {
        setBookDetails(mergeBookWithManifest(book, manifestData));
      } else {
        errorUtils.logWarning('BookDetailModal', 'manifest 응답 실패', { code: manifestData?.code, message: manifestData?.message });
        setBookDetails(book);
        setError('책의 상세 정보를 불러올 수 없습니다. 기본 정보만 표시됩니다.');
      }
    } catch (err) {
      if (isDetailsRequestStale(requestId)) return;
      errorUtils.logError('BookDetailModal', err, { action: 'loadManifest' });
      const errorMessage = err?.message || '책 정보를 불러오는데 실패했습니다.';
      setError(errorMessage);
      setBookDetails(book);
    } finally {
      if (!isDetailsRequestStale(requestId)) setLoading(false);
    }
  }, [book, serverBookId, nextDetailsRequestId, isDetailsRequestStale]);

  useEffect(() => {
    if (isOpen) {
      fetchBookDetails();
      fetchProgressInfo();
    }
  }, [isOpen, book, fetchBookDetails, fetchProgressInfo]);

  useEffect(() => {
    if (!isOpen || serverBookId == null) return undefined;
    const onUpd = (e) => {
      if (String(e.detail?.bookId) === String(serverBookId)) {
        setProgressCacheTick((t) => t + 1);
      }
    };
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, onUpd);
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, onUpd);
  }, [isOpen, serverBookId]);

  const retry = useCallback(() => {
    fetchBookDetails();
    fetchProgressInfo();
  }, [fetchBookDetails, fetchProgressInfo]);

  return { bookDetails, loading, error, progressInfo, setProgressInfo, retry };
}

/** 표시용 제목·저자·표지 (manifest 값 우선, 없으면 목록의 book) */
function resolveBookDisplay(book, details) {
  return {
    coverSrc: details?.coverImgUrl || book?.coverImgUrl,
    displayTitle: details?.title || book?.title || '제목 없음',
    chapterStripBookTitle: String(details?.title ?? book?.title ?? '').trim(),
    displayAuthor: details?.author || book?.author || '저자 정보 없음',
  };
}

/** 책 숨기기·진도 삭제 확인 다이얼로그 상태와 실행. Esc는 열린 확인창부터 닫음 */
function useDeleteConfirms({ isOpen, book, serverBookId, onDelete, onClose, progressInfo, setProgressInfo }) {
  const queryClient = useQueryClient();
  const [bookDeleteConfirm, setBookDeleteConfirm] = useState(false);
  const [progressDeleteConfirm, setProgressDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBookDeleteConfirm(false);
      setProgressDeleteConfirm(false);
    }
  }, [isOpen]);

  const deleteProgressMutation = useMutation({
    mutationFn: (bookId) => deleteBookProgress(bookId),
    onMutate: async () => {
      const previousProgress = progressInfo;
      setProgressInfo(null);
      return { previousProgress };
    },
    onSuccess: () => {
      toast.success('독서 진도가 삭제되었습니다');
      queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
    },
    onError: (err, variables, context) => {
      if (context?.previousProgress) {
        setProgressInfo(context.previousProgress);
      }
      errorUtils.logError('BookDetailModal', err, { action: 'deleteProgress' });
      toast.error('독서 진도 삭제에 실패했습니다');
    },
  });

  const confirmDeleteProgress = useCallback(async () => {
    setProgressDeleteConfirm(false);
    try {
      await deleteProgressMutation.mutateAsync(serverBookId);
    } catch {
      // deleteProgressMutation.onError에서 처리
    }
  }, [serverBookId, deleteProgressMutation]);

  const confirmDeleteBook = useCallback(async () => {
    if (!book || !book.id) {
      return;
    }

    try {
      if (onDelete) {
        await onDelete(book.id);
        setBookDeleteConfirm(false);
        onClose();
      } else {
        toast.error('숨기기 기능을 사용할 수 없습니다');
      }
    } catch (err) {
      errorUtils.logError('BookDetailModal', err, { action: 'deleteBook' });
      toast.error(HIDE_BOOK_COPY.failed);
    }
  }, [book, onDelete, onClose]);

  const nestedConfirmStateRef = useLatestRef({ bookDeleteConfirm, progressDeleteConfirm });

  useEffect(() => {
    if (!isOpen) return undefined;
    return attachLibraryModalChrome({
      onEscape: () => {
        const { bookDeleteConfirm: isBookConfirm, progressDeleteConfirm: isProgressConfirm } =
          nestedConfirmStateRef.current;
        if (isBookConfirm) {
          setBookDeleteConfirm(false);
          return;
        }
        if (isProgressConfirm) {
          setProgressDeleteConfirm(false);
          return;
        }
        onClose();
      },
    });
  }, [isOpen, onClose, nestedConfirmStateRef]);

  const openBook = useCallback(() => setBookDeleteConfirm(true), []);
  const closeBook = useCallback(() => setBookDeleteConfirm(false), []);
  const openProgress = useCallback(() => setProgressDeleteConfirm(true), []);
  const closeProgress = useCallback(() => setProgressDeleteConfirm(false), []);

  return {
    book: bookDeleteConfirm,
    progress: progressDeleteConfirm,
    openBook,
    closeBook,
    openProgress,
    closeProgress,
    confirmDeleteBook,
    confirmDeleteProgress,
  };
}

function BookCover({ src, title }) {
  // 실패한 src만 기억 → src가 바뀌면 자동으로 다시 시도
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;
  const initial = (title || '?').trim().slice(0, 1) || '?';
  return (
    <div className="book-detail-cover-wrap">
      <div className="book-detail-cover">
        {showImage ? (
          <AuthenticatedImage src={src} alt={title} onError={() => setFailedSrc(src)} />
        ) : (
          <div className="book-detail-cover-placeholder" aria-hidden="true">
            <span className="book-detail-cover-placeholder-letter">{initial}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressSkeleton() {
  return (
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
}

function ProgressMeta({ readPercent, relativeUpdated, updatedAtIso, hasServerProgress, onDeleteClick }) {
  return (
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
        {relativeUpdated ? (
          <time
            className="book-detail-reader-compact-time"
            dateTime={updatedAtIso ?? undefined}
            aria-label={`최근 업데이트 ${relativeUpdated}`}
          >
            {relativeUpdated}
          </time>
        ) : hasServerProgress ? (
          <span className="book-detail-reader-compact-placeholder">—</span>
        ) : null}
        {hasServerProgress && (
          <button
            type="button"
            className="book-detail-reader-clear-progress"
            onClick={onDeleteClick}
            aria-label="독서 진도 삭제"
          >
            진도 삭제
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBlocks({ loading, error, onRetry }) {
  return (
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
          <button type="button" className="book-detail-error-retry" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
    </>
  );
}

function CharactersPanel({ characterLists, isOpen, onToggle, showMore, onToggleShowMore }) {
  const { unique, sortedMain, sortedOther } = characterLists;
  return (
    <div className="book-detail-panel">
      <CollapsiblePanelHeader
        titleId="book-detail-characters-heading"
        title="등장 인물"
        countLabel={`${unique.length}명`}
        isOpen={isOpen}
        onToggle={onToggle}
        controlsId="book-detail-characters-region"
        toggleOpenLabel="등장 인물 접기"
        toggleClosedLabel="등장 인물 펼치기"
      />
      <div
        id="book-detail-characters-region"
        className={libraryPanelBodyClass(isOpen)}
        role="region"
        aria-labelledby="book-detail-characters-heading"
        aria-hidden={!isOpen}
      >
        {sortedMain.length > 0 && (
          <ul className="book-detail-characters-list">
            {sortedMain.map((character) => (
              <CharacterRow key={character.id ?? character.name} character={character} isMain />
            ))}
          </ul>
        )}

        {sortedOther.length > 0 && (
          <>
            {showMore && (
              <ul className="book-detail-characters-list book-detail-characters-list--secondary">
                {sortedOther.map((character) => (
                  <CharacterRow key={character.id ?? character.name} character={character} />
                ))}
              </ul>
            )}
            <button
              type="button"
              className="book-detail-more-btn"
              onClick={onToggleShowMore}
              aria-expanded={showMore}
            >
              {showMore ? '일반 인물 접기' : `일반 인물 더보기 · ${sortedOther.length}명`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ChaptersPanel({ chapters, bookTitle, currentChapterIndex, isOpen, onToggle, onContinue }) {
  return (
    <div className="book-detail-panel">
      <CollapsiblePanelHeader
        titleId="book-detail-chapters-heading"
        title="목차"
        countLabel={`${chapters.length}챕터`}
        isOpen={isOpen}
        onToggle={onToggle}
        controlsId="book-detail-chapters-region"
        toggleOpenLabel="목차 접기"
        toggleClosedLabel="목차 펼치기"
      />
      <div
        id="book-detail-chapters-region"
        className={libraryPanelBodyClass(isOpen)}
        role="region"
        aria-labelledby="book-detail-chapters-heading"
        aria-hidden={!isOpen}
      >
        <ol className="book-detail-chapters-list">
          {chapters.map((chapter, index) => {
            const { rawTitle, chapterLine, chapterKey, isCurrent, displayNum } =
              formatChapterRowMeta(chapter, bookTitle, index, currentChapterIndex);
            return (
              <li
                key={chapterKey}
                className={
                  isCurrent
                    ? 'book-detail-chapter-item book-detail-chapter-item--current'
                    : 'book-detail-chapter-item'
                }
              >
                <span className="book-detail-chapter-num">{displayNum}</span>
                <span className="book-detail-chapter-title" title={rawTitle || undefined}>
                  {chapterLine}
                </span>
                {isCurrent ? (
                  <button
                    type="button"
                    className="book-detail-chapter-current-badge"
                    onClick={onContinue}
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
  );
}

const BookDetailModal = memo(({ book, isOpen, onClose, onDelete, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const [showMoreCharacters, setShowMoreCharacters] = useState(false);
  const [charactersPanelOpen, setCharactersPanelOpen] = useState(true);
  const [chaptersPanelOpen, setChaptersPanelOpen] = useState(true);
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);

  const serverBookId = resolveServerBookId(book);
  const { bookDetails, loading, error, progressInfo, setProgressInfo, retry: handleRetryFetch } =
    useBookDetails(book, serverBookId, isOpen);

  const characterLists = useMemo(
    () => dedupeAndSortCharacters(bookDetails?.characters),
    [bookDetails?.characters]
  );


  const cachedProgress = serverBookId != null ? getProgressFromCache(serverBookId) : null;
  const progressLocator = resolveProgressLocator(cachedProgress || progressInfo);
  const readPercent = resolveLibraryReadingProgressPercent(book);

  const libraryRelativeUpdated = book?.updatedAt
    ? formatRelativeTime(book.updatedAt, { withTime: false })
    : '';
  const libraryUpdatedAtIso = toLibraryIsoDateOrNull(book?.updatedAt);

  useEffect(() => {
    if (isOpen) {
      setShowMoreCharacters(false);
    }
  }, [isOpen, book?.id]);

  useEffect(() => {
    const len = bookDetails?.chapters?.length ?? 0;
    if (len > 12) {
      setChaptersPanelOpen(false);
    } else if (len > 0) {
      setChaptersPanelOpen(true);
    }
  }, [bookDetails?.id, bookDetails?.chapters?.length]);

  const confirms = useDeleteConfirms({
    isOpen, book, serverBookId, onDelete, onClose, progressInfo, setProgressInfo,
  });

  // 중첩된 ConfirmDialog(삭제 확인)가 열려있는 동안은 Tab 트랩만 양보 — "이전 포커스" 캡처는
  // isOpen 기준으로 유지해 중첩 다이얼로그가 열고 닫힐 때마다 포커스가 두 번 튀지 않게 함
  useModalFocusTrap(isOpen, dialogRef, undefined, {
    initialFocusRef: closeButtonRef,
    suspended: confirms.book || confirms.progress,
  });

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

  const toggleCharactersPanel = useCallback(() => {
    setCharactersPanelOpen((o) => !o);
  }, []);

  const toggleChaptersPanel = useCallback(() => {
    setChaptersPanelOpen((o) => !o);
  }, []);

  const toggleShowMoreCharacters = useCallback(() => {
    setShowMoreCharacters((v) => !v);
  }, []);

  if (!isOpen) return null;

  const { coverSrc, displayTitle, chapterStripBookTitle, displayAuthor } =
    resolveBookDisplay(book, bookDetails);
  const isListView = viewMode === 'list';
  const hasProgress = readPercent > 0 || !!progressInfo;

  const titleBlock = (
    <div className="book-detail-title-row">
      <h2 id="book-detail-title" className="book-detail-title">
        {displayTitle}
      </h2>
      <span className="book-detail-author">{displayAuthor}</span>
    </div>
  );

  return (
    <>
      <div
        ref={dialogRef}
        className="book-detail-modal"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-detail-title"
        aria-describedby="book-detail-modal-desc"
        tabIndex={-1}
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
            <BookCover key={book?.id} src={coverSrc} title={displayTitle} />
            <div className="book-detail-info">
              {titleBlock}
              {loading && !error && <ProgressSkeleton />}
              {!loading && hasProgress && (
                <ProgressMeta
                  readPercent={readPercent}
                  relativeUpdated={libraryRelativeUpdated}
                  updatedAtIso={libraryUpdatedAtIso}
                  hasServerProgress={Boolean(progressInfo)}
                  onDeleteClick={confirms.openProgress}
                />
              )}
              <StatusBlocks loading={loading} error={error} onRetry={handleRetryFetch} />
            </div>
          </div>

          <div className="book-detail-scroll">
            <div className="book-detail-body">
              {bookDetails && (
                <>
                  {characterLists.unique.length > 0 && (
                    <CharactersPanel
                      characterLists={characterLists}
                      isOpen={charactersPanelOpen}
                      onToggle={toggleCharactersPanel}
                      showMore={showMoreCharacters}
                      onToggleShowMore={toggleShowMoreCharacters}
                    />
                  )}
                  {bookDetails.chapters?.length > 0 && (
                    <ChaptersPanel
                      chapters={bookDetails.chapters}
                      bookTitle={chapterStripBookTitle}
                      currentChapterIndex={progressLocator?.chapterIndex}
                      isOpen={chaptersPanelOpen}
                      onToggle={toggleChaptersPanel}
                      onContinue={handleReadClick}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="book-detail-footer-stack">
            <div className="book-detail-actions book-detail-actions--footer">
              <div className="book-detail-footer-row" role="group" aria-label="관계도 및 서재에서 숨기기">
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
                  onClick={confirms.openBook}
                  type="button"
                  aria-label="서재에서 이 책 숨기기"
                >
                  서재에서 숨기기
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirms.book}
        onClose={confirms.closeBook}
        onConfirm={confirms.confirmDeleteBook}
        title={HIDE_BOOK_COPY.title}
        message={HIDE_BOOK_COPY.message}
        confirmLabel={HIDE_BOOK_COPY.confirmLabel}
        manageChrome={false}
      />

      <ConfirmDialog
        isOpen={confirms.progress}
        onClose={confirms.closeProgress}
        onConfirm={confirms.confirmDeleteProgress}
        title="진도 삭제"
        message="독서 진도를 삭제할까요?"
        confirmLabel="삭제"
        manageChrome={false}
      />
    </>
  );
});

BookDetailModal.displayName = 'BookDetailModal';

export default BookDetailModal;

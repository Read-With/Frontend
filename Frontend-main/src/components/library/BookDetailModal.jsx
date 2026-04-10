import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBookManifest, getBookProgress, deleteBookProgress } from '../../utils/api/api';
import { resolveProgressLocator } from '../../utils/common/locatorUtils';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { getServerBookId } from '../../utils/viewer/viewerUtils';
import { USER_VIEWER_PREFIX } from '../../utils/navigation/viewerPaths';
import { toast } from 'react-toastify';
import './BookDetailModal.css';

const BookDetailModal = memo(({ book, isOpen, onClose, onDelete }) => {
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

  const progressLocator = useMemo(
    () => (progressInfo ? resolveProgressLocator(progressInfo) : null),
    [progressInfo]
  );

  const manifestStats = useMemo(() => {
    const chapters = Array.isArray(bookDetails?.chapters) ? bookDetails.chapters : [];
    const pm = bookDetails?.progressMetadata;
    const totalLength = Number(pm?.totalLength);
    const maxChapter = Number(pm?.maxChapter);
    return {
      chapterCount: chapters.length,
      totalLength: Number.isFinite(totalLength) && totalLength > 0 ? totalLength : null,
      maxChapter: Number.isFinite(maxChapter) && maxChapter > 0 ? maxChapter : chapters.length,
    };
  }, [bookDetails?.chapters, bookDetails?.progressMetadata]);

  const readerMeta = useMemo(() => {
    const { chapterCount, totalLength, maxChapter } = manifestStats;
    let readPercent = null;
    if (totalLength != null && progressInfo && Number.isFinite(Number(progressInfo.startTxtOffset))) {
      const ratio = Number(progressInfo.startTxtOffset) / totalLength;
      readPercent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
    } else if (progressLocator && chapterCount > 0) {
      const mc = Math.max(1, maxChapter || chapterCount);
      const ch = progressLocator.chapterIndex;
      if (Number.isFinite(ch) && ch >= 1) {
        readPercent = Math.min(100, Math.max(0, Math.round((ch / mc) * 100)));
      }
    }

    let lastReadFormatted = null;
    let lastReadCompact = null;
    let lastReadAt = null;
    if (progressInfo?.updatedAt) {
      const d = new Date(progressInfo.updatedAt);
      lastReadAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
      lastReadFormatted = d.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      lastReadCompact = d.toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    return {
      readPercent,
      lastReadFormatted,
      lastReadCompact,
      lastReadAt,
      hasReadingRecord: !!progressInfo,
    };
  }, [manifestStats, progressInfo, progressLocator]);

  const fetchProgressInfo = useCallback(async () => {
    const serverBookId = getServerBookId(book);
    
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
    const serverBookId = getServerBookId(book);
    
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
        // 정규화된 manifest 데이터 가져오기 (캐시에서 가져오면 정규화됨)
        const normalizedManifest = getManifestFromCache(serverBookId) || manifestData.result;
        
        // API 응답 구조에 맞게 데이터 처리
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
    const id = book?.id ?? getServerBookId(book);
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

  const handleGraphClick = useCallback(() => navigateToBookPage('/user/graph'), [navigateToBookPage]);

  const handleRetryFetch = useCallback(() => {
    fetchBookDetails();
    fetchProgressInfo();
  }, [fetchBookDetails, fetchProgressInfo]);

  // 진도 삭제 - useMutation + 낙관적 업데이트
  const deleteProgressMutation = useMutation({
    mutationFn: (bookId) => deleteBookProgress(bookId),
    onMutate: async () => {
      // 낙관적 업데이트 - 즉시 UI 반영
      const previousProgress = progressInfo;
      setProgressInfo(null);
      return { previousProgress };
    },
    onSuccess: () => {
      toast.success('독서 진도가 삭제되었습니다');
      // 책 목록 무효화 (진도율 업데이트)
      queryClient.invalidateQueries({ queryKey: ['books', 'server'] });
    },
    onError: (err, variables, context) => {
      // 롤백
      if (context?.previousProgress) {
        setProgressInfo(context.previousProgress);
      }
      console.error('독서 진도 삭제 실패:', err);
      toast.error('독서 진도 삭제에 실패했습니다');
    },
  });

  const handleDeleteProgress = useCallback(async () => {
    const serverBookId = getServerBookId(book);
    
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
    } catch (_err) {
      // 에러는 onError에서 처리
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
  const displayTitle = bookDetails?.title || book?.title || '제목 없음';
  const displayAuthor = bookDetails?.author || book?.author || '저자 정보 없음';
  const coverInitial = (displayTitle || '?').trim().slice(0, 1) || '?';
  const currentChapterIndex = progressLocator?.chapterIndex;

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
        책 표지와 제목, 독서 진도, 등장 인물과 목차를 확인할 수 있습니다.
      </p>
      <div className="book-detail-content" onClick={(e) => e.stopPropagation()}>
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

        <div className="book-detail-header">
          <div className="book-detail-cover-wrap">
            <div className="book-detail-cover">
              {coverSrc && !coverImgFailed ? (
                <img
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
          <div className="book-detail-info">
            <div className="book-detail-title-row">
              <h2 id="book-detail-title" className="book-detail-title">
                {displayTitle}
              </h2>
              <span className="book-detail-author">{displayAuthor}</span>
            </div>
            {loading && !error && (
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
            )}
            {!loading && (readerMeta.hasReadingRecord || readerMeta.readPercent != null) && (
              <div
                className="book-detail-reader-meta book-detail-reader-meta--compact"
                role="region"
                aria-label="독서 진행"
              >
                {readerMeta.readPercent != null && (
                  <div className="book-detail-reader-progress-row">
                    <div
                      className="book-detail-reader-progress"
                      role="progressbar"
                      aria-valuenow={readerMeta.readPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuetext={`${readerMeta.readPercent}% 읽음`}
                      aria-label={`읽기 진행 ${readerMeta.readPercent}%`}
                    >
                      <div
                        className="book-detail-reader-progress-fill"
                        style={{ width: `${readerMeta.readPercent}%` }}
                      />
                    </div>
                    <span className="book-detail-reader-progress-pct" aria-hidden="true">
                      <span className="book-detail-reader-progress-pct-value">
                        {readerMeta.readPercent}
                      </span>
                      %
                    </span>
                  </div>
                )}
                <div className="book-detail-reader-compact-foot">
                  {readerMeta.lastReadCompact ? (
                    <time
                      className="book-detail-reader-compact-time"
                      dateTime={readerMeta.lastReadAt ?? undefined}
                      title={readerMeta.lastReadFormatted ?? undefined}
                      aria-label={
                        readerMeta.lastReadFormatted
                          ? `마지막으로 읽음 ${readerMeta.lastReadFormatted}`
                          : undefined
                      }
                    >
                      {readerMeta.lastReadCompact}
                    </time>
                  ) : readerMeta.hasReadingRecord ? (
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
            )}
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
                      등장 인물
                    </h3>
                    <div className="book-detail-panel-head-actions">
                      <span className="book-detail-panel-count">{characterLists.unique.length}명</span>
                      <button
                        type="button"
                        className="book-detail-panel-toggle"
                        onClick={() => setCharactersPanelOpen((o) => !o)}
                        aria-expanded={charactersPanelOpen}
                        aria-controls="book-detail-characters-region"
                        aria-labelledby="book-detail-characters-heading"
                      >
                        <span className="book-detail-panel-toggle-sr">
                          {charactersPanelOpen ? '등장 인물 접기' : '등장 인물 펼치기'}
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
                                <img
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
                            <span className="character-badge" aria-label="주요 인물">
                              주연
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
                                    <img
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
                  <div className="book-detail-panel-head">
                    <h3 className="book-detail-panel-title" id="book-detail-chapters-heading">
                      목차
                    </h3>
                    <div className="book-detail-panel-head-actions">
                      <span className="book-detail-panel-count">{bookDetails.chapters.length}챕터</span>
                      <button
                        type="button"
                        className="book-detail-panel-toggle"
                        onClick={() => setChaptersPanelOpen((o) => !o)}
                        aria-expanded={chaptersPanelOpen}
                        aria-controls="book-detail-chapters-region"
                        aria-labelledby="book-detail-chapters-heading"
                      >
                        <span className="book-detail-panel-toggle-sr">
                          {chaptersPanelOpen ? '목차 접기' : '목차 펼치기'}
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
                        const chapterTitle =
                          chapter.title ||
                          chapter.chapterTitle ||
                          chapter.name ||
                          chapter.chapterName ||
                          '';
                        const chapterIdx =
                          chapter.idx ??
                          chapter.chapterIdx ??
                          chapter.chapter ??
                          chapter.number ??
                          index + 1;
                        const chapterKey = chapter.id ?? chapter.href ?? `${chapterIdx}-${chapterTitle}`;
                        const idxNum = Number(chapterIdx);
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
                            <span className="book-detail-chapter-num">{chapterIdx}</span>
                            <span className="book-detail-chapter-title">
                              {chapterTitle || '제목 없음'}
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
                서재에서 이 책을 삭제할까요? 이 작업은 되돌릴 수 없습니다.
              </p>
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
  onDelete: PropTypes.func
};

BookDetailModal.displayName = 'BookDetailModal';

export default BookDetailModal;


import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import ViewerLayout from './ViewerLayout';
import XhtmlViewer from './XhtmlViewer';
import ViewerSettings from './ViewerSettings';
import { useViewerPage } from '../../hooks/viewer/useViewerPage';
import { useModalFocusTrap, useLatestRef } from '../../hooks/common/hooksShared';
import { useTooltipState } from '../../hooks/ui/tooltipHooks';
import { anchorToLocators, resolveChapterIndex } from '../../utils/common/valueUtils';
import {
  resolveViewerLineEvent,
  parseReadingLocatorKey,
  patchTopBarFromLineEvent,
} from '../../utils/viewer/viewerSession';
import { isSameBookmarkPosition, normalizeBookmarkLocators } from '../../utils/bookmarks/bookmarkUtils';
import { errorUtils } from '../../utils/common/urlUtils';
import GraphSplitArea from './GraphSplitArea';
import '../../pages/BookmarksPage.css';

const TOOLBAR_REVEAL_ZONE_PX = 72;

function BookmarkDeleteConfirm({
  open,
  busy,
  onCancel,
  onConfirm,
}) {
  const dialogRef = useRef(null);
  const busyRef = useLatestRef(busy);
  const onCancelRef = useLatestRef(onCancel);
  // busy/onCancel을 ref로 안정화 — useModalFocusTrap의 onClose 참조가 busy 토글마다 바뀌면
  // effect가 재실행되며 (버튼이 disabled된) 다이얼로그로 포커스가 불필요하게 튐
  const handleClose = useCallback(() => {
    if (!busyRef.current) onCancelRef.current?.();
  }, [busyRef, onCancelRef]);

  useModalFocusTrap(open, dialogRef, handleClose);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="bm-confirm-overlay"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        className="bm-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-bookmark-delete-title"
        aria-describedby="viewer-bookmark-delete-desc"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <p id="viewer-bookmark-delete-title" className="bm-confirm-title">
          북마크를 삭제할까요?
        </p>
        <p id="viewer-bookmark-delete-desc" className="bm-confirm-desc">
          현재 위치에 표시된 북마크가 제거됩니다.
        </p>
        <div className="bm-confirm-actions">
          <button
            type="button"
            className="bm-btn bm-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="bm-btn bm-btn-confirm-delete"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ViewerPage = () => {
  const {
    viewerRef,
    reloadKey,
    showSettingsModal,
    setShowSettingsModal,
    setCurrentPage,
    setTotalPages,
    setCurrentChapter,
    setCurrentEvent,
    setShowToolbar,
    bookmarks,
    manifestLoaded,
    handlePrevPage,
    handleNextPage,
    handleAddBookmark,
    removeBookmark,
    isBookmarkMutating,
    handleApplySettings,
    onToggleBookmarkList,
    handleSliderChange,
    toggleGraph,
    restoreAfterViewerLayoutChange,
    exitToMypage,
    graphStateWithProgress,
    graphActions,
    viewerState,
    searchState,
    searchActions,
    previousPage,
    isFromLibrary,
    setProgressTopBar,
    readingLocatorKey,
    serverResumeAnchor: resumeAnchor,
    applyReadingLocator,
    markViewerPageReady,
    isViewerPageReady,
    isResumePending,
    cachedLocation,
    transitionState,
    graphApiError: apiError,
    flushProgressAsync,
  } = useViewerPage();

  const [toolbarDeleteConfirmId, setToolbarDeleteConfirmId] = useState(null);

  const {
    currentChapter,
    showGraph,
    graphFullScreen,
    progressMetricsReady,
  } = graphStateWithProgress;
  const {
    book,
    bookKey,
    progress,
    settings,
    currentPage,
    totalPages,
    showToolbar,
  } = viewerState;

  const suppressViewport =
    !isViewerPageReady && (isResumePending || Boolean(resumeAnchor));

  const readingChapterRef = useLatestRef(currentChapter);
  const showToolbarRef = useLatestRef(showToolbar);

  const graphClearRef = useRef(null);

  useEffect(() => {
    const revealIfHidden = (clientY) => {
      if (showToolbarRef.current) return;
      const nearTop = clientY <= TOOLBAR_REVEAL_ZONE_PX;
      const nearBottom =
        clientY >= window.innerHeight - TOOLBAR_REVEAL_ZONE_PX;
      if (nearTop || nearBottom) setShowToolbar(true);
    };
    const onMouseMove = (event) => revealIfHidden(event.clientY);
    const onTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (touch) revealIfHidden(touch.clientY);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouchStart);
    };
  }, [setShowToolbar]);

  const toggleToolbar = useCallback(() => {
    setShowToolbar((prev) => !prev);
  }, [setShowToolbar]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable], [role="dialog"]')) {
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggleToolbar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleToolbar]);

  const dismissDeleteConfirm = useCallback(() => {
    setToolbarDeleteConfirmId(null);
  }, []);

  const openSettings = useCallback(() => {
    setShowSettingsModal(true);
  }, [setShowSettingsModal]);

  const closeSettings = useCallback(() => {
    setShowSettingsModal(false);
  }, [setShowSettingsModal]);

  const onAddBookmark = useCallback(async () => {
    const result = await handleAddBookmark();
    if (result?.needsConfirm) {
      setToolbarDeleteConfirmId(result.bookmarkId);
    }
  }, [handleAddBookmark]);

  const confirmToolbarDelete = useCallback(async () => {
    if (toolbarDeleteConfirmId == null) return;
    try {
      await removeBookmark(toolbarDeleteConfirmId);
      setToolbarDeleteConfirmId(null);
    } catch (error) {
      errorUtils.logError('[ViewerPage] 북마크 삭제 실패', error, { bookmarkId: toolbarDeleteConfirmId });
      toast.error('북마크 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, [toolbarDeleteConfirmId, removeBookmark]);

  const onTooltipError = useCallback(() => {
    toast.error('노드 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }, []);

  const {
    activeTooltip,
    handleClearTooltip: onClearTooltip,
    handleSetActiveTooltip: onSetActiveTooltip,
  } = useTooltipState({
    onError: onTooltipError,
    graphClearRef,
  });

  const isBookmarked = useMemo(() => {
    if (!bookmarks?.length || !readingLocatorKey || !bookKey) return false;
    const { start, end } = parseReadingLocatorKey(readingLocatorKey);
    if (!start) return false;
    const { startLocator, endLocator } = normalizeBookmarkLocators(
      bookKey,
      start,
      end ?? start
    );
    if (!startLocator) return false;
    return bookmarks.some((bookmark) =>
      isSameBookmarkPosition(bookmark, {
        startLocator,
        endLocator: endLocator ?? startLocator,
      })
    );
  }, [bookmarks, readingLocatorKey, bookKey]);

  const handleCurrentLineChange = useCallback(
    (receivedEvent) => {
      if (!receivedEvent) return;

      markViewerPageReady();

      const { nextEvent, nextChapter } = resolveViewerLineEvent({
        receivedEvent,
        book,
        bookKey,
      });

      const { startLocator, endLocator } = anchorToLocators(
        receivedEvent?.anchor ?? nextEvent?.anchor
      );

      const locatorChapter = resolveChapterIndex(startLocator);
      const resolvedChapter =
        nextChapter ??
        (Number.isFinite(locatorChapter) && locatorChapter > 0 ? locatorChapter : null);

      if (resolvedChapter && resolvedChapter !== readingChapterRef.current) {
        setCurrentChapter(resolvedChapter);
      }

      setCurrentEvent(nextEvent);
      applyReadingLocator(startLocator, endLocator);
      setProgressTopBar((prev) => patchTopBarFromLineEvent(prev, nextEvent, startLocator));
    },
    [
      book,
      bookKey,
      markViewerPageReady,
      setCurrentChapter,
      setCurrentEvent,
      applyReadingLocator,
      setProgressTopBar,
    ]
  );

  const handleExitToMypage = useCallback(async () => {
    try {
      const res = await flushProgressAsync();
      if (res?.isSuccess === false && !res.skipped && !res.deduped) {
        errorUtils.logWarning(
          '[ViewerPage] 마이페이지 이동 전 진도 저장 실패',
          res?.message || '알 수 없는 오류',
          { bookId: bookKey }
        );
      }
    } catch {
      /* 저장 실패해도 이탈 */
    } finally {
      exitToMypage();
    }
  }, [bookKey, flushProgressAsync, exitToMypage]);

  const tooltipProps = useMemo(
    () => ({
      activeTooltip,
      onClearTooltip,
      onSetActiveTooltip,
      graphClearRef,
    }),
    [activeTooltip, onClearTooltip, onSetActiveTooltip]
  );

  const rightSideContent = useMemo(() => {
    if (!showGraph) return null;
    return (
      <GraphSplitArea
        graphState={graphStateWithProgress}
        graphActions={graphActions}
        viewerState={viewerState}
        searchState={searchState}
        searchActions={searchActions}
        tooltipProps={tooltipProps}
        transitionState={transitionState}
        apiError={apiError}
        cachedLocation={cachedLocation}
        resumeAnchor={resumeAnchor}
        onToggleGraph={toggleGraph}
      />
    );
  }, [
    showGraph,
    graphStateWithProgress,
    graphActions,
    viewerState,
    searchState,
    searchActions,
    tooltipProps,
    transitionState,
    apiError,
    cachedLocation,
    resumeAnchor,
    toggleGraph,
  ]);

  return (
    <div className="h-screen">
      <ViewerLayout
        showToolbar={showToolbar}
        currentChapter={currentChapter}
        progress={progress}
        progressMetricsReady={progressMetricsReady}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
        isBookmarked={isBookmarked}
        onToggleBookmarkList={onToggleBookmarkList}
        onAddBookmark={onAddBookmark}
        onOpenSettings={openSettings}
        onSliderChange={handleSliderChange}
        currentPage={currentPage}
        totalPages={totalPages}
        showGraph={showGraph}
        onToggleGraph={toggleGraph}
        graphFullScreen={graphFullScreen}
        isFromLibrary={isFromLibrary}
        previousPage={previousPage}
        onExitToMypage={handleExitToMypage}
        rightSideContent={rightSideContent}
        onViewerLayoutSettled={restoreAfterViewerLayoutChange}
      >
        <XhtmlViewer
          key={reloadKey}
          ref={viewerRef}
          book={book}
          manifestReady={manifestLoaded}
          onCurrentPageChange={setCurrentPage}
          onTotalPagesChange={setTotalPages}
          settings={settings}
          onCurrentLineChange={handleCurrentLineChange}
          bookKey={bookKey}
          suppressViewport={suppressViewport}
          suppressMessage={
            resumeAnchor ? '읽던 위치로 이동 중...' : '로딩 중...'
          }
          onToggleChrome={toggleToolbar}
        />
        <ViewerSettings
          isOpen={showSettingsModal}
          onClose={closeSettings}
          onApplySettings={handleApplySettings}
          settings={settings}
        />
      </ViewerLayout>

      <BookmarkDeleteConfirm
        open={toolbarDeleteConfirmId != null}
        busy={isBookmarkMutating}
        onCancel={dismissDeleteConfirm}
        onConfirm={confirmToolbarDelete}
      />
    </div>
  );
};

export default ViewerPage;

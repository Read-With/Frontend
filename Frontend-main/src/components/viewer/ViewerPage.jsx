import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import ViewerLayout from './ViewerLayout';
import XhtmlViewer from './XhtmlViewer';
import ViewerSettings from './ViewerSettings';
import { useViewerPage } from '../../hooks/viewer/useViewerPage';
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
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="bm-confirm-overlay"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="bm-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-bookmark-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="viewer-bookmark-delete-title" className="bm-confirm-title">
          현재 위치의 북마크를 삭제하시겠습니까?
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
            className="bm-btn bm-btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            삭제
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
    serverResumeAnchor,
    applyReadingLocator,
    markViewerPageReady,
    isViewerPageReady,
    isResumePending,
    cachedLocation,
    transitionState,
    graphApiError,
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
    !isViewerPageReady && (isResumePending || Boolean(serverResumeAnchor));

  const readingChapterRef = useRef(currentChapter);
  readingChapterRef.current = currentChapter;

  const showToolbarRef = useRef(showToolbar);
  showToolbarRef.current = showToolbar;

  const graphClearRef = useRef(null);

  useEffect(() => {
    const updateFromClientY = (clientY) => {
      const nearTop = clientY <= TOOLBAR_REVEAL_ZONE_PX;
      const nearBottom =
        clientY >= window.innerHeight - TOOLBAR_REVEAL_ZONE_PX;
      const next = nearTop || nearBottom;
      if (showToolbarRef.current !== next) {
        setShowToolbar(next);
      }
    };
    const onMouseMove = (event) => updateFromClientY(event.clientY);
    const onTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (touch) updateFromClientY(touch.clientY);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouchStart);
    };
  }, [setShowToolbar]);

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
    await removeBookmark(toolbarDeleteConfirmId);
    setToolbarDeleteConfirmId(null);
  }, [toolbarDeleteConfirmId, removeBookmark]);

  const onTooltipError = useCallback(() => {
    toast.error('노드 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }, []);

  const {
    activeTooltip,
    handleClearTooltip,
    handleSetActiveTooltip,
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

      const { startLocator: lineLocator, endLocator: lineEnd } = anchorToLocators(
        receivedEvent?.anchor ?? nextEvent?.anchor
      );

      const locatorChapter = resolveChapterIndex(lineLocator);
      const resolvedChapter =
        nextChapter ??
        (Number.isFinite(locatorChapter) && locatorChapter > 0 ? locatorChapter : null);

      if (resolvedChapter && resolvedChapter !== readingChapterRef.current) {
        setCurrentChapter(resolvedChapter);
      }

      setCurrentEvent(nextEvent);
      applyReadingLocator(lineLocator, lineEnd);
      setProgressTopBar((prev) => patchTopBarFromLineEvent(prev, nextEvent, lineLocator));
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
      onClearTooltip: handleClearTooltip,
      onSetActiveTooltip: handleSetActiveTooltip,
      graphClearRef,
    }),
    [activeTooltip, handleClearTooltip, handleSetActiveTooltip]
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
        apiError={graphApiError}
        cachedLocation={cachedLocation}
        resumeAnchor={serverResumeAnchor}
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
    graphApiError,
    cachedLocation,
    serverResumeAnchor,
    toggleGraph,
  ]);

  return (
    <div className="h-screen">
      <ViewerLayout
        showControls={showToolbar}
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
          bookId={bookKey}
          suppressViewport={suppressViewport}
          suppressMessage={
            serverResumeAnchor ? '읽던 위치로 이동 중...' : '로딩 중...'
          }
        />
        <ViewerSettings
          isOpen={showSettingsModal}
          onClose={closeSettings}
          onApplySettings={handleApplySettings}
          currentSettings={settings}
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

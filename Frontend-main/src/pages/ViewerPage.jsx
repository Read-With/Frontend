import { useRef, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-toastify';
import ViewerLayout from '../components/viewer/ViewerLayout';
import XhtmlViewer from '../components/viewer/XhtmlViewer';
import ViewerSettings from '../components/viewer/ViewerSettings';
import { useViewerPage } from '../hooks/viewer/useViewerPage';
import { useLatestRef } from '../hooks/common/hooksShared';
import { useTooltipState } from '../hooks/tooltipHooks';
import { resolveChapterIndex, errorUtils, toPositiveNumberOrNull } from '../utils/common/valueUtils';
import { anchorToLocators } from '../utils/common/locator';
import { resolveViewerLineEvent, patchTopBarFromLineEvent } from '../utils/viewer/viewerSession';
import { isTypingTarget } from '../utils/common/domUtils';
import GraphSplitArea from '../components/viewer/GraphSplitArea';
import ConfirmDialog from '../components/common/ConfirmDialog';

const TOOLBAR_REVEAL_ZONE_PX = 72;

const ViewerPage = () => {
  const {
    viewerRef,
    reloadKey,
    bookmarkUi,
    settingsUi,
    setCurrentPage,
    setTotalPages,
    setCurrentChapter,
    setCurrentEvent,
    setShowToolbar,
    manifestLoaded,
    handlePrevPage,
    handleNextPage,
    handleSliderChange,
    toggleGraph,
    restoreAfterViewerLayoutChange,
    exitToMypage,
    graphStateWithProgress,
    graphActions,
    viewerState,
    searchState,
    searchActions,
    setProgressTopBar,
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
  }, [setShowToolbar, showToolbarRef]);

  const toggleToolbar = useCallback(() => {
    setShowToolbar((prev) => !prev);
  }, [setShowToolbar]);

  useEffect(() => {
    const onKey = (e) => {
      if (isTypingTarget(e.target) || e.target.closest?.('[role="dialog"]')) {
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
      const resolvedChapter = nextChapter ?? toPositiveNumberOrNull(locatorChapter);

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
      readingChapterRef,
      setCurrentChapter,
      setCurrentEvent,
      applyReadingLocator,
      setProgressTopBar,
    ]
  );

  const handleExitToMypage = useCallback(async () => {
    let saved = true;
    try {
      const res = await flushProgressAsync();
      if (res?.isSuccess === false && !res.skipped && !res.deduped) {
        saved = false;
        errorUtils.logWarning(
          '[ViewerPage] 마이페이지 이동 전 진도 저장 실패',
          res?.message || '알 수 없는 오류',
          { bookId: bookKey }
        );
      }
    } catch {
      saved = false; // 저장 실패해도 이탈
    } finally {
      if (!saved) {
        toast.warning('읽던 위치를 저장하지 못했어요. 다음에 열 때 위치가 조금 다를 수 있어요.');
      }
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
        isBookmarked={bookmarkUi.isBookmarked}
        onToggleBookmarkList={bookmarkUi.onOpenList}
        onAddBookmark={bookmarkUi.onAdd}
        onOpenSettings={settingsUi.open}
        onSliderChange={handleSliderChange}
        currentPage={currentPage}
        totalPages={totalPages}
        showGraph={showGraph}
        onToggleGraph={toggleGraph}
        graphFullScreen={graphFullScreen}
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
            resumeAnchor ? '읽던 위치로 이동 중…' : '로딩 중…'
          }
          onToggleChrome={toggleToolbar}
        />
        <ViewerSettings
          isOpen={settingsUi.isOpen}
          onClose={settingsUi.close}
          onApplySettings={settingsUi.apply}
          settings={settings}
        />
      </ViewerLayout>

      <ConfirmDialog
        {...bookmarkUi.deleteConfirm}
        title="북마크를 삭제할까요?"
        message="현재 위치에 표시된 북마크가 제거됩니다."
      />
    </div>
  );
};

export default ViewerPage;

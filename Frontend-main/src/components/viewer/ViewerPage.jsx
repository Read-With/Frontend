import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import ViewerLayout from "./ViewerLayout";
import XhtmlViewer from "./xhtml/XhtmlViewer";
import BookmarkPanel from "./bookmark/BookmarkPanel";
import ViewerSettings from "./ui/ViewerSettings";
import { useViewerPage } from "../../hooks/viewer/useViewerPage";
import { useTooltipState } from "../../hooks/ui/tooltipHooks";
import { anchorToLocators } from "../../utils/common/locatorUtils";
import { eventUtils } from "../../utils/viewer/viewerCoreStateUtils";
import { resolveViewerLineEvent } from "../../utils/viewer/viewerEventProgressUtils";
import { restoreGraphLayout, preloadChapterLayouts } from "../../utils/graph/graphLayoutUtils";
import { isSameBookmarkPosition } from "../../utils/bookmarks/bookmarkUtils";
import { errorUtils } from "../../utils/common/errorUtils";
import GraphSplitArea from "./GraphSplitArea";
import {
  parseReadingLocatorKey,
  patchTopBarFromLineEvent,
} from "../../utils/viewer/viewerEventProgressUtils";

const TOOLBAR_REVEAL_ZONE_PX = 72;

const ViewerPage = () => {
  const {
    viewerRef,
    reloadKey,
    showSettingsModal,
    setProgress,
    setCurrentPage,
    setTotalPages,
    setCurrentChapter,
    setCurrentEvent,
    setGraphViewState,
    setCurrentCharIndex,
    setShowToolbar,
    bookmarks,
    showBookmarkList,
    book,
    folderKey,
    bookKey,
    manifestLoaded,
    handlePrevPage,
    handleNextPage,
    handleAddBookmark,
    handleBookmarkSelect,
    handleOpenSettings,
    handleCloseSettings,
    handleApplySettings,
    onToggleBookmarkList,
    handleSliderChange,
    toggleGraph,
    exitToMypage,
    graphState,
    graphStateWithProgress,
    graphActions,
    viewerState,
    searchState,
    searchActions,
    previousPage,
    isFromLibrary,
    setProgressTopBar,
    progressMetricsReady,
    readingLocatorKey,
    serverResumeAnchor,
    applyReadingLocator,
    updateReadingPercent,
    markViewerPageReady,
    cachedLocation,
    transitionState,
    graphApiError,
    flushProgressAsync,
  } = useViewerPage();

  const { currentChapter, currentEvent, showGraph, graphFullScreen } = graphState;
  const {
    progress,
    settings,
    currentPage,
    totalPages,
    showToolbar,
    isDataReady,
  } = viewerState;

  const readingChapterRef = useRef(currentChapter);
  const lastRestoredLayoutKeyRef = useRef("");
  const showToolbarRef = useRef(showToolbar);
  const graphClearRef = useRef(null);

  useEffect(() => {
    readingChapterRef.current = currentChapter;
  }, [currentChapter]);

  useEffect(() => {
    showToolbarRef.current = showToolbar;
  }, [showToolbar]);

  useEffect(() => {
    lastRestoredLayoutKeyRef.current = "";
  }, [bookKey, currentChapter]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      const next = event.clientY <= TOOLBAR_REVEAL_ZONE_PX;
      if (showToolbarRef.current !== next) {
        setShowToolbar(next);
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [setShowToolbar]);

  const {
    activeTooltip,
    handleClearTooltip,
    handleSetActiveTooltip,
  } = useTooltipState({
    onError: () => {
      toast.error("노드 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", {
        autoClose: 2000,
        closeOnClick: true,
        pauseOnHover: true,
      });
    },
    graphClearRef,
  });

  const isBookmarked = useMemo(() => {
    if (!bookmarks?.length || !readingLocatorKey) return false;
    const { start, end } = parseReadingLocatorKey(readingLocatorKey);
    if (!start) return false;
    return bookmarks.some((bookmark) =>
      isSameBookmarkPosition(bookmark, { startLocator: start, endLocator: end ?? start })
    );
  }, [bookmarks, readingLocatorKey]);

  const handleCurrentLineChange = useCallback(
    (charIndex, _totalEvents, receivedEvent) => {
      setCurrentCharIndex(charIndex);
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

      const locatorChapter = Number(lineLocator?.chapterIndex);
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
      setCurrentCharIndex,
      setCurrentEvent,
      applyReadingLocator,
      setProgressTopBar,
    ]
  );

  const handleExitToMypage = useCallback(async () => {
    try {
      const res = await flushProgressAsync();
      if (res && res.isSuccess === false && !res.skipped && !res.deduped) {
        errorUtils.logWarning(
          "[ViewerPage] 마이페이지 이동 전 진도 저장 실패",
          res?.message || "알 수 없는 오류",
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

  useEffect(() => {
    if (!isDataReady || !currentEvent) return;

    const eventNum = eventUtils.resolveEventOrdinal(currentEvent) ?? 0;
    const layoutKey = `${currentChapter}:${eventNum}`;
    if (lastRestoredLayoutKeyRef.current === layoutKey) return;

    const restoredLayout = restoreGraphLayout(currentEvent, currentChapter);
    if (restoredLayout) {
      lastRestoredLayoutKeyRef.current = layoutKey;
      setGraphViewState(restoredLayout);
    }
  }, [isDataReady, currentEvent, currentChapter, setGraphViewState]);

  useEffect(() => {
    if (!folderKey || !bookKey) return;

    const abortController = new AbortController();
    preloadChapterLayouts({
      folderKey,
      bookKey,
      signal: abortController.signal,
    });

    return () => {
      abortController.abort();
    };
  }, [folderKey, bookKey]);

  return (
    <div className="h-screen">
      <ViewerLayout
        showControls={showToolbar}
        currentChapter={currentChapter}
        progress={progress}
        setProgress={setProgress}
        progressMetricsReady={progressMetricsReady}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
        isBookmarked={isBookmarked}
        onToggleBookmarkList={onToggleBookmarkList}
        onAddBookmark={handleAddBookmark}
        onOpenSettings={handleOpenSettings}
        onSliderChange={handleSliderChange}
        currentPage={currentPage}
        totalPages={totalPages}
        showGraph={showGraph}
        onToggleGraph={toggleGraph}
        pageMode={settings.pageMode}
        graphFullScreen={graphFullScreen}
        isFromLibrary={isFromLibrary}
        previousPage={previousPage}
        onExitToMypage={handleExitToMypage}
        rightSideContent={
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
          />
        }
      >
        <XhtmlViewer
          key={reloadKey}
          ref={viewerRef}
          book={book}
          manifestReady={manifestLoaded}
          initialAnchor={serverResumeAnchor ?? undefined}
          onProgressChange={updateReadingPercent}
          onCurrentPageChange={setCurrentPage}
          onTotalPagesChange={setTotalPages}
          settings={settings}
          onCurrentLineChange={handleCurrentLineChange}
          bookId={bookKey}
        />
        {showBookmarkList && bookKey && (
          <BookmarkPanel bookId={bookKey} onSelect={handleBookmarkSelect} />
        )}

        <ViewerSettings
          isOpen={showSettingsModal}
          onClose={handleCloseSettings}
          onApplySettings={handleApplySettings}
          currentSettings={settings}
        />
      </ViewerLayout>
      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop
        closeOnClick
      />
    </div>
  );
};

export default ViewerPage;

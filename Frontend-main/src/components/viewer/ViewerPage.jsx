import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import ViewerLayout from "./ViewerLayout";
import XhtmlViewer from "./xhtml/XhtmlViewer";
import BookmarkPanel from "./bookmark/BookmarkPanel";
import ViewerSettings from "./ui/ViewerSettings";
import { useViewerPage } from "../../hooks/viewer/useViewerPage";
import { useGraphSearch } from "../../hooks/graph/useGraphSearch";
import { useTransitionState } from "../../hooks/ui/useTransitionState";
import { useProgressAutoSave } from "../../hooks/viewer/useProgressAutoSave";
import { useTooltipState } from "../../hooks/ui/useTooltipState";
import { useCachedLocation } from "../../hooks/viewer/useCachedLocation";
import { saveProgress, getBookProgress } from "../../utils/api/api";
import {
  anchorToLocators,
  locatorsEqual,
  progressResultToViewerAnchor,
  toLocator,
  viewerResumeAnchorKey,
} from "../../utils/common/locatorUtils";
import { getCachedChapterEvents, getCachedReaderProgress, isGraphBookCacheBuilding, ensureGraphBookCache } from "../../utils/common/cache/chapterEventCache";
import {
  eventUtils,
  cacheKeyUtils,
} from "../../utils/viewer/viewerUtils";
import {
  resolveDisplayedEventNum,
} from "../../utils/viewer/eventDisplayUtils";
import { restoreGraphLayout, preloadChapterLayouts } from "../../utils/graph/graphLayoutUtils";
import { removeBookmarkHighlights } from "./bookmark/BookmarkManager";
import { errorUtils } from "../../utils/common/errorUtils";
import GraphSplitArea from "./GraphSplitArea";
import {
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
  normalizeReadingProgressPercent,
} from "../../utils/common/cache/progressCache";
import { resolveViewerLineEvent } from "../../utils/viewer/viewerLineEventResolver";
import { useFineGraphLoader } from "../../hooks/viewer/useFineGraphLoader";

// ??곷선癰귣떯由?displayAt ??彛? 癰귣챶揆夷??됱뵠?袁⑹뜍 筌왖????揶쏄쑵肉???쎈솭 獄쎻뫗?
const VIEWER_RESUME_POLL_MS = 100;
const VIEWER_RESUME_MAX_ATTEMPTS = 150;

function progressRowToTopBar(row) {
  if (!row || typeof row !== "object") {
    return {
      eventNum: null,
      chapterProgress: null,
      readingProgressPercent: null,
      eventName: "",
    };
  }
  const explicit = Number(row.eventNum);
  const fromId = resolveDisplayedEventNum(row);
  const eventNum =
    Number.isFinite(explicit) && explicit > 0
      ? explicit
      : fromId > 0
        ? fromId
        : null;
  const cp = Number(row.chapterProgress);
  const pct = normalizeReadingProgressPercent(row);
  return {
    eventNum,
    chapterProgress: Number.isFinite(cp) ? Math.min(100, Math.max(0, cp)) : null,
    readingProgressPercent: pct,
    eventName: String(row.eventName ?? row.eventTitle ?? row.name ?? "").trim(),
  };
}

const ViewerPage = () => {
  const {
    viewerRef, reloadKey, setReloadKey, progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal,
    settings, currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    events: _events, setEvents, showGraph, elements, setElements, setGraphViewState,
    setCurrentCharIndex,
    loading, setLoading,
    isDataReady, setIsDataReady, isReloading,
    isGraphLoading, setIsGraphLoading, setFineGraphLoading, showToolbar, setShowToolbar,
    bookmarks, showBookmarkList,
    prevElementsRef, book, folderKey, currentChapterData,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, toggleGraph,
    graphState, graphActions, viewerState, searchState, graphFullScreen,
    previousPage, isFromLibrary, bookId, cleanBookId, exitToMypage,
    manifestLoaded,
  } = useViewerPage();

  const bookKey = useMemo(() => {
    const id = cleanBookId ?? bookId ?? book?.id;
    if (id == null) return null;
    const trimmed = String(id).trim();
    return trimmed || null;
  }, [cleanBookId, bookId, book?.id]);

  const [progressTopBar, setProgressTopBar] = useState(undefined);

  const [serverResumeAnchor, setServerResumeAnchor] = useState(null);
  const serverResumeAppliedKeyRef = useRef(null);
  const reloadKeyBumpedForBookRef = useRef(null);

  useEffect(() => {
    serverResumeAppliedKeyRef.current = null;

    const numeric = Number(bookKey);
    if (!bookKey || !Number.isFinite(numeric) || numeric <= 0) {
      setServerResumeAnchor(null);
      return;
    }

    if (reloadKeyBumpedForBookRef.current !== bookKey) {
      reloadKeyBumpedForBookRef.current = bookKey;
      setReloadKey((k) => k + 1);
    }

    const idStr = String(numeric);
    const applyCachedProgress = () => {
      const row = getProgressFromCache(idStr);
      setProgressTopBar(progressRowToTopBar(row));
      setServerResumeAnchor(progressResultToViewerAnchor(row));
    };
    applyCachedProgress();

    let cancelled = false;
    (async () => {
      try {
        const res = await getBookProgress(idStr, { skipCache: false });
        if (cancelled) return;
        if (!res?.isSuccess || !res?.result) {
          applyCachedProgress();
          return;
        }
        const anchor = progressResultToViewerAnchor(res.result);
        setServerResumeAnchor(anchor);
        setProgressTopBar(progressRowToTopBar(res.result));
      } catch (_err) {
        if (!cancelled) applyCachedProgress();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookKey]);

  useEffect(() => {
    const numeric = Number(bookKey);
    if (!bookKey || !Number.isFinite(numeric) || numeric <= 0) {
      return undefined;
    }
    const idStr = String(numeric);
    const sync = () => {
      setProgressTopBar(progressRowToTopBar(getProgressFromCache(idStr)));
    };
    const onCache = (e) => {
      if (String(e?.detail?.bookId) === idStr) sync();
    };
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, onCache);
    sync();
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, onCache);
  }, [bookKey]);

  useEffect(() => {
    if (!serverResumeAnchor) return undefined;
    const key = viewerResumeAnchorKey(serverResumeAnchor);
    if (!key) return undefined;
    if (serverResumeAppliedKeyRef.current === key) return undefined;

    let cancelled = false;
    let attempts = 0;
    const id = setInterval(() => {
      if (cancelled || serverResumeAppliedKeyRef.current === key) {
        clearInterval(id);
        return;
      }
      attempts += 1;
      try {
        const moved = viewerRef.current?.displayAt?.(serverResumeAnchor);
        if (moved) {
          serverResumeAppliedKeyRef.current = key;
          clearInterval(id);
        }
      } catch (_e) {
        void 0;
      }
      if (attempts >= VIEWER_RESUME_MAX_ATTEMPTS) clearInterval(id);
    }, VIEWER_RESUME_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverResumeAnchor, reloadKey]);

  const { cachedLocation, saveLocation } = useCachedLocation(bookKey);

  const graphClearRef = useRef(null);
  const sequentialPrefetchStatusRef = useRef(new Map());
  const chapterEventDiscoveryRef = useRef(new Map());
  // True after the viewer fires handleCurrentLineChange for the first time per chapter,
  // meaning the page transition is complete and content is visible.
  const isViewerPageReadyRef = useRef(false);
  const [isViewerPageReady, setIsViewerPageReady] = useState(false);
  const {
    transitionState,
    resetTransition
  } = useTransitionState({
    currentEvent,
    currentChapter,
    loading,
    isReloading,
    isGraphLoading,
    isDataReady
  });
  const { apiError, setApiError } = useFineGraphLoader({
    book,
    currentChapter,
    currentEvent,
    graphActions,
    manifestLoaded,
    resetTransition,
    setElements,
    setEvents,
    setFineGraphLoading,
    setIsDataReady,
    setLoading,
  });

  // Reset the viewer-ready flag whenever the book or chapter changes so that
  // discoverEvents waits for the next handleCurrentLineChange before fetching.
  useEffect(() => {
    isViewerPageReadyRef.current = false;
    setIsViewerPageReady(false);
  }, [book?.id, currentChapter]);

  const {
    activeTooltip,
    handleClearTooltip,
    handleSetActiveTooltip
  } = useTooltipState({
    onError: () => {
      toast.error("??꾨샍 ??뽯뻻???얜챷?ｅ첎? 獄쏆뮇源??됰뮸??덈뼄. ??륁뵠筌왖????덉쨮?⑥쥙臾???곻폒?紐꾩뒄.", {
        autoClose: 2000,
        closeOnClick: true,
        pauseOnHover: true
      });
    },
    graphClearRef
  });


  useEffect(() => {
    if (!bookKey || !currentEvent) return;

    const { startLocator: startL, endLocator: endL } = anchorToLocators(currentEvent.anchor);
    if (!startL) return;

    const cached = getCachedReaderProgress(bookKey);
    const cachedStart =
      toLocator(cached?.startLocator) ??
      toLocator(cached?.locator) ??
      null;
    const evNow = eventUtils.extractRawEventIdx(currentEvent);
    const evCached = Number(cached?.eventNum ?? 0);
    if (cachedStart && locatorsEqual(cachedStart, startL) && evNow === evCached) {
      return;
    }

    const numericBookId = Number(bookKey);

    saveLocation({
      bookId: Number.isFinite(numericBookId) && numericBookId > 0 ? numericBookId : null,
      startLocator: startL,
      endLocator: endL ?? startL,
      locator: startL,
      chapterIdx: startL.chapterIndex,
      eventIdx: Number(currentEvent.eventNum),
      eventNum: Number(currentEvent.eventNum),
      eventId: currentEvent.event_id ?? currentEvent.eventId ?? currentEvent.id ?? null,
      eventName:
        currentEvent.event?.name ??
        currentEvent.event?.title ??
        currentEvent.title ??
        currentEvent.name ??
        null,
      chapterProgress: currentEvent.chapterProgress ?? null,
      source: 'runtime',
    });
  }, [bookKey, currentEvent, saveLocation]);

  const prefetchChapterEventsSequentially = useCallback(async (targetChapter) => {
    if (!book?.id || typeof book.id !== 'number') {
      return;
    }

    if (!targetChapter || targetChapter < 1) {
      return;
    }

    const bookId = book.id;
    const key = cacheKeyUtils.createChapterKey(bookId, targetChapter);
    const status = sequentialPrefetchStatusRef.current.get(key);

    if (status === 'running' || status === 'completed') {
      return;
    }

    sequentialPrefetchStatusRef.current.set(key, 'running');

    try {
      const chapterPayload = getCachedChapterEvents(bookId, targetChapter);
      if (!chapterPayload || !Array.isArray(chapterPayload.events)) {
        sequentialPrefetchStatusRef.current.set(key, 'completed');
        return;
      }

      const sortedEvents = [...chapterPayload.events].sort(
        (a, b) => (Number(a?.eventNum) || 0) - (Number(b?.eventNum) || 0)
      );

      const normalizedEvents = sortedEvents.reduce((acc, event) => {
        const normalizedIdx = Number(event.eventNum);
        if (!Number.isFinite(normalizedIdx) || normalizedIdx <= 0) return acc;
        const normalizedEvent = {
          ...event.event,
          chapter: targetChapter,
          chapterIdx: targetChapter,
          eventIdx: normalizedIdx,
          eventNum: normalizedIdx,
          event_id: normalizedIdx,
          resolvedEventIdx: normalizedIdx,
          originalEventIdx: normalizedIdx,
          relations: Array.isArray(event.relations) ? event.relations : [],
          characters: Array.isArray(event.characters) ? event.characters : [],
          start: event?.startPos ?? event?.start ?? null,
          end: event?.endPos ?? event?.end ?? null,
        };
        return eventUtils.updateEventsInState(acc, normalizedEvent, targetChapter);
      }, []);

      setEvents((prev) =>
        normalizedEvents.length > 0
          ? normalizedEvents.reduce((p, evt) => eventUtils.updateEventsInState(p, evt, targetChapter), prev)
          : prev
      );

      sequentialPrefetchStatusRef.current.set(key, 'completed');
    } catch (error) {
      errorUtils.logError('[ViewerPage] 筌?벤苑???源??????嚥≪뮆諭?餓???살첒', error);
      sequentialPrefetchStatusRef.current.delete(key);
    }
  }, [book?.id, setEvents]);

  useEffect(() => {
    if (!book?.id || typeof book.id !== 'number') {
      return;
    }

    if (!currentChapter || currentChapter < 1) {
      return;
    }

    prefetchChapterEventsSequentially(currentChapter);
  }, [book?.id, currentChapter, prefetchChapterEventsSequentially]);

  useEffect(() => {
    return () => {
      if (sequentialPrefetchStatusRef.current) {
        sequentialPrefetchStatusRef.current.clear();
      }
      if (chapterEventDiscoveryRef.current) {
        chapterEventDiscoveryRef.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    // Wait until the viewer has rendered its first frame for this chapter.
    if (!isViewerPageReady) return;

    let isMounted = true;
    let checkInterval = null;
    const applyDiscoveryState = (loadingState, errorState = null) => {
      if (!isMounted) return;
      setIsGraphLoading(loadingState);
      setApiError(errorState);
    };

    const discoverEvents = async () => {
      if (!book?.id || typeof book.id !== 'number' || !currentChapter) {
        return;
      }
      
      const discoveryKey = cacheKeyUtils.createChapterKey(book.id, currentChapter);
      const currentStatus = chapterEventDiscoveryRef.current.get(discoveryKey);
      if (currentStatus === 'completed' || currentStatus === 'loading') {
        return;
      }
      
      const cached = getCachedChapterEvents(book.id, currentChapter);
      if (cached) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'completed');
        applyDiscoveryState(false, null);
        return;
      }

      let isBuilding = isGraphBookCacheBuilding(book.id);
      if (!isBuilding) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'loading');
        applyDiscoveryState(true, null);
        ensureGraphBookCache(book.id).catch(() => {});
      }

      if (isBuilding || chapterEventDiscoveryRef.current.get(discoveryKey) === 'loading') {
        applyDiscoveryState(true, null);
        checkInterval = setInterval(() => {
          if (!isMounted) {
            if (checkInterval) clearInterval(checkInterval);
            return;
          }
          const stillBuilding = isGraphBookCacheBuilding(book.id);
          const nowCached = getCachedChapterEvents(book.id, currentChapter);
          if (nowCached) {
            chapterEventDiscoveryRef.current.set(discoveryKey, 'completed');
            if (checkInterval) clearInterval(checkInterval);
            applyDiscoveryState(false, null);
          } else if (!stillBuilding) {
            chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
            if (checkInterval) clearInterval(checkInterval);
            // 筌?Ŋ??沃섎챷?????燁살꼶梨???살첒揶쎛 ?袁⑤뻷: fine API 筌욊낯???野껋럥以덃에??④쑴??筌욊쑵六??뺣뼄.
            applyDiscoveryState(false, null);
          }
        }, 200);
        return;
      }

      chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
      // 筌?Ŋ?녶첎? ??곷선????源???紐껊쑔??疫꿸퀡而?fine API 鈺곌퀬???揶쎛?館釉??
      applyDiscoveryState(false, null);
    };
    
    discoverEvents();
    
    return () => {
      isMounted = false;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  }, [book?.id, currentChapter, isViewerPageReady, setIsGraphLoading, setApiError]);

  useProgressAutoSave({
    bookId: bookKey,
    currentEvent,
    progress,
    getCurrentLocator: () => viewerRef.current?.getCurrentLocator?.(),
    saveLocation,
  });

  useEffect(() => {
    if (!bookmarks?.length) return undefined;
    const timer = setTimeout(() => {
      removeBookmarkHighlights();
    }, 500);
    return () => {
      clearTimeout(timer);
      removeBookmarkHighlights();
    };
  }, [bookmarks, currentChapter]);
  const {
    searchTerm, isSearchActive, filteredElements,
    fitNodeIds,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  const handleCurrentChapterChange = useCallback((chapter) => {
    setCurrentChapter(chapter);
  }, [setCurrentChapter]);

  const handleCurrentLineChange = useCallback(
    async (charIndex, _totalEvents, receivedEvent) => {
      setCurrentCharIndex(charIndex);
      if (!receivedEvent) return;

      if (!isViewerPageReadyRef.current) {
        isViewerPageReadyRef.current = true;
        setIsViewerPageReady(true);
      }

      const { nextEvent, nextChapter } = resolveViewerLineEvent({
        receivedEvent,
        book,
        cleanBookId,
        eventUtils,
      });
      if (nextChapter && nextChapter !== currentChapter) {
        setCurrentChapter(nextChapter);
      }

      setCurrentEvent(nextEvent);
      setProgressTopBar((prev) => {
        const base =
          prev !== undefined && prev !== null && typeof prev === "object"
            ? { ...prev }
            : progressRowToTopBar(null);
        const n = resolveDisplayedEventNum(nextEvent);
        if (n > 0) base.eventNum = n;
        const cp = Number(nextEvent.chapterProgress);
        if (Number.isFinite(cp)) base.chapterProgress = Math.min(100, Math.max(0, cp));
        const nm = nextEvent.name ?? nextEvent.event_name ?? nextEvent.eventTitle;
        if (typeof nm === "string" && nm.trim()) base.eventName = nm.trim();
        const pct = normalizeReadingProgressPercent(nextEvent);
        if (pct != null) base.readingProgressPercent = pct;
        return base;
      });


    },
    [
      book,
      cleanBookId,
      currentChapter,
      setCurrentChapter,
      setCurrentCharIndex,
      setCurrentEvent,
    ]
  );

  const handleExitToMypage = useCallback(async () => {
    try {
      if (bookKey && viewerRef.current?.getCurrentLocator) {
        const loc = await viewerRef.current.getCurrentLocator();
        const { startLocator } = anchorToLocators(loc);
        if (startLocator) {
          const res = await saveProgress({
            bookId: String(bookKey),
            startLocator,
            locator: startLocator,
          });
          if (!res?.isSuccess) {
            errorUtils.logWarning('[ViewerPage] ?ル굝利???筌욊쑬猷???????쎈솭', res?.message || '?臾먮뼗 ??쎈솭', {
              bookId: bookKey,
            });
          }
        }
      }
    } catch (_e) {
      void 0;
    } finally {
      exitToMypage();
    }
  }, [bookKey, viewerRef, exitToMypage]);

  const graphStateProp = useMemo(() => {
    let prevValidEvent = null;
    if (currentEvent) {
      const evCh = currentEvent.chapter ?? currentEvent.chapterIdx;
      if (evCh == null || Number(evCh) === Number(currentChapter)) {
        prevValidEvent = currentEvent;
      }
    }
    return {
      ...graphState,
      prevValidEvent,
      events: _events,
      progressTopBar,
    };
  }, [graphState, currentEvent, currentChapter, _events, progressTopBar]);

  const searchStateProp = useMemo(() => ({
    ...searchState,
    searchTerm,
    isSearchActive,
    elements,
    filteredElements,
    isResetFromSearch,
    fitNodeIds,
    suggestions,
    showSuggestions,
    selectedIndex,
  }), [searchState, searchTerm, isSearchActive, elements, filteredElements,
      isResetFromSearch, fitNodeIds, suggestions, showSuggestions, selectedIndex]);

  const searchActionsProp = useMemo(() => ({
    onSearchSubmit: handleSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions: setSearchTerm,
    handleKeyDown,
  }), [handleSearchSubmit, clearSearch, closeSuggestions, setSearchTerm, handleKeyDown]);

  const tooltipPropsProp = useMemo(() => ({
    activeTooltip,
    onClearTooltip: handleClearTooltip,
    onSetActiveTooltip: handleSetActiveTooltip,
    graphClearRef,
  }), [activeTooltip, handleClearTooltip, handleSetActiveTooltip]);

  useEffect(() => {
    if (!isDataReady || !currentEvent) return;
    
    const restoredLayout = restoreGraphLayout(currentEvent, currentChapter);
    if (restoredLayout) {
      setGraphViewState(restoredLayout);
    }
  }, [isDataReady, currentEvent, currentChapter]);

  useEffect(() => {
    if (!elements) return;
    prevElementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    if (!folderKey || !bookKey) {
      return;
    }
    
    const abortController = new AbortController();
    
    preloadChapterLayouts({
      folderKey,
      bookKey,
      signal: abortController.signal
    });
    
    return () => {
      abortController.abort();
    };
  }, [folderKey, bookKey]);


  return (
    <div
      className="h-screen"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      <ViewerLayout
        showControls={showToolbar}
        book={book}
        currentChapter={currentChapter}
        progress={progress}
        setProgress={setProgress}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
        isBookmarked={false}
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
            graphState={graphStateProp}
            graphActions={graphActions}
            viewerState={viewerState}
            searchState={searchStateProp}
            searchActions={searchActionsProp}
            tooltipProps={tooltipPropsProp}
            transitionState={transitionState}
            apiError={apiError}
            bookId={bookId}
            book={book}
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
          onProgressChange={setProgress}
          onCurrentPageChange={setCurrentPage}
          onTotalPagesChange={setTotalPages}
          onCurrentChapterChange={handleCurrentChapterChange}
          settings={settings}
          onCurrentLineChange={handleCurrentLineChange}
          bookId={cleanBookId ?? bookKey}
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

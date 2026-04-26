import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
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
import { getFineGraph, saveProgress, getBookProgress } from "../../utils/api/api";
import {
  anchorToLocators,
  locatorsEqual,
  progressResultToViewerAnchor,
  toLocator,
  viewerResumeAnchorKey,
} from "../../utils/common/locatorUtils";
import { getGraphEventState, getCachedChapterEvents, getCachedReaderProgress, isGraphBookCacheBuilding, ensureGraphBookCache } from "../../utils/common/cache/chapterEventCache";
import {
  eventUtils,
  graphDataCacheUtils,
  eventIdxUtils,
  graphDataTransformUtils,
  cacheKeyUtils,
  resolveFineGraphEventOrdinal,
  getServerBookId,
} from "../../utils/viewer/viewerUtils";
import {
  pickFineGraphResultEvent,
  resolveDisplayedEventNum,
  resolveFineGraphEventIdString,
  resolveViewerGraphEventFromManifest,
} from "../../utils/viewer/eventDisplayUtils";
import { restoreGraphLayout, preloadChapterLayouts } from "../../utils/graph/graphLayoutUtils";
import { removeBookmarkHighlights } from "./bookmark/BookmarkManager";
import { convertRelationsToElements, filterRelationsByTimeline } from "../../utils/graph/graphDataUtils";
import { buildNodeWeights, createCharacterMaps } from "../../utils/graph/characterUtils";
import { getRelationKeyFromRelation } from "../../utils/graph/relationUtils";
import { errorUtils } from "../../utils/common/errorUtils";
import GraphSplitArea from "./GraphSplitArea";
import {
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
  normalizeReadingProgressPercent,
} from "../../utils/common/cache/progressCache";

// 이어보기 displayAt 폴링: 본문·레이아웃 지연 시 간헐 실패 방지
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

function mergeNextEventFromFineGraphPayload(nextEvent, payload, relFallbackMeta) {
  if (!nextEvent || typeof nextEvent !== "object") return { nextEvent, merged: false };
  const meta = relFallbackMeta && typeof relFallbackMeta === "object" ? relFallbackMeta : {};
  const chapterIdx = Number(meta.chapterIdx);
  const off = meta.startTxtOffset;
  const hasOff = Number.isFinite(off);

  let apiEvent =
    payload?.event && typeof payload.event === "object" ? payload.event : null;
  if (
    !apiEvent &&
    payload &&
    Array.isArray(payload.relations) &&
    payload.relations.length > 0 &&
    Number.isFinite(chapterIdx) &&
    chapterIdx >= 1
  ) {
    for (const rel of payload.relations) {
      const n = Number(
        rel?.eventIdx ?? rel?.eventNum ?? rel?.event_idx ?? rel?.event_id
      );
      if (Number.isFinite(n) && n > 0) {
        apiEvent = {
          chapterIdx,
          eventNum: n,
          event_id: n,
          ...(hasOff
            ? {
                startTxtOffset: off,
                endTxtOffset: Number.isFinite(meta.endTxtOffset) ? meta.endTxtOffset : off,
              }
            : {}),
        };
        break;
      }
    }
  }
  if (!apiEvent || typeof apiEvent !== "object") return { nextEvent, merged: false };

  const normalized = graphDataTransformUtils.normalizeApiEvent(apiEvent);
  const ord = resolveFineGraphEventOrdinal(apiEvent);
  let merged = {
    ...nextEvent,
    ...(normalized || {}),
    event: normalized ? { ...apiEvent, ...normalized } : { ...apiEvent },
  };
  if (ord) {
    if (!Number.isFinite(Number(merged.eventNum)) || Number(merged.eventNum) <= 0) {
      merged = { ...merged, eventNum: ord, eventIdx: ord, event_id: ord };
    }
    if (!Number.isFinite(merged.resolvedEventIdx) || merged.resolvedEventIdx <= 0) {
      merged = { ...merged, resolvedEventIdx: ord };
    }
  }
  return { nextEvent: merged, merged: true };
}

const ViewerPage = () => {
  const {
    viewerRef, reloadKey, setReloadKey, progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal,
    settings, currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    events: _events, setEvents, showGraph, elements, setElements, setGraphViewState,
    setCurrentCharIndex,
    loading, setLoading,
    isDataReady, setIsDataReady, isReloading, setIsReloading: _setIsReloading,
    isGraphLoading, setIsGraphLoading, setFineGraphLoading, showToolbar, setShowToolbar,
    bookmarks, showBookmarkList, setShowBookmarkList: _setShowBookmarkList,
    prevElementsRef, book, folderKey, currentChapterData,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, toggleGraph, handleLocationChange: _handleLocationChange,
    graphState, graphActions, viewerState, searchState, graphFullScreen, setGraphFullScreen: _setGraphFullScreen,
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
  const apiEventCacheRef = useRef(new Map());
  const apiCallRef = useRef(null);
  const fineGraphLoadKickTimerRef = useRef(null);
  const fineGraphLoadGenerationRef = useRef(0);
  const initialGraphEventLoadedRef = useRef(false);
  const sequentialPrefetchStatusRef = useRef(new Map());
  const setElementsRef = useRef(setElements);
  const previousGraphDataRef = useRef({ elements: [], eventIdx: 0, chapterIdx: 0 });
  const chapterEventDiscoveryRef = useRef(new Map());
  const retryTimeoutRef = useRef(null);
  const fineAnchorFetchEpochRef = useRef(0);
  const lastViewerGraphLoadLogRef = useRef('');
  
  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);
  
  const clearGraphElements = useCallback((eventIdx, chapterIdx) => {
    eventUtils.updateGraphDataRef(previousGraphDataRef, [], eventIdx || 0, chapterIdx || 0);
    setElementsRef.current([]);
  }, []);

  const isFineGraphCacheWarm = useCallback((numericBookId, chapter, apiEventIdx) => {
    if (!numericBookId || !chapter || apiEventIdx < 1) return false;
    if (getGraphEventState(numericBookId, chapter, apiEventIdx)) return true;
    const ck = cacheKeyUtils.createCacheKey(chapter, apiEventIdx);
    return Boolean(apiEventCacheRef.current?.get(ck));
  }, []);
  
  const {
    transitionState,
    isChapterTransitionRef,
    chapterTransitionDirectionRef,
    forcedChapterEventIdxRef,
    startChapterTransition,
    releaseForcedEventIdx,
    resetTransition
  } = useTransitionState({
    currentEvent,
    currentChapter,
    loading,
    isReloading,
    isGraphLoading,
    isDataReady
  });
  
  const [apiError, setApiError] = useState(null);
  
  const updateLoadingState = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    setIsDataReady(isReady);
    setLoading(isLoading);
    if (shouldResetTransition) resetTransition();
    setApiError(error);
  }, [setIsDataReady, setLoading, setApiError, resetTransition]);

  const triggerGraphRetry = useCallback((resetInitialGraphEvent = false) => {
    clearRetryTimeout();
    setApiError(null);
    apiCallRef.current = null;
    if (resetInitialGraphEvent) {
      initialGraphEventLoadedRef.current = false;
    }
    setLoading((prev) => !prev);
  }, [clearRetryTimeout, setLoading]);

  const buildGraphLoadError = useCallback((details, retryHandler) => ({
    message: '그래프 데이터를 불러오는데 실패했습니다.',
    details,
    retry: retryHandler,
  }), []);

  const resetGraphOnNotFound = useCallback(() => {
    clearGraphElements(0, currentChapter);
    updateLoadingState(true, false);
  }, [clearGraphElements, currentChapter, updateLoadingState]);
  
  useEffect(() => {
    apiEventCacheRef.current.clear();
  }, [book?.id, currentChapter]);

  const {
    activeTooltip,
    handleClearTooltip,
    handleSetActiveTooltip
  } = useTooltipState({
    onError: () => {
      toast.error("툴팁 표시에 문제가 발생했습니다. 페이지를 새로고침 해주세요.", {
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

    const numericBookId =
      typeof book?.id === 'number'
        ? book.id
        : Number.isFinite(Number(bookKey)) && Number(bookKey) > 0
          ? Number(bookKey)
          : null;

    saveLocation({
      bookId: numericBookId,
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
  }, [bookKey, currentEvent, book?.id, saveLocation]);

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
      errorUtils.logError('[ViewerPage] 챕터 이벤트 사전 로드 중 오류', error);
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
      clearRetryTimeout();
      if (apiEventCacheRef.current) {
        apiEventCacheRef.current.clear();
      }
      if (sequentialPrefetchStatusRef.current) {
        sequentialPrefetchStatusRef.current.clear();
      }
      if (chapterEventDiscoveryRef.current) {
        chapterEventDiscoveryRef.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    setElementsRef.current = setElements;
  }, [setElements]);

  useEffect(() => {
    initialGraphEventLoadedRef.current = false;
    apiCallRef.current = null;
    lastViewerGraphLoadLogRef.current = '';
    setApiError(null);
  }, [book?.id]);
  
  useEffect(() => {
    apiCallRef.current = null;
  }, [book?.id, currentChapter]);

  useEffect(() => {
    let isMounted = true;
    let checkInterval = null;
    
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
        if (isMounted) {
          setApiError(null);
        }
        return;
      }

      let isBuilding = isGraphBookCacheBuilding(book.id);
      if (!isBuilding) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'loading');
        if (isMounted) {
          setIsGraphLoading(true);
          setApiError(null);
        }
        ensureGraphBookCache(book.id).catch(() => {});
      }

      if (isBuilding || chapterEventDiscoveryRef.current.get(discoveryKey) === 'loading') {
        if (isMounted) {
          setIsGraphLoading(true);
          setApiError(null);
        }
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
            if (isMounted) {
              setIsGraphLoading(false);
              setApiError(null);
            }
          } else if (!stillBuilding) {
            chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
            if (checkInterval) clearInterval(checkInterval);
            if (isMounted) {
              setIsGraphLoading(false);
              setApiError((prev) => prev ?? '그래프 이벤트 캐시가 없습니다. 마이페이지에서 데이터를 준비해주세요.');
            }
          }
        }, 200);
        return;
      }

      if (isMounted) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
        setIsGraphLoading(false);
        setApiError((prev) => prev ?? '그래프 이벤트 캐시가 없습니다. 마이페이지에서 데이터를 준비해주세요.');
      }
    };
    
    discoverEvents();
    
    return () => {
      isMounted = false;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  }, [book?.id, currentChapter, setIsGraphLoading, setApiError]);

  const resolveFineGraphCallContext = useCallback(() => {
    const numericBookId = getServerBookId(book);
    if (!numericBookId || !currentChapter) return null;
    let apiEventIdx = eventIdxUtils.calculateEventIdxForTransition(
      currentEvent,
      isChapterTransitionRef.current,
      forcedChapterEventIdxRef,
      chapterTransitionDirectionRef,
      numericBookId,
      currentChapter,
      getCachedChapterEvents,
      eventUtils
    );
    if (!isChapterTransitionRef.current && currentEvent) {
      const fromM = resolveViewerGraphEventFromManifest(currentEvent, numericBookId);
      if (fromM.eventId && fromM.eventNum > 0 && fromM.manifestEvent) {
        apiEventIdx = fromM.eventNum;
      }
    }
    const callKey = cacheKeyUtils.createEventKey(numericBookId, currentChapter, apiEventIdx);
    return { numericBookId, apiEventIdx, callKey };
  }, [book, currentChapter, currentEvent]);

  useLayoutEffect(() => {
    if (!manifestLoaded) return;
    const ctx = resolveFineGraphCallContext();
    if (!ctx || ctx.apiEventIdx < 1) return;
    if (
      eventIdxUtils.shouldBlockApiCall(
        isChapterTransitionRef.current,
        forcedChapterEventIdxRef,
        ctx.apiEventIdx
      )
    ) {
      return;
    }
    if (ctx.callKey !== apiCallRef.current) {
      if (!isFineGraphCacheWarm(ctx.numericBookId, currentChapter, ctx.apiEventIdx)) {
        setFineGraphLoading(true);
      }
    }
  }, [manifestLoaded, resolveFineGraphCallContext, setFineGraphLoading, currentChapter, isFineGraphCacheWarm]);
  
  useEffect(() => {
    let isMounted = true;
    
    const loadGraphData = async () => {
        if (!manifestLoaded) {
          return;
        }

        const ctx = resolveFineGraphCallContext();
        if (!ctx) {
          return;
        }
        const { numericBookId, apiEventIdx, callKey } = ctx;
        const forcedIdx = Number(forcedChapterEventIdxRef.current);
        const hasForcedIdx = Number.isFinite(forcedIdx) && forcedIdx > 0;

          if (apiCallRef.current === callKey) {
            return;
          }
          
          if (eventIdxUtils.shouldBlockApiCall(isChapterTransitionRef.current, forcedChapterEventIdxRef, apiEventIdx)) {
            return;
          }
          
        if (fineGraphLoadKickTimerRef.current) {
          globalThis.clearTimeout(fineGraphLoadKickTimerRef.current);
          fineGraphLoadKickTimerRef.current = null;
        }
        apiCallRef.current = callKey;
        const fineLoadGen = (fineGraphLoadGenerationRef.current += 1);
        const warmFg = isFineGraphCacheWarm(numericBookId, currentChapter, apiEventIdx);
        if (warmFg) {
          fineGraphLoadKickTimerRef.current = globalThis.setTimeout(() => {
            fineGraphLoadKickTimerRef.current = null;
            if (isMounted && apiCallRef.current === callKey) setFineGraphLoading(true);
          }, 40);
        } else {
          setFineGraphLoading(true);
        }

        try {
          if (!numericBookId || !currentChapter || apiEventIdx < 1) {
            clearGraphElements(0, currentChapter);
            updateLoadingState(true, false);
            return;
          }
          
          const chapterEventApiKey = cacheKeyUtils.createEventKey(numericBookId, currentChapter, apiEventIdx);
          const hasCalledApiForEvent = initialGraphEventLoadedRef.current === chapterEventApiKey;
          
          if (!hasCalledApiForEvent) {
            initialGraphEventLoadedRef.current = chapterEventApiKey;
          }

          let { resultData, usedCache } = await graphDataCacheUtils.getGraphDataFromApiOrCache(
            numericBookId,
            currentChapter,
            apiEventIdx,
            getFineGraph,
            getGraphEventState,
            eventUtils,
            apiEventCacheRef,
            hasCalledApiForEvent,
            null,
            hasForcedIdx ? { useCallerEventIdxOnly: true } : undefined
          );

          if (!isMounted || apiCallRef.current !== callKey) return;

          const cacheKey = cacheKeyUtils.createCacheKey(currentChapter, apiEventIdx);
          
          const hasCacheElements = Array.isArray(resultData?.elements) && resultData.elements.length > 0;
          const hasApiRelations = Array.isArray(resultData?.relations) && resultData.relations.length > 0;
          const hasApiCharacters = Array.isArray(resultData?.characters) && resultData.characters.length > 0;
          const hasGraphData = usedCache
            ? hasCacheElements || (hasApiRelations && hasApiCharacters)
            : hasApiRelations || hasApiCharacters;
          
          if (!hasGraphData) {
            clearGraphElements(apiEventIdx, currentChapter);

            if (isMounted) {
              updateLoadingState(true, false);
            }

            return;
          }
          
          if (apiEventCacheRef.current) {
            apiEventCacheRef.current.set(cacheKey, resultData);
          }

          const relationsAfterTimeline = !usedCache
            ? await filterRelationsByTimeline({
                relations: resultData.relations,
                mode: "api",
                bookId: numericBookId,
                chapterNum: currentChapter,
                eventNum: apiEventIdx,
                cacheRef: apiEventCacheRef,
                eventUtils,
                getCachedChapterEvents,
                getGraphEventState,
                getRelationKeyFromRelation
              })
            : (resultData.relations || []);

          if (!isMounted || apiCallRef.current !== callKey) return;

          // per-event 캐시는 elements만 있고 relations는 비울 수 있음 → 빈 배열로 오판해 그래프를 지우지 않음
          if (
            (!Array.isArray(relationsAfterTimeline) || relationsAfterTimeline.length === 0) &&
            !hasCacheElements
          ) {
            clearGraphElements(apiEventIdx, currentChapter);

            const emptyEvent = eventUtils.createEmptyEvent(currentChapter, apiEventIdx, resultData?.event);

            setCurrentEvent(emptyEvent);

            setEvents((prevEvents) => {
              if (!Array.isArray(prevEvents) || prevEvents.length === 0) {
                return [emptyEvent];
              }
              const updated = prevEvents.map((evt) =>
                Number(evt?.eventNum) === apiEventIdx ? { ...evt, ...emptyEvent } : evt
              );
              const exists = updated.some((evt) => Number(evt?.eventNum) === apiEventIdx);
              if (!exists) {
                updated.push(emptyEvent);
              }
              return updated;
            });

            if (apiEventCacheRef.current) {
              apiEventCacheRef.current.set(cacheKey, { ...resultData, relations: [] });
            }

            if (isMounted) {
              updateLoadingState(true, false);
            }

            return;
          }

          resultData = { ...resultData, relations: relationsAfterTimeline };
          if (apiEventCacheRef.current) {
            apiEventCacheRef.current.set(cacheKey, resultData);
          }

          const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(resultData.event);
          
          const convertedElements = graphDataTransformUtils.convertToElements(
            resultData,
            usedCache,
            normalizedEvent,
            createCharacterMaps,
            buildNodeWeights,
            convertRelationsToElements
          );

          if (import.meta.env.DEV && currentEvent && convertedElements.length > 0) {
            const eventId = resolveFineGraphEventIdString(currentEvent);
            if (eventId) {
              const logKey = `${numericBookId}|${currentChapter}|${apiEventIdx}|${eventId}`;
              if (logKey !== lastViewerGraphLoadLogRef.current) {
                lastViewerGraphLoadLogRef.current = logKey;
                const nodeEls = convertedElements.filter((e) => e?.data && !e.data.source);
                const edgeEls = convertedElements.filter((e) => e?.data?.source);
                const nodesPreview = nodeEls.slice(0, 12).map((e) => ({
                  id: e.data.id,
                  label: e.data.label ?? e.data.name ?? '',
                }));
                const edgesPreview = edgeEls.slice(0, 16).map((e) => ({
                  id: e.data.id,
                  source: e.data.source,
                  target: e.data.target,
                  label: e.data.label ?? '',
                }));
                const charPreview = (Array.isArray(resultData.characters) ? resultData.characters : [])
                  .slice(0, 10)
                  .map((c) => ({
                    id: c?.id,
                    label: c?.label ?? c?.name ?? '',
                  }));
                console.log('[뷰어 그래프 로드]', {
                  eventId,
                  chapterIdx: currentChapter,
                  apiEventIdx,
                  source: usedCache ? 'cache' : 'api',
                  nodeCount: nodeEls.length,
                  edgeCount: edgeEls.length,
                  charactersPreview: charPreview,
                  relationsPreview: (resultData.relations || []).slice(0, 8).map((r) => ({
                    source: r?.source,
                    target: r?.target,
                    relation: r?.relation ?? r?.label ?? r?.type,
                  })),
                  cytoscapeNodesPreview: nodesPreview,
                  cytoscapeEdgesPreview: edgesPreview,
                });
              }
            }
          }
          
          const hasGraphPayload = Array.isArray(resultData?.relations) && resultData.relations.length > 0;
          const hasCharacterPayload = Array.isArray(resultData?.characters) && resultData.characters.length > 0;
          
          if (convertedElements.length > 0 && isMounted) {
            const prevData = previousGraphDataRef.current;
            const finalElements = graphDataTransformUtils.mergeElementsWithPrevious(
              convertedElements,
              prevData,
              currentChapter,
              apiEventIdx
            );
            eventUtils.updateGraphDataRef(previousGraphDataRef, finalElements, apiEventIdx, currentChapter);
            setElementsRef.current(finalElements);
            if (graphActions.setIsDataEmpty) graphActions.setIsDataEmpty(false);

            const nextEventData = graphDataTransformUtils.createNextEventData(
              normalizedEvent,
              currentChapter,
              apiEventIdx,
              resultData,
              eventUtils
            );

            setEvents(prevEvents => 
              eventUtils.updateEventsInState(
                prevEvents, 
                nextEventData, 
                currentChapter, 
                !hasGraphPayload && !hasCharacterPayload
              )
            );

            // relations/characters 플래그가 비어도 Cytoscape elements로 이미 그린 경우(캐시 등) 그래프를 비우지 않음
            if (!hasGraphPayload && !hasCharacterPayload && !hasCacheElements) {
              const fallbackEvent = {
                ...nextEventData,
                placeholder: true,
                relations: [],
                characters: []
              };
              setCurrentEvent(fallbackEvent);
              clearGraphElements(apiEventIdx, currentChapter);
              releaseForcedEventIdx();
            } else {
              setCurrentEvent(prev => {
                if (!prev || Number(prev?.chapter ?? prev?.chapterIdx) !== currentChapter) {
                  return nextEventData;
                }

                const prevIdx = eventUtils.extractRawEventIdx(prev);
                const nextIdx = eventUtils.extractRawEventIdx(nextEventData);
                if (prevIdx !== nextIdx) {
                  return nextEventData;
                }

                const merged = { ...prev, ...nextEventData };
                if (
                  Object.prototype.hasOwnProperty.call(nextEventData, 'event') &&
                  nextEventData.event == null &&
                  prev?.event != null &&
                  typeof prev.event === 'object'
                ) {
                  merged.event = prev.event;
                }
                return merged;
              });

              const appliedIdx = eventUtils.extractRawEventIdx(nextEventData);
              const forced = forcedChapterEventIdxRef.current;
              if (
                forced &&
                forced !== 'max' &&
                Number.isFinite(Number(forced)) &&
                appliedIdx === Number(forced)
              ) {
                releaseForcedEventIdx();
              }
            }
          } else {
            // relations/characters는 있으나 convertToElements 결과가 비었을 때(캐릭터 매핑 없음·정규화 후 관계 전부 탈락 등).
            // 위쪽 relationsAfterTimeline===0 분기와 달리 setCurrentEvent(createEmptyEvent)는 하지 않음.
            if (!usedCache || !Array.isArray(resultData.elements) || resultData.elements.length === 0) {
              errorUtils.logWarning('[ViewerPage] 그래프 데이터 변환 실패', 'characters, relations, 또는 elements가 비어있음');
            }

            clearGraphElements(apiEventIdx, currentChapter);
          }
          
          const isChapterTransition = transitionState.type === 'chapter' && 
                                     transitionState.direction;
          
          if (isChapterTransition) {
            if (!hasGraphPayload && !hasCharacterPayload) {
              setEvents([]);
              setCurrentEvent(null);
              clearGraphElements(0, currentChapter);
            } else {
              previousGraphDataRef.current = {
                ...previousGraphDataRef.current,
                chapterIdx: currentChapter
              };
            }
          }

          if (isMounted) {
            updateLoadingState(true, false);
          }
          
        } catch (error) {
          if (isMounted) {
            const status = error?.status;
            const message = error?.message || '';
            const isNotFound = status === 404 || message.includes('404') || message.includes('찾을 수 없습니다');
            
            if (isNotFound) {
              resetGraphOnNotFound();
            } else {
              const maxRetries = 3;
              const retryCount = (error.retryCount || 0) + 1;
              
              if (retryCount < maxRetries) {
                clearRetryTimeout();
                retryTimeoutRef.current = setTimeout(() => {
                  if (isMounted) {
                    apiCallRef.current = null;
                    setLoading((prev) => !prev);
                  }
                  retryTimeoutRef.current = null;
                }, 1000 * retryCount);
                
                setApiError(buildGraphLoadError(
                  `${message || '알 수 없는 오류'} (재시도 ${retryCount}/${maxRetries})`,
                  () => triggerGraphRetry(false)
                ));
              } else {
                clearRetryTimeout();
                setApiError(buildGraphLoadError(
                  message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                  () => triggerGraphRetry(true)
                ));
              }
              
              updateLoadingState(true, false);
            }
          }
        } finally {
          if (fineGraphLoadKickTimerRef.current) {
            globalThis.clearTimeout(fineGraphLoadKickTimerRef.current);
            fineGraphLoadKickTimerRef.current = null;
          }
          if (isMounted && fineLoadGen === fineGraphLoadGenerationRef.current) {
            setFineGraphLoading(false);
          }
        }
    };

    loadGraphData();
    
    return () => {
      isMounted = false;
      if (fineGraphLoadKickTimerRef.current) {
        globalThis.clearTimeout(fineGraphLoadKickTimerRef.current);
        fineGraphLoadKickTimerRef.current = null;
      }
      setFineGraphLoading(false);
    };
  }, [
    book,
    currentChapter,
    manifestLoaded,
    currentEvent,
    setFineGraphLoading,
    resolveFineGraphCallContext,
    isFineGraphCacheWarm,
  ]);

  useProgressAutoSave({
    bookKey,
    currentChapter,
    currentEvent,
    readingProgressPercent: progress,
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
    const prev = Number(currentChapter || 0);
    const next = Number(chapter || 0);
    if (prev && next && prev !== next) {
      const transitionInfo = startChapterTransition(prev, next);
      if (transitionInfo && transitionInfo.forcedIdx === 1) {
        setCurrentEvent({
          chapter: next, chapterIdx: next,
          eventIdx: 1, eventNum: 1, event_id: 1,
          relations: [], characters: [],
          placeholder: true,
        });
      }
    }
    setCurrentChapter(chapter);
  }, [currentChapter, startChapterTransition, setCurrentEvent, setCurrentChapter]);

  const handleCurrentLineChange = useCallback(
    async (charIndex, _totalEvents, receivedEvent) => {
      setCurrentCharIndex(charIndex);
      if (!receivedEvent) return;

      const epoch = (fineAnchorFetchEpochRef.current += 1);

      const chapter =
        receivedEvent.chapter ??
        receivedEvent.anchor?.startLocator?.chapterIndex ??
        receivedEvent.anchor?.start?.chapterIndex ??
        null;
      if (chapter && chapter !== currentChapter) {
        setCurrentChapter(chapter);
      }

      const forcedIdx = forcedChapterEventIdxRef.current;
      const rawIdx = eventUtils.extractRawEventIdx(receivedEvent);
      let shouldReleaseForced = false;
      let nextEvent = receivedEvent;

      if (Number.isFinite(forcedIdx)) {
        if (rawIdx > 0 && rawIdx !== forcedIdx) {
          shouldReleaseForced = true;
        } else {
          nextEvent = {
            ...receivedEvent,
            eventIdx: forcedIdx,
            eventNum: forcedIdx,
            event_id: forcedIdx,
            resolvedEventIdx: forcedIdx,
            originalEventIdx: rawIdx || forcedIdx,
          };
          shouldReleaseForced = true;
        }
      }

      const resolvedIdxForEvent = eventUtils.extractRawEventIdx(nextEvent);
      if (!Number.isFinite(nextEvent.resolvedEventIdx) || nextEvent.resolvedEventIdx <= 0) {
        nextEvent = {
          ...nextEvent,
          resolvedEventIdx: resolvedIdxForEvent > 0 ? resolvedIdxForEvent : undefined,
        };
      }

      const bid =
        getServerBookId(book) ??
        (Number.isFinite(Number(cleanBookId)) && Number(cleanBookId) > 0
          ? Number(cleanBookId)
          : null);
      const atLocator = toLocator(
        nextEvent.anchor?.startLocator ?? nextEvent.anchor?.start
      );
      let fineApiMerged = false;
      if (bid && atLocator && !pickFineGraphResultEvent(nextEvent)) {
        try {
          const res = await getFineGraph(bid, atLocator.chapterIndex, 1, atLocator);
          if (fineAnchorFetchEpochRef.current !== epoch) return;
          const ok = res && res.isSuccess !== false;
          const payload = res?.result ?? res?.data ?? null;
          if (ok) {
            const { nextEvent: merged, merged: did } = mergeNextEventFromFineGraphPayload(
              nextEvent,
              payload,
              {
                chapterIdx: atLocator.chapterIndex,
                startTxtOffset: atLocator.offset,
                endTxtOffset: atLocator.offset,
              }
            );
            if (did) {
              nextEvent = merged;
              fineApiMerged = true;
            }
          }
        } catch (_e) {
          void 0;
        }
      }

      if (bid && !fineApiMerged) {
        const fromM = resolveViewerGraphEventFromManifest(nextEvent, bid);
        if (
          fromM.chapterIdx >= 1 &&
          fromM.eventNum > 0 &&
          fromM.manifestEvent
        ) {
          try {
            const res = await getFineGraph(bid, fromM.chapterIdx, fromM.eventNum, null);
            if (fineAnchorFetchEpochRef.current !== epoch) return;
            const ok = res && res.isSuccess !== false;
            const payload = res?.result ?? res?.data ?? null;
            if (ok) {
              const { nextEvent: merged, merged: did } = mergeNextEventFromFineGraphPayload(
                nextEvent,
                payload,
                { chapterIdx: fromM.chapterIdx }
              );
              if (did) {
                nextEvent = merged;
                fineApiMerged = true;
              }
            }
          } catch (_e) {
            void 0;
          }
        }
      }

      if (fineAnchorFetchEpochRef.current !== epoch) return;

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
      if (shouldReleaseForced) releaseForcedEventIdx();
    },
    [
      book,
      cleanBookId,
      currentChapter,
      setCurrentChapter,
      setCurrentCharIndex,
      setCurrentEvent,
      releaseForcedEventIdx,
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
            errorUtils.logWarning('[ViewerPage] 종료 시 진도 저장 실패', res?.message || '응답 실패', {
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
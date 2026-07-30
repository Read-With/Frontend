/** 뷰어 그래프: UI 상태·검색·mode persist + 챕터 이벤트 discovery·캐시 로드 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  applyChapterEventsFromCache,
  ensureChapterEventsDiscovered,
  prefetchChapterEvents,
  clearBookRelationshipDeltas,
} from '../../utils/graph/graphFetch';
import { errorUtils } from '../../utils/common/urlUtils';
import { cacheKeyUtils, deriveGraphPhase, eventUtils } from '../../utils/viewer/viewerCore';
import {
  saveViewerMode,
  resolveInitialGraphFullScreen,
  resolvePersistedViewerMode,
  isHardNavigationReload,
  eventMatchesChapter,
  buildViewerActionError,
} from '../../utils/viewer/viewerSession';
import {
  buildChapterCharacterSearchData,
  commitVisibleGraphElements,
  fallbackEventMeta,
  graphDataTransformUtils,
  resolveCumulativeGraphForDisplay,
  resolveGraphCallContext,
  VIEWER_GRAPH_PIPELINE,
  getCachedChapterMaxEventIdx,
  hasCachedChapterThrough,
  toCommitGraphArgs,
  awaitPendingChapterDiscovery,
  resolveChapterDiscoveryCoverage,
  clearViewerGraphPipelineMaps,
  resolvePipelineBookId,
} from '../../utils/viewer/viewerGraph';
import { useGraphSearch, useGraphDisplayToggles } from '../graph/useGraphViewState';
import { useAsyncRequestGuard } from '../common/hooksShared';

const { HARD_RELOAD_SETTLE_MS } = VIEWER_GRAPH_PIPELINE;

export function useViewerGraphState({
  currentChapter,
  bookKey,
  showGraph,
}) {
  const [currentEvent, setCurrentEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [prevValidEvent, setPrevValidEvent] = useState(null);
  const [graphFullScreen, setGraphFullScreen] = useState(() =>
    resolveInitialGraphFullScreen(showGraph),
  );
  const [isDataReady, setIsDataReady] = useState(false);
  const {
    edgeLabelVisible,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
  } = useGraphDisplayToggles();
  const [isReloading, setIsReloading] = useState(false);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isEventGraphLoading, setEventGraphLoading] = useState(false);
  const [elements, setElements] = useState([]);
  const [isDataEmpty, setIsDataEmpty] = useState(false);

  const currentChapterData = useMemo(
    () => buildChapterCharacterSearchData(events, currentChapter),
    [events, currentChapter],
  );

  const graphPhase = useMemo(
    () => deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }),
    [isReloading, isEventGraphLoading, isGraphLoading],
  );

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);

  useEffect(() => {
    saveViewerMode(resolvePersistedViewerMode(graphFullScreen, showGraph));
  }, [showGraph, graphFullScreen]);

  useEffect(() => {
    if (!showGraph && graphFullScreen) setGraphFullScreen(false);
  }, [showGraph, graphFullScreen]);

  const clearDisplayedGraph = useCallback(({ loading = true } = {}) => {
    setElements([]);
    setIsDataEmpty(true);
    setIsDataReady(false);
    if (loading) {
      setIsGraphLoading(true);
      setEventGraphLoading(true);
    }
  }, []);

  useEffect(() => {
    if (!currentEvent) return;
    if (eventMatchesChapter(currentEvent, currentChapter)) {
      setPrevValidEvent(currentEvent);
      return;
    }
    setCurrentEvent(null);
    setPrevValidEvent(null);
    clearDisplayedGraph({ loading: true });
  }, [currentChapter, currentEvent, clearDisplayedGraph]);

  const resetGraphPipelineState = useCallback(() => {
    setEvents([]);
    clearDisplayedGraph({ loading: true });
  }, [clearDisplayedGraph]);

  const resetGraphTransientState = useCallback(() => {
    setCurrentEvent(null);
    setPrevValidEvent(null);
    resetGraphPipelineState();
  }, [resetGraphPipelineState]);

  // 책 변경 hard reset
  useEffect(() => {
    resetGraphPipelineState();
  }, [bookKey, resetGraphPipelineState]);

  // 챕터·이벤트 타깃이 바뀌면 이전 그래프를 즉시 숨김 (같은 챕터 이벤트 전환 포함)
  const displayEventNum = eventUtils.resolveEventNum(currentEvent, null);
  const graphTargetKey = `${currentChapter ?? ''}:${displayEventNum >= 1 ? displayEventNum : 0}`;
  const prevGraphTargetKeyRef = useRef(null);
  useEffect(() => {
    if (prevGraphTargetKeyRef.current === graphTargetKey) return;
    const hadPrevious = prevGraphTargetKeyRef.current != null;
    prevGraphTargetKeyRef.current = graphTargetKey;
    if (!hadPrevious) return;
    clearDisplayedGraph({ loading: true });
  }, [graphTargetKey, clearDisplayedGraph]);

  useEffect(() => {
    if (!isHardNavigationReload()) return undefined;

    setIsReloading(true);
    resetGraphTransientState();
    setGraphFullScreen(resolveInitialGraphFullScreen());

    const timer = setTimeout(() => {
      setIsReloading(false);
      setIsGraphLoading(false);
    }, HARD_RELOAD_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [resetGraphTransientState]);

  const graphState = useMemo(
    () => ({
      currentChapter,
      currentEvent,
      prevValidEvent,
      elements,
      edgeLabelVisible,
      graphFullScreen,
      showGraph: Boolean(showGraph),
    }),
    [
      currentChapter,
      currentEvent,
      prevValidEvent,
      elements,
      edgeLabelVisible,
      graphFullScreen,
      showGraph,
    ],
  );

  const graphActions = useMemo(
    () => ({
      setGraphFullScreen,
      setEdgeLabelVisible,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    }),
    [filterStage],
  );

  const graphViewerState = useMemo(
    () => ({ graphPhase, isDataReady, isDataEmpty }),
    [graphPhase, isDataReady, isDataEmpty],
  );

  return {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    setIsDataReady,
    setIsGraphLoading,
    setEventGraphLoading,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  };
}

const LOG_PREFIX = '[useViewerGraphPipeline]';
const {
  PREFETCH_AHEAD_EVENTS,
  PREFETCH_NEXT_CHAPTER_EVENTS,
  DISCOVERY_WAIT_MS,
  DISCOVERY_POLL_MS,
} = VIEWER_GRAPH_PIPELINE;

function logPipelineError(message, error) {
  if (import.meta.env.DEV) {
    errorUtils.logError(`${LOG_PREFIX} ${message}`, error?.message || error);
  }
}

/** 재시도 시 effect를 다시 돌리기 위한 토큰 */
function useRetryToken() {
  const [token, setToken] = useState(0);
  const bumpRetryToken = useCallback(() => {
    setToken((n) => n + 1);
  }, []);
  return [token, bumpRetryToken];
}

function usePipelineRefs() {
  const applyTokenRef = useRef(0);
  const hasVisibleElementsRef = useRef(false);
  const chapterSyncStatusRef = useRef(new Map());
  const chapterEventDiscoveryRef = useRef(new Map());
  const chapterDiscoveryPromiseRef = useRef(new Map());
  const activeCallKeyRef = useRef(null);
  const cacheAppliedCallKeyRef = useRef(null);
  const graphScopeRef = useRef({ bookId: null, chapter: null, eventIdx: 0 });

  return useMemo(
    () => ({
      applyTokenRef,
      hasVisibleElementsRef,
      chapterSyncStatusRef,
      chapterEventDiscoveryRef,
      chapterDiscoveryPromiseRef,
      activeCallKeyRef,
      cacheAppliedCallKeyRef,
      graphScopeRef,
    }),
    [],
  );
}

function useGraphElementApply({ setElements, setEvents, setGraphIsDataEmpty, refs }) {
  const setVisibleElements = useCallback((nextElements) => {
    // useState setter는 안정적이라 ref indirection 불필요
    const visibleElements = commitVisibleGraphElements(
      setElements,
      nextElements,
      { applyTokenRef: refs.applyTokenRef },
    );
    refs.hasVisibleElementsRef.current = visibleElements.length > 0;
    setGraphIsDataEmpty?.(visibleElements.length === 0);
    return visibleElements;
  }, [setElements, setGraphIsDataEmpty, refs]);

  /** React elements는 GraphState가 리셋. in-flight apply만 무효화 */
  const invalidateVisibleGraphApply = useCallback(() => {
    refs.applyTokenRef.current += 1;
    refs.hasVisibleElementsRef.current = false;
  }, [refs]);

  const commitGraphState = useCallback(({
    graphChapter,
    apiEventIdx,
    elements,
    eventMeta,
    normalizedEvent: normalizedEventInput,
    characters = [],
    relations = [],
  }) => {
    const normalizedEvent = normalizedEventInput
      ?? graphDataTransformUtils.normalizeApiEvent(
        eventMeta ?? fallbackEventMeta(graphChapter, apiEventIdx),
      );

    setVisibleElements(elements);

    if (!normalizedEvent) return;

    setEvents((prev) => eventUtils.updateEventsInState(
      prev,
      graphDataTransformUtils.createNextEventData(
        normalizedEvent,
        graphChapter,
        apiEventIdx,
        { relations, characters, event: eventMeta ?? null },
      ),
      graphChapter,
    ));
  }, [setEvents, setVisibleElements]);

  return { setVisibleElements, invalidateVisibleGraphApply, commitGraphState };
}

function useGraphCacheApply({
  book,
  setEvents,
  setIsDataReady,
  setEventGraphLoading,
  finishFineLoading,
  refs,
  commitGraphState,
}) {
  const syncEventsFromCache = useCallback((targetChapter, { force = false, throughEventIdx = null } = {}) => {
    const bookId = resolvePipelineBookId(book);
    if (!bookId || !targetChapter || targetChapter < 1) return false;

    const key = cacheKeyUtils.createChapterKey(bookId, targetChapter);
    const status = refs.chapterSyncStatusRef.current.get(key);
    if (status === 'running') return false;
    if (status === 'completed' && !force) return false;

    refs.chapterSyncStatusRef.current.set(key, 'running');

    try {
      let result = null;
      setEvents((prev) => {
        result = applyChapterEventsFromCache(prev, bookId, targetChapter, throughEventIdx);
        return result.hasPayload ? result.events : prev;
      });

      if (!result?.hasPayload) {
        refs.chapterSyncStatusRef.current.set(key, 'pending');
        return false;
      }

      const didApply = result.applied || result.isEmpty;
      refs.chapterSyncStatusRef.current.set(key, didApply ? 'completed' : 'pending');
      return didApply;
    } catch (error) {
      refs.chapterSyncStatusRef.current.delete(key);
      logPipelineError('챕터 이벤트 동기화 실패', error);
      return false;
    }
  }, [book, setEvents, refs]);

  const prefetchAhead = useCallback((bookId, chapter, eventIdx) => {
    void prefetchChapterEvents(bookId, chapter, eventIdx + PREFETCH_AHEAD_EVENTS).catch(() => {});
    // 다음 챕터 선캐시 — 페이지 넘김으로 챕터 전환 시 discovery 대기 제거
    const nextChapter = Number(chapter) + 1;
    if (Number.isFinite(nextChapter) && nextChapter >= 1) {
      void prefetchChapterEvents(bookId, nextChapter, PREFETCH_NEXT_CHAPTER_EVENTS).catch(() => {});
    }
  }, []);

  const markPendingLoad = useCallback((_bookId, _chapter, _eventIdx) => {
    setIsDataReady(false);
    setEventGraphLoading(true);
  }, [setIsDataReady, setEventGraphLoading]);

  const tryApplyCache = useCallback((bookId, chapter, eventIdx, callKey) => {
    if (refs.cacheAppliedCallKeyRef.current === callKey) return true;

    const resolved = resolveCumulativeGraphForDisplay(bookId, chapter, eventIdx);
    if (!resolved) return false;

    refs.cacheAppliedCallKeyRef.current = callKey;
    commitGraphState(toCommitGraphArgs(chapter, eventIdx, resolved));
    return true;
  }, [commitGraphState, refs]);

  const ensureCacheOrPending = useCallback((bookId, chapter, eventIdx, callKey, { finalizeOnCache = false } = {}) => {
    const hit = tryApplyCache(bookId, chapter, eventIdx, callKey);
    if (!hit) {
      markPendingLoad(bookId, chapter, eventIdx);
      return false;
    }
    prefetchAhead(bookId, chapter, eventIdx);
    if (finalizeOnCache) finishFineLoading(true, false, null, true);
    return true;
  }, [finishFineLoading, markPendingLoad, prefetchAhead, tryApplyCache]);

  return { syncEventsFromCache, ensureCacheOrPending };
}

function useGraphChapterDiscovery({
  book,
  currentChapter,
  currentEvent,
  isViewerPageReady,
  setIsGraphLoading,
  syncEventsFromCache,
  refs,
}) {
  const [discoveryError, setDiscoveryError] = useState(null);
  const [discoveryRetryToken, bumpDiscoveryRetry] = useRetryToken();
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();

  const retryDiscovery = useCallback(() => {
    const bookId = resolvePipelineBookId(book);
    if (!bookId || !currentChapter) return;

    const chapterKey = cacheKeyUtils.createChapterKey(bookId, currentChapter);
    refs.chapterEventDiscoveryRef.current.delete(chapterKey);
    refs.chapterDiscoveryPromiseRef.current.delete(chapterKey);
    refs.chapterSyncStatusRef.current.delete(chapterKey);
    setDiscoveryError(null);
    setIsGraphLoading(true);
    bumpDiscoveryRetry();
  }, [book, currentChapter, setIsGraphLoading, refs, bumpDiscoveryRetry]);

  useEffect(() => {
    const bookId = resolvePipelineBookId(book);
    if (!bookId || !currentChapter || currentChapter < 1) return;
    const throughEventIdx = eventUtils.resolveEventNum(currentEvent, null);
    // 확정된 이벤트까지만 캐시 동기화 — 미확정 시 event 1로 가장하지 않음
    if (!(throughEventIdx >= 1)) return;
    syncEventsFromCache(currentChapter, { throughEventIdx });
  }, [book, currentChapter, currentEvent, syncEventsFromCache]);

  useEffect(() => {
    const bookId = resolvePipelineBookId(book);
    if (!isViewerPageReady || !bookId || !currentChapter) return undefined;

    // 현재 읽기 이벤트가 확정된 뒤에만 discovery → 잘못된 이벤트 스냅샷 방지
    const throughEventIdx = eventUtils.resolveEventNum(currentEvent, null);
    if (!(throughEventIdx >= 1)) {
      setIsGraphLoading(true);
      return undefined;
    }

    const runId = nextRequestId();
    const discoveryKey = cacheKeyUtils.createChapterKey(bookId, currentChapter);
    let cancelled = false;
    const isRunStale = () => cancelled || isStale(runId);

    const setLoading = (loading) => {
      if (!isRunStale()) setIsGraphLoading(loading);
    };

    const syncDiscoveredEvents = () => {
      syncEventsFromCache(currentChapter, { force: true, throughEventIdx });
    };

    const markCovered = () => {
      refs.chapterEventDiscoveryRef.current.set(discoveryKey, throughEventIdx);
      setLoading(false);
      setDiscoveryError(null);
      syncDiscoveredEvents();
    };

    const runDiscovery = async () => {
      // 캐시 hit면 로딩 플래시 없이 즉시 완료
      if (hasCachedChapterThrough(bookId, currentChapter, throughEventIdx)) {
        markCovered();
        return;
      }

      while (!isRunStale()) {
        const existingThrough = refs.chapterEventDiscoveryRef.current.get(discoveryKey);
        if (typeof existingThrough === 'number' && existingThrough >= throughEventIdx) {
          setDiscoveryError(null);
          setLoading(false);
          syncDiscoveredEvents();
          return;
        }

        if (!(await awaitPendingChapterDiscovery(refs.chapterDiscoveryPromiseRef.current.get(discoveryKey)))) {
          break;
        }
      }

      if (isRunStale()) return;

      // pending discovery가 캐시를 이미 채웠을 수 있음
      if (hasCachedChapterThrough(bookId, currentChapter, throughEventIdx)) {
        markCovered();
        return;
      }

      refs.chapterEventDiscoveryRef.current.set(discoveryKey, 'loading');
      setLoading(true);
      setDiscoveryError(null);

      const discoveryPromise = ensureChapterEventsDiscovered(bookId, currentChapter, {
        throughEventIdx,
        onPartialCache: () => {
          if (isRunStale()) return;
          syncDiscoveredEvents();
          if (getCachedChapterMaxEventIdx(bookId, currentChapter) >= throughEventIdx) {
            refs.chapterEventDiscoveryRef.current.set(discoveryKey, throughEventIdx);
            setLoading(false);
            setDiscoveryError(null);
          }
        },
      });

      refs.chapterDiscoveryPromiseRef.current.set(discoveryKey, discoveryPromise);

      let outcome;
      try {
        outcome = await discoveryPromise;
      } finally {
        if (refs.chapterDiscoveryPromiseRef.current.get(discoveryKey) === discoveryPromise) {
          refs.chapterDiscoveryPromiseRef.current.delete(discoveryKey);
        }
      }

      if (isRunStale()) {
        if (refs.chapterEventDiscoveryRef.current.get(discoveryKey) === 'loading') {
          refs.chapterEventDiscoveryRef.current.delete(discoveryKey);
        }
        return;
      }

      if (outcome.success) {
        markCovered();
        return;
      }

      refs.chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
      setLoading(false);
      setDiscoveryError(buildViewerActionError(
        '챕터 이벤트를 불러오지 못했습니다.',
        outcome.reason === 'api_error'
          ? outcome.error?.message || '알 수 없는 오류가 발생했습니다.'
          : '캐시가 생성되지 않았습니다.',
        retryDiscovery,
      ));

      if (outcome.reason === 'api_error') {
        logPipelineError('챕터 이벤트 discovery 실패', outcome.error);
      }
    };

    void runDiscovery();

    return () => {
      cancelled = true;
      invalidate();
      if (
        refs.chapterEventDiscoveryRef.current.get(discoveryKey) === 'loading' &&
        !refs.chapterDiscoveryPromiseRef.current.has(discoveryKey)
      ) {
        refs.chapterEventDiscoveryRef.current.delete(discoveryKey);
      }
    };
  }, [
    book,
    currentChapter,
    currentEvent,
    discoveryRetryToken,
    isViewerPageReady,
    retryDiscovery,
    setIsGraphLoading,
    syncEventsFromCache,
    refs,
    nextRequestId,
    isStale,
    invalidate,
  ]);

  return { discoveryError };
}

function useGraphFineLoad({
  target,
  ready,
  loading,
  refs,
  invalidateVisibleGraphApply,
  setVisibleElements,
  ensureCacheOrPending,
}) {
  const { book, currentChapter, currentEvent } = target;
  const manifestLoaded = ready.manifest;
  const isViewerPageReady = ready.viewer;
  const { resetTransition, setIsDataReady, setEventGraphLoading } = loading;
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();

  const [apiError, setApiError] = useState(null);
  const [retryGeneration, bumpGraphRetry] = useRetryToken();

  const finishFineLoading = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    setIsDataReady((prev) => (prev === isReady ? prev : isReady));
    setEventGraphLoading((prev) => (prev === isLoading ? prev : isLoading));
    if (shouldResetTransition) resetTransition();
    setApiError((prev) => (error == null && prev == null ? prev : error));
  }, [resetTransition, setIsDataReady, setEventGraphLoading]);

  const clearActiveGraphKeys = useCallback(() => {
    refs.activeCallKeyRef.current = null;
    refs.cacheAppliedCallKeyRef.current = null;
  }, [refs]);

  const triggerGraphRetry = useCallback(() => {
    setApiError(null);
    clearActiveGraphKeys();
    setEventGraphLoading(true);
    bumpGraphRetry();
  }, [clearActiveGraphKeys, setEventGraphLoading, bumpGraphRetry]);

  const resolveCallContext = useCallback(
    () => resolveGraphCallContext({ book, currentChapter, currentEvent }),
    [book, currentChapter, currentEvent],
  );

  const failFineLoad = useCallback((error) => {
    clearActiveGraphKeys();
    setVisibleElements([]);
    finishFineLoading(
      true,
      false,
      buildViewerActionError(
        '그래프 데이터를 불러오지 못했습니다.',
        error?.message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        triggerGraphRetry,
      ),
    );
  }, [clearActiveGraphKeys, finishFineLoading, setVisibleElements, triggerGraphRetry]);

  const waitForDiscovery = useCallback(async (bookId, chapter, eventIdx) => {
    const discoveryKey = cacheKeyUtils.createChapterKey(bookId, chapter);
    const deadline = Date.now() + DISCOVERY_WAIT_MS;

    while (Date.now() < deadline) {
      const coverage = resolveChapterDiscoveryCoverage(refs, bookId, chapter, eventIdx);
      if (coverage) return coverage;

      if (await awaitPendingChapterDiscovery(refs.chapterDiscoveryPromiseRef.current.get(discoveryKey))) {
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_MS));
    }

    return { ready: false, reason: 'timeout' };
  }, [refs]);

  const pipelineBookId = resolvePipelineBookId(book);

  useEffect(() => {
    const bookId = pipelineBookId;
    const chapter = currentChapter ?? null;
    const eventIdx = eventUtils.resolveEventNum(currentEvent, null);
    const eventKey = eventIdx >= 1 ? eventIdx : 0;
    const prev = refs.graphScopeRef.current;
    const bookChanged = prev.bookId !== bookId;
    const chapterChanged = prev.chapter !== chapter;
    const eventChanged = prev.eventIdx !== eventKey;

    if (!bookChanged && !chapterChanged && !eventChanged) return;

    if (bookChanged && prev.bookId != null) {
      clearBookRelationshipDeltas(prev.bookId);
    }

    refs.graphScopeRef.current = { bookId, chapter, eventIdx: eventKey };
    if (bookChanged || chapterChanged) {
      clearViewerGraphPipelineMaps(refs);
      setApiError(null);
    }
    clearActiveGraphKeys();
    // elements/isDataEmpty 리셋은 useViewerGraphState 소유. in-flight apply만 무효화
    if (bookChanged || chapterChanged || eventChanged) invalidateVisibleGraphApply();
  }, [
    pipelineBookId,
    currentChapter,
    currentEvent,
    clearActiveGraphKeys,
    invalidateVisibleGraphApply,
    refs,
  ]);

  const holdUntilEventResolved = useCallback(() => {
    clearActiveGraphKeys();
    setIsDataReady(false);
    setEventGraphLoading(true);
  }, [clearActiveGraphKeys, setIsDataReady, setEventGraphLoading]);

  useLayoutEffect(() => {
    if (!manifestLoaded) return;

    const ctx = resolveCallContext();
    if (!ctx?.bookId || !ctx.chapter) return;

    if (!(ctx.eventIdx >= 1)) {
      holdUntilEventResolved();
      return;
    }

    const callKey = ctx.callKey;
    if (callKey === refs.activeCallKeyRef.current) return;

    if (ensureCacheOrPending(ctx.bookId, ctx.chapter, ctx.eventIdx, callKey, {
      finalizeOnCache: true,
    })) {
      refs.activeCallKeyRef.current = callKey;
    }
  }, [
    ensureCacheOrPending,
    holdUntilEventResolved,
    manifestLoaded,
    resolveCallContext,
    refs,
  ]);

  const canFineLoad = manifestLoaded && isViewerPageReady;

  useEffect(() => {
    const generation = nextRequestId();

    if (!canFineLoad) return undefined;

    const ctx = resolveCallContext();
    if (!ctx?.bookId || !ctx.chapter) return undefined;

    if (!(ctx.eventIdx >= 1)) {
      holdUntilEventResolved();
      return undefined;
    }

    const { bookId, chapter, eventIdx, callKey } = ctx;

    if (refs.activeCallKeyRef.current === callKey) return undefined;

    const isCurrent = () =>
      !isStale(generation) &&
      refs.activeCallKeyRef.current === callKey;

    const runLoad = async () => {
      if (isStale(generation)) return;

      refs.activeCallKeyRef.current = callKey;

      if (ensureCacheOrPending(bookId, chapter, eventIdx, callKey)) {
        finishFineLoading(true, false, null, true);
        return;
      }

      try {
        const waited = await waitForDiscovery(bookId, chapter, eventIdx);
        if (!isCurrent()) return;

        if (ensureCacheOrPending(bookId, chapter, eventIdx, callKey)) {
          finishFineLoading(true, false);
          return;
        }

        if (!waited.ready) {
          failFineLoad(new Error(
            waited.reason === 'timeout'
              ? '챕터 이벤트 준비를 기다리는 중 시간이 초과되었습니다.'
              : '챕터 이벤트 캐시가 없습니다.',
          ));
          return;
        }

        setVisibleElements([]);
        finishFineLoading(true, false);
      } catch (error) {
        if (!isCurrent()) return;
        failFineLoad(error);
      }
    };

    queueMicrotask(runLoad);

    return () => {
      invalidate();
    };
  }, [
    canFineLoad,
    ensureCacheOrPending,
    failFineLoad,
    finishFineLoading,
    holdUntilEventResolved,
    resolveCallContext,
    retryGeneration,
    setVisibleElements,
    waitForDiscovery,
    refs,
    nextRequestId,
    isStale,
    invalidate,
  ]);

  return { apiError, finishFineLoading };
}

export function useViewerGraphPipeline({
  book,
  currentChapter,
  currentEvent,
  setIsDataEmpty: setGraphIsDataEmpty,
  manifestLoaded,
  isViewerPageReady,
  setElements,
  setEvents,
  setIsGraphLoading,
  setEventGraphLoading,
  setIsDataReady,
  resetTransition,
}) {
  const refs = usePipelineRefs();
  const finishFineLoadingRef = useRef(() => {});

  const { setVisibleElements, invalidateVisibleGraphApply, commitGraphState } = useGraphElementApply({
    setElements,
    setEvents,
    setGraphIsDataEmpty,
    refs,
  });

  const invokeFinishFineLoading = useCallback((...args) => {
    finishFineLoadingRef.current(...args);
  }, []);

  const { syncEventsFromCache, ensureCacheOrPending } = useGraphCacheApply({
    book,
    setEvents,
    setIsDataReady,
    setEventGraphLoading,
    finishFineLoading: invokeFinishFineLoading,
    refs,
    commitGraphState,
  });

  const { discoveryError } = useGraphChapterDiscovery({
    book,
    currentChapter,
    currentEvent,
    isViewerPageReady,
    setIsGraphLoading,
    syncEventsFromCache,
    refs,
  });

  const { apiError, finishFineLoading } = useGraphFineLoad({
    target: { book, currentChapter, currentEvent },
    ready: { manifest: manifestLoaded, viewer: isViewerPageReady },
    loading: { resetTransition, setIsDataReady, setEventGraphLoading },
    refs,
    invalidateVisibleGraphApply,
    setVisibleElements,
    ensureCacheOrPending,
  });

  finishFineLoadingRef.current = finishFineLoading;

  return { graphApiError: discoveryError ?? apiError };
}


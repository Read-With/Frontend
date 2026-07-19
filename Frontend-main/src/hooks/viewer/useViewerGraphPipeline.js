/** 뷰어 그래프: UI 상태 + 챕터 이벤트 discovery·캐시 기반 로드 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ensureChapterEventsDiscovered,
  getCachedChapterEvents,
  getGraphEventState,
  prefetchChapterEvents,
  clearBookRelationshipDeltas,
} from '../../utils/common/cache/chapterEventCache';
import { applyChapterEventsFromCache } from '../../utils/graph/graphData';
import { aggregateCharactersFromEvents } from '../../utils/graph/characterUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import {
  cacheKeyUtils,
  eventUtils,
  buildViewerActionError,
  saveViewerMode,
  resolveInitialGraphFullScreen,
} from '../../utils/viewer/viewerCoreStateUtils';
import {
  commitVisibleGraphElements,
  fallbackEventMeta,
  getCachedGraphSnapshot,
  graphDataTransformUtils,
  resolveCumulativeGraphForDisplay,
  resolveGraphCallContext,
} from '../../utils/viewer/viewerGraphUtils';
import { eventMatchesChapter } from '../../utils/viewer/viewerEventProgressUtils';
import { useGraphSearch } from '../graph/useGraphViewHooks';

const PREFETCH_AHEAD_EVENTS = 2;
const HARD_RELOAD_SETTLE_MS = 1000;
const DISCOVERY_WAIT_MS = 30000;
const DISCOVERY_POLL_MS = 16;
const LOG_PREFIX = '[useViewerGraphPipeline]';

function deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }) {
  if (isReloading) return 'reloading';
  if (isEventGraphLoading) return 'event';
  if (isGraphLoading) return 'loading';
  return 'idle';
}

function resolvePersistedViewerMode(graphFullScreen, showGraph) {
  if (graphFullScreen) return 'graph';
  if (showGraph) return 'split';
  return 'viewer';
}

function isHardNavigationReload() {
  if (!performance?.getEntriesByType) return false;
  const [entry] = performance.getEntriesByType('navigation');
  return entry?.type === 'reload';
}

function isNumericBookId(bookId) {
  return typeof bookId === 'number';
}

function logPipelineError(message, error) {
  errorUtils.logError(`${LOG_PREFIX} ${message}`, error);
}

function getCachedMaxEventIdx(bookId, chapter) {
  return Number(getCachedChapterEvents(bookId, chapter)?.maxEventIdx) || 0;
}

async function awaitPendingDiscovery(pending) {
  if (!pending) return false;
  try {
    await pending;
  } catch {
    /* discovery 쪽에서 에러 상태 기록 */
  }
  return true;
}

/** 캐시 max 또는 discovery status로 through 커버리지 판정 */
function resolveDiscoveryCoverage(refs, bookId, chapter, eventIdx) {
  if (getCachedMaxEventIdx(bookId, chapter) >= eventIdx) {
    return { ready: true };
  }
  const status = refs.chapterEventDiscoveryRef.current.get(
    cacheKeyUtils.createChapterKey(bookId, chapter)
  );
  if (typeof status === 'number' && status >= eventIdx) return { ready: true };
  if (status === 'missing') return { ready: false, reason: 'missing' };
  return null;
}

function clearChapterPipelineMaps(refs) {
  refs.chapterSyncStatusRef.current.clear();
  refs.chapterEventDiscoveryRef.current.clear();
  refs.chapterDiscoveryPromiseRef.current.clear();
}

function toCommitGraphArgs(chapter, eventIdx, source) {
  return {
    graphChapter: chapter,
    apiEventIdx: eventIdx,
    elements: source.elements,
    eventMeta: source.eventMeta,
    normalizedEvent: source.normalizedEvent ?? undefined,
    characters: source.characters,
    relations: source.relations,
  };
}

/** showGraph는 settings(SSOT). UI 반영·fullscreen persist만 담당 */
export function useViewerGraphState({
  currentChapter,
  bookKey,
  showGraph,
}) {
  const [currentEvent, setCurrentEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [prevValidEvent, setPrevValidEvent] = useState(null);
  const [graphFullScreen, setGraphFullScreen] = useState(() =>
    resolveInitialGraphFullScreen(showGraph)
  );
  const [isDataReady, setIsDataReady] = useState(false);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [filterStage, setFilterStage] = useState(0);
  const [isReloading, setIsReloading] = useState(false);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isEventGraphLoading, setEventGraphLoading] = useState(false);
  const [elements, setElements] = useState([]);
  const [isDataEmpty, setIsDataEmpty] = useState(false);

  const currentChapterData = useMemo(() => {
    if (!currentChapter || !Array.isArray(events) || events.length === 0) {
      return { characters: [] };
    }
    const chapterEvents = events.filter(
      (evt) => Number(eventUtils.resolveChapterIdx(evt)) === Number(currentChapter)
    );
    return { characters: Array.from(aggregateCharactersFromEvents(chapterEvents).values()) };
  }, [events, currentChapter]);

  const graphPhase = useMemo(
    () => deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }),
    [isReloading, isEventGraphLoading, isGraphLoading]
  );

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);

  useEffect(() => {
    saveViewerMode(resolvePersistedViewerMode(graphFullScreen, showGraph));
  }, [showGraph, graphFullScreen]);

  useEffect(() => {
    if (!showGraph && graphFullScreen) setGraphFullScreen(false);
  }, [showGraph, graphFullScreen]);

  useEffect(() => {
    if (!currentEvent) return;
    if (eventMatchesChapter(currentEvent, currentChapter)) {
      setPrevValidEvent(currentEvent);
      return;
    }
    setCurrentEvent(null);
    setPrevValidEvent(null);
  }, [currentChapter, currentEvent]);

  const resetGraphPipelineState = useCallback(() => {
    setEvents([]);
    setElements([]);
    setIsDataEmpty(true);
    setIsDataReady(false);
    setIsGraphLoading(true);
  }, []);

  const resetGraphTransientState = useCallback(() => {
    setCurrentEvent(null);
    setPrevValidEvent(null);
    resetGraphPipelineState();
  }, [resetGraphPipelineState]);

  useEffect(() => {
    resetGraphPipelineState();
  }, [currentChapter, bookKey, resetGraphPipelineState]);

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
    ]
  );

  const graphActions = useMemo(
    () => ({
      setGraphFullScreen,
      setEdgeLabelVisible,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    }),
    [filterStage]
  );

  const graphViewerState = useMemo(
    () => ({ graphPhase, isDataReady, isDataEmpty }),
    [graphPhase, isDataReady, isDataEmpty]
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

function usePipelineRefs() {
  const setElementsRef = useRef(null);
  const applyTokenRef = useRef(0);
  const hasVisibleElementsRef = useRef(false);
  const chapterSyncStatusRef = useRef(new Map());
  const chapterEventDiscoveryRef = useRef(new Map());
  const chapterDiscoveryPromiseRef = useRef(new Map());
  const activeDiscoveryRunRef = useRef(0);
  const activeCallKeyRef = useRef(null);
  const cacheAppliedCallKeyRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const graphScopeRef = useRef({ bookId: null, chapter: null });

  const refsRef = useRef(null);
  if (!refsRef.current) {
    refsRef.current = {
      setElementsRef,
      applyTokenRef,
      hasVisibleElementsRef,
      chapterSyncStatusRef,
      chapterEventDiscoveryRef,
      chapterDiscoveryPromiseRef,
      activeDiscoveryRunRef,
      activeCallKeyRef,
      cacheAppliedCallKeyRef,
      loadGenerationRef,
      graphScopeRef,
    };
  }
  return refsRef.current;
}

function useGraphElementApply({ setElements, setEvents, setGraphIsDataEmpty, refs }) {
  useEffect(() => {
    refs.setElementsRef.current = setElements;
  }, [setElements, refs]);

  const setVisibleElements = useCallback((nextElements) => {
    const visibleElements = commitVisibleGraphElements(
      (els) => { refs.setElementsRef.current(els); },
      nextElements,
      { applyTokenRef: refs.applyTokenRef }
    );
    refs.hasVisibleElementsRef.current = visibleElements.length > 0;
    setGraphIsDataEmpty?.(visibleElements.length === 0);
    return visibleElements;
  }, [setGraphIsDataEmpty, refs]);

  const clearGraphElements = useCallback(() => {
    refs.applyTokenRef.current += 1;
    refs.hasVisibleElementsRef.current = false;
    refs.setElementsRef.current([]);
    setGraphIsDataEmpty?.(true);
  }, [setGraphIsDataEmpty, refs]);

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
        eventMeta ?? fallbackEventMeta(graphChapter, apiEventIdx)
      );

    setVisibleElements(elements);

    if (!normalizedEvent) return;

    setEvents((prev) => eventUtils.updateEventsInState(
      prev,
      graphDataTransformUtils.createNextEventData(
        normalizedEvent,
        graphChapter,
        apiEventIdx,
        { relations, characters, event: eventMeta ?? null }
      ),
      graphChapter
    ));
  }, [setEvents, setVisibleElements]);

  return { setVisibleElements, clearGraphElements, commitGraphState };
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
    if (!isNumericBookId(book?.id) || !targetChapter || targetChapter < 1) return false;

    const key = cacheKeyUtils.createChapterKey(book.id, targetChapter);
    const status = refs.chapterSyncStatusRef.current.get(key);
    if (status === 'running') return false;
    if (status === 'completed' && !force) return false;

    refs.chapterSyncStatusRef.current.set(key, 'running');

    try {
      let result = null;
      setEvents((prev) => {
        result = applyChapterEventsFromCache(prev, book.id, targetChapter, throughEventIdx);
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
  }, [book?.id, setEvents, refs]);

  const prefetchAhead = useCallback((bookId, chapter, eventIdx) => {
    void prefetchChapterEvents(bookId, chapter, eventIdx + PREFETCH_AHEAD_EVENTS).catch(() => {});
  }, []);

  const markPendingLoad = useCallback((bookId, chapter, eventIdx) => {
    if (getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventState)) return;
    if (refs.hasVisibleElementsRef.current) return;
    setIsDataReady(false);
    setEventGraphLoading(true);
  }, [setIsDataReady, setEventGraphLoading, refs]);

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
    if (finalizeOnCache) finishFineLoading(true, false, null, false);
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
  const [discoveryRetryToken, setDiscoveryRetryToken] = useState(0);

  const retryDiscovery = useCallback(() => {
    if (!book?.id || !currentChapter) return;

    const chapterKey = cacheKeyUtils.createChapterKey(book.id, currentChapter);
    refs.chapterEventDiscoveryRef.current.delete(chapterKey);
    refs.chapterDiscoveryPromiseRef.current.delete(chapterKey);
    refs.chapterSyncStatusRef.current.delete(chapterKey);
    setDiscoveryError(null);
    setIsGraphLoading(true);
    setDiscoveryRetryToken((token) => token + 1);
  }, [book?.id, currentChapter, setIsGraphLoading, refs]);

  useEffect(() => {
    if (!isNumericBookId(book?.id) || !currentChapter || currentChapter < 1) return;
    syncEventsFromCache(currentChapter, {
      throughEventIdx: eventUtils.resolveEventNum(currentEvent, null),
    });
  }, [book?.id, currentChapter, currentEvent, syncEventsFromCache]);

  useEffect(() => {
    if (!isViewerPageReady || !isNumericBookId(book?.id) || !currentChapter) return undefined;

    const throughEventIdx = eventUtils.resolveEventNum(currentEvent, null);
    if (!throughEventIdx || throughEventIdx < 1) return undefined;

    const runId = ++refs.activeDiscoveryRunRef.current;
    const discoveryKey = cacheKeyUtils.createChapterKey(book.id, currentChapter);
    let cancelled = false;
    const isStale = () => cancelled || runId !== refs.activeDiscoveryRunRef.current;

    const setLoading = (loading) => {
      if (!isStale()) setIsGraphLoading(loading);
    };

    const markCovered = () => {
      refs.chapterEventDiscoveryRef.current.set(discoveryKey, throughEventIdx);
      setLoading(false);
      setDiscoveryError(null);
      syncEventsFromCache(currentChapter, { force: true, throughEventIdx });
    };

    const runDiscovery = async () => {
      const forceSync = () =>
        syncEventsFromCache(currentChapter, { force: true, throughEventIdx });

      while (!isStale()) {
        const existingThrough = refs.chapterEventDiscoveryRef.current.get(discoveryKey);
        if (typeof existingThrough === 'number' && existingThrough >= throughEventIdx) {
          setDiscoveryError(null);
          forceSync();
          return;
        }

        if (!(await awaitPendingDiscovery(refs.chapterDiscoveryPromiseRef.current.get(discoveryKey)))) {
          break;
        }
      }

      if (isStale()) return;

      refs.chapterEventDiscoveryRef.current.set(discoveryKey, 'loading');
      setLoading(true);
      setDiscoveryError(null);

      const discoveryPromise = ensureChapterEventsDiscovered(book.id, currentChapter, {
        throughEventIdx,
        onPartialCache: () => {
          if (isStale()) return;
          forceSync();
          if (getCachedMaxEventIdx(book.id, currentChapter) >= throughEventIdx) {
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

      if (isStale()) {
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
        retryDiscovery
      ));

      if (outcome.reason === 'api_error') {
        logPipelineError('챕터 이벤트 discovery 실패', outcome.error);
      }
    };

    void runDiscovery();

    return () => {
      cancelled = true;
      if (
        refs.chapterEventDiscoveryRef.current.get(discoveryKey) === 'loading' &&
        !refs.chapterDiscoveryPromiseRef.current.has(discoveryKey)
      ) {
        refs.chapterEventDiscoveryRef.current.delete(discoveryKey);
      }
    };
  }, [
    book?.id,
    currentChapter,
    currentEvent,
    discoveryRetryToken,
    isViewerPageReady,
    retryDiscovery,
    setIsGraphLoading,
    syncEventsFromCache,
    refs,
  ]);

  return { discoveryError };
}

function useGraphFineLoad({
  target,
  ready,
  loading,
  refs,
  clearGraphElements,
  setVisibleElements,
  ensureCacheOrPending,
}) {
  const { book, currentChapter, currentEvent } = target;
  const manifestLoaded = ready.manifest;
  const isViewerPageReady = ready.viewer;
  const { resetTransition, setIsDataReady, setEventGraphLoading } = loading;

  const [apiError, setApiError] = useState(null);
  const [retryGeneration, setRetryGeneration] = useState(0);

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
    setRetryGeneration((n) => n + 1);
  }, [clearActiveGraphKeys, setEventGraphLoading]);

  const resolveCallContext = useCallback(
    () => resolveGraphCallContext({ book, currentChapter, currentEvent }),
    [book, currentChapter, currentEvent]
  );

  const failFineLoad = useCallback((error) => {
    clearActiveGraphKeys();
    finishFineLoading(
      true,
      false,
      buildViewerActionError(
        '그래프 데이터를 불러오지 못했습니다.',
        error?.message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        triggerGraphRetry
      )
    );
  }, [clearActiveGraphKeys, finishFineLoading, triggerGraphRetry]);

  const waitForDiscovery = useCallback(async (bookId, chapter, eventIdx) => {
    const discoveryKey = cacheKeyUtils.createChapterKey(bookId, chapter);
    const deadline = Date.now() + DISCOVERY_WAIT_MS;

    while (Date.now() < deadline) {
      const coverage = resolveDiscoveryCoverage(refs, bookId, chapter, eventIdx);
      if (coverage) return coverage;

      if (await awaitPendingDiscovery(refs.chapterDiscoveryPromiseRef.current.get(discoveryKey))) {
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_MS));
    }

    return { ready: false, reason: 'timeout' };
  }, [refs]);

  useEffect(() => {
    const bookId = book?.id ?? null;
    const chapter = currentChapter ?? null;
    const prev = refs.graphScopeRef.current;
    const bookChanged = prev.bookId !== bookId;
    const chapterChanged = prev.chapter !== chapter;

    if (!bookChanged && !chapterChanged) return;

    if (bookChanged && prev.bookId != null) {
      clearBookRelationshipDeltas(prev.bookId);
    }

    refs.graphScopeRef.current = { bookId, chapter };
    clearChapterPipelineMaps(refs);
    setApiError(null);
    clearActiveGraphKeys();
    if (bookChanged) clearGraphElements();
  }, [book?.id, currentChapter, clearActiveGraphKeys, clearGraphElements, refs]);

  useLayoutEffect(() => {
    if (!manifestLoaded) return;

    const ctx = resolveCallContext();
    if (!ctx || ctx.eventIdx < 1) return;
    if (ctx.callKey === refs.activeCallKeyRef.current) return;

    if (ensureCacheOrPending(ctx.bookId, ctx.chapter, ctx.eventIdx, ctx.callKey, {
      finalizeOnCache: true,
    })) {
      refs.activeCallKeyRef.current = ctx.callKey;
    }
  }, [ensureCacheOrPending, manifestLoaded, resolveCallContext, refs]);

  const canFineLoad = manifestLoaded && isViewerPageReady;

  useEffect(() => {
    const generation = ++refs.loadGenerationRef.current;

    if (!canFineLoad) return undefined;

    const ctx = resolveCallContext();
    if (!ctx) return undefined;

    const { bookId, chapter, eventIdx, callKey } = ctx;
    if (!bookId || !chapter || eventIdx < 1) {
      finishFineLoading(true, false);
      return undefined;
    }

    if (refs.activeCallKeyRef.current === callKey) return undefined;

    const isCurrent = () =>
      refs.loadGenerationRef.current === generation &&
      refs.activeCallKeyRef.current === callKey;

    const runLoad = async () => {
      if (refs.loadGenerationRef.current !== generation) return;

      refs.activeCallKeyRef.current = callKey;

      if (ensureCacheOrPending(bookId, chapter, eventIdx, callKey)) {
        finishFineLoading(true, false, null, false);
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
              : '챕터 이벤트 캐시가 없습니다.'
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
      refs.loadGenerationRef.current += 1;
    };
  }, [
    canFineLoad,
    ensureCacheOrPending,
    failFineLoad,
    finishFineLoading,
    resolveCallContext,
    retryGeneration,
    setVisibleElements,
    waitForDiscovery,
    refs,
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

  const { setVisibleElements, clearGraphElements, commitGraphState } = useGraphElementApply({
    setElements,
    setEvents,
    setGraphIsDataEmpty,
    refs,
  });

  const finishFineLoadingRef = useRef(null);
  const invokeFinishFineLoading = useCallback((...args) => {
    finishFineLoadingRef.current?.(...args);
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

  const fineTarget = useMemo(
    () => ({ book, currentChapter, currentEvent }),
    [book, currentChapter, currentEvent]
  );
  const fineReady = useMemo(
    () => ({ manifest: manifestLoaded, viewer: isViewerPageReady }),
    [manifestLoaded, isViewerPageReady]
  );
  const fineLoading = useMemo(
    () => ({ resetTransition, setIsDataReady, setEventGraphLoading }),
    [resetTransition, setIsDataReady, setEventGraphLoading]
  );

  const { apiError, finishFineLoading } = useGraphFineLoad({
    target: fineTarget,
    ready: fineReady,
    loading: fineLoading,
    refs,
    clearGraphElements,
    setVisibleElements,
    ensureCacheOrPending,
  });

  finishFineLoadingRef.current = finishFineLoading;

  return { graphApiError: discoveryError ?? apiError };
}

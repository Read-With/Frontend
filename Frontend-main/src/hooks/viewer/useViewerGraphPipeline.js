/** 뷰어 그래프 파이프라인: 챕터 이벤트 discovery + fine graph 로드 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getFineGraph } from '../../utils/api/api';
import {
  ensureChapterEventsDiscovered,
  getGraphEventState,
  prefetchChapterEvents,
} from '../../utils/common/cache/chapterEventCache';
import { applyChapterEventsFromCache } from '../../utils/graph/graphData';
import { errorUtils } from '../../utils/common/errorUtils';
import { cacheKeyUtils, eventUtils, buildViewerActionError } from '../../utils/viewer/viewerCoreStateUtils';
import {
  commitVisibleGraphElements,
  DEFAULT_GRAPH_TRANSFORM_DEPS,
  elementsFromGraphEventState,
  convertFineGraphToElements,
  fallbackEventMeta,
  getCachedGraphSnapshot,
  graphDataTransformUtils,
  requestFineGraph,
  resolveFineGraphCallContext,
} from '../../utils/viewer/viewerGraphUtils';

const PREFETCH_AHEAD_EVENTS = 2;

function isStaleLoad(generationRef, generation, activeCallKeyRef, callKey) {
  return generationRef.current !== generation || activeCallKeyRef.current !== callKey;
}

function usePipelineRefs() {
  const setElementsRef = useRef(null);
  const applyTokenRef = useRef(0);
  const hasVisibleElementsRef = useRef(false);
  const chapterSyncStatusRef = useRef(new Map());
  const chapterEventDiscoveryRef = useRef(new Map());
  const activeDiscoveryRunRef = useRef(0);
  const activeCallKeyRef = useRef(null);
  const apiFetchedCallKeyRef = useRef(null);
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
      activeDiscoveryRunRef,
      activeCallKeyRef,
      apiFetchedCallKeyRef,
      cacheAppliedCallKeyRef,
      loadGenerationRef,
      graphScopeRef,
    };
  }
  return refsRef.current;
}

/** 캐시/API 결과 → elements·events 커밋 */
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
    if (setGraphIsDataEmpty) setGraphIsDataEmpty(visibleElements.length === 0);
    return visibleElements;
  }, [setGraphIsDataEmpty, refs]);

  const clearGraphElements = useCallback(() => {
    refs.applyTokenRef.current += 1;
    refs.hasVisibleElementsRef.current = false;
    refs.setElementsRef.current([]);
    if (setGraphIsDataEmpty) setGraphIsDataEmpty(true);
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

    if (normalizedEvent) {
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
    }
  }, [setEvents, setVisibleElements]);

  return { setVisibleElements, clearGraphElements, commitGraphState };
}

/** chapterEventCache 스냅샷 적용·동기화 */
function useGraphCacheApply({
  book,
  setEvents,
  setIsDataReady,
  setFineGraphLoading,
  finishFineLoading,
  refs,
  commitGraphState,
}) {
  const syncEventsFromCache = useCallback((targetChapter, { force = false } = {}) => {
    if (!book?.id || typeof book.id !== 'number') return false;
    if (!targetChapter || targetChapter < 1) return false;

    const key = cacheKeyUtils.createChapterKey(book.id, targetChapter);
    const status = refs.chapterSyncStatusRef.current.get(key);
    if (status === 'running') return false;
    if (status === 'completed' && !force) return false;

    refs.chapterSyncStatusRef.current.set(key, 'running');

    try {
      const syncResult = { result: null };

      setEvents((prev) => {
        syncResult.result = applyChapterEventsFromCache(prev, book.id, targetChapter);
        if (!syncResult.result.hasPayload) return prev;
        return syncResult.result.events;
      });

      const { result } = syncResult;
      if (!result?.hasPayload) {
        refs.chapterSyncStatusRef.current.set(key, 'pending');
        return false;
      }

      const didApply = result.applied || result.isEmpty;
      refs.chapterSyncStatusRef.current.set(key, didApply ? 'completed' : 'pending');
      return didApply;
    } catch (error) {
      refs.chapterSyncStatusRef.current.delete(key);
      errorUtils.logError('[useViewerGraphPipeline] 챕터 이벤트 동기화 실패', error);
      return false;
    }
  }, [book?.id, setEvents, refs]);

  const prefetchAhead = useCallback((bookId, chapter, eventIdx) => {
    const through = eventIdx + PREFETCH_AHEAD_EVENTS;
    void prefetchChapterEvents(bookId, chapter, through).catch(() => {});
  }, []);

  const markPendingLoad = useCallback((bookId, chapter, eventIdx) => {
    if (getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventState)) return;
    if (!refs.hasVisibleElementsRef.current) {
      setIsDataReady(false);
      setFineGraphLoading(true);
    }
  }, [setIsDataReady, setFineGraphLoading, refs]);

  const tryApplyCache = useCallback((bookId, chapter, eventIdx, callKey) => {
    if (refs.cacheAppliedCallKeyRef.current === callKey) return true;

    const cached = getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventState);
    if (!cached) return false;

    const resolved = elementsFromGraphEventState(
      cached,
      chapter,
      eventIdx,
      DEFAULT_GRAPH_TRANSFORM_DEPS
    );

    // commitGraphState는 useLayoutEffect 안에서 동기 리렌더를 유발할 수 있으므로
    // ref를 먼저 설정해 중복 적용 루프를 막는다.
    refs.cacheAppliedCallKeyRef.current = callKey;

    commitGraphState({
      graphChapter: chapter,
      apiEventIdx: eventIdx,
      elements: resolved.elements,
      eventMeta: resolved.eventMeta,
      characters: resolved.characters,
      relations: resolved.relations,
    });
    return true;
  }, [commitGraphState, refs]);

  const ensureCacheOrPending = useCallback((bookId, chapter, eventIdx, callKey, { finalizeOnCache = false } = {}) => {
    const cacheApplied = tryApplyCache(bookId, chapter, eventIdx, callKey);
    if (cacheApplied) {
      prefetchAhead(bookId, chapter, eventIdx);
      if (finalizeOnCache) {
        finishFineLoading(true, false, null, false);
      }
    } else {
      markPendingLoad(bookId, chapter, eventIdx);
    }
    return cacheApplied;
  }, [finishFineLoading, markPendingLoad, prefetchAhead, tryApplyCache]);

  const shouldSkipApi = useCallback((cacheApplied, atLocator, callKey) => {
    if (!cacheApplied) return false;
    if (refs.apiFetchedCallKeyRef.current === callKey) return true;
    return !atLocator;
  }, [refs]);

  return {
    syncEventsFromCache,
    prefetchAhead,
    ensureCacheOrPending,
    shouldSkipApi,
  };
}

/** 챕터 이벤트 discovery */
function useGraphChapterDiscovery({
  book,
  currentChapter,
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
    refs.chapterSyncStatusRef.current.delete(chapterKey);
    setDiscoveryError(null);
    setIsGraphLoading(true);
    setDiscoveryRetryToken((token) => token + 1);
  }, [book?.id, currentChapter, setIsGraphLoading, refs]);

  useEffect(() => {
    if (!book?.id || typeof book.id !== 'number') return;
    if (!currentChapter || currentChapter < 1) return;
    syncEventsFromCache(currentChapter);
  }, [book?.id, currentChapter, syncEventsFromCache]);

  useEffect(() => {
    if (!isViewerPageReady) return undefined;
    if (!book?.id || typeof book.id !== 'number' || !currentChapter) return undefined;

    const runId = ++refs.activeDiscoveryRunRef.current;
    const discoveryKey = cacheKeyUtils.createChapterKey(book.id, currentChapter);
    let cancelled = false;
    const isStale = () => cancelled || runId !== refs.activeDiscoveryRunRef.current;

    const applyDiscoveryLoading = (loadingState) => {
      if (isStale()) return;
      setIsGraphLoading(loadingState);
    };

    const runDiscovery = async () => {
      const existing = refs.chapterEventDiscoveryRef.current.get(discoveryKey);
      if (existing === 'completed') {
        setDiscoveryError(null);
        syncEventsFromCache(currentChapter, { force: true });
        return;
      }
      if (existing === 'loading') return;

      refs.chapterEventDiscoveryRef.current.set(discoveryKey, 'loading');
      applyDiscoveryLoading(true);
      setDiscoveryError(null);

      const outcome = await ensureChapterEventsDiscovered(book.id, currentChapter, {
        onPartialCache: () => {
          if (isStale()) return;
          syncEventsFromCache(currentChapter, { force: true });
        },
      });

      if (isStale()) {
        refs.chapterEventDiscoveryRef.current.delete(discoveryKey);
        return;
      }

      if (outcome.success) {
        refs.chapterEventDiscoveryRef.current.set(discoveryKey, 'completed');
        applyDiscoveryLoading(false);
        setDiscoveryError(null);
        syncEventsFromCache(currentChapter, { force: true });
        return;
      }

      refs.chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
      applyDiscoveryLoading(false);
      setDiscoveryError(buildViewerActionError(
        '챕터 이벤트를 불러오지 못했습니다.',
        outcome.reason === 'api_error'
          ? outcome.error?.message || '알 수 없는 오류가 발생했습니다.'
          : '캐시가 생성되지 않았습니다.',
        retryDiscovery
      ));

      if (outcome.reason === 'api_error') {
        errorUtils.logError('[useViewerGraphPipeline] 챕터 이벤트 discovery 실패', outcome.error);
      }
    };

    void runDiscovery();

    return () => {
      cancelled = true;
      refs.chapterEventDiscoveryRef.current.delete(discoveryKey);
      setIsGraphLoading(false);
    };
  }, [
    book?.id,
    currentChapter,
    discoveryRetryToken,
    isViewerPageReady,
    retryDiscovery,
    setIsGraphLoading,
    syncEventsFromCache,
    refs,
  ]);

  return { discoveryError, retryDiscovery };
}

/** fine graph API 로드 */
function useGraphFineLoad({
  book,
  currentChapter,
  currentEvent,
  manifestLoaded,
  resetTransition,
  setIsDataReady,
  setFineGraphLoading,
  refs,
  clearGraphElements,
  setVisibleElements,
  commitGraphState,
  ensureCacheOrPending,
  shouldSkipApi,
  prefetchAhead,
}) {
  const [apiError, setApiError] = useState(null);
  const [retryGeneration, setRetryGeneration] = useState(0);

  const finishFineLoading = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    setIsDataReady((prev) => (prev === isReady ? prev : isReady));
    setFineGraphLoading((prev) => (prev === isLoading ? prev : isLoading));
    if (shouldResetTransition) resetTransition();
    setApiError((prev) => {
      if (error == null && prev == null) return prev;
      return error;
    });
  }, [resetTransition, setIsDataReady, setFineGraphLoading]);

  const resetFineGraphSession = useCallback((scope) => {
    refs.activeCallKeyRef.current = null;
    refs.cacheAppliedCallKeyRef.current = null;
    if (scope === 'book') {
      refs.apiFetchedCallKeyRef.current = null;
      setApiError(null);
      clearGraphElements();
    } else if (scope === 'chapter') {
      refs.apiFetchedCallKeyRef.current = null;
    }
  }, [clearGraphElements, refs]);

  const triggerGraphRetry = useCallback((resetApiFetched = false) => {
    setApiError(null);
    refs.activeCallKeyRef.current = null;
    refs.cacheAppliedCallKeyRef.current = null;
    if (resetApiFetched) {
      refs.apiFetchedCallKeyRef.current = null;
    }
    setFineGraphLoading(true);
    setRetryGeneration((n) => n + 1);
  }, [setFineGraphLoading, refs]);

  const resolveCallContext = useCallback(
    () => resolveFineGraphCallContext({ book, currentChapter, currentEvent }),
    [book, currentChapter, currentEvent]
  );

  const applyApiResult = useCallback((ctx, fineResult) => {
    const { bookId, chapter, eventIdx } = ctx;
    const converted = convertFineGraphToElements(
      fineResult,
      chapter,
      eventIdx,
      DEFAULT_GRAPH_TRANSFORM_DEPS
    );

    if (import.meta.env.DEV) {
      console.log('[ViewerGraph] visible graph data', { bookId, chapter, eventIdx, elements: converted.elements });
    }

    commitGraphState({
      graphChapter: chapter,
      apiEventIdx: eventIdx,
      elements: converted.elements,
      normalizedEvent: converted.normalizedEvent,
      eventMeta: converted.eventMeta,
      characters: converted.characters,
      relations: converted.relations,
    });
    prefetchAhead(bookId, chapter, eventIdx);
  }, [commitGraphState, prefetchAhead]);

  useEffect(() => {
    const bookId = book?.id ?? null;
    const chapter = currentChapter ?? null;
    const prev = refs.graphScopeRef.current;

    if (prev.bookId !== bookId) {
      refs.graphScopeRef.current = { bookId, chapter };
      refs.chapterSyncStatusRef.current.clear();
      refs.chapterEventDiscoveryRef.current.clear();
      setApiError(null);
      resetFineGraphSession('book');
      return;
    }

    if (prev.chapter !== chapter) {
      refs.graphScopeRef.current.chapter = chapter;
      refs.chapterEventDiscoveryRef.current.clear();
      refs.chapterSyncStatusRef.current.clear();
      setApiError(null);
      resetFineGraphSession('chapter');
    }
  }, [book?.id, currentChapter, resetFineGraphSession, refs]);

  useLayoutEffect(() => {
    if (!manifestLoaded) return;

    const ctx = resolveCallContext();
    if (!ctx || ctx.eventIdx < 1) return;
    if (ctx.callKey === refs.activeCallKeyRef.current) return;

    const cacheApplied = ensureCacheOrPending(ctx.bookId, ctx.chapter, ctx.eventIdx, ctx.callKey, {
      finalizeOnCache: true,
    });
    if (cacheApplied) {
      refs.activeCallKeyRef.current = ctx.callKey;
    }
  }, [ensureCacheOrPending, manifestLoaded, resolveCallContext, refs]);

  useEffect(() => {
    const generation = ++refs.loadGenerationRef.current;

    if (!manifestLoaded) return undefined;

    const ctx = resolveCallContext();
    if (!ctx) return undefined;

    const { bookId, chapter, eventIdx, callKey, atLocator } = ctx;
    if (!bookId || !chapter || eventIdx < 1) {
      finishFineLoading(true, false);
      return undefined;
    }

    if (refs.activeCallKeyRef.current === callKey) return undefined;

    const runFetch = async () => {
      if (refs.loadGenerationRef.current !== generation) return;

      refs.activeCallKeyRef.current = callKey;

      const cacheApplied = ensureCacheOrPending(bookId, chapter, eventIdx, callKey);

      if (shouldSkipApi(cacheApplied, atLocator, callKey)) {
        finishFineLoading(true, false, null, false);
        return;
      }

      try {
        refs.apiFetchedCallKeyRef.current = callKey;

        const { success, result, notFound, error } = await requestFineGraph(
          getFineGraph,
          bookId,
          chapter,
          eventIdx,
          atLocator
        );

        if (isStaleLoad(refs.loadGenerationRef, generation, refs.activeCallKeyRef, callKey)) {
          if (refs.loadGenerationRef.current !== generation) {
            refs.activeCallKeyRef.current = null;
            refs.apiFetchedCallKeyRef.current = null;
          }
          return;
        }

        if (!success) {
          if (!cacheApplied && (notFound || !error)) {
            setVisibleElements([]);
          }
          if (notFound || !error) {
            finishFineLoading(true, false);
            return;
          }

          refs.apiFetchedCallKeyRef.current = null;
          refs.activeCallKeyRef.current = null;
          finishFineLoading(true, false, buildViewerActionError(
            '그래프 데이터를 불러오지 못했습니다.',
            error?.message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            () => triggerGraphRetry(true)
          ));
          return;
        }

        applyApiResult(ctx, result);
        finishFineLoading(true, false);
      } catch (error) {
        if (refs.loadGenerationRef.current !== generation) return;

        refs.apiFetchedCallKeyRef.current = null;
        refs.activeCallKeyRef.current = null;
        finishFineLoading(true, false, buildViewerActionError(
          '그래프 데이터를 불러오지 못했습니다.',
          error?.message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          () => triggerGraphRetry(true)
        ));
      }
    };

    queueMicrotask(runFetch);

    return () => {
      refs.loadGenerationRef.current += 1;
    };
  }, [
    applyApiResult,
    currentChapter,
    currentEvent,
    finishFineLoading,
    ensureCacheOrPending,
    manifestLoaded,
    resolveCallContext,
    retryGeneration,
    setVisibleElements,
    shouldSkipApi,
    triggerGraphRetry,
    refs,
  ]);

  return { apiError, finishFineLoading };
}

export function useViewerGraphPipeline({
  book,
  currentChapter,
  currentEvent,
  graphActions,
  manifestLoaded,
  isViewerPageReady,
  setElements,
  setEvents,
  setIsGraphLoading,
  setFineGraphLoading,
  setIsDataReady,
  resetTransition,
}) {
  const refs = usePipelineRefs();
  const setGraphIsDataEmpty = graphActions?.setIsDataEmpty;

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

  const cacheLayer = useGraphCacheApply({
    book,
    setEvents,
    setIsDataReady,
    setFineGraphLoading,
    finishFineLoading: invokeFinishFineLoading,
    refs,
    commitGraphState,
  });

  const discovery = useGraphChapterDiscovery({
    book,
    currentChapter,
    isViewerPageReady,
    setIsGraphLoading,
    syncEventsFromCache: cacheLayer.syncEventsFromCache,
    refs,
  });

  const fineLoad = useGraphFineLoad({
    book,
    currentChapter,
    currentEvent,
    manifestLoaded,
    resetTransition,
    setIsDataReady,
    setFineGraphLoading,
    refs,
    clearGraphElements,
    setVisibleElements,
    commitGraphState,
    ensureCacheOrPending: cacheLayer.ensureCacheOrPending,
    shouldSkipApi: cacheLayer.shouldSkipApi,
    prefetchAhead: cacheLayer.prefetchAhead,
  });

  finishFineLoadingRef.current = fineLoad.finishFineLoading;

  const graphApiError = discovery.discoveryError ?? fineLoad.apiError;

  return { graphApiError };
}

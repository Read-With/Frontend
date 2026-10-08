/** 뷰어 그래프: UI 상태·검색·mode persist + 챕터 이벤트 discovery·캐시 로드 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  applyChapterEventsFromCache,
} from '../../utils/graph/graphFetch';
import {
  ensureChapterEventsDiscovered,
  prefetchChapterEvents,
  clearBookRelationshipDeltas,
} from '../../utils/graph/graphModel';
import { errorUtils } from '../../utils/common/valueUtils';
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

const INITIAL_GRAPH_LOAD = {
  isDataReady: false,
  isGraphLoading: true,
  isEventGraphLoading: false,
  appliedGraphKey: null,
  isDataEmpty: false,
};

/** 그래프 로딩 플래그는 이 reducer에서만 바뀐다 — 플래그 조합을 액션 단위로 고정 */
function graphLoadReducer(state, action) {
  let next;
  switch (action.type) {
    case 'bookReset':
      next = { isDataReady: false, isGraphLoading: true, isEventGraphLoading: true, appliedGraphKey: null, isDataEmpty: true };
      break;
    case 'chapterChanged':
      next = { isDataReady: false, isGraphLoading: true, isEventGraphLoading: true, appliedGraphKey: null };
      break;
    case 'pending':
      next = { isDataReady: false, isEventGraphLoading: true, appliedGraphKey: null };
      break;
    case 'retry':
      next = { isEventGraphLoading: true, appliedGraphKey: null };
      break;
    case 'applied':
      next = { appliedGraphKey: action.key ?? null };
      break;
    case 'finished':
      next = { isDataReady: action.ready, isEventGraphLoading: action.loading };
      break;
    case 'discoveryLoading':
      next = { isGraphLoading: action.loading };
      break;
    case 'empty':
      next = { isDataEmpty: action.empty };
      break;
    default:
      return state;
  }
  return Object.keys(next).every((k) => state[k] === next[k]) ? state : { ...state, ...next };
}

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
  const {
    edgeLabelVisible,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
  } = useGraphDisplayToggles();
  const [isReloading, setIsReloading] = useState(false);
  const [elements, setElements] = useState([]);
  const [graphLoad, dispatchGraphLoad] = useReducer(graphLoadReducer, INITIAL_GRAPH_LOAD);
  const { isDataReady, isGraphLoading, isEventGraphLoading, appliedGraphKey, isDataEmpty } = graphLoad;

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

  // 그래프를 끄면 전체화면 해제 (렌더 중 조정 → 중간 커밋 없음)
  if (!showGraph && graphFullScreen) setGraphFullScreen(false);


  // 챕터·이벤트 정합성은 렌더 중 조정 — 새 챕터 + 이전 이벤트 조합이 커밋되지 않게 함
  if (currentEvent) {
    if (!eventMatchesChapter(currentEvent, currentChapter)) {
      setCurrentEvent(null);
      setPrevValidEvent(null);
    } else if (prevValidEvent !== currentEvent) {
      setPrevValidEvent(currentEvent);
    }
  }

  const resetGraphPipelineState = useCallback(() => {
    setEvents([]);
    setElements([]);
    dispatchGraphLoad({ type: 'bookReset' });
  }, []);

  const resetGraphTransientState = useCallback(() => {
    setCurrentEvent(null);
    setPrevValidEvent(null);
    resetGraphPipelineState();
  }, [resetGraphPipelineState]);

  // 책 변경 hard reset
  useEffect(() => {
    resetGraphPipelineState();
  }, [bookKey, resetGraphPipelineState]);

  // 챕터 전환 중에도 기존 요소를 유지하고, 다음 스냅샷 적용 시 id diff로 증감만 반영한다.
  const [graphChapter, setGraphChapter] = useState(currentChapter);
  if (graphChapter !== currentChapter) {
    setGraphChapter(currentChapter);
    if (currentChapter != null) dispatchGraphLoad({ type: 'chapterChanged' });
  }

  useEffect(() => {
    if (!isHardNavigationReload()) return undefined;

    setIsReloading(true);
    resetGraphTransientState();
    setGraphFullScreen(resolveInitialGraphFullScreen());

    const timer = setTimeout(() => {
      setIsReloading(false);
      dispatchGraphLoad({ type: 'discoveryLoading', loading: false });
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
      filterStage,
      setFilterStage,
    }),
    [filterStage, setEdgeLabelVisible, setFilterStage],
  );

  const graphViewerState = useMemo(
    () => ({ graphPhase, isDataReady, isDataEmpty, appliedGraphKey }),
    [graphPhase, isDataReady, isDataEmpty, appliedGraphKey],
  );

  return {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    dispatchGraphLoad,
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

function useGraphElementApply({ setElements, setEvents, dispatchGraphLoad, refs }) {
  const setVisibleElements = useCallback((nextElements) => {
    // useState setter는 안정적이라 ref indirection 불필요
    const visibleElements = commitVisibleGraphElements(
      setElements,
      nextElements,
      { applyTokenRef: refs.applyTokenRef },
    );
    refs.hasVisibleElementsRef.current = visibleElements.length > 0;
    dispatchGraphLoad({ type: 'empty', empty: visibleElements.length === 0 });
    return visibleElements;
  }, [setElements, dispatchGraphLoad, refs]);

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
  bookId: pipelineBookId,
  setEvents,
  dispatchGraphLoad,
  refs,
  commitGraphState,
}) {
  const syncEventsFromCache = useCallback((targetChapter, { force = false, throughEventIdx = null } = {}) => {
    const bookId = pipelineBookId;
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
      errorUtils.logError(`${LOG_PREFIX} 챕터 이벤트 동기화 실패`, error);
      return false;
    }
  }, [pipelineBookId, setEvents, refs]);

  const prefetchAhead = useCallback((bookId, chapter, eventIdx) => {
    void prefetchChapterEvents(bookId, chapter, eventIdx + PREFETCH_AHEAD_EVENTS).catch(() => {});
    // 다음 챕터 선캐시 — 페이지 넘김으로 챕터 전환 시 discovery 대기 제거
    const nextChapter = Number(chapter) + 1;
    if (Number.isFinite(nextChapter) && nextChapter >= 1) {
      void prefetchChapterEvents(bookId, nextChapter, PREFETCH_NEXT_CHAPTER_EVENTS).catch(() => {});
    }
  }, []);

  const markPendingLoad = useCallback(() => {
    dispatchGraphLoad({ type: 'pending' });
    // 이전 이벤트 callKey 잔존 시 조기 return으로 새 타깃 적용이 스킵되지 않게 함
    refs.cacheAppliedCallKeyRef.current = null;
  }, [dispatchGraphLoad, refs]);

  const tryApplyCache = useCallback((bookId, chapter, eventIdx, callKey) => {
    if (refs.cacheAppliedCallKeyRef.current === callKey) {
      dispatchGraphLoad({ type: 'applied', key: callKey });
      return true;
    }

    const resolved = resolveCumulativeGraphForDisplay(bookId, chapter, eventIdx);
    if (!resolved) return false;

    refs.cacheAppliedCallKeyRef.current = callKey;
    commitGraphState(toCommitGraphArgs(chapter, eventIdx, resolved));
    dispatchGraphLoad({ type: 'applied', key: callKey });
    return true;
  }, [commitGraphState, refs, dispatchGraphLoad]);

  const ensureCacheOrPending = useCallback((bookId, chapter, eventIdx, callKey) => {
    const hit = tryApplyCache(bookId, chapter, eventIdx, callKey);
    if (!hit) {
      markPendingLoad();
      return false;
    }
    prefetchAhead(bookId, chapter, eventIdx);
    return true;
  }, [markPendingLoad, prefetchAhead, tryApplyCache]);

  return { syncEventsFromCache, ensureCacheOrPending };
}

function useGraphChapterDiscovery({
  bookId,
  currentChapter,
  throughEventIdx,
  isViewerPageReady,
  dispatchGraphLoad,
  syncEventsFromCache,
  refs,
}) {
  const setIsGraphLoading = useCallback((loading) => {
    dispatchGraphLoad({ type: 'discoveryLoading', loading });
  }, [dispatchGraphLoad]);
  const [discoveryError, setDiscoveryError] = useState(null);
  const [discoveryRetryToken, bumpDiscoveryRetry] = useRetryToken();
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();

  const retryDiscovery = useCallback(() => {
    if (!bookId || !currentChapter) return;

    const chapterKey = cacheKeyUtils.createChapterKey(bookId, currentChapter);
    refs.chapterEventDiscoveryRef.current.delete(chapterKey);
    refs.chapterDiscoveryPromiseRef.current.delete(chapterKey);
    refs.chapterSyncStatusRef.current.delete(chapterKey);
    setDiscoveryError(null);
    setIsGraphLoading(true);
    bumpDiscoveryRetry();
  }, [bookId, currentChapter, setIsGraphLoading, refs, bumpDiscoveryRetry]);

  useEffect(() => {
    if (!bookId || !currentChapter || currentChapter < 1) return;
    // 확정된 이벤트까지만 캐시 동기화 — 미확정 시 event 1로 가장하지 않음
    if (!(throughEventIdx >= 1)) return;
    syncEventsFromCache(currentChapter, { throughEventIdx });
  }, [bookId, currentChapter, throughEventIdx, syncEventsFromCache]);

  useEffect(() => {
    if (!isViewerPageReady || !bookId || !currentChapter) return undefined;

    // 현재 읽기 이벤트가 확정된 뒤에만 discovery → 잘못된 이벤트 스냅샷 방지
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
        errorUtils.logError(`${LOG_PREFIX} 챕터 이벤트 discovery 실패`, outcome.error);
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
    bookId,
    currentChapter,
    throughEventIdx,
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
  const { resetTransition, dispatchGraphLoad } = loading;
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();

  const [apiError, setApiError] = useState(null);
  const [retryGeneration, bumpGraphRetry] = useRetryToken();

  const finishFineLoading = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    dispatchGraphLoad({ type: 'finished', ready: isReady, loading: isLoading });
    if (shouldResetTransition) resetTransition();
    setApiError((prev) => (error == null && prev == null ? prev : error));
  }, [resetTransition, dispatchGraphLoad]);

  const clearActiveGraphKeys = useCallback(() => {
    refs.activeCallKeyRef.current = null;
    refs.cacheAppliedCallKeyRef.current = null;
  }, [refs]);

  const triggerGraphRetry = useCallback(() => {
    setApiError(null);
    clearActiveGraphKeys();
    dispatchGraphLoad({ type: 'retry' });
    bumpGraphRetry();
  }, [clearActiveGraphKeys, dispatchGraphLoad, bumpGraphRetry]);

  const resolveCallContext = useCallback(
    () => resolveGraphCallContext({ book, currentChapter, currentEvent }),
    [book, currentChapter, currentEvent],
  );

  const failFineLoad = useCallback((error) => {
    clearActiveGraphKeys();
    dispatchGraphLoad({ type: 'applied', key: null });
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
  }, [clearActiveGraphKeys, finishFineLoading, dispatchGraphLoad, setVisibleElements, triggerGraphRetry]);

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
      clearActiveGraphKeys();
      dispatchGraphLoad({ type: 'applied', key: null });
      // 책/챕터 전환만 in-flight apply·이미지 resolve 무효화
      invalidateVisibleGraphApply();
    }
    // 이벤트만 바뀌면 activeKey는 layout이 새 callKey로 교체.
    // 여기서 invalidate하면 방금 적용한 그래프의 프로필 이미지 resolve가 취소됨.
  }, [
    pipelineBookId,
    currentChapter,
    currentEvent,
    clearActiveGraphKeys,
    invalidateVisibleGraphApply,
    dispatchGraphLoad,
    refs,
  ]);

  const holdUntilEventResolved = useCallback(() => {
    clearActiveGraphKeys();
    dispatchGraphLoad({ type: 'pending' });
  }, [clearActiveGraphKeys, dispatchGraphLoad]);

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

    if (ensureCacheOrPending(ctx.bookId, ctx.chapter, ctx.eventIdx, callKey)) {
      finishFineLoading(true, false, null, true);
      refs.activeCallKeyRef.current = callKey;
    }
  }, [
    ensureCacheOrPending,
    finishFineLoading,
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

        // 캐시 히트 없이 준비만 끝난 빈 그래프 — 타깃 key를 기록해 empty UI가 뜨게 함
        setVisibleElements([]);
        dispatchGraphLoad({ type: 'applied', key: callKey });
        refs.cacheAppliedCallKeyRef.current = callKey;
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
    dispatchGraphLoad,
    waitForDiscovery,
    refs,
    nextRequestId,
    isStale,
    invalidate,
  ]);

  return { apiError };
}

export function useViewerGraphPipeline({
  book,
  currentChapter,
  currentEvent,
  manifestLoaded,
  isViewerPageReady,
  setElements,
  setEvents,
  dispatchGraphLoad,
  resetTransition,
}) {
  const refs = usePipelineRefs();
  const pipelineBookId = resolvePipelineBookId(book);

  const { setVisibleElements, invalidateVisibleGraphApply, commitGraphState } = useGraphElementApply({
    setElements,
    setEvents,
    dispatchGraphLoad,
    refs,
  });

  const { syncEventsFromCache, ensureCacheOrPending } = useGraphCacheApply({
    bookId: pipelineBookId,
    setEvents,
    dispatchGraphLoad,
    refs,
    commitGraphState,
  });

  const { discoveryError } = useGraphChapterDiscovery({
    bookId: pipelineBookId,
    currentChapter,
    throughEventIdx: eventUtils.resolveEventNum(currentEvent, null),
    isViewerPageReady,
    dispatchGraphLoad,
    syncEventsFromCache,
    refs,
  });

  const { apiError } = useGraphFineLoad({
    target: { book, currentChapter, currentEvent },
    ready: { manifest: manifestLoaded, viewer: isViewerPageReady },
    loading: { resetTransition, dispatchGraphLoad },
    refs,
    invalidateVisibleGraphApply,
    setVisibleElements,
    ensureCacheOrPending,
  });

  return { graphApiError: discoveryError ?? apiError };
}

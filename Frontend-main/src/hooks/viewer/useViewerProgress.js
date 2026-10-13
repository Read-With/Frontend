/** 뷰어 진도: resume·TopBar·locator + 자동 저장 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getBookProgress, saveProgress, saveProgressKeepalive } from '../../utils/api/booksApi';
import { ensureSessionAccessToken } from '../../utils/api/authApi';
import { canResolveProgressMetrics, resolveProgressMetricsFromLocator } from '../../utils/common/cache/manifestCache';
import {
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
  removeProgressFromCache,
  setProgressToCache,
  getCachedReaderProgress,
  setCachedReaderProgress,
} from '../../utils/common/cache/progressCache';
import { viewerResumeAnchorKey, clampPercent, errorUtils, stringOrEmpty, sleep } from '../../utils/common/valueUtils';
import {
  waitForPaint,
  waitForViewerMethod,
  resolveMetricsFromReadingLocatorKey,
  shouldApplyCacheSnapshot,
  snapshotFromProgressRow,
  toReadingLocatorKey,
  VIEWER_RESUME_TIMING,
  FORCE_RESUME_SNAPSHOT,
  normalizeProgressBookId,
  mergeProgressTopBar,
  resolveCachedResumeAnchor,
  isViewerResumeBlocking,
  buildProgressPayload,
  buildSaveLocationPayload,
  resolveReadingLocators,
} from '../../utils/viewer/viewerSession';
import { useAsyncRequestGuard, useLatestRef } from '../common/hooksShared';

const {
  POLL_MS: VIEWER_RESUME_POLL_MS,
  MAX_ATTEMPTS: VIEWER_RESUME_MAX_ATTEMPTS,
  TIMEOUT_MS: VIEWER_RESUME_TIMEOUT_MS,
  PERCENT_FALLBACK_ATTEMPTS: VIEWER_RESUME_PERCENT_FALLBACK_ATTEMPTS,
} = VIEWER_RESUME_TIMING;

/**
 * ref(같은 실행 흐름에서 즉시 읽기)와 state(렌더)를 함께 갱신.
 * patch에서 바뀐 값이 없으면 렌더 생략 (useState의 Object.is bail-out과 동일)
 */
function useRefState(initial) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  const patch = useCallback((partial) => {
    const prev = stateRef.current;
    if (Object.keys(partial).every((key) => Object.is(prev[key], partial[key]))) return;
    stateRef.current = { ...prev, ...partial };
    setState(stateRef.current);
  }, []);
  return [state, stateRef, patch];
}

/** resume 타임아웃 시 저장된 진행률(%)로 이동 시도. stale이면 즉시 중단 */
async function moveToProgressFallback(viewerRef, pct, isStale) {
  if (!Number.isFinite(pct) || pct < 0) return;
  const ready = await waitForViewerMethod(viewerRef, 'moveToProgress', VIEWER_RESUME_TIMEOUT_MS);
  if (!ready || isStale()) return;
  try {
    for (let attempt = 0; attempt < VIEWER_RESUME_PERCENT_FALLBACK_ATTEMPTS; attempt += 1) {
      if (isStale()) return;
      const moved = viewerRef.current?.moveToProgress?.(pct);
      await waitForPaint();
      if (moved) return;
      await sleep(VIEWER_RESUME_POLL_MS);
    }
  } catch (error) {
    errorUtils.logWarning(
      '[useViewerProgress] resume 타임아웃 percent 폴백 실패',
      error?.message ?? '알 수 없는 오류',
    );
  }
}

const NOT_READY = Symbol('notReady');

/** bookKey에 묶인 state — 책이 바뀌면 리셋 effect 없이 같은 렌더에서 initial로 보인다 */
function useBookScopedState(bookKey, bookKeyRef, initial) {
  const [entry, setEntry] = useState({ key: bookKey, value: initial });
  const value = entry.key === bookKey ? entry.value : initial;
  const setValue = useCallback((next) => {
    setEntry({ key: bookKeyRef.current, value: next });
  }, [bookKeyRef]);
  return [value, setValue];
}

export function useViewerProgress({
  bookKey,
  manifestLoaded,
  setReloadKey,
  viewerRef,
  reloadKey,
  preferredResumeAnchor = null,
  onPreferredResumeApplied = null,
  awaitingBookId = false,
}) {
  const [progressTopBar, setProgressTopBar] = useState(undefined);
  const [serverResumeAnchor, setServerResumeAnchor] = useState(null);
  const bookKeyRef = useLatestRef(bookKey);
  const [progress, setProgress] = useBookScopedState(bookKey, bookKeyRef, null);
  // 콜백·resume 루프가 같은 실행 흐름에서 즉시 읽어야 하는 값 (viewStateRef로 읽음)
  // readyBookKey: ready는 그 시점의 bookKey로 기록 → 책이 바뀌면 같은 렌더에서 false
  const [viewState, viewStateRef, patchViewState] = useRefState({
    resumePending: false,
    readyBookKey: NOT_READY,
    readingLocatorKey: '',
    liveChapterProgress: null,
  });
  const { resumePending: isResumePending, readyBookKey, readingLocatorKey, liveChapterProgress } = viewState;
  const isViewerPageReady = readyBookKey === bookKey;
  const isViewerPageReadyNow = useCallback(
    () => viewStateRef.current.readyBookKey === bookKeyRef.current,
    [viewStateRef, bookKeyRef],
  );

  const serverResumeAppliedKeyRef = useRef(null);
  const reloadKeyBumpedForBookRef = useRef(null);
  const manifestLocatorSyncedRef = useRef(false);
  const preferredResumeRef = useRef(null);
  const progressRef = useLatestRef(progress);
  const { nextRequestId: nextResumeRunId, isStale: isResumeRunStale, invalidate: invalidateResumeRun } =
    useAsyncRequestGuard();
  const { nextRequestId: nextProgressFetchId, isStale: isProgressFetchStale, invalidate: invalidateProgressFetch } =
    useAsyncRequestGuard();

  const markReady = useCallback(() => {
    patchViewState({
      resumePending: false,
      ...(isViewerPageReadyNow() ? {} : { readyBookKey: bookKeyRef.current }),
    });
    invalidateResumeRun();
  }, [invalidateResumeRun, patchViewState, isViewerPageReadyNow, bookKeyRef]);

  const clearPreferredResume = useCallback(() => {
    if (!preferredResumeRef.current) return;
    preferredResumeRef.current = null;
    onPreferredResumeApplied?.();
  }, [onPreferredResumeApplied]);

  const finishResume = useCallback(async (options = {}) => {
    // 실행이 stale이면 이후 단계는 모두 생략 (stale은 되돌아가지 않음)
    const isStale = () => options.runId != null && isResumeRunStale(options.runId);
    if (isStale()) return;

    if (options.appliedKey != null) {
      serverResumeAppliedKeyRef.current = options.appliedKey;
    }

    if (options.timeoutKey != null) {
      errorUtils.logWarning('[useViewerProgress] resume 위치 복원 시간 초과', options.timeoutKey);
      await moveToProgressFallback(viewerRef, Number(progressRef.current), isStale);
    }

    if (isStale()) return;
    clearPreferredResume();
    markReady();
  }, [clearPreferredResume, isResumeRunStale, markReady, progressRef, viewerRef]);

  const markViewerPageReady = useCallback(() => {
    if (isViewerPageReadyNow()) return;
    if (isViewerResumeBlocking(viewStateRef.current.resumePending, preferredResumeRef.current)) return;
    markReady();
  }, [markReady, isViewerPageReadyNow, viewStateRef]);

  useEffect(() => {
    preferredResumeRef.current = preferredResumeAnchor;
    if (!preferredResumeAnchor) return;
    patchViewState({ resumePending: true });
    setServerResumeAnchor(preferredResumeAnchor);
    serverResumeAppliedKeyRef.current = null;
    patchViewState({ readyBookKey: NOT_READY });
  }, [preferredResumeAnchor, patchViewState]);

  const progressMetricsReady = useMemo(
    () => Boolean(bookKey && manifestLoaded && canResolveProgressMetrics(bookKey)),
    [bookKey, manifestLoaded],
  );

  const normalizedBookId = useMemo(
    () => normalizeProgressBookId(bookKey),
    [bookKey],
  );

  const applyLiveMetrics = useCallback((metrics) => {
    if (metrics?.chapterProgress != null) {
      patchViewState({ liveChapterProgress: metrics.chapterProgress });
    }
    if (metrics?.readingProgressPercent != null) {
      setProgress(metrics.readingProgressPercent);
    }
  }, [setProgress, patchViewState]);

  const applyProgressSnapshot = useCallback((snapshot, { force = false, updateResumeAnchor = false } = {}) => {
    if (!snapshot) return;
    if (
      !force &&
      !shouldApplyCacheSnapshot(
        snapshot,
        viewStateRef.current.readingLocatorKey,
        isViewerPageReadyNow(),
      )
    ) {
      return;
    }

    setProgressTopBar(snapshot.topBar);

    if (updateResumeAnchor) {
      const nextAnchor = preferredResumeRef.current ?? snapshot.anchor ?? null;
      setServerResumeAnchor(nextAnchor);
      if (nextAnchor) {
        const nextKey = viewerResumeAnchorKey(nextAnchor);
        if (serverResumeAppliedKeyRef.current !== nextKey) {
          patchViewState({ resumePending: true });
          serverResumeAppliedKeyRef.current = null;
        }
      }
    }

    if (snapshot.readingProgressPercent != null) {
      setProgress(snapshot.readingProgressPercent);
    }
    if (snapshot.readingLocatorKey) {
      patchViewState({ readingLocatorKey: stringOrEmpty(snapshot.readingLocatorKey) });
    }
    const cp = snapshot.topBar?.chapterProgress;
    if (cp != null) {
      patchViewState({ liveChapterProgress: cp });
    }
  }, [setProgress, patchViewState, viewStateRef, isViewerPageReadyNow]);

  const syncProgressFromCache = useCallback((idStr, options = {}) => {
    const row = getProgressFromCache(idStr);
    if (!row && !options.force) return;
    applyProgressSnapshot(snapshotFromProgressRow(row, idStr), options);
  }, [applyProgressSnapshot]);

  useEffect(() => {
    // 같은 ViewerPage 인스턴스에서 A→B→A 복귀 시 이전 ready/progress 재사용 방지
    setProgress(null);
    serverResumeAppliedKeyRef.current = null;
    manifestLocatorSyncedRef.current = false;
    invalidateResumeRun();
    patchViewState({
      readyBookKey: NOT_READY,
      readingLocatorKey: '',
      liveChapterProgress: null,
      resumePending: Boolean(normalizedBookId || (bookKey && awaitingBookId) || preferredResumeRef.current),
    });
    setServerResumeAnchor(preferredResumeRef.current);

    if (!normalizedBookId) return undefined;

    if (reloadKeyBumpedForBookRef.current !== bookKey) {
      reloadKeyBumpedForBookRef.current = bookKey;
      setReloadKey((k) => k + 1);
    }

    const fetchGeneration = nextProgressFetchId();
    syncProgressFromCache(normalizedBookId, FORCE_RESUME_SNAPSHOT);

    const isStale = (cancelled) =>
      cancelled || isProgressFetchStale(fetchGeneration);

    const releasePendingIfNoAnchor = () => {
      const anchor =
        preferredResumeRef.current ?? resolveCachedResumeAnchor(normalizedBookId);
      if (!anchor) patchViewState({ resumePending: false });
    };

    const recoverFromProgressFetchFailure = (message) => {
      errorUtils.logWarning('[useViewerProgress] 서버 진도 조회 실패', message);
      syncProgressFromCache(normalizedBookId, FORCE_RESUME_SNAPSHOT);
      releasePendingIfNoAnchor();
    };

    let cancelled = false;
    void (async () => {
      try {
        const res = await getBookProgress(normalizedBookId, { skipCache: true });
        if (isStale(cancelled)) return;

        if (!res?.isSuccess || !res?.result) {
          recoverFromProgressFetchFailure(res?.message || '응답이 비어 있습니다.');
          return;
        }

        const snapshot = snapshotFromProgressRow(res.result, normalizedBookId);
        applyProgressSnapshot(snapshot, FORCE_RESUME_SNAPSHOT);
        if (!(preferredResumeRef.current ?? snapshot.anchor)) {
          patchViewState({ resumePending: false });
        }
      } catch (error) {
        if (isStale(cancelled)) return;
        recoverFromProgressFetchFailure(error?.message ?? '알 수 없는 오류');
      }
    })();

    return () => {
      cancelled = true;
      invalidateProgressFetch();
    };
  }, [
    bookKey,
    normalizedBookId,
    awaitingBookId,
    setReloadKey,
    invalidateResumeRun,
    invalidateProgressFetch,
    nextProgressFetchId,
    isProgressFetchStale,
    syncProgressFromCache,
    applyProgressSnapshot,
    patchViewState,
    setProgress,
  ]);

  useEffect(() => {
    if (!normalizedBookId) return undefined;
    const onCache = (e) => {
      if (String(e?.detail?.bookId) !== normalizedBookId) return;
      syncProgressFromCache(normalizedBookId);
    };
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, onCache);
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, onCache);
  }, [normalizedBookId, syncProgressFromCache]);

  useEffect(() => {
    if (!serverResumeAnchor) return undefined;
    const key = viewerResumeAnchorKey(serverResumeAnchor);
    if (!key) return undefined;
    if (serverResumeAppliedKeyRef.current === key) return undefined;

    const runId = nextResumeRunId();

    const pollResume = async () => {
      const methodReady = await waitForViewerMethod(
        viewerRef,
        'displayAt',
        VIEWER_RESUME_TIMEOUT_MS,
      );
      if (isResumeRunStale(runId)) return;
      if (!methodReady) {
        await finishResume({ timeoutKey: key, runId });
        return;
      }

      for (let attempt = 0; attempt < VIEWER_RESUME_MAX_ATTEMPTS; attempt += 1) {
        if (isResumeRunStale(runId)) return;
        if (serverResumeAppliedKeyRef.current === key) return;

        try {
          const moved = viewerRef.current?.displayAt?.(serverResumeAnchor);
          if (moved) {
            await finishResume({ appliedKey: key, runId });
            return;
          }
        } catch (error) {
          errorUtils.logWarning(
            '[useViewerProgress] resume displayAt 실패',
            error?.message ?? '알 수 없는 오류',
          );
        }

        await sleep(VIEWER_RESUME_POLL_MS);
      }

      if (!isResumeRunStale(runId)) {
        await finishResume({ timeoutKey: key, runId });
      }
    };

    void pollResume();

    return () => {
      invalidateResumeRun();
    };
  }, [
    serverResumeAnchor,
    reloadKey,
    viewerRef,
    finishResume,
    nextResumeRunId,
    isResumeRunStale,
    invalidateResumeRun,
  ]);

  useEffect(() => {
    if (!bookKey) return;

    const pct = clampPercent(progress);
    const nextCp =
      viewStateRef.current.liveChapterProgress ??
      resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, {
        metricsReady: progressMetricsReady,
      })?.chapterProgress ??
      null;

    setProgressTopBar((prev) =>
      mergeProgressTopBar(prev, bookKey, {
        readingProgressPercent: pct,
        chapterProgress: nextCp,
      }),
    );
  }, [bookKey, progress, progressMetricsReady, readingLocatorKey, liveChapterProgress, viewStateRef]);

  useEffect(() => {
    if (!bookKey || !progressMetricsReady || !readingLocatorKey) return;
    if (manifestLocatorSyncedRef.current) return;
    manifestLocatorSyncedRef.current = true;

    applyLiveMetrics(
      resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, {
        metricsReady: true,
      }),
    );
  }, [bookKey, progressMetricsReady, readingLocatorKey, applyLiveMetrics]);

  const applyReadingLocator = useCallback(
    (lineLocator, lineEnd) => {
      if (isViewerResumeBlocking(viewStateRef.current.resumePending, preferredResumeRef.current)) return;
      if (lineLocator) {
        patchViewState({ readingLocatorKey: stringOrEmpty(toReadingLocatorKey(lineLocator, lineEnd)) });
      }
      applyLiveMetrics(
        progressMetricsReady ? resolveProgressMetricsFromLocator(bookKey, lineLocator) : null,
      );
    },
    [bookKey, progressMetricsReady, applyLiveMetrics, patchViewState, viewStateRef],
  );

  return {
    progress,
    setProgress,
    progressTopBar,
    setProgressTopBar,
    progressMetricsReady,
    readingLocatorKey,
    serverResumeAnchor,
    applyReadingLocator,
    isViewerPageReady,
    isResumePending,
    markViewerPageReady,
  };
}

/* ─── 진도 자동 저장 (from useProgressAutoSave) ─── */

const AUTO_SAVE_DELAY_MS = 2000;
const LOG_PREFIX = '[useProgressAutoSave]';

function payloadFingerprint(payload) {
  return payload ? JSON.stringify(payload) : null;
}

function flushResult(extra = {}) {
  return { isSuccess: true, ...extra };
}

function settle(resolve, result) {
  resolve?.(result);
  return result;
}

/** pagehide / beforeunload / visibility hidden 공통 구독 */
function subscribePageExit(onExit, { onHidden } = {}) {
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') return;
    onHidden?.();
    onExit();
  };
  window.addEventListener('pagehide', onExit);
  window.addEventListener('beforeunload', onExit);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pagehide', onExit);
    window.removeEventListener('beforeunload', onExit);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function useProgressAutoSave({
  bookId,
  currentEvent,
  readingLocatorKey = '',
  getCurrentLocator,
  metricsReady = true,
  /** resume 완료 전(맨 앞 오탐) 저장 방지 */
  canPersist = true,
}) {
  const [cachedLocation, setCachedLocation] = useState(null);

  useEffect(() => {
    if (!bookId) {
      setCachedLocation(null);
      return;
    }
    try {
      setCachedLocation(getCachedReaderProgress(bookId));
    } catch (error) {
      errorUtils.logWarning(`${LOG_PREFIX} 캐시된 위치 정보를 불러오는데 실패했습니다`, error.message);
      setCachedLocation(null);
    }
  }, [bookId]);

  const saveLocation = useCallback((progressData) => {
    if (!bookId) return null;
    try {
      const stored = setCachedReaderProgress(bookId, progressData);
      if (stored) setCachedLocation(stored);
      return stored;
    } catch (error) {
      errorUtils.logWarning(`${LOG_PREFIX} 캐시된 위치 정보를 저장하는데 실패했습니다`, error.message);
      return null;
    }
  }, [bookId]);

  const timeoutRef = useRef(null);
  const lastPayloadRef = useRef(null);
  const latestPayloadRef = useRef(null);
  const latestLocationPayloadRef = useRef(null);
  const initialSavedRef = useRef(false);
  const pagehideFlushedRef = useRef(false);
  const prevMetricsReadyRef = useRef(metricsReady);
  const prevBookIdRef = useRef(null);
  const flushChainRef = useRef(Promise.resolve());
  const liveRef = useRef({});

  const refreshLatestPayload = useCallback(() => {
    const { bookId: id, getCurrentLocator: getLocator, currentEvent: event, metricsReady: ready } =
      liveRef.current;
    if (!id) return null;

    const { startLocator, endLocator } = resolveReadingLocators(getLocator, event);
    if (!startLocator) return null;

    const metrics = ready ? resolveProgressMetricsFromLocator(id, startLocator) : null;
    const payload = buildProgressPayload(id, startLocator, endLocator, event, metrics);
    if (!payload) return null;

    latestPayloadRef.current = payload;
    latestLocationPayloadRef.current = buildSaveLocationPayload(
      id,
      startLocator,
      endLocator,
      event,
      metrics
    );
    return payload;
  }, []);

  const resetAutoSaveState = useCallback(() => {
    lastPayloadRef.current = null;
    latestPayloadRef.current = null;
    latestLocationPayloadRef.current = null;
    initialSavedRef.current = false;
    pagehideFlushedRef.current = false;
    flushChainRef.current = Promise.resolve();
  }, []);

  const applyLocalCaches = useCallback((payload, locationPayload) => {
    if (locationPayload) liveRef.current.saveLocation?.(locationPayload);
    setProgressToCache(payload);
  }, []);

  const runFlushOnce = useCallback(async (resolve) => {
    const payload = latestPayloadRef.current;
    const id = liveRef.current.bookId;
    if (!payload) return settle(resolve, flushResult({ skipped: true }));

    const payloadKey = payloadFingerprint(payload);
    if (lastPayloadRef.current === payloadKey) {
      return settle(resolve, flushResult({ deduped: true }));
    }

    const prevCached = id ? getProgressFromCache(id) : null;
    const locationPayload = latestLocationPayloadRef.current;

    try {
      setProgressToCache(payload);
      const res = await saveProgress(payload);
      if (!res?.isSuccess) {
        throw new Error(res?.message || '진도 저장 응답 실패');
      }

      if (locationPayload) liveRef.current.saveLocation?.(locationPayload);
      lastPayloadRef.current = payloadKey;

      const latestKey = payloadFingerprint(latestPayloadRef.current);
      if (latestKey && latestKey !== payloadKey) {
        queueMicrotask(() => liveRef.current.runFlush?.());
      }

      return settle(resolve, res);
    } catch (err) {
      if (id) {
        if (prevCached) setProgressToCache(prevCached);
        else removeProgressFromCache(id);
      }
      errorUtils.logWarning(
        `${LOG_PREFIX} 서버 저장 실패`,
        err?.message ?? stringOrEmpty(err),
      );
      return settle(resolve, { isSuccess: false, message: err?.message });
    }
  }, []);

  const runFlush = useCallback((resolve) => {
    flushChainRef.current = flushChainRef.current
      .catch(() => {})
      .then(() => runFlushOnce(resolve));
  }, [runFlushOnce]);

  liveRef.current = {
    getCurrentLocator,
    saveLocation,
    currentEvent,
    bookId,
    metricsReady,
    canPersist,
    refreshLatestPayload,
    runFlush,
  };

  const flushProgressAsync = useCallback(() => {
    if (!liveRef.current.canPersist) {
      return Promise.resolve(flushResult({ skipped: true }));
    }
    refreshLatestPayload();
    return new Promise((resolve) => runFlush(resolve));
  }, [refreshLatestPayload, runFlush]);

  useEffect(() => {
    const bookChanged = prevBookIdRef.current !== bookId;
    if (!bookId || bookChanged) {
      prevBookIdRef.current = bookId || null;
      prevMetricsReadyRef.current = metricsReady;
      resetAutoSaveState();
      if (!bookId) return undefined;
    }

    if (!canPersist) return undefined;

    const metricsJustBecameReady = metricsReady && !prevMetricsReadyRef.current;
    prevMetricsReadyRef.current = metricsReady;

    refreshLatestPayload();
    if (!latestPayloadRef.current) return undefined;

    if (!initialSavedRef.current || metricsJustBecameReady) {
      initialSavedRef.current = true;
      runFlush();
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => runFlush(), AUTO_SAVE_DELAY_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    bookId,
    currentEvent,
    readingLocatorKey,
    metricsReady,
    canPersist,
    refreshLatestPayload,
    runFlush,
    resetAutoSaveState,
  ]);

  useEffect(() => {
    const handlePageHide = () => {
      if (pagehideFlushedRef.current || !liveRef.current.canPersist) return;
      refreshLatestPayload();
      const payload = latestPayloadRef.current;
      if (!payload) return;

      pagehideFlushedRef.current = true;
      applyLocalCaches(payload, latestLocationPayloadRef.current);
      const ok = saveProgressKeepalive(payload);
      if (ok) {
        lastPayloadRef.current = payloadFingerprint(payload);
      } else {
        errorUtils.logWarning(
          `${LOG_PREFIX} keepalive 저장 요청 생성 실패`,
          String(liveRef.current.bookId ?? ''),
        );
      }
    };

    const unsubscribe = subscribePageExit(handlePageHide, {
      onHidden: () => {
        void ensureSessionAccessToken();
      },
    });
    return () => {
      unsubscribe();
      pagehideFlushedRef.current = false;
    };
  }, [refreshLatestPayload, applyLocalCaches]);

  useEffect(() => {
    return () => {
      if (!liveRef.current.canPersist) return;
      liveRef.current.refreshLatestPayload?.();
      liveRef.current.runFlush?.();
    };
  }, []);

  return { flushProgressAsync, cachedLocation };
}

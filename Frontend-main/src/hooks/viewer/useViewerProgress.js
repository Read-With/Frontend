/** 뷰어 진도: resume·TopBar·locator + 자동 저장 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getBookProgress, saveProgress, saveProgressKeepalive } from '../../utils/api/booksApi';
import { canResolveProgressMetrics } from '../../utils/common/cache/manifestCache';
import {
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
  removeProgressFromCache,
  setProgressToCache,
  getCachedReaderProgress,
  setCachedReaderProgress,
} from '../../utils/common/cache/progressCache';
import { viewerResumeAnchorKey, clampPercent } from '../../utils/common/valueUtils';
import { errorUtils } from '../../utils/common/urlUtils';
import {
  delay,
  waitForPaint,
  waitForViewerMethod,
  resolveMetricsFromLocator,
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

/** ref와 state를 동시에 갱신 */
function applyRefState(ref, setState, value) {
  ref.current = value;
  setState(value);
  return value;
}

export function useViewerProgress({
  bookKey,
  manifestLoaded,
  progress,
  setProgress,
  setReloadKey,
  viewerRef,
  reloadKey,
  preferredResumeAnchor = null,
  onPreferredResumeApplied = null,
  awaitingBookId = false,
}) {
  const [progressTopBar, setProgressTopBar] = useState(undefined);
  const [readingLocatorKey, setReadingLocatorKey] = useState('');
  const [liveChapterProgress, setLiveChapterProgress] = useState(null);
  const [serverResumeAnchor, setServerResumeAnchor] = useState(null);
  const [isViewerPageReady, setIsViewerPageReady] = useState(false);

  const readingLocatorKeyRef = useRef('');
  const liveChapterProgressRef = useRef(null);
  const serverResumeAppliedKeyRef = useRef(null);
  const reloadKeyBumpedForBookRef = useRef(null);
  const isViewerPageReadyRef = useRef(false);
  const resumePendingRef = useRef(false);
  const [isResumePending, setIsResumePendingState] = useState(false);
  const manifestLocatorSyncedRef = useRef(false);
  const preferredResumeRef = useRef(null);
  const progressRef = useLatestRef(progress);
  const { nextRequestId: nextResumeRunId, isStale: isResumeRunStale, invalidate: invalidateResumeRun } =
    useAsyncRequestGuard();
  const { nextRequestId: nextProgressFetchId, isStale: isProgressFetchStale, invalidate: invalidateProgressFetch } =
    useAsyncRequestGuard();

  const setResumePending = useCallback((value) => {
    applyRefState(resumePendingRef, setIsResumePendingState, Boolean(value));
  }, []);

  const setViewerPageNotReady = useCallback(() => {
    applyRefState(isViewerPageReadyRef, setIsViewerPageReady, false);
  }, []);

  const applyReadingLocatorKey = useCallback((nextKey) => {
    applyRefState(
      readingLocatorKeyRef,
      setReadingLocatorKey,
      typeof nextKey === 'string' ? nextKey : '',
    );
  }, []);

  const applyLiveChapterProgress = useCallback((nextChapterProgress) => {
    applyRefState(liveChapterProgressRef, setLiveChapterProgress, nextChapterProgress ?? null);
  }, []);

  const markReady = useCallback(() => {
    setResumePending(false);
    if (!isViewerPageReadyRef.current) {
      applyRefState(isViewerPageReadyRef, setIsViewerPageReady, true);
    }
    invalidateResumeRun();
  }, [invalidateResumeRun, setResumePending]);

  const clearPreferredResume = useCallback(() => {
    if (!preferredResumeRef.current) return;
    preferredResumeRef.current = null;
    onPreferredResumeApplied?.();
  }, [onPreferredResumeApplied]);

  const finishResume = useCallback(async (options = {}) => {
    if (options.runId != null && isResumeRunStale(options.runId)) return;

    if (options.appliedKey != null) {
      serverResumeAppliedKeyRef.current = options.appliedKey;
    }

    if (options.timeoutKey != null) {
      errorUtils.logWarning('[useViewerProgress] resume 위치 복원 시간 초과', options.timeoutKey);
      const pct = Number(progressRef.current);
      if (Number.isFinite(pct) && pct >= 0) {
        const ready = await waitForViewerMethod(
          viewerRef,
          'moveToProgress',
          VIEWER_RESUME_TIMEOUT_MS,
        );
        if (options.runId != null && isResumeRunStale(options.runId)) return;
        if (ready) {
          try {
            for (let attempt = 0; attempt < VIEWER_RESUME_PERCENT_FALLBACK_ATTEMPTS; attempt += 1) {
              if (options.runId != null && isResumeRunStale(options.runId)) return;
              const moved = viewerRef.current?.moveToProgress?.(pct);
              await waitForPaint();
              if (moved) break;
              await delay(VIEWER_RESUME_POLL_MS);
            }
          } catch (error) {
            errorUtils.logWarning(
              '[useViewerProgress] resume 타임아웃 percent 폴백 실패',
              error?.message ?? '알 수 없는 오류',
            );
          }
        }
      }
    }

    if (options.runId != null && isResumeRunStale(options.runId)) return;
    clearPreferredResume();
    markReady();
  }, [clearPreferredResume, isResumeRunStale, markReady, progressRef, viewerRef]);

  const markViewerPageReady = useCallback(() => {
    if (isViewerPageReadyRef.current) return;
    if (isViewerResumeBlocking(resumePendingRef.current, preferredResumeRef.current)) return;
    markReady();
  }, [markReady]);

  useEffect(() => {
    setViewerPageNotReady();
    setResumePending(Boolean(bookKey));
  }, [bookKey, setViewerPageNotReady, setResumePending]);

  useEffect(() => {
    preferredResumeRef.current = preferredResumeAnchor;
    if (!preferredResumeAnchor) return;
    setResumePending(true);
    setServerResumeAnchor(preferredResumeAnchor);
    serverResumeAppliedKeyRef.current = null;
    setViewerPageNotReady();
  }, [preferredResumeAnchor, setViewerPageNotReady, setResumePending]);

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
      applyLiveChapterProgress(metrics.chapterProgress);
    }
    if (metrics?.readingProgressPercent != null) {
      setProgress(metrics.readingProgressPercent);
    }
  }, [setProgress, applyLiveChapterProgress]);

  const applyProgressSnapshot = useCallback((snapshot, { force = false, updateResumeAnchor = false } = {}) => {
    if (!snapshot) return;
    if (
      !force &&
      !shouldApplyCacheSnapshot(
        snapshot,
        readingLocatorKeyRef.current,
        isViewerPageReadyRef.current,
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
          setResumePending(true);
          serverResumeAppliedKeyRef.current = null;
        }
      }
    }

    if (snapshot.readingProgressPercent != null) {
      setProgress(snapshot.readingProgressPercent);
    }
    if (snapshot.readingLocatorKey) {
      applyReadingLocatorKey(snapshot.readingLocatorKey);
    }
    const cp = snapshot.topBar?.chapterProgress;
    if (cp != null) {
      applyLiveChapterProgress(cp);
    }
  }, [setProgress, applyReadingLocatorKey, applyLiveChapterProgress, setResumePending]);

  const syncProgressFromCache = useCallback((idStr, options = {}) => {
    const row = getProgressFromCache(idStr);
    if (!row && !options.force) return;
    applyProgressSnapshot(snapshotFromProgressRow(row, idStr), options);
  }, [applyProgressSnapshot]);

  useEffect(() => {
    serverResumeAppliedKeyRef.current = null;
    applyReadingLocatorKey('');
    applyLiveChapterProgress(null);
    manifestLocatorSyncedRef.current = false;
    invalidateResumeRun();
    setResumePending(Boolean(normalizedBookId) || Boolean(bookKey && awaitingBookId));

    if (!normalizedBookId) {
      setServerResumeAnchor(preferredResumeRef.current);
      if (!(bookKey && awaitingBookId)) {
        setResumePending(Boolean(preferredResumeRef.current));
      }
      return undefined;
    }

    setServerResumeAnchor(preferredResumeRef.current);

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
      if (!anchor) setResumePending(false);
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
          setResumePending(false);
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
    applyReadingLocatorKey,
    applyLiveChapterProgress,
    syncProgressFromCache,
    applyProgressSnapshot,
    setResumePending,
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

        await delay(VIEWER_RESUME_POLL_MS);
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
      liveChapterProgressRef.current ??
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
  }, [bookKey, progress, progressMetricsReady, readingLocatorKey, liveChapterProgress]);

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
      if (isViewerResumeBlocking(resumePendingRef.current, preferredResumeRef.current)) return;
      if (lineLocator) {
        applyReadingLocatorKey(toReadingLocatorKey(lineLocator, lineEnd));
      }
      applyLiveMetrics(
        resolveMetricsFromLocator(bookKey, lineLocator, {
          metricsReady: progressMetricsReady,
        }),
      );
    },
    [bookKey, progressMetricsReady, applyLiveMetrics, applyReadingLocatorKey],
  );

  return {
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

function logWarn(message, detail) {
  errorUtils.logWarning(`${LOG_PREFIX} ${message}`, detail);
}

/** pagehide / beforeunload / visibility hidden 공통 구독 */
function subscribePageExit(onExit) {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onExit();
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
      logWarn('캐시된 위치 정보를 불러오는데 실패했습니다', error.message);
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
      logWarn('캐시된 위치 정보를 저장하는데 실패했습니다', error.message);
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

    const metrics = resolveMetricsFromLocator(id, startLocator, { metricsReady: ready });
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
      logWarn('서버 저장 실패', err?.message ?? (typeof err === 'string' ? err : ''));
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
        logWarn('keepalive 저장 요청 생성 실패', String(liveRef.current.bookId ?? ''));
      }
    };

    const unsubscribe = subscribePageExit(handlePageHide);
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

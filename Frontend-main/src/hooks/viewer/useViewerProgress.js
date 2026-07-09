/** 뷰어 실시간 진도: resume·TopBar·locatorKey·캐시 동기화 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getBookProgress } from '../../utils/api/api';
import {
  getProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
} from '../../utils/common/cache/progressCache';
import { canResolveProgressMetrics } from '../../utils/common/cache/manifestCache';
import { viewerResumeAnchorKey } from '../../utils/common/locatorUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import { delay } from '../../utils/viewer/viewerCoreStateUtils';
import {
  clampProgressPercent,
  progressRowToTopBar,
  resolveMetricsFromLocator,
  resolveMetricsFromReadingLocatorKey,
  shouldApplyCacheSnapshot,
  snapshotFromProgressRow,
  toReadingLocatorKey,
} from '../../utils/viewer/viewerEventProgressUtils';

const VIEWER_RESUME_POLL_MS = 100;
const VIEWER_RESUME_MAX_ATTEMPTS = 150;

export function useViewerProgress({
  bookKey,
  manifestLoaded,
  progress,
  setProgress,
  setReloadKey,
  viewerRef,
  reloadKey,
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
  const manifestLocatorSyncedRef = useRef(false);
  const resumeRunIdRef = useRef(0);
  const progressFetchGenerationRef = useRef(0);

  const clearResumePolling = useCallback(() => {
    resumeRunIdRef.current += 1;
  }, []);

  const applyReadingLocatorKey = useCallback((nextKey) => {
    const key = typeof nextKey === 'string' ? nextKey : '';
    readingLocatorKeyRef.current = key;
    setReadingLocatorKey(key);
  }, []);

  const applyLiveChapterProgress = useCallback((nextChapterProgress) => {
    const cp = nextChapterProgress ?? null;
    liveChapterProgressRef.current = cp;
    setLiveChapterProgress(cp);
  }, []);

  const markViewerPageReady = useCallback(() => {
    if (isViewerPageReadyRef.current) return;
    isViewerPageReadyRef.current = true;
    setIsViewerPageReady(true);
    clearResumePolling();
  }, [clearResumePolling]);

  useEffect(() => {
    isViewerPageReadyRef.current = false;
    setIsViewerPageReady(false);
  }, [bookKey]);

  const progressMetricsReady = useMemo(
    () => Boolean(bookKey && manifestLoaded && canResolveProgressMetrics(bookKey)),
    [bookKey, manifestLoaded]
  );
  const normalizedBookId = useMemo(() => {
    const numeric = Number(bookKey);
    if (!bookKey || !Number.isFinite(numeric) || numeric <= 0) return null;
    return String(numeric);
  }, [bookKey]);

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
        isViewerPageReadyRef.current
      )
    ) {
      return;
    }
    setProgressTopBar(snapshot.topBar);
    if (updateResumeAnchor && snapshot.anchor) {
      setServerResumeAnchor(snapshot.anchor);
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
  }, [setProgress, applyReadingLocatorKey, applyLiveChapterProgress]);

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
    clearResumePolling();

    if (!normalizedBookId) {
      setServerResumeAnchor(null);
      return undefined;
    }

    if (reloadKeyBumpedForBookRef.current !== bookKey) {
      reloadKeyBumpedForBookRef.current = bookKey;
      setReloadKey((k) => k + 1);
    }

    const fetchGeneration = ++progressFetchGenerationRef.current;
    syncProgressFromCache(normalizedBookId, { force: true, updateResumeAnchor: true });

    let cancelled = false;
    (async () => {
      try {
        const res = await getBookProgress(normalizedBookId, { skipCache: true });
        if (cancelled || fetchGeneration !== progressFetchGenerationRef.current) return;

        if (!res?.isSuccess || !res?.result) {
          errorUtils.logWarning(
            '[useViewerProgress] 서버 진도 조회 실패',
            res?.message || '응답이 비어 있습니다.'
          );
          syncProgressFromCache(normalizedBookId, { force: true, updateResumeAnchor: true });
          return;
        }

        applyProgressSnapshot(snapshotFromProgressRow(res.result, normalizedBookId), {
          force: true,
          updateResumeAnchor: true,
        });
      } catch (error) {
        if (cancelled || fetchGeneration !== progressFetchGenerationRef.current) return;
        errorUtils.logWarning(
          '[useViewerProgress] 서버 진도 조회 실패',
          error?.message ?? '알 수 없는 오류'
        );
        syncProgressFromCache(normalizedBookId, { force: true, updateResumeAnchor: true });
      }
    })();

    return () => {
      cancelled = true;
      progressFetchGenerationRef.current += 1;
    };
  }, [
    bookKey,
    normalizedBookId,
    setReloadKey,
    clearResumePolling,
    applyReadingLocatorKey,
    applyLiveChapterProgress,
    syncProgressFromCache,
    applyProgressSnapshot,
  ]);

  useEffect(() => {
    if (!normalizedBookId) {
      return undefined;
    }
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
    if (isViewerPageReadyRef.current) return undefined;

    const runId = ++resumeRunIdRef.current;

    const pollResume = async () => {
      for (let attempt = 0; attempt < VIEWER_RESUME_MAX_ATTEMPTS; attempt += 1) {
        if (runId !== resumeRunIdRef.current) return;
        if (serverResumeAppliedKeyRef.current === key || isViewerPageReadyRef.current) return;

        try {
          const moved = viewerRef.current?.displayAt?.(serverResumeAnchor);
          if (moved) {
            serverResumeAppliedKeyRef.current = key;
            markViewerPageReady();
            return;
          }
        } catch (error) {
          errorUtils.logWarning(
            '[useViewerProgress] resume displayAt 실패',
            error?.message ?? '알 수 없는 오류'
          );
        }

        await delay(VIEWER_RESUME_POLL_MS);
      }

      if (runId === resumeRunIdRef.current) {
        errorUtils.logWarning('[useViewerProgress] resume 위치 복원 시간 초과', key);
      }
    };

    void pollResume();

    return () => {
      resumeRunIdRef.current += 1;
    };
  }, [serverResumeAnchor, reloadKey, viewerRef, markViewerPageReady]);

  useEffect(() => {
    if (!bookKey) return;

    const pct = clampProgressPercent(progress);
    const nextCp =
      liveChapterProgressRef.current ??
      resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, {
        metricsReady: progressMetricsReady,
      })?.chapterProgress ??
      null;

    setProgressTopBar((prev) => {
      const base =
        prev !== undefined && prev !== null && typeof prev === 'object'
          ? prev
          : progressRowToTopBar(null, bookKey);
      const nextPct = pct ?? base.readingProgressPercent;
      const resolvedCp = nextCp ?? base.chapterProgress;
      if (base.readingProgressPercent === nextPct && base.chapterProgress === resolvedCp) {
        return prev;
      }
      return {
        ...base,
        ...(nextPct != null ? { readingProgressPercent: nextPct } : {}),
        ...(resolvedCp != null ? { chapterProgress: resolvedCp } : {}),
      };
    });
  }, [bookKey, progress, progressMetricsReady, readingLocatorKey, liveChapterProgress]);

  useEffect(() => {
    if (!bookKey || !progressMetricsReady || !readingLocatorKey) return;
    if (manifestLocatorSyncedRef.current) return;
    manifestLocatorSyncedRef.current = true;

    const metrics = resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, {
      metricsReady: true,
    });
    applyLiveMetrics(metrics);
  }, [bookKey, progressMetricsReady, readingLocatorKey, applyLiveMetrics]);

  const updateReadingPercent = useCallback(
    (percent) => {
      const pct = clampProgressPercent(percent);
      if (pct != null) {
        setProgress(pct);
      }
    },
    [setProgress]
  );

  const applyReadingLocator = useCallback(
    (lineLocator, lineEnd) => {
      clearResumePolling();
      if (lineLocator) {
        const key = toReadingLocatorKey(lineLocator, lineEnd);
        applyReadingLocatorKey(key);
      }
      const metrics = resolveMetricsFromLocator(bookKey, lineLocator, {
        metricsReady: progressMetricsReady,
      });
      applyLiveMetrics(metrics);
    },
    [bookKey, progressMetricsReady, applyLiveMetrics, clearResumePolling, applyReadingLocatorKey]
  );

  return {
    progressTopBar,
    setProgressTopBar,
    progressMetricsReady,
    readingLocatorKey,
    serverResumeAnchor,
    applyReadingLocator,
    updateReadingPercent,
    isViewerPageReady,
    markViewerPageReady,
  };
}

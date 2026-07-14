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
import {
  delay,
  waitForPaint,
  waitForViewerMethod,
} from '../../utils/viewer/viewerCoreStateUtils';
import { clampPercent } from '../../utils/common/valueUtils';
import {
  progressRowToTopBar,
  resolveMetricsFromLocator,
  resolveMetricsFromReadingLocatorKey,
  shouldApplyCacheSnapshot,
  snapshotFromProgressRow,
  toReadingLocatorKey,
} from '../../utils/viewer/viewerEventProgressUtils';

const VIEWER_RESUME_POLL_MS = 100;
const VIEWER_RESUME_MAX_ATTEMPTS = 150;
const VIEWER_RESUME_TIMEOUT_MS = VIEWER_RESUME_POLL_MS * VIEWER_RESUME_MAX_ATTEMPTS;
const VIEWER_RESUME_PERCENT_FALLBACK_ATTEMPTS = 30;
const FORCE_RESUME_SNAPSHOT = { force: true, updateResumeAnchor: true };

function syncRefAndState(ref, setState, value) {
  ref.current = value;
  setState(value);
}

function normalizeProgressBookId(bookKey) {
  const numeric = Number(bookKey);
  if (!bookKey || !Number.isFinite(numeric) || numeric <= 0) return null;
  return String(numeric);
}

function mergeProgressTopBar(prev, bookKey, { readingProgressPercent, chapterProgress }) {
  const base =
    prev != null && typeof prev === 'object'
      ? prev
      : progressRowToTopBar(null, bookKey);
  const nextPct = readingProgressPercent ?? base.readingProgressPercent;
  const resolvedCp = chapterProgress ?? base.chapterProgress;
  if (base.readingProgressPercent === nextPct && base.chapterProgress === resolvedCp) {
    return prev;
  }
  return {
    ...base,
    ...(nextPct != null ? { readingProgressPercent: nextPct } : {}),
    ...(resolvedCp != null ? { chapterProgress: resolvedCp } : {}),
  };
}

function resolveCachedResumeAnchor(bookId) {
  const cached = getProgressFromCache(bookId);
  return snapshotFromProgressRow(cached, bookId).anchor;
}

function isResumeBlocking(resumePendingRef, preferredResumeRef) {
  return Boolean(resumePendingRef.current || preferredResumeRef.current);
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
  /** 진도 fetch·resume 적용 전에는 맨 앞 line 이벤트로 ready/저장하지 않음 */
  const resumePendingRef = useRef(false);
  const [isResumePending, setIsResumePendingState] = useState(false);
  const manifestLocatorSyncedRef = useRef(false);
  const resumeRunIdRef = useRef(0);
  const progressFetchGenerationRef = useRef(0);
  const preferredResumeRef = useRef(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const setResumePending = useCallback((value) => {
    const next = Boolean(value);
    resumePendingRef.current = next;
    setIsResumePendingState(next);
  }, []);

  const clearResumePolling = useCallback(() => {
    resumeRunIdRef.current += 1;
  }, []);

  const setViewerPageNotReady = useCallback(() => {
    isViewerPageReadyRef.current = false;
    setIsViewerPageReady(false);
  }, []);

  const applyReadingLocatorKey = useCallback((nextKey) => {
    syncRefAndState(readingLocatorKeyRef, setReadingLocatorKey, typeof nextKey === 'string' ? nextKey : '');
  }, []);

  const applyLiveChapterProgress = useCallback((nextChapterProgress) => {
    syncRefAndState(liveChapterProgressRef, setLiveChapterProgress, nextChapterProgress ?? null);
  }, []);

  const markReady = useCallback(() => {
    setResumePending(false);
    if (!isViewerPageReadyRef.current) {
      isViewerPageReadyRef.current = true;
      setIsViewerPageReady(true);
    }
    clearResumePolling();
  }, [clearResumePolling, setResumePending]);

  const clearPreferredResume = useCallback(() => {
    if (!preferredResumeRef.current) return;
    preferredResumeRef.current = null;
    onPreferredResumeApplied?.();
  }, [onPreferredResumeApplied]);

  /** resume 성공(appliedKey) 또는 타임아웃(timeoutKey) 후 ready 전환.
   * 타임아웃 시 moveToProgress 폴백이 끝날 때까지 pending/suppress를 유지한다. */
  const finishResume = useCallback(async (options = {}) => {
    if (options.runId != null && options.runId !== resumeRunIdRef.current) return;

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
          VIEWER_RESUME_TIMEOUT_MS
        );
        if (options.runId != null && options.runId !== resumeRunIdRef.current) return;
        if (ready) {
          try {
            for (let attempt = 0; attempt < VIEWER_RESUME_PERCENT_FALLBACK_ATTEMPTS; attempt += 1) {
              if (options.runId != null && options.runId !== resumeRunIdRef.current) return;
              const moved = viewerRef.current?.moveToProgress?.(pct);
              await waitForPaint();
              if (moved) break;
              await delay(VIEWER_RESUME_POLL_MS);
            }
          } catch (error) {
            errorUtils.logWarning(
              '[useViewerProgress] resume 타임아웃 percent 폴백 실패',
              error?.message ?? '알 수 없는 오류'
            );
          }
        }
      }
    }

    if (options.runId != null && options.runId !== resumeRunIdRef.current) return;
    clearPreferredResume();
    markReady();
  }, [clearPreferredResume, markReady, viewerRef]);

  const markViewerPageReady = useCallback(() => {
    if (isViewerPageReadyRef.current) return;
    // resume/북마크 점프 대기 중이면 맨 앞 line change로 ready 처리하지 않음
    if (isResumeBlocking(resumePendingRef, preferredResumeRef)) return;
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
    [bookKey, manifestLoaded]
  );

  const normalizedBookId = useMemo(
    () => normalizeProgressBookId(bookKey),
    [bookKey]
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
        isViewerPageReadyRef.current
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
    clearResumePolling();
    setResumePending(Boolean(normalizedBookId) || Boolean(bookKey && awaitingBookId));

    if (!normalizedBookId) {
      setServerResumeAnchor(preferredResumeRef.current);
      // 서버 bookId 매칭 중이면 pending 유지. 끝나면 preferred 앵커만 남김
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

    const fetchGeneration = ++progressFetchGenerationRef.current;
    syncProgressFromCache(normalizedBookId, FORCE_RESUME_SNAPSHOT);

    const isStale = (cancelled) =>
      cancelled || fetchGeneration !== progressFetchGenerationRef.current;

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
    (async () => {
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
      progressFetchGenerationRef.current += 1;
    };
  }, [
    bookKey,
    normalizedBookId,
    awaitingBookId,
    setReloadKey,
    clearResumePolling,
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

    const runId = ++resumeRunIdRef.current;

    const pollResume = async () => {
      // XhtmlViewer pendingDisplay + layout effect와 같이, 메서드 준비 후 폴링
      const methodReady = await waitForViewerMethod(
        viewerRef,
        'displayAt',
        VIEWER_RESUME_TIMEOUT_MS
      );
      if (runId !== resumeRunIdRef.current) return;
      if (!methodReady) {
        await finishResume({ timeoutKey: key, runId });
        return;
      }

      for (let attempt = 0; attempt < VIEWER_RESUME_MAX_ATTEMPTS; attempt += 1) {
        if (runId !== resumeRunIdRef.current) return;
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
            error?.message ?? '알 수 없는 오류'
          );
        }

        await delay(VIEWER_RESUME_POLL_MS);
      }

      if (runId === resumeRunIdRef.current) {
        await finishResume({ timeoutKey: key, runId });
      }
    };

    void pollResume();

    return () => {
      resumeRunIdRef.current += 1;
    };
  }, [serverResumeAnchor, reloadKey, viewerRef, finishResume]);

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
      })
    );
  }, [bookKey, progress, progressMetricsReady, readingLocatorKey, liveChapterProgress]);

  useEffect(() => {
    if (!bookKey || !progressMetricsReady || !readingLocatorKey) return;
    if (manifestLocatorSyncedRef.current) return;
    manifestLocatorSyncedRef.current = true;

    applyLiveMetrics(
      resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, {
        metricsReady: true,
      })
    );
  }, [bookKey, progressMetricsReady, readingLocatorKey, applyLiveMetrics]);

  const applyReadingLocator = useCallback(
    (lineLocator, lineEnd) => {
      // resume 대기 중이면 맨 앞 viewport locator로 진도를 덮지 않음
      if (isResumeBlocking(resumePendingRef, preferredResumeRef)) return;
      if (lineLocator) {
        applyReadingLocatorKey(toReadingLocatorKey(lineLocator, lineEnd));
      }
      applyLiveMetrics(
        resolveMetricsFromLocator(bookKey, lineLocator, {
          metricsReady: progressMetricsReady,
        })
      );
    },
    [bookKey, progressMetricsReady, applyLiveMetrics, applyReadingLocatorKey]
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

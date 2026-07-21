/** 진도 자동 저장: 캐시 + 서버(v2 locator), 디바운스·중복 방지 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getProgressFromCache,
  removeProgressFromCache,
  setProgressToCache,
  getCachedReaderProgress,
  setCachedReaderProgress,
} from '../../utils/common/cache/progressCache';
import { errorUtils } from '../../utils/common/errorUtils';
import { saveProgress, saveProgressKeepalive } from '../../utils/api/api';
import {
  buildProgressPayload,
  buildSaveLocationPayload,
  resolveMetricsFromLocator,
  resolveReadingLocators,
} from '../../utils/viewer/viewerEventProgressUtils';

const AUTO_SAVE_DELAY_MS = 2000;

function payloadFingerprint(payload) {
  return payload ? JSON.stringify(payload) : null;
}

function flushResult(extra = {}) {
  return { isSuccess: true, ...extra };
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
      errorUtils.logWarning(
        '[useProgressAutoSave] 캐시된 위치 정보를 불러오는데 실패했습니다',
        error.message
      );
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
      errorUtils.logWarning(
        '[useProgressAutoSave] 캐시된 위치 정보를 저장하는데 실패했습니다',
        error.message
      );
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
  const runFlushRef = useRef(null);
  const refreshLatestPayloadRef = useRef(null);

  // effect/flush/unmount에서 최신 props를 읽기 위한 미러 (stale closure 방지)
  const liveRef = useRef({
    getCurrentLocator,
    saveLocation,
    currentEvent,
    bookId,
    metricsReady,
    canPersist,
  });
  liveRef.current = {
    getCurrentLocator,
    saveLocation,
    currentEvent,
    bookId,
    metricsReady,
    canPersist,
  };

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

  const commitLocalCaches = useCallback((payload, locationPayload) => {
    if (locationPayload) {
      liveRef.current.saveLocation?.(locationPayload);
    }
    setProgressToCache(payload);
  }, []);

  const runFlushOnce = useCallback(async (resolve) => {
    const payload = latestPayloadRef.current;
    const id = liveRef.current.bookId;
    if (!payload) {
      const skipped = flushResult({ skipped: true });
      resolve?.(skipped);
      return skipped;
    }

    const payloadKey = payloadFingerprint(payload);
    if (lastPayloadRef.current === payloadKey) {
      const deduped = flushResult({ deduped: true });
      resolve?.(deduped);
      return deduped;
    }

    const prevCached = id ? getProgressFromCache(id) : null;
    const locationPayload = latestLocationPayloadRef.current;

    try {
      setProgressToCache(payload);
      const res = await saveProgress(payload);
      if (!res?.isSuccess) {
        throw new Error(res?.message || '진도 저장 응답 실패');
      }

      if (locationPayload) {
        liveRef.current.saveLocation?.(locationPayload);
      }
      lastPayloadRef.current = payloadKey;

      const latestKey = payloadFingerprint(latestPayloadRef.current);
      if (latestKey && latestKey !== payloadKey) {
        queueMicrotask(() => runFlushRef.current?.());
      }

      resolve?.(res);
      return res;
    } catch (err) {
      if (id) {
        if (prevCached) setProgressToCache(prevCached);
        else removeProgressFromCache(id);
      }
      errorUtils.logWarning(
        '[useProgressAutoSave] 서버 저장 실패',
        err?.message ?? (typeof err === 'string' ? err : '')
      );
      const failure = { isSuccess: false, message: err?.message };
      resolve?.(failure);
      return failure;
    }
  }, []);

  const runFlush = useCallback((resolve) => {
    flushChainRef.current = flushChainRef.current
      .catch(() => {})
      .then(() => runFlushOnce(resolve));
  }, [runFlushOnce]);

  runFlushRef.current = runFlush;
  refreshLatestPayloadRef.current = refreshLatestPayload;

  const flushProgressAsync = useCallback(() => {
    if (!liveRef.current.canPersist) {
      return Promise.resolve(flushResult({ skipped: true }));
    }
    refreshLatestPayload();
    return new Promise((resolve) => {
      runFlush(resolve);
    });
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
      commitLocalCaches(payload, latestLocationPayloadRef.current);
      const ok = saveProgressKeepalive(payload);
      if (ok) {
        lastPayloadRef.current = payloadFingerprint(payload);
      } else {
        errorUtils.logWarning(
          '[useProgressAutoSave] keepalive 저장 요청 생성 실패',
          String(liveRef.current.bookId ?? '')
        );
      }
    };

    const unsubscribe = subscribePageExit(handlePageHide);
    return () => {
      unsubscribe();
      pagehideFlushedRef.current = false;
    };
  }, [refreshLatestPayload, commitLocalCaches]);

  useEffect(() => {
    return () => {
      if (!liveRef.current.canPersist) return;
      refreshLatestPayloadRef.current?.();
      runFlushRef.current?.();
    };
  }, []);

  return { flushProgressAsync, cachedLocation };
}

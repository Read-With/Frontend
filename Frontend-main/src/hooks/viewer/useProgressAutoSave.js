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

export function useProgressAutoSave({
  bookId,
  currentEvent,
  readingLocatorKey = '',
  getCurrentLocator,
  metricsReady = true,
  delay = 2000,
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
  const flushChainRef = useRef(Promise.resolve());
  const getCurrentLocatorRef = useRef(getCurrentLocator);
  const saveLocationRef = useRef(saveLocation);
  const currentEventRef = useRef(currentEvent);
  const bookIdRef = useRef(bookId);
  const metricsReadyRef = useRef(metricsReady);
  const runFlushRef = useRef(null);
  const refreshLatestPayloadRef = useRef(null);

  useEffect(() => {
    getCurrentLocatorRef.current = getCurrentLocator;
    saveLocationRef.current = saveLocation;
    currentEventRef.current = currentEvent;
    bookIdRef.current = bookId;
    metricsReadyRef.current = metricsReady;
  }, [getCurrentLocator, saveLocation, currentEvent, bookId, metricsReady]);

  const refreshLatestPayload = useCallback(() => {
    const id = bookIdRef.current;
    if (!id) return null;

    const { startLocator, endLocator } = resolveReadingLocators(
      getCurrentLocatorRef.current,
      currentEventRef.current
    );
    if (!startLocator) return null;

    const metrics = resolveMetricsFromLocator(id, startLocator, {
      metricsReady: metricsReadyRef.current,
    });
    const payload = buildProgressPayload(
      id,
      startLocator,
      endLocator,
      currentEventRef.current,
      metrics
    );
    if (!payload) return null;

    latestPayloadRef.current = payload;
    latestLocationPayloadRef.current = buildSaveLocationPayload(
      id,
      startLocator,
      endLocator,
      currentEventRef.current,
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

  /** progressCache만 낙관적 갱신 (서버 성공 전) */
  const applyProgressCache = useCallback((payload) => {
    setProgressToCache(payload);
  }, []);

  /** 서버 저장 성공 후 reader progress 캐시 동기화 */
  const commitReaderLocation = useCallback((locationPayload) => {
    if (locationPayload) {
      saveLocationRef.current?.(locationPayload);
    }
  }, []);

  /** 페이지 이탈 시 로컬 캐시 모두 즉시 반영 */
  const applyLocalProgressForExit = useCallback((payload, locationPayload) => {
    commitReaderLocation(locationPayload);
    applyProgressCache(payload);
  }, [applyProgressCache, commitReaderLocation]);

  const runFlushOnce = useCallback(async (resolve) => {
    const payload = latestPayloadRef.current;
    const id = bookIdRef.current;
    if (!payload) {
      const skipped = { isSuccess: true, skipped: true };
      resolve?.(skipped);
      return skipped;
    }

    const payloadKey = JSON.stringify(payload);
    if (lastPayloadRef.current === payloadKey) {
      const deduped = { isSuccess: true, deduped: true };
      resolve?.(deduped);
      return deduped;
    }

    const prevCached = id ? getProgressFromCache(id) : null;
    const locationPayload = latestLocationPayloadRef.current;

    try {
      applyProgressCache(payload);
      const res = await saveProgress(payload);
      if (!res?.isSuccess) {
        throw new Error(res?.message || '진도 저장 응답 실패');
      }

      commitReaderLocation(locationPayload);
      lastPayloadRef.current = payloadKey;

      const latest = latestPayloadRef.current;
      const latestKey = latest ? JSON.stringify(latest) : null;
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
  }, [applyProgressCache, commitReaderLocation]);

  const runFlush = useCallback((resolve) => {
    flushChainRef.current = flushChainRef.current
      .catch(() => {})
      .then(() => runFlushOnce(resolve));
  }, [runFlushOnce]);

  runFlushRef.current = runFlush;
  refreshLatestPayloadRef.current = refreshLatestPayload;

  const flushProgressAsync = useCallback(() => {
    refreshLatestPayload();
    return new Promise((resolve) => {
      runFlush(resolve);
    });
  }, [refreshLatestPayload, runFlush]);

  const prevBookIdRef = useRef(null);

  useEffect(() => {
    if (!bookId) {
      prevBookIdRef.current = null;
      prevMetricsReadyRef.current = metricsReady;
      resetAutoSaveState();
      return;
    }
    if (prevBookIdRef.current !== bookId) {
      prevBookIdRef.current = bookId;
      prevMetricsReadyRef.current = metricsReady;
      resetAutoSaveState();
    }

    const metricsJustBecameReady = metricsReady && !prevMetricsReadyRef.current;
    prevMetricsReadyRef.current = metricsReady;

    refreshLatestPayload();

    if (!latestPayloadRef.current) return;

    if (!initialSavedRef.current) {
      initialSavedRef.current = true;
      runFlush();
    } else if (metricsJustBecameReady) {
      runFlush();
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => runFlush(), delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [bookId, currentEvent, readingLocatorKey, metricsReady, delay, refreshLatestPayload, runFlush, resetAutoSaveState]);

  useEffect(() => {
    const handlePageHide = () => {
      if (pagehideFlushedRef.current) return;
      refreshLatestPayload();
      const payload = latestPayloadRef.current;
      if (!payload) return;
      pagehideFlushedRef.current = true;
      const locationPayload = latestLocationPayloadRef.current;
      applyLocalProgressForExit(payload, locationPayload);
      const ok = saveProgressKeepalive(payload);
      if (ok) {
        lastPayloadRef.current = JSON.stringify(payload);
      } else {
        errorUtils.logWarning('[useProgressAutoSave] keepalive 저장 요청 생성 실패', String(bookIdRef.current ?? ''));
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handlePageHide();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pagehideFlushedRef.current = false;
    };
  }, [refreshLatestPayload, applyLocalProgressForExit]);

  useEffect(() => {
    return () => {
      refreshLatestPayloadRef.current?.();
      runFlushRef.current?.();
    };
  }, []);

  return { flushProgressAsync, cachedLocation };
}

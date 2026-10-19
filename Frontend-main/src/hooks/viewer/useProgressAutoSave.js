/** 뷰어 진도 자동 저장: 디바운스 저장 + 페이지 이탈 시 flush */

import { useEffect, useRef, useState, useCallback } from 'react';
import { saveProgress, saveProgressKeepalive } from '../../utils/api/booksApi';
import { ensureSessionAccessToken } from '../../utils/api/authApi';
import { resolveProgressMetricsFromLocator } from '../../utils/common/readingProgress';
import {
  getProgressFromCache,
  removeProgressFromCache,
  setProgressToCache,
  getCachedReaderProgress,
  setCachedReaderProgress,
} from '../../utils/common/cache/progressCache';
import { errorUtils, stringOrEmpty } from '../../utils/common/valueUtils';
import {
  buildProgressPayloads,
  resolveReadingLocators,
} from '../../utils/viewer/viewerSession';

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
function subscribePageExit(onExit, { onHidden, onVisible } = {}) {
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') {
      onVisible?.();
      return;
    }
    // 토큰 갱신을 기다린 뒤 저장 (토큰이 유효하면 바로 진행)
    Promise.resolve(onHidden?.()).finally(onExit);
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
    const payloads = buildProgressPayloads(id, startLocator, endLocator, event, metrics);
    if (!payloads) return null;

    latestPayloadRef.current = payloads.progress;
    latestLocationPayloadRef.current = payloads.location;
    return payloads.progress;
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
      // 이미 저장된 진도와 같으면 보내지 않음 (탭 전환마다 중복 저장 방지)
      if (payloadFingerprint(payload) === lastPayloadRef.current) return;

      pagehideFlushedRef.current = true;
      applyLocalCaches(payload, latestLocationPayloadRef.current);
      const sent = saveProgressKeepalive(payload);
      if (!sent) {
        errorUtils.logWarning(
          `${LOG_PREFIX} keepalive 저장 요청 생성 실패`,
          String(liveRef.current.bookId ?? ''),
        );
        return;
      }
      // 서버 저장이 확인된 뒤에만 저장됨으로 기록 (실패하면 다음 자동 저장이 다시 보냄)
      const payloadKey = payloadFingerprint(payload);
      void sent.then((ok) => {
        if (ok) lastPayloadRef.current = payloadKey;
      });
    };

    const unsubscribe = subscribePageExit(handlePageHide, {
      onHidden: ensureSessionAccessToken,
      // 다시 보이면 이후 숨김/종료 때 keepalive를 또 보낼 수 있게
      onVisible: () => {
        pagehideFlushedRef.current = false;
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

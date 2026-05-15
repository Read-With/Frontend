/**
 * useProgressAutoSave.js : 진도 자동 저장 훅 (v2 locator 전용)
 * - 캐시 + 서버(POST /api/v2/progress) 전송
 * - 디바운스(delay) 및 중복 저장 방지
 */

import { useEffect, useMemo, useRef } from 'react';
import { setProgressToCache } from '../../utils/common/cache/progressCache';
import { anchorToLocators } from '../../utils/common/locatorUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import { saveProgress } from '../../utils/api/api';

export function useProgressAutoSave({
  bookKey,
  currentChapter,
  currentEvent,
  readingProgressPercent,
  delay = 2000,
}) {
  const timeoutRef = useRef(null);
  const lastPayloadRef = useRef(null);
  const latestPayloadRef = useRef(null);
  const inFlightRef = useRef(false);
  const initialSavedRef = useRef(false);

  const readingLocatorKey = useMemo(() => {
    const anchor = currentEvent?.anchor;
    if (!anchor?.startLocator && !anchor?.start) return '';
    const { startLocator } = anchorToLocators(anchor);
    if (!startLocator) return '';
    return JSON.stringify(startLocator);
  }, [currentEvent?.anchor]);

  const flushProgress = () => {
    const payload = latestPayloadRef.current;
    if (!payload) return;
    const payloadKey = JSON.stringify(payload);
    if (lastPayloadRef.current === payloadKey || inFlightRef.current) return;

    try {
      setProgressToCache(payload);
      inFlightRef.current = true;
      saveProgress(payload)
        .then((res) => {
          if (!res?.isSuccess) {
            throw new Error(res?.message || '진도 저장 응답 실패');
          }
          lastPayloadRef.current = payloadKey;
          const latest = latestPayloadRef.current;
          const latestKey = latest ? JSON.stringify(latest) : null;
          if (latestKey && latestKey !== payloadKey) {
            queueMicrotask(() => flushProgress());
          }
        })
        .catch((err) => {
          errorUtils.logWarning(
            '[useProgressAutoSave] 서버 저장 실패',
            err?.message ?? (typeof err === 'string' ? err : '')
          );
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    } catch (error) {
      const msg = error?.message ?? (typeof error === 'string' ? error : '알 수 없는 오류');
      errorUtils.logWarning('[useProgressAutoSave] 진도 자동 저장 실패', msg);
    }
  };

  const prevBookKeyRef = useRef(null);

  useEffect(() => {
    if (!bookKey) {
      prevBookKeyRef.current = null;
      lastPayloadRef.current = null;
      latestPayloadRef.current = null;
      initialSavedRef.current = false;
      return;
    }
    if (prevBookKeyRef.current !== bookKey) {
      prevBookKeyRef.current = bookKey;
      lastPayloadRef.current = null;
      initialSavedRef.current = false;
    }
    if (!readingLocatorKey) return;

    const anchor = currentEvent?.anchor;
    const { startLocator } = anchorToLocators(anchor);
    if (!startLocator) return;

    const evn = Number(currentEvent?.eventNum);
    const chp = Number(currentEvent?.chapterProgress);
    const evName = currentEvent?.eventName ?? currentEvent?.eventTitle ?? currentEvent?.name;

    const payload = {
      bookId: bookKey,
      startLocator,
      locator: startLocator,
      ...(Number.isFinite(Number(readingProgressPercent))
        ? { readingProgressPercent: Math.min(100, Math.max(0, Math.round(Number(readingProgressPercent)))) }
        : {}),
      ...(Number.isFinite(evn) && evn > 0 ? { eventNum: evn } : {}),
      ...(Number.isFinite(chp) ? { chapterProgress: Math.min(100, Math.max(0, chp)) } : {}),
      ...(typeof evName === 'string' && evName.trim() ? { eventName: evName.trim() } : {}),
    };
    latestPayloadRef.current = payload;

    if (!initialSavedRef.current) {
      initialSavedRef.current = true;
      flushProgress();
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(flushProgress, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [bookKey, currentChapter, currentEvent, readingLocatorKey, readingProgressPercent, delay]);

  useEffect(() => {
    const handlePageHide = () => flushProgress();
    const handleBeforeUnload = () => flushProgress();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushProgress();
    };
  }, []);
}

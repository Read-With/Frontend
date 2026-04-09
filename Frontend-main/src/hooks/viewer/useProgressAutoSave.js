/**
 * useProgressAutoSave.js : 진도 자동 저장 훅 (v2 locator 전용)
 * - 캐시 + 서버(POST /api/v2/progress) 전송
 * - 디바운스(delay) 및 중복 저장 방지
 */

import { useEffect, useRef } from 'react';
import { setProgressToCache } from '../../utils/common/cache/progressCache';
import { anchorToLocators } from '../../utils/common/locatorUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import { saveProgress } from '../../utils/api/api';

export function useProgressAutoSave({ bookKey, currentChapter, currentEvent, delay = 2000 }) {
  const timeoutRef = useRef(null);
  const lastPayloadRef = useRef(null);
  const latestPayloadRef = useRef(null);
  const inFlightRef = useRef(false);

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

  useEffect(() => {
    if (!bookKey) {
      lastPayloadRef.current = null;
      latestPayloadRef.current = null;
      return;
    }
    const anchor = currentEvent?.anchor;
    if (!anchor?.startLocator && !anchor?.start) return;

    const { startLocator } = anchorToLocators(anchor);
    if (!startLocator) return;

    const payload = { bookId: bookKey, startLocator, locator: startLocator };
    latestPayloadRef.current = payload;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(flushProgress, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [bookKey, currentChapter, currentEvent?.anchor, delay]);

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

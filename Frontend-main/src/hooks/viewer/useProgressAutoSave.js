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

  useEffect(() => {
    if (!bookKey) {
      lastPayloadRef.current = null;
      return;
    }
    const anchor = currentEvent?.anchor;
    if (!anchor?.startLocator && !anchor?.start) return;

    const { startLocator } = anchorToLocators(anchor);
    if (!startLocator) return;

    const payload = { bookId: bookKey, locator: startLocator };
    const payloadKey = JSON.stringify(payload);

    const autoSaveProgress = () => {
      if (lastPayloadRef.current === payloadKey) return;
      try {
        setProgressToCache(payload);
        lastPayloadRef.current = payloadKey;
        saveProgress(payload).catch((err) => {
          errorUtils.logWarning('[useProgressAutoSave] 서버 저장 실패', err?.message ?? (typeof err === 'string' ? err : ''));
        });
      } catch (error) {
        const msg = error?.message ?? (typeof error === 'string' ? error : '알 수 없는 오류');
        errorUtils.logWarning('[useProgressAutoSave] 진도 자동 저장 실패', msg);
      }
    };

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(autoSaveProgress, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [bookKey, currentChapter, currentEvent?.anchor, delay]);
}

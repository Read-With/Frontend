/** hooks 공통: bookId · latest ref · localStorage · error · manifest */

import { useRef, useState, useEffect, useCallback } from 'react';
import { getBookManifest } from '../../utils/api/api';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import { resolveServerBookId } from '../../utils/viewer/viewerCoreStateUtils';

export function useLatestRef(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function useErrorHandler(context = '알 수 없는 컨텍스트') {
  const handleError = useCallback((error, additionalContext = '', options = {}) => {
    const errorMessage = error?.message || error?.toString() || '알 수 없는 오류가 발생했습니다';
    const errorStatus = error?.status || error?.statusCode || null;
    const errorCode = error?.code || null;

    const errorInfo = {
      message: errorMessage,
      context: additionalContext || context,
      status: errorStatus,
      code: errorCode,
      timestamp: Date.now(),
      stack: error?.stack,
      originalError: error,
    };

    errorUtils.logError(context, error, {
      additionalContext,
      status: errorStatus,
      code: errorCode,
      ...options.metadata,
    });

    return errorInfo;
  }, [context]);

  return { handleError };
}

export function resolveServerBookIdOrFallback(book, routeBookId = null) {
  return resolveServerBookId(book) ?? toPositiveNumberOrNull(routeBookId);
}

export function useLocalStorageNumber(key, initialValue, options = {}) {
  const { forceInitialValue = false } = options;

  const [storedValue, setStoredValue] = useState(() => {
    const numericInitial = Number(initialValue);
    const sanitizedInitial = isNaN(numericInitial) ? initialValue : numericInitial;

    if (forceInitialValue) {
      try {
        localStorage.setItem(key, sanitizedInitial.toString());
      } catch (error) {
        console.error(`[useLocalStorageNumber] 초기값 강제 저장 실패 (key: ${key}):`, error);
      }
      return sanitizedInitial;
    }

    try {
      const item = localStorage.getItem(key);
      const parsedValue = item ? Number(item) : sanitizedInitial;
      return isNaN(parsedValue) ? sanitizedInitial : parsedValue;
    } catch (error) {
      console.error(`[useLocalStorageNumber] 초기값 로드 실패 (key: ${key}):`, error);
      return sanitizedInitial;
    }
  });

  const setValue = useCallback((value) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    const numericValue = Number(valueToStore);
    const previousValue = storedValue;

    if (isNaN(numericValue)) {
      return;
    }

    try {
      localStorage.setItem(key, numericValue.toString());
      setStoredValue(numericValue);

      window.dispatchEvent(new CustomEvent('localStorageChange', {
        detail: { key, newValue: numericValue.toString() }
      }));
    } catch (error) {
      console.error(`[useLocalStorageNumber] 저장 실패 (key: ${key}):`, error);
      setStoredValue(previousValue);
    }
  }, [key, storedValue]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          const parsedValue = Number(e.newValue);
          if (!isNaN(parsedValue)) {
            setStoredValue(parsedValue);
          }
        } catch (error) {
          console.error(`[useLocalStorageNumber] storage 이벤트 처리 실패 (key: ${key}):`, error);
        }
      }
    };

    const handleCustomStorageChange = (e) => {
      if (e.detail?.key === key && e.detail?.newValue !== null) {
        handleStorageChange({ key: e.detail.key, newValue: e.detail.newValue });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageChange', handleCustomStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageChange', handleCustomStorageChange);
    };
  }, [key]);

  return [storedValue, setValue];
}

/**
 * @param {number|string|null|undefined} bookId
 * @returns {Promise<{
 *   manifest: object|null,
 *   ok: boolean,
 *   skipped?: boolean,
 *   fromCache?: boolean,
 *   response?: object|null,
 *   error?: Error,
 * }>}
 */
export async function ensureBookManifest(bookId) {
  const numericBookId = Number(bookId);
  if (!Number.isFinite(numericBookId) || numericBookId < 1) {
    return { manifest: null, ok: true, skipped: true };
  }

  const cached = getManifestFromCache(numericBookId);
  if (cached) {
    return { manifest: cached, ok: true, fromCache: true, response: null };
  }

  try {
    const response = await getBookManifest(numericBookId);
    const manifest =
      response?.fromCache === true
        ? response.result
        : (getManifestFromCache(numericBookId) ?? response?.result ?? null);
    const ok = response?.isSuccess !== false && Boolean(manifest);
    return { manifest, ok, fromCache: false, response };
  } catch (error) {
    return {
      manifest: getManifestFromCache(numericBookId),
      ok: false,
      fromCache: false,
      error,
    };
  }
}

/**
 * 뷰어/그래프용 manifest 준비 게이트.
 * fail-open: 로드 실패해도 true로 두어 이후 metrics·fine graph가 막히지 않게 함.
 */
export function useManifestLoaded(bookId) {
  const [manifestLoaded, setManifestLoaded] = useState(
    () => !bookId || Boolean(getManifestFromCache(bookId))
  );

  useEffect(() => {
    if (!bookId) {
      setManifestLoaded(true);
      return undefined;
    }

    if (getManifestFromCache(bookId)) {
      setManifestLoaded(true);
      return undefined;
    }

    let cancelled = false;
    setManifestLoaded(false);

    void ensureBookManifest(bookId).then((outcome) => {
      if (cancelled) return;
      if (!outcome.ok && !outcome.skipped) {
        errorUtils.logWarning(
          '[useManifestLoaded] manifest 로드 실패',
          outcome.error?.message ?? outcome.response?.message ?? '알 수 없는 오류'
        );
      }
      setManifestLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return manifestLoaded;
}

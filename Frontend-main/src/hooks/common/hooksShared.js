/** hooks 공통: bookId · latest ref · localStorage · error · manifest */

import { useRef, useState, useEffect, useCallback } from 'react';
import { getBookManifest } from '../../utils/api/booksApi';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import { errorUtils } from '../../utils/common/urlUtils';
import { resolveServerBookId } from '../../utils/viewer/viewerCore';

export function useLatestRef(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** 뷰어·그래프 공통 모바일 브레이크포인트 */
export const NARROW_VIEWPORT_MQ = '(max-width: 767px)';

export function useIsNarrowViewport(mediaQuery = NARROW_VIEWPORT_MQ) {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(mediaQuery).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(mediaQuery);
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mediaQuery]);

  return isNarrow;
}

/** 세션 1회성 온보딩 힌트의 sessionStorage 읽기·기록 공통화 */
export function readSessionHintSeen(key) {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return true;
  }
}

export function markSessionHintSeen(key) {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

/** 세션 1회성 온보딩 힌트 open/dismiss 상태 머신 — 그래프·뷰어 공통 */
export function useSessionHint(storageKey, { autoOpen = true } = {}) {
  const [hintSeen, setHintSeen] = useState(() => readSessionHintSeen(storageKey));
  const [open, setOpen] = useState(() => autoOpen && !readSessionHintSeen(storageKey));

  const markSeen = useCallback(() => {
    markSessionHintSeen(storageKey);
    setHintSeen(true);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      markSeen();
      return !v;
    });
  }, [markSeen]);

  return { hintSeen, open, setOpen, dismiss, toggle, markSeen };
}

const MODAL_FOCUS_TRAP_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달/다이얼로그 공용 포커스 관리: 열릴 때 첫 포커스 가능 요소(또는 initialFocusRef)로 이동,
 * Tab/Shift+Tab을 다이얼로그 내부로 트랩, Escape로 닫기, 닫힐 때 이전 포커스로 복원.
 * dialogRef가 가리키는 요소에는 tabIndex={-1}이 있어야 함(포커스 가능 요소가 없을 때의 폴백 타깃).
 * @param {{
 *   initialFocusRef?: import('react').RefObject<HTMLElement>,
 *   suspended?: boolean,
 * }} [options]
 *   initialFocusRef: 첫 포커스 가능 요소 대신 특정 요소(예: 취소 버튼)로 초기 포커스를 보내고 싶을 때 지정
 *   suspended: 중첩된 다른 다이얼로그가 열려 이 트랩이 일시적으로 제어권을 넘겨야 할 때 true.
 *     Tab 트랩과 초기 포커스 이동만 멈추고, 최초 진입 시 캡처한 "이전 포커스"는 건드리지 않아
 *     중첩 다이얼로그가 열고 닫힐 때마다 포커스가 불필요하게 두 번 튀는 것을 막는다.
 */
export function useModalFocusTrap(isOpen, dialogRef, onClose, options = {}) {
  const { initialFocusRef = null, suspended = false } = options;
  const previouslyFocusedRef = useRef(null);

  // isOpen이 실제로 열림→닫힘으로 바뀔 때만 이전 포커스를 캡처·복원 (suspended 토글에는 반응하지 않음)
  useEffect(() => {
    if (!isOpen) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [isOpen]);

  // Tab 트랩 + 초기 포커스 이동은 suspended일 때만 일시 중단
  useEffect(() => {
    if (!isOpen || suspended) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll(MODAL_FOCUS_TRAP_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    const focusable = getFocusable();
    (initialFocusRef?.current || focusable[0] || dialog).focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const currentFocusable = getFocusable();
      if (currentFocusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, suspended, dialogRef, onClose, initialFocusRef]);
}

/** 언마운트 후 setState 방지용: 마운트 상태를 ref로 추적 */
export function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}

/** imperative handle 슬롯: mount 시 할당, unmount 시 null */
export function useRefSlot(slotRef, value) {
  useEffect(() => {
    if (!slotRef) return undefined;
    slotRef.current = value;
    return () => {
      slotRef.current = null;
    };
  }, [slotRef, value]);
}

/** 비동기 effect race 방지용 request id */
export function useAsyncRequestGuard() {
  const requestIdRef = useRef(0);

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  const isStale = useCallback((id) => id !== requestIdRef.current, []);

  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
  }, []);

  return { nextRequestId, isStale, invalidate, requestIdRef };
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
        errorUtils.logWarning('useLocalStorageNumber', '초기값 강제 저장 실패', { key, message: error?.message });
      }
      return sanitizedInitial;
    }

    try {
      const item = localStorage.getItem(key);
      const parsedValue = item ? Number(item) : sanitizedInitial;
      return isNaN(parsedValue) ? sanitizedInitial : parsedValue;
    } catch (error) {
      errorUtils.logWarning('useLocalStorageNumber', '초기값 로드 실패', { key, message: error?.message });
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
      errorUtils.logWarning('useLocalStorageNumber', '저장 실패', { key, message: error?.message });
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
          errorUtils.logWarning('useLocalStorageNumber', 'storage 이벤트 처리 실패', { key, message: error?.message });
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

function getManifestLoadState(bookId) {
  if (!bookId) {
    return { loaded: true, ready: true, manifest: null, error: null, skipped: true };
  }
  const cached = getManifestFromCache(bookId);
  return {
    loaded: Boolean(cached),
    ready: Boolean(cached),
    manifest: cached ?? null,
    error: null,
    skipped: false,
  };
}

/**
 * 뷰어/그래프용 manifest 준비 게이트.
 * - loaded: 로드 시도 완료 (또는 캐시 히트)
 * - ready: 사용 가능한 manifest 있음 (또는 bookId 스킵)
 * 그래프 등 manifest 필수 경로는 ready를 사용하고,
 * 뷰어 읽기 진행은 loaded로 fail-open 유지 가능.
 */
export function useManifestLoaded(bookId) {
  const [state, setState] = useState(() => getManifestLoadState(bookId));

  useEffect(() => {
    if (!bookId) {
      setState({ loaded: true, ready: true, manifest: null, error: null, skipped: true });
      return undefined;
    }

    const cached = getManifestFromCache(bookId);
    if (cached) {
      setState({ loaded: true, ready: true, manifest: cached, error: null, skipped: false });
      return undefined;
    }

    let cancelled = false;
    setState({ loaded: false, ready: false, manifest: null, error: null, skipped: false });

    void ensureBookManifest(bookId).then((outcome) => {
      if (cancelled) return;

      const manifest = outcome.manifest ?? getManifestFromCache(bookId);
      let error = null;
      if (!outcome.ok && !outcome.skipped) {
        const message =
          outcome.error?.message ?? outcome.response?.message ?? '알 수 없는 오류';
        errorUtils.logWarning('[useManifestLoaded] manifest 로드 실패', message);
        error =
          outcome.error ??
          Object.assign(new Error('Manifest 로드 실패'), {
            status: outcome.response?.code || null,
          });
      }

      const hasManifest = Boolean(manifest);
      setState({
        loaded: true,
        ready: hasManifest || Boolean(outcome.skipped),
        manifest: manifest ?? null,
        error: hasManifest ? null : error,
        skipped: Boolean(outcome.skipped),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return state;
}

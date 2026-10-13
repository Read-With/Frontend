/** hooks 공통: latest ref · viewport · focus trap · localStorage · manifest */

import { useRef, useState, useEffect, useCallback } from 'react';
import { getBookManifest } from '../../utils/api/booksApi';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { errorUtils } from '../../utils/common/valueUtils';
import { lockBodyScroll } from '../../utils/styles/styles';
import { useQuery } from '@tanstack/react-query';

/** body 스크롤 잠금 (중첩 안전 — lockBodyScroll 참고) */
export function useBodyScrollLock(active = true) {
  useEffect(() => (active ? lockBodyScroll() : undefined), [active]);
}

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

const MODAL_FOCUS_TRAP_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달/다이얼로그 공용 포커스 관리: 열릴 때 첫 포커스 가능 요소(또는 initialFocusRef)로 이동,
 * Tab/Shift+Tab을 다이얼로그 내부로 트랩, Escape로 닫기, 닫힐 때 이전 포커스로 복원.
 * dialogRef가 가리키는 요소에는 tabIndex={-1}이 있어야 함(포커스 가능 요소가 없을 때의 폴백 타깃).
 * @param {{
 *   initialFocusRef?: import('react').RefObject<HTMLElement>,
 *   suspended?: boolean,
 *   returnFocusRef?: import('react').RefObject<HTMLElement>,
 *   capture?: boolean,
 * }} [options]
 *   initialFocusRef: 첫 포커스 가능 요소 대신 특정 요소(예: 취소 버튼)로 초기 포커스를 보내고 싶을 때 지정
 *   suspended: 중첩된 다른 다이얼로그가 열려 이 트랩이 일시적으로 제어권을 넘겨야 할 때 true.
 *     Tab 트랩과 초기 포커스 이동만 멈추고, 최초 진입 시 캡처한 "이전 포커스"는 건드리지 않아
 *     중첩 다이얼로그가 열고 닫힐 때마다 포커스가 불필요하게 두 번 튀는 것을 막는다.
 *   returnFocusRef: 닫힐 때 "열 때의 포커스" 대신 돌려보낼 요소 (재마운트로 열린 모달처럼 이전 포커스가 body일 때)
 *   capture: keydown을 캡처 단계에서 처리 (Escape가 하위 요소의 keydown 핸들러에 닿기 전에 가로챔)
 */
export function useModalFocusTrap(isOpen, dialogRef, onClose, options = {}) {
  const { initialFocusRef = null, suspended = false, returnFocusRef = null, capture = false } = options;
  const previouslyFocusedRef = useRef(null);

  // isOpen이 실제로 열림→닫힘으로 바뀔 때만 이전 포커스를 캡처·복원 (suspended 토글에는 반응하지 않음)
  useEffect(() => {
    if (!isOpen) return undefined;
    previouslyFocusedRef.current = returnFocusRef?.current || document.activeElement;
    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [isOpen, returnFocusRef]);

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

    document.addEventListener('keydown', onKeyDown, capture);

    return () => {
      document.removeEventListener('keydown', onKeyDown, capture);
    };
  }, [isOpen, suspended, dialogRef, onClose, initialFocusRef, capture]);
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
    setStoredValue((prev) => {
      const next = Number(value instanceof Function ? value(prev) : value);
      if (isNaN(next)) return prev;
      try {
        localStorage.setItem(key, next.toString());
        return next;
      } catch (error) {
        errorUtils.logWarning('useLocalStorageNumber', '저장 실패', { key, message: error?.message });
        return prev;
      }
    });
  }, [key]);

  // 다른 탭의 변경 반영
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key !== key || e.newValue === null) return;
      const parsedValue = Number(e.newValue);
      if (!isNaN(parsedValue)) setStoredValue(parsedValue);
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue];
}

async function fetchBookManifest(bookId) {
  try {
    const response = await getBookManifest(bookId);
    const manifest =
      response?.fromCache === true
        ? response.result
        : (getManifestFromCache(bookId) ?? response?.result ?? null);
    if (response?.isSuccess === false || !manifest) {
      throw Object.assign(new Error(response?.message || 'Manifest 로드 실패'), {
        status: response?.code || null,
      });
    }
    return manifest;
  } catch (error) {
    errorUtils.logWarning('[useManifestLoaded] manifest 로드 실패', error?.message ?? '알 수 없는 오류');
    throw error;
  }
}

const noop = () => {};
const SKIPPED_MANIFEST = { loaded: true, ready: true, manifest: null, error: null, skipped: true, retry: noop };

/**
 * 뷰어/그래프용 manifest 준비 게이트.
 * - loaded: 로드 시도 완료 (또는 캐시 히트)
 * - ready: 사용 가능한 manifest 있음 (또는 bookId 스킵)
 * 그래프 등 manifest 필수 경로는 ready를 사용하고,
 * 뷰어 읽기 진행은 loaded로 fail-open 유지 가능.
 */
export function useManifestLoaded(bookId) {
  const id = Number(bookId);
  const valid = Number.isFinite(id) && id >= 1;

  const query = useQuery({
    queryKey: ['manifest', id],
    queryFn: () => fetchBookManifest(id),
    enabled: valid,
    initialData: () => (valid ? getManifestFromCache(id) ?? undefined : undefined),
    staleTime: Infinity,
    retry: false,
  });

  const { refetch } = query;
  const retry = useCallback(() => { void refetch(); }, [refetch]);

  if (!valid) return SKIPPED_MANIFEST;

  // 실패해도 다른 경로가 채운 캐시가 있으면 사용
  const manifest = query.data ?? getManifestFromCache(id) ?? null;
  return {
    loaded: query.status !== 'pending',
    ready: Boolean(manifest),
    manifest,
    // 재시도 중에는 에러를 숨김
    error: manifest || query.isFetching ? null : query.error ?? null,
    skipped: false,
    retry,
  };
}

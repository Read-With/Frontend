/** hooks 공통: latest ref · viewport · focus trap · 요청 가드 · manifest */

import { useRef, useState, useEffect, useCallback, useReducer } from 'react';
import { getBookManifest } from '../../utils/api/booksApi';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { PROGRESS_CACHE_UPDATED_EVENT } from '../../utils/common/cache/progressCache';
import { errorUtils } from '../../utils/common/valueUtils';
import { lockBodyScroll } from '../../utils/common/domUtils';
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

export function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_VIEWPORT_MQ).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_VIEWPORT_MQ);
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

/**
 * progressCache 갱신 이벤트 구독. bookId를 주면 그 책의 갱신만 전달.
 * onUpdate를 생략하면 갱신될 때마다 다시 렌더 (렌더 중 캐시를 다시 읽는 화면용).
 * 반환값: 갱신 횟수 — 캐시를 읽는 useMemo의 의존성으로 사용
 */
export function useProgressCacheUpdates({ bookId = null, enabled = true, onUpdate = null } = {}) {
  const [version, rerender] = useReducer((n) => n + 1, 0);
  const onUpdateRef = useLatestRef(onUpdate ?? rerender);

  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e) => {
      if (bookId != null && String(e?.detail?.bookId) !== String(bookId)) return;
      onUpdateRef.current();
    };
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, handler);
  }, [enabled, bookId, onUpdateRef]);

  return version;
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

  return { nextRequestId, isStale, invalidate };
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
const SKIPPED_MANIFEST = { loaded: true, ready: true, manifest: null, error: null, retry: noop };

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
    retry,
  };
}

/** DOM·이벤트 유틸: 클래스명 join, ref 병합, 키 입력 판별, body 스크롤 잠금 */

/** falsy 값을 걸러내고 남은 클래스명을 공백으로 join */
export function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function mergeRefs(...refs) {
  return (element) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(element);
      } else if (ref != null) {
        ref.current = element;
      }
    });
  };
}

/** role="button" 등 비버튼 요소용 keydown: Enter/Space면 기본 동작을 막고 handler(e) 실행 */
export const onActivationKey = (handler) => (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handler(e);
  }
};

/** 키 입력이 텍스트 입력 요소에서 온 것인지 (단축키 무시용) */
export function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable);
}

let bodyScrollLockCount = 0;

/** body 스크롤 잠금 — 카운트 기반이라 중첩(뷰어 + 다이얼로그 등)돼도 마지막 해제 시에만 복원. 해제 함수 반환. */
export function lockBodyScroll() {
  bodyScrollLockCount += 1;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyScrollLockCount -= 1;
    if (bodyScrollLockCount === 0) document.body.style.overflow = '';
  };
}

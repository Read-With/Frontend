/** 공통 UI 색상·애니메이션·ref 유틸 */

import { STYLE_DURATION } from './graphStyles';

export const ANIMATION_VALUES = {
  EASE_OUT: 'cubic-bezier(0.4, 0, 0.2, 1)',
  DURATION: STYLE_DURATION,
};

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

/** falsy 값을 걸러내고 남은 클래스명을 공백으로 join */
export function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ');
}

const opacityTransition = `opacity ${ANIMATION_VALUES.DURATION.NORMAL}`;

const createConditionalTransition = (condition, normalTransition, disabledTransition = 'none') =>
  condition ? disabledTransition : normalTransition;

/** NodeDetail 툴팁: 드래그 중 transition 억제 */
export const nodeDetailAnimations = {
  tooltipSimpleTransition: (isDragging) =>
    createConditionalTransition(isDragging, opacityTransition, 'none'),

  tooltipComplexTransition: (isDragging) =>
    createConditionalTransition(
      isDragging,
      `${opacityTransition}, transform ${ANIMATION_VALUES.DURATION.SLOW}`,
      'none',
    ),
};

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

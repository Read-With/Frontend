/** 공통 UI 색상·애니메이션·ref 유틸 */

import { GRAPH_COLORS, STYLE_DURATION } from './graphStyles';

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

/** falsy 값을 걸러내고 남은 클래스명을 공백으로 join */
export function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** GRAPH_COLORS 재export (소비자는 COLORS 또는 GRAPH_COLORS) */
export const COLORS = GRAPH_COLORS;

const opacityTransition = `opacity ${ANIMATION_VALUES.DURATION.NORMAL}`;

const createConditionalTransition = (condition, normalTransition, disabledTransition = 'none') =>
  condition ? disabledTransition : normalTransition;

/** UnifiedNodeInfo 드래그 중 transition 억제 */
export const unifiedNodeAnimations = {
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

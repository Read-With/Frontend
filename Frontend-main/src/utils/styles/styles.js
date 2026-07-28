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

/** GRAPH_COLORS 재export (소비자는 COLORS 또는 GRAPH_COLORS) */
export const COLORS = GRAPH_COLORS;

const createConditionalTransition = (condition, normalTransition, disabledTransition = 'none') =>
  condition ? disabledTransition : normalTransition;

/** UnifiedNodeInfo 드래그 중 transition 억제 */
export const unifiedNodeAnimations = {
  tooltipSimpleTransition: (isDragging) =>
    createConditionalTransition(isDragging, `opacity ${ANIMATION_VALUES.DURATION.NORMAL}`, 'none'),

  tooltipComplexTransition: (isDragging) =>
    createConditionalTransition(
      isDragging,
      `opacity ${ANIMATION_VALUES.DURATION.NORMAL}, transform ${ANIMATION_VALUES.DURATION.SLOW}`,
      'none'
    ),
};

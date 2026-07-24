/** 공통 UI 스타일·애니메이션·색상 상수 */

import { GRAPH_COLORS, STYLE_DURATION } from './graphStyles';

export const ANIMATION_VALUES = {
  EASE_OUT: 'cubic-bezier(0.4, 0, 0.2, 1)',
  DURATION: STYLE_DURATION,
};

function createSlideAnimation(isOpen, animationValues, translateX = -10) {
  return {
    opacity: isOpen ? 1 : 0,
    transform: isOpen ? 'translateX(0)' : `translateX(${translateX}px)`,
    transition: `all ${animationValues.DURATION.NORMAL} ${animationValues.EASE_OUT}`,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    width: isOpen ? 'auto' : '0px',
    display: 'inline-block',
    minWidth: isOpen ? 'auto' : '0px',
  };
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

const COLORS = {
  ...GRAPH_COLORS,
  primaryLight: '#E8F5E8',
  background: '#fff',
  error: '#ef4444',
  darkText: GRAPH_COLORS.primary,
  lightGray: '#f9fafb',
  lightGrayBorder: '#d1d5db',
};

const FOCUS_STYLE = {
  '&:focus': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
  '&:focusVisible': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
};

// 통일된 버튼 스타일 (xhtml-toolbar-btn 기준)
export const createButtonStyle = (variant = 'default') => {
  const baseStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5em',
    fontSize: '13px',
    fontWeight: '500',
    padding: '8px 16px',
    borderRadius: '8px',
    border: `1px solid ${COLORS.border}`,
    background: COLORS.white,
    color: COLORS.darkText,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    height: '40px',
    outline: 'none',
    ...FOCUS_STYLE,
  };

  if (variant === 'default') {
    return {
      ...baseStyle,
      background: COLORS.white,
      color: COLORS.darkText,
      border: `1px solid ${COLORS.border}`,
    };
  }

  return baseStyle;
};

/**
 * 통일된 버튼 hover 효과 핸들러
 */
const ADVANCED_BUTTON_HANDLERS = {
  default: {
    onMouseEnter: (e) => {
      e.target.style.background = COLORS.lightGray;
      e.target.style.borderColor = COLORS.lightGrayBorder;
    },
    onMouseLeave: (e) => {
      e.target.style.background = COLORS.white;
      e.target.style.borderColor = COLORS.border;
    },
  },
};

export const createAdvancedButtonHandlers = (variant) => ADVANCED_BUTTON_HANDLERS[variant] ?? {};

const createConditionalTransition = (condition, normalTransition, disabledTransition = 'none') =>
  condition ? disabledTransition : normalTransition;

// 반응형 사이드바 너비
const getResponsiveSidebarWidth = (isOpen, isMobile = false) => {
  if (isMobile) {
    return isOpen ? '280px' : '60px';
  }
  return isOpen ? '240px' : '60px';
};

// 사이드바 공통 스타일
export const sidebarStyles = {
  container: (isOpen, animationValues, isMobile = false) => ({
    width: getResponsiveSidebarWidth(isOpen, isMobile),
    height: '100vh',
    background: COLORS.background,
    borderRight: `1px solid ${COLORS.border}`,
    boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
    transition: `width ${animationValues.DURATION.SLOW} ${animationValues.EASE_OUT}`,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000,
    overflow: 'hidden',
    position: 'fixed',
    top: 0,
    left: 0,
  }),
  header: {
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '12px',
    padding: '0 16px',
    borderBottom: `1px solid ${COLORS.border}`,
    background: COLORS.backgroundLight,
    overflow: 'hidden',
    flexShrink: 0,
  },
  toggleButton: () => ({
    ...createButtonStyle('default'),
    width: '36px',
    height: '36px',
    fontSize: '16px',
  }),
  title: (isOpen, animationValues) => ({
    fontSize: '22px',
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'left',
    ...createSlideAnimation(isOpen, animationValues, -20),
  }),
  chapterList: {
    flex: 1,
    padding: '16px 0',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  chapterButton: (isSelected, isOpen, animationValues) => ({
    width: '100%',
    height: '48px',
    padding: '0 16px',
    border: 'none',
    background: isSelected ? COLORS.primaryLight : 'transparent',
    color: isSelected ? COLORS.textPrimary : COLORS.primary,
    fontSize: '16px',
    fontWeight: isSelected ? '600' : '500',
    textAlign: 'left',
    cursor: 'pointer',
    transition: `all ${animationValues.DURATION.NORMAL} ${animationValues.EASE_OUT}`,
    borderLeft: isSelected ? `4px solid ${COLORS.primary}` : '4px solid transparent',
    transform: isSelected ? 'translateX(4px)' : 'translateX(0)',
    boxShadow: isSelected ? `0 2px 8px ${COLORS.primary}26` : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: isOpen ? 'flex-start' : 'center',
    position: 'relative',
    overflow: 'hidden',
    ...FOCUS_STYLE,
  }),
  chapterNumber: (isSelected, animationValues) => ({
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: isSelected ? COLORS.primary : COLORS.borderLight,
    color: isSelected ? COLORS.background : COLORS.primary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: '600',
    marginRight: '12px',
    transition: `all ${animationValues.DURATION.NORMAL} ease`,
    flexShrink: 0,
    minWidth: '24px',
    minHeight: '24px',
  }),
  chapterText: (isOpen, animationValues) => createSlideAnimation(isOpen, animationValues),
};

export { COLORS };

const FIXED_TOOLTIP_BASE = {
  position: 'fixed',
  zIndex: 99999,
  width: 'min(26.25rem, calc(100vw - 1.5rem))',
  maxWidth: 'min(26.25rem, 92%)',
  background: COLORS.background,
  pointerEvents: 'auto',
};

// UnifiedNodeInfo 전용 툴팁 스타일
export const unifiedNodeTooltipStyles = {
  tooltipContainer: {
    ...FIXED_TOOLTIP_BASE,
    height: 'auto',
    maxHeight: 420,
    minHeight: 'unset',
    borderRadius: 15,
    boxShadow: '0 0.5rem 1.5rem rgba(0, 0, 0, 0.15), 0 0.25rem 0.75rem rgba(0, 0, 0, 0.1)',
    padding: 0,
    border: `1px solid ${COLORS.border}`,
  },

  errorContainer: {
    ...FIXED_TOOLTIP_BASE,
    minHeight: 150,
    maxHeight: 420,
    borderRadius: 15,
    boxShadow: '0 0.5rem 1.5rem rgba(0, 0, 0, 0.15), 0 0.25rem 0.75rem rgba(0, 0, 0, 0.1)',
    padding: 0,
    border: `1px solid ${COLORS.error}40`,
  },

  notAppearedContainer: {
    ...FIXED_TOOLTIP_BASE,
    opacity: 1,
    transition: 'opacity 0.3s',
    cursor: 'grab',
    minHeight: 150,
    maxHeight: 420,
    borderRadius: 15,
    boxShadow: '0 0.5rem 1.5rem rgba(0, 0, 0, 0.15), 0 0.25rem 0.75rem rgba(0, 0, 0, 0.1)',
    padding: 0,
    border: `1px solid ${COLORS.border}`,
  },
};

// UnifiedNodeInfo 전용 애니메이션 스타일
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

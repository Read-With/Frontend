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
  tooltipClose: '#bfc8e2',
  lightGray: '#f9fafb',
  lightGrayBorder: '#d1d5db',
};

const createFocusStyle = () => ({
  '&:focus': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
  '&:focusVisible': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
});

// 통일된 버튼 스타일 (xhtml-toolbar-btn 기준)
export const createButtonStyle = (animationValues, variant = 'default') => {
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
    ...createFocusStyle(),
  };

  const variants = {
    default: {
      background: COLORS.white,
      color: COLORS.darkText,
      border: `1px solid ${COLORS.border}`,
    },
    tooltipClose: {
      background: 'none',
      border: 'none',
      fontSize: '18px',
      color: COLORS.tooltipClose,
      position: 'absolute',
      top: '14px',
      right: '14px',
      zIndex: 2,
      width: '24px',
      height: '24px',
      padding: '0',
      borderRadius: '4px',
    },
    primaryEdge: {
      background: COLORS.primary,
      color: COLORS.white,
      border: 'none',
      borderRadius: '0.5rem',
      padding: '0.5rem 1.375rem',
      fontWeight: 600,
      fontSize: '0.9375rem',
      cursor: 'pointer',
      boxShadow: `0 0.125rem 0.5rem ${COLORS.primary}20`,
      transition: `background ${ANIMATION_VALUES.DURATION.FAST}, color ${ANIMATION_VALUES.DURATION.FAST}, box-shadow ${ANIMATION_VALUES.DURATION.FAST}, transform 0.13s`,
      margin: '0 auto',
      display: 'inline-block',
    },
    secondaryEdge: {
      background: COLORS.white,
      color: COLORS.primary,
      border: `1.5px solid ${COLORS.primary}`,
      borderRadius: '0.5rem',
      padding: '0.5rem 1.375rem',
      fontWeight: 600,
      fontSize: '0.9375rem',
      cursor: 'pointer',
      boxShadow: `0 0.125rem 0.5rem ${COLORS.primary}20`,
      transition: `background ${ANIMATION_VALUES.DURATION.FAST}, color ${ANIMATION_VALUES.DURATION.FAST}, box-shadow ${ANIMATION_VALUES.DURATION.FAST}, transform 0.13s`,
      margin: '0 auto',
      display: 'inline-block',
    },
  };

  // closeEdge는 tooltipClose와 동일 (호환 alias)
  variants.closeEdge = variants.tooltipClose;

  return { ...baseStyle, ...variants[variant] };
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
  tooltipClose: {
    onMouseEnter: (e) => {
      e.target.style.color = COLORS.primary;
      e.target.style.backgroundColor = 'rgba(92, 111, 92, 0.1)';
    },
    onMouseLeave: (e) => {
      e.target.style.color = COLORS.tooltipClose;
      e.target.style.backgroundColor = 'transparent';
    },
  },
};

ADVANCED_BUTTON_HANDLERS.closeEdge = ADVANCED_BUTTON_HANDLERS.tooltipClose;

export const createAdvancedButtonHandlers = (variant) => ADVANCED_BUTTON_HANDLERS[variant] ?? {};

const createConditionalTransition = (condition, normalTransition, disabledTransition = 'none') => {
  return condition ? disabledTransition : normalTransition;
};

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
  toggleButton: (animationValues) => ({
    ...createButtonStyle(animationValues, 'default'),
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
    ...createFocusStyle(),
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

export const topBarStyles = {
  container: {
    width: '100%',
    background: COLORS.background,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 16,
    height: 60,
    flexWrap: 'nowrap',
    overflow: 'visible',
  },
  leftSection: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '2rem',
    flex: 1,
    minWidth: 0,
    overflow: 'visible',
    flexWrap: 'nowrap',
  },
};

// 그래프 관련 스타일은 graphStyles.js에서 import
export { graphStyles, graphControlsStyles } from './graphStyles';

export { COLORS };

// UnifiedNodeInfo 전용 툴팁 스타일
export const unifiedNodeTooltipStyles = {
  // 툴팁 모드 컨테이너
  tooltipContainer: {
    position: "fixed",
    zIndex: 99999,
    width: 500,
    minWidth: 500,
    maxWidth: 500,
    height: "auto",
    minHeight: 280,
    background: COLORS.background,
    borderRadius: 10,
    boxShadow: `0 8px 4px ${COLORS.primary}21, 0 1.5px 8px rgba(0,0,0,0.04)`,
    padding: 0,
    border: `1.5px solid ${COLORS.border}`,
    animation: "fadeIn 0.4s ease-out",
    transformStyle: "preserve-3d",
  },
  
  // 사이드바 모드 컨테이너
  sidebarContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: COLORS.background,
    overflow: 'hidden',
    fontFamily: 'var(--font-family-primary)',
  },
  
  // 에러 툴팁 컨테이너
  errorContainer: {
    position: "fixed",
    zIndex: 99999,
    width: 500,
    minHeight: 150,
    background: COLORS.background,
    borderRadius: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
    padding: "20px",
    border: `1px solid ${COLORS.error}40`,
    animation: "scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  
  // 등장하지 않은 인물 툴팁
  notAppearedContainer: {
    position: "fixed",
    zIndex: 99999,
    opacity: 1,
    transition: "opacity 0.3s",
    cursor: "grab",
    width: 500,
    minHeight: 150,
    background: COLORS.background,
    borderRadius: 20,
    boxShadow: `0 8px 32px ${COLORS.primary}21, 0 1.5px 8px rgba(0,0,0,0.04)`,
    padding: 0,
    border: `1.5px solid ${COLORS.border}`,
    animation: "scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
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

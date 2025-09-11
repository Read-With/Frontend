const COLORS = {
  primary: '#6C8EFF',
  primaryLight: '#EEF2FF',
  textPrimary: '#22336b',
  textSecondary: '#6c757d',
  border: '#e5e7eb',
  borderLight: '#e3e6ef',
  background: '#fff',
  backgroundLight: '#f8f9fc',
  backgroundLighter: '#f8fafc',
  error: '#ef4444',
  success: '#10b981',
  warning: '#f59e0b',
};

const BREAKPOINTS = {
  mobile: '480px',
  tablet: '768px',
  desktop: '1024px',
  wide: '1200px',
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

// animations.js에서 애니메이션 관련 함수들 import
import { createSlideAnimation, ANIMATION_VALUES } from './animations';

// 통일된 버튼 스타일 (epub-toolbar-btn 기준)
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
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    color: '#374151',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    height: '40px',
    outline: 'none',
    ...createFocusStyle(),
  };

  const variants = {
    default: {
      background: '#ffffff',
      color: '#374151',
      border: '1px solid #e2e8f0',
    },
    primary: {
      background: '#3b82f6',
      color: '#ffffff',
      border: '1px solid #3b82f6',
    },
    secondary: {
      background: '#6b7280',
      color: '#ffffff',
      border: '1px solid #6b7280',
    },
    // 특수 버튼들
    close: {
      position: 'absolute',
      top: '8px',
      right: '8px',
      background: '#ffffff',
      color: '#374151',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      width: '32px',
      height: '32px',
      padding: '0',
      fontSize: '16px',
      zIndex: 100,
    },
    tooltipClose: {
      background: 'none',
      border: 'none',
      fontSize: '18px',
      color: '#bfc8e2',
      position: 'absolute',
      top: '14px',
      right: '14px',
      zIndex: 2,
      width: '24px',
      height: '24px',
      padding: '0',
      borderRadius: '4px',
    },
    // 기존 고급 스타일 유지
    primaryAdvanced: {
      background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primary} 100%)`,
      color: '#fff',
      border: 'none',
      borderRadius: '12px',
      padding: '14px 28px',
      fontSize: '15px',
      fontWeight: '600',
      boxShadow: `0 4px 12px ${COLORS.primary}40`,
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      height: 'auto',
    },
  };

  return { ...baseStyle, ...variants[variant] };
};

/**
 * 통일된 버튼 hover 효과 핸들러
 * @param {string} variant - 버튼 variant
 * @returns {Object} hover 이벤트 핸들러 객체
 */
export const createAdvancedButtonHandlers = (variant) => {
  if (variant === 'primaryAdvanced') {
    return {
      onMouseOver: (e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `0 8px 20px ${COLORS.primary}59`;
      },
      onMouseOut: (e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = `0 4px 12px ${COLORS.primary}40`;
      }
    };
  }
  
  if (variant === 'primary') {
    return {
      onMouseEnter: (e) => {
        e.target.style.background = '#2563eb';
        e.target.style.borderColor = '#2563eb';
      },
      onMouseLeave: (e) => {
        e.target.style.background = '#3b82f6';
        e.target.style.borderColor = '#3b82f6';
      }
    };
  }
  
  if (variant === 'secondary') {
    return {
      onMouseEnter: (e) => {
        e.target.style.background = '#4b5563';
        e.target.style.borderColor = '#4b5563';
      },
      onMouseLeave: (e) => {
        e.target.style.background = '#6b7280';
        e.target.style.borderColor = '#6b7280';
      }
    };
  }
  
  if (variant === 'default') {
    return {
      onMouseEnter: (e) => {
        e.target.style.background = '#f9fafb';
        e.target.style.borderColor = '#d1d5db';
      },
      onMouseLeave: (e) => {
        e.target.style.background = '#ffffff';
        e.target.style.borderColor = '#e2e8f0';
      }
    };
  }
  
  if (variant === 'close') {
    return {
      onMouseEnter: (e) => {
        e.target.style.background = '#f9fafb';
        e.target.style.borderColor = '#d1d5db';
      },
      onMouseLeave: (e) => {
        e.target.style.background = '#ffffff';
        e.target.style.borderColor = '#e2e8f0';
      }
    };
  }
  
  if (variant === 'tooltipClose') {
    return {
      onMouseEnter: (e) => {
        e.target.style.color = '#6C8EFF';
        e.target.style.backgroundColor = 'rgba(108, 142, 255, 0.1)';
      },
      onMouseLeave: (e) => {
        e.target.style.color = '#bfc8e2';
        e.target.style.backgroundColor = 'transparent';
      }
    };
  }
  
  return {};
};

/**
 * 조건부 애니메이션 생성 함수
 * @param {boolean} condition - 애니메이션 비활성화 조건
 * @param {string} normalTransition - 정상 상태의 transition
 * @param {string} disabledTransition - 비활성화 상태의 transition
 * @returns {string} 조건에 따른 transition 값
 */
export const createConditionalTransition = (condition, normalTransition, disabledTransition = 'none') => {
  return condition ? disabledTransition : normalTransition;
};

/**
 * 복합 애니메이션 생성 함수
 * @param {Array<string>} properties - 애니메이션할 속성들
 * @param {string} duration - 애니메이션 지속 시간
 * @param {string} easing - 애니메이션 이징 함수
 * @returns {string} 복합 transition 값
 */
export const createComplexTransition = (properties, duration, easing) => {
  return properties.map(prop => `${prop} ${duration} ${easing}`).join(', ');
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
    height: '54px',
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
    width: '32px',
    height: '32px',
    fontSize: '14px',
  }),
  title: (isOpen, animationValues) => ({
    fontSize: '20px',
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
    fontSize: '14px',
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
    fontSize: '12px',
    fontWeight: '600',
    marginRight: '12px',
    transition: `all ${animationValues.DURATION.NORMAL} ease`,
    flexShrink: 0,
    minWidth: '24px',
    minHeight: '24px',
  }),
  chapterText: (isOpen, animationValues) => createSlideAnimation(isOpen, animationValues),
  chapterTitle: (isOpen, animationValues) => ({
    ...createSlideAnimation(isOpen, animationValues),
    fontSize: '12px',
    color: COLORS.textSecondary,
    marginTop: '2px',
  }),
  content: (isOpen, animationValues) => ({
    flex: 1,
    padding: isOpen ? '16px' : '8px',
    overflowY: 'auto',
    overflowX: 'hidden',
    transition: `padding ${animationValues.DURATION.NORMAL} ${animationValues.EASE_OUT}`,
  }),
  footer: {
    padding: '16px',
    borderTop: `1px solid ${COLORS.border}`,
    background: COLORS.backgroundLight,
    flexShrink: 0,
  },
  footerButton: {
    width: '100%',
    height: '40px',
    border: `1px solid ${COLORS.primary}`,
    borderRadius: '6px',
    background: COLORS.background,
    color: COLORS.primary,
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    ...createFocusStyle(),
  },
  footerButtonHover: {
    background: COLORS.primary,
    color: COLORS.background,
  },
};

// 상단바 공통 스타일
export const topBarStyles = {
  container: {
    width: '100%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 16,
    height: 54,
    flexWrap: 'nowrap',
    overflow: 'visible',
  },
  leftSection: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    overflow: 'visible',
    flexWrap: 'nowrap',
  },
  centerSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    textAlign: 'center',
  },
  rightSection: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  backButton: {
    height: 36,
    padding: '0 16px',
    borderRadius: 8,
    border: '1.5px solid #e3e6ef',
    background: '#fff',
    color: '#22336b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#22336b',
    margin: 0,
  },
  subtitle: {
    fontSize: 12,
    color: '#6c757d',
    margin: 0,
    marginTop: 2,
  },
  closeButton: (animationValues) => ({
    height: 36,
    width: 36,
    borderRadius: 8,
    border: '1.5px solid #e3e6ef',
    background: '#fff',
    color: '#22336b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: `all ${animationValues.DURATION.FAST} ease`,
    outline: 'none',
    fontSize: 14,
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  }),
};

// 로딩/에러 컨테이너 스타일
export const containerStyles = {
  loading: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: '#6C8EFF',
  },
  error: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
    padding: '20px',
  },
  controlsContainer: {
    padding: '8px 16px',
    background: '#f8f9fc',
    borderBottom: '1px solid #e5e7eb',
  },
};

// 그래프 관련 스타일은 graphStyles.js에서 import
export { graphStyles, graphControlsStyles } from './graphStyles';

// 기본 상수들
export { COLORS, BREAKPOINTS, ANIMATION_VALUES };

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
  // 툴팁 단순 전환 (opacity만)
  tooltipSimpleTransition: (isDragging) => 
    createConditionalTransition(isDragging, `opacity ${ANIMATION_VALUES.DURATION.NORMAL}`, 'none'),
  
  // 툴팁 복합 전환 (opacity + transform) - UnifiedNodeInfo의 실제 사용 패턴 반영
  tooltipComplexTransition: (isDragging) => 
    createConditionalTransition(
      isDragging, 
      `opacity ${ANIMATION_VALUES.DURATION.NORMAL}, transform ${ANIMATION_VALUES.DURATION.SLOW}`, 
      'none'
    ),
  
  // 버튼 hover 전환
  buttonHoverTransition: `all ${ANIMATION_VALUES.DURATION.FAST} ${ANIMATION_VALUES.EASE}`,
  
  // 사이드바 닫기 버튼 전환
  sidebarCloseTransition: `all ${ANIMATION_VALUES.DURATION.FAST} ${ANIMATION_VALUES.EASE}`,
};

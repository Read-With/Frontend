// 색상 상수 정의
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

// 반응형 브레이크포인트
const BREAKPOINTS = {
  mobile: '480px',
  tablet: '768px',
  desktop: '1024px',
  wide: '1200px',
};

// 공통 포커스 스타일
const createFocusStyle = () => ({
  '&:focus': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
  '&:focus-visible': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
});

// animations.js에서 슬라이드 애니메이션 import (중복 제거)
import { createSlideAnimation } from './animations';

// 공통 버튼 스타일
const createButtonStyle = (animationValues, variant = 'default') => {
  const baseStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    outline: 'none',
    border: 'none',
    borderRadius: '6px',
    transition: `all ${animationValues.DURATION.FAST} ease`,
    ...createFocusStyle(),
  };

  const variants = {
    default: {
      background: COLORS.background,
      color: COLORS.primary,
      border: `1px solid ${COLORS.borderLight}`,
    },
    primary: {
      background: COLORS.primary,
      color: COLORS.background,
    },
    secondary: {
      background: COLORS.backgroundLight,
      color: COLORS.textSecondary,
      border: `1px solid ${COLORS.borderLight}`,
    },
  };

  return { ...baseStyle, ...variants[variant] };
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
    zIndex: 10001,
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

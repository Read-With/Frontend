// 통합 스타일 유틸리티
// styles.js + graphStyles.js + relationStyles.js + animations.js 통합

// ============================================================================
// 1. 기본 상수 및 설정 (styles.js에서 가져옴)
// ============================================================================

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
  '&:focusVisible': {
    outline: `2px solid ${COLORS.primary}`,
    outlineOffset: '2px',
  },
});

// ============================================================================
// 2. 애니메이션 관련 (animations.js에서 가져옴)
// ============================================================================

// 공통 애니메이션 값들
export const ANIMATION_VALUES = {
  EASE_OUT: 'cubic-bezier(0.4, 0, 0.2, 1)',
  EASE_IN_OUT: 'cubic-bezier(0.4, 2, 0.6, 1)',
  DURATION: {
    FAST: '0.18s',
    NORMAL: '0.3s',
    SLOW: '0.4s',
  }
};

/**
 * 슬라이드 인 애니메이션 스타일
 * @param {string} direction - 슬라이드 방향 ('left', 'right', 'up', 'down')
 * @param {number} duration - 애니메이션 지속 시간 (초)
 * @returns {string} CSS 애니메이션 문자열
 */
export function getSlideInAnimation(direction = 'right', duration = 0.4) {
  const animations = {
    right: `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `,
    left: `
      @keyframes slideIn {
        from {
          transform: translateX(-100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `,
    up: `
      @keyframes slideIn {
        from {
          transform: translateY(100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `,
    down: `
      @keyframes slideIn {
        from {
          transform: translateY(-100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `
  };

  return `
    ${animations[direction] || animations.right}
    animation: slideIn ${duration}s ${ANIMATION_VALUES.EASE_OUT};
  `;
}

/**
 * 슬라이드 애니메이션 생성 (styles.js의 createSlideAnimation과 통합)
 * @param {boolean} isOpen - 열림 상태
 * @param {Object} animationValues - 애니메이션 값
 * @param {number} translateX - X축 이동 거리
 * @returns {Object} 애니메이션 스타일 객체
 */
export function createSlideAnimation(isOpen, animationValues, translateX = -10) {
  return {
    transform: isOpen ? 'translateX(0)' : `translateX(${translateX}px)`,
    opacity: isOpen ? 1 : 0,
    transition: `all ${animationValues.DURATION.NORMAL} ${animationValues.EASE_OUT}`,
  };
}

/**
 * 페이드 인 애니메이션
 * @param {number} duration - 애니메이션 지속 시간 (초)
 * @returns {string} CSS 애니메이션 문자열
 */
export function getFadeInAnimation(duration = 0.3) {
  return `
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    animation: fadeIn ${duration}s ${ANIMATION_VALUES.EASE_OUT};
  `;
}

/**
 * 스케일 인 애니메이션
 * @param {number} duration - 애니메이션 지속 시간 (초)
 * @returns {string} CSS 애니메이션 문자열
 */
export function getScaleInAnimation(duration = 0.3) {
  return `
    @keyframes scaleIn {
      from {
        transform: scale(0.9);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
    animation: scaleIn ${duration}s ${ANIMATION_VALUES.EASE_OUT};
  `;
}

/**
 * 사이드바 애니메이션
 * @param {boolean} isOpen - 열림 상태
 * @param {string} property - 애니메이션 속성
 * @returns {Object} 애니메이션 스타일 객체
 */
export function getSidebarAnimation(isOpen, property = 'all') {
  const duration = isOpen ? ANIMATION_VALUES.DURATION.SLOW : ANIMATION_VALUES.DURATION.NORMAL;
  return {
    transition: `${property} ${duration} ${ANIMATION_VALUES.EASE_OUT}`,
  };
}

/**
 * 버튼 호버 애니메이션
 * @returns {string} CSS transition 문자열
 */
export function getButtonHoverAnimation() {
  return `all ${ANIMATION_VALUES.DURATION.FAST} ${ANIMATION_VALUES.EASE_OUT}`;
}

/**
 * ref 병합 유틸리티
 * @param {...any} refs - 병합할 ref들
 * @returns {Function} 병합된 ref 함수
 */
export function mergeRefs(...refs) {
  return (element) => {
    refs.forEach(ref => {
      if (typeof ref === 'function') {
        ref(element);
      } else if (ref && typeof ref === 'object') {
        ref.current = element;
      }
    });
  };
}

// ============================================================================
// 3. 그래프 스타일 관련 (graphStyles.js에서 가져옴)
// ============================================================================

// 그래프 레이아웃 설정
export const DEFAULT_LAYOUT = {
  name: "preset",
  padding: 20,
  nodeRepulsion: 15000,
  idealEdgeLength: 400,
  animate: false,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 50,
  randomSeed: 42,
  componentSpacing: 400
};

export const SEARCH_LAYOUT = {
  name: "cose",
  padding: 5,
  nodeRepulsion: 2500,
  idealEdgeLength: 135,
  animate: true,
  animationDuration: 200,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 20,
  randomSeed: 42,
  gravity: 0.3,
  refresh: 10,
  componentSpacing: 110,
  coolingFactor: 0.8,
  initialTemp: 100
};

// 와이드 레이아웃 설정
export const getWideLayout = () => {
  return { name: 'preset' };
};

// 페이지 위치와 관계 값에 따라 그래프 스타일 조절
export const getNodeSize = (context = 'default') => {
  if (typeof window === 'undefined' || !window.location) {
    return 40; // SSR 환경 고려
  }
  
  const path = window.location.pathname || '';
  if (path.includes('/user/viewer/')) return 40;
  if (path.includes('/user/graph/')) {
    return context === 'search' ? 35 : 50;
  }
  return 40;
};

// 엣지 스타일 조절
export const getEdgeStyle = (context = 'default') => {
  if (typeof window === 'undefined' || !window.location) {
    return { width: 2, opacity: 0.8 };
  }
  
  const path = window.location.pathname || '';
  if (path.includes('/user/viewer/')) {
    return { width: 1.5, opacity: 0.7 };
  }
  if (path.includes('/user/graph/')) {
    return context === 'search' ? { width: 1.5, opacity: 0.6 } : { width: 2.5, opacity: 0.9 };
  }
  return { width: 2, opacity: 0.8 };
};

// 관계 색상 계산
export const getRelationColor = (positivity) => {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 50%)`;
};

// 그래프 스타일시트 생성
export const createGraphStylesheet = (nodeSize, edgeStyle, edgeLabelVisible, maxEdgeLabelLength = 15) => [
  {
    selector: 'node',
    style: {
      'width': nodeSize,
      'height': nodeSize,
      'background-image': 'data(image)',
      'background-fit': 'cover',
      'background-clip': 'node',
      'background-color': '#6C8EFF',
      'border-width': 2,
      'border-color': '#4A6CF7',
      'label': 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'color': '#fff',
      'font-size': '12px',
      'font-weight': 'bold',
      'text-outline-width': 1,
      'text-outline-color': '#000',
      'overlay-opacity': 0,
      'text-events': 'yes',
      'events': 'yes',
      'z-index': 10,
    }
  },
  {
    selector: 'node[main_character="true"]',
    style: {
      'background-image': 'data(image)',
      'background-fit': 'cover',
      'background-clip': 'node',
      'background-color': '#FF6B6B',
      'border-color': '#E53E3E',
      'border-width': 3,
      'width': nodeSize * 1.2,
      'height': nodeSize * 1.2,
    }
  },
  {
    selector: 'node:selected',
    style: {
      'background-image': 'data(image)',
      'background-fit': 'cover',
      'background-clip': 'node',
      'background-color': '#FFD93D',
      'border-color': '#FFA500',
      'border-width': 3,
    }
  },
  {
    selector: 'node.highlighted',
    style: {
      'background-image': 'data(image)',
      'background-fit': 'cover',
      'background-clip': 'node',
      'background-color': '#FFD93D',
      'border-color': '#FFA500',
      'border-width': 3,
      'z-index': 999,
    }
  },
  {
    selector: 'node.faded',
    style: {
      'opacity': 0.3,
    }
  },
  {
    selector: 'edge',
    style: {
      'width': edgeStyle.width,
      'line-color': 'mapData(positivity, -1, 1, #ff6b6b, #4ade80)',
      'target-arrow-color': 'mapData(positivity, -1, 1, #ff6b6b, #4ade80)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'opacity': edgeStyle.opacity,
      'label': edgeLabelVisible ? 'data(label)' : '',
      'text-rotation': 'autorotate',
      'text-margin-y': -10,
      'font-size': '10px',
      'color': '#4A5568',
      'text-outline-width': 1,
      'text-outline-color': '#fff',
      'text-wrap': 'wrap',
      'text-max-width': `${maxEdgeLabelLength}px`,
      'overlay-opacity': 0,
      'events': 'yes',
    }
  },
  {
    selector: 'edge.highlighted',
    style: {
      'line-color': '#FFD93D',
      'target-arrow-color': '#FFD93D',
      'width': edgeStyle.width * 1.5,
      'opacity': 1,
      'z-index': 999,
    }
  },
  {
    selector: 'edge.faded',
    style: {
      'opacity': 0.1,
    }
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#FFA500',
      'target-arrow-color': '#FFA500',
      'width': edgeStyle.width * 1.5,
    }
  }
];

// 그래프 컨테이너 스타일
export const graphStyles = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: '#f8f9fc',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  loading: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 1000,
  },
  error: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: COLORS.error,
    fontSize: '14px',
    textAlign: 'center',
  },
  tooltipContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 1000,
  },
  tooltipStyle: {
    pointerEvents: 'auto',
  },
  graphArea: {
    width: '100%',
    height: '100%',
    position: 'relative',
  }
};

// 그래프 컨트롤 스타일은 아래에서 통합 정의

// ============================================================================
// 4. 관계 스타일 관련 (relationStyles.js에서 가져옴)
// ============================================================================

// 관계 스타일 캐시
const relationStyleCache = new Map();

/**
 * 긍정도에 따른 스타일 계산
 * @param {number} positivity - 긍정도 값 (-1 ~ 1)
 * @returns {Object} 스타일 객체 { color, text }
 */
function calculateRelationStyle(positivity) {
  // 입력 가드 및 범위 클램프
  const value = typeof positivity === 'number' && !Number.isNaN(positivity)
    ? Math.max(-1, Math.min(1, positivity))
    : 0;
  
  // 색상: 통합된 함수 사용
  const color = getRelationColor(value);
  
  // 텍스트 분류
  if (value > 0.6) return { color, text: "긍정적" };
  if (value > 0.3) return { color, text: "우호적" };
  if (value > -0.3) return { color, text: "중립적" };
  if (value > -0.6) return { color, text: "비우호적" };
  return { color, text: "부정적" };
}

export function getRelationStyle(positivity) {
  // 소수점 2자리로 반올림하여 캐시 키 생성
  const key = Math.round(positivity * 100) / 100;
  
  if (relationStyleCache.has(key)) {
    return relationStyleCache.get(key);
  }
  
  const result = calculateRelationStyle(positivity);
  relationStyleCache.set(key, result);
  return result;
}

/**
 * 관계 라벨 배열을 생성하는 함수
 * @param {array|string} relation - 관계 데이터 (배열 또는 문자열)
 * @param {string} label - 백업용 라벨 문자열
 * @returns {array} 관계 라벨 배열
 */
export function getRelationLabels(relation, label) {
  try {
    if (Array.isArray(relation)) {
      return relation.filter(Boolean);
    }
    
    if (typeof relation === 'string' && relation.trim()) {
      return relation.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    if (typeof label === 'string' && label.trim()) {
      return label.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    return [];
  } catch (error) {
    console.warn('getRelationLabels 에러:', error);
    return [];
  }
}

// 관계 툴팁 스타일
export const tooltipStyles = {
  container: {
    position: 'absolute',
    zIndex: 1000,
    backgroundColor: '#fff',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    minWidth: '200px',
    maxWidth: '300px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    lineHeight: '1.4',
    color: COLORS.textPrimary,
  },
  header: {
    padding: '12px 16px',
    borderBottom: `1px solid ${COLORS.borderLight}`,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: '8px 8px 0 0',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: COLORS.textSecondary,
  },
  content: {
    padding: '16px',
  },
  relationTag: {
    display: 'inline-block',
    padding: '4px 8px',
    backgroundColor: COLORS.primaryLight,
    color: COLORS.primary,
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    margin: '2px 4px 2px 0',
  },
  progressBar: {
    width: '100%',
    height: '6px',
    backgroundColor: COLORS.borderLight,
    borderRadius: '3px',
    overflow: 'hidden',
    margin: '8px 0',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
  button: {
    padding: '8px 16px',
    backgroundColor: COLORS.primary,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    '&:hover': {
      backgroundColor: '#5A7BFF',
    }
  }
};

/**
 * 관계 스타일 캐시 정리 함수
 * @returns {void}
 */
export function clearRelationStyleCache() {
  relationStyleCache.clear();
}

/**
 * 모든 관계 스타일 리소스 정리 함수
 * @returns {void}
 */
export function cleanupRelationStyleResources() {
  clearRelationStyleCache();
}

// ============================================================================
// 5. UI 컴포넌트 스타일 (styles.js에서 가져옴)
// ============================================================================

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
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: '500',
    textDecoration: 'none',
    ...createFocusStyle(),
  };

  const variants = {
    primary: {
      ...baseStyle,
      backgroundColor: COLORS.primary,
      color: '#fff',
      padding: '10px 16px',
      '&:hover': {
        backgroundColor: '#5A7BFF',
        transform: 'translateY(-1px)',
      },
      '&:active': {
        transform: 'translateY(0)',
      },
    },
    secondary: {
      ...baseStyle,
      backgroundColor: 'transparent',
      color: COLORS.primary,
      border: `1px solid ${COLORS.primary}`,
      padding: '9px 15px',
      '&:hover': {
        backgroundColor: COLORS.primaryLight,
        transform: 'translateY(-1px)',
      },
    },
    ghost: {
      ...baseStyle,
      backgroundColor: 'transparent',
      color: COLORS.textSecondary,
      padding: '8px 12px',
      '&:hover': {
        backgroundColor: COLORS.backgroundLight,
        color: COLORS.textPrimary,
      },
    },
    default: {
      ...baseStyle,
      backgroundColor: COLORS.background,
      color: COLORS.textPrimary,
      border: `1px solid ${COLORS.border}`,
      padding: '9px 15px',
      '&:hover': {
        backgroundColor: COLORS.backgroundLight,
        borderColor: COLORS.primary,
      },
    },
  };

  return variants[variant] || variants.default;
};

// 사이드바 스타일
export const sidebarStyles = {
  container: (isOpen, animationValues, isMobile = false) => ({
    position: 'fixed',
    top: 0,
    left: 0,
    height: '100vh',
    width: isOpen ? (isMobile ? '100%' : '320px') : '0',
    backgroundColor: COLORS.background,
    borderRight: `1px solid ${COLORS.border}`,
    zIndex: 1000,
    overflow: 'hidden',
    ...createSlideAnimation(isOpen, animationValues, -320),
    ...getSidebarAnimation(isOpen),
  }),
  overlay: (isOpen, animationValues) => ({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 999,
    opacity: isOpen ? 1 : 0,
    visibility: isOpen ? 'visible' : 'hidden',
    transition: `opacity ${animationValues.DURATION.NORMAL} ease, visibility ${animationValues.DURATION.NORMAL} ease`,
  }),
  content: {
    padding: '20px',
    height: '100%',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: `1px solid ${COLORS.borderLight}`,
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: COLORS.textPrimary,
    margin: 0,
  },
  closeButton: {
    ...createButtonStyle(ANIMATION_VALUES, 'ghost'),
    padding: '8px',
    minWidth: 'auto',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: `background-color ${ANIMATION_VALUES.DURATION.FAST} ease`,
    '&:hover': {
      backgroundColor: COLORS.backgroundLight,
    },
  },
  itemActive: {
    backgroundColor: COLORS.primaryLight,
    color: COLORS.primary,
  },
  itemIcon: {
    marginRight: '12px',
    fontSize: '16px',
  },
  itemText: {
    fontSize: '14px',
    fontWeight: '500',
  },
};

// 탑바 스타일
export const topBarStyles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    backgroundColor: COLORS.background,
    borderBottom: `1px solid ${COLORS.border}`,
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: COLORS.textPrimary,
    margin: 0,
  },
  button: {
    ...createButtonStyle(ANIMATION_VALUES, 'ghost'),
    padding: '8px 12px',
  },
  buttonPrimary: {
    ...createButtonStyle(ANIMATION_VALUES, 'primary'),
    padding: '8px 16px',
  },
  searchInput: {
    padding: '8px 12px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s ease',
    minWidth: '200px',
    '&:focus': {
      borderColor: COLORS.primary,
      boxShadow: `0 0 0 3px ${COLORS.primaryLight}`,
    },
  },
};

// 컨테이너 스타일
export const containerStyles = {
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    color: COLORS.textSecondary,
    fontSize: '14px',
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    color: COLORS.error,
    fontSize: '14px',
    textAlign: 'center',
    padding: '20px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    color: COLORS.textSecondary,
    fontSize: '14px',
    textAlign: 'center',
    padding: '20px',
  },
  content: {
    padding: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  section: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: '16px',
  },
  grid: {
    display: 'grid',
    gap: '16px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
  },
  card: {
    backgroundColor: COLORS.background,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    padding: '16px',
    transition: `box-shadow ${ANIMATION_VALUES.DURATION.FAST} ease`,
    '&:hover': {
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    },
  },
};

// 그래프 컨트롤 스타일 (기존 graphControlsStyles와 통합)
export const graphControlsStyles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: COLORS.background,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  input: {
    padding: '8px 12px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s ease',
    '&:focus': {
      borderColor: COLORS.primary,
      boxShadow: `0 0 0 3px ${COLORS.primaryLight}`,
    }
  },
  button: {
    ...createButtonStyle(ANIMATION_VALUES, 'secondary'),
    padding: '8px 12px',
  },
  buttonPrimary: {
    ...createButtonStyle(ANIMATION_VALUES, 'primary'),
    padding: '8px 16px',
  },
  select: {
    padding: '8px 12px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
    backgroundColor: COLORS.background,
    cursor: 'pointer',
    '&:focus': {
      borderColor: COLORS.primary,
      boxShadow: `0 0 0 3px ${COLORS.primaryLight}`,
    }
  },
};

// ============================================================================
// 6. 내보내기
// ============================================================================

// 기본 상수들
export { COLORS, BREAKPOINTS };

// 유틸리티 함수들
export { createFocusStyle, createButtonStyle };

// 모든 스타일 객체들은 이미 위에서 export됨

//공통 애니메이션 스타일 유틸리티

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
 * 슬라이드 인 애니메이션 스타일 (styles.js의 createSlideAnimation과 통합)
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
    ${animations[direction]}
    animation: slideIn ${duration}s ${ANIMATION_VALUES.EASE_OUT};
  `;
}

/**
 * 사이드바용 슬라이드 애니메이션 스타일 (styles.js와 호환)
 * @param {boolean} isOpen - 사이드바 열림 상태
 * @param {Object} animationValues - 애니메이션 값 객체
 * @param {number} translateX - X축 이동 거리
 * @returns {Object} 스타일 객체
 */
export function createSlideAnimation(isOpen, animationValues, translateX = -10) {
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

/**
 * 페이드 인 애니메이션 스타일
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
    animation: fadeIn ${duration}s ease-out;
  `;
}

/**
 * 스케일 인 애니메이션 스타일
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
 * 사이드바 애니메이션 스타일
 * @param {boolean} isOpen - 사이드바 열림 상태
 * @param {string} property - 애니메이션할 속성 ('width', 'opacity', 'transform')
 * @returns {string} CSS transition 문자열
 */
export function getSidebarAnimation(isOpen, property = 'all') {
  const duration = isOpen ? ANIMATION_VALUES.DURATION.SLOW : ANIMATION_VALUES.DURATION.NORMAL;
  const delay = isOpen ? '0.2s' : '0s';
  
  return `${property} ${duration} ${ANIMATION_VALUES.EASE_OUT} ${delay}`;
}

/**
 * 버튼 호버 애니메이션 스타일
 * @returns {string} CSS transition 문자열
 */
export function getButtonHoverAnimation() {
  return `all ${ANIMATION_VALUES.DURATION.FAST} ${ANIMATION_VALUES.EASE_OUT}`;
}

/**
 * 리플 애니메이션 관련 유틸리티
 */
export const rippleUtils = {
  /**
   * 리플 효과 생성
   * @param {Event} e - 클릭 이벤트
   * @param {HTMLElement} container - 컨테이너 요소
   * @returns {Object} 리플 정보 { id, x, y }
   */
  createRipple: (e, container) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now() + Math.random();
    return { id, x, y };
  },

  /**
   * 리플 스타일 생성
   * @param {Object} ripple - 리플 정보 { x, y }
   * @param {Object} options - 옵션 { size: 120, offset: 60 }
   * @returns {Object} 스타일 객체
   */
  getRippleStyle: (ripple, options = {}) => {
    const { size = 120, offset = 60 } = options;
    return {
      left: ripple.x - offset,
      top: ripple.y - offset,
      width: size,
      height: size,
    };
  },

  /**
   * 리플 제거 타이머 설정
   * @param {Function} setRipples - 리플 상태 설정 함수
   * @param {string} id - 리플 ID
   * @param {number} duration - 지속 시간 (ms)
   * @returns {Function} 타이머 정리 함수
   */
  removeRippleAfter: (setRipples, id, duration = 700) => {
    const timer = setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, duration);
    
    // 타이머 정리 함수 반환
    return () => clearTimeout(timer);
  },
};

/**
 * 여러 ref를 하나로 병합하는 유틸리티 함수
 * @param {...any} refs - 병합할 ref들 (함수형 ref, useRef 객체 등)
 * @returns {Function} 병합된 ref 함수
 */
export function mergeRefs(...refs) {
  return (element) => {
    refs.forEach(ref => {
      if (typeof ref === 'function') {
        ref(element);
      } else if (ref != null) {
        ref.current = element;
      }
    });
  };
}

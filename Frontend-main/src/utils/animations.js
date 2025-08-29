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
    ${animations[direction]}
    animation: slideIn ${duration}s ${ANIMATION_VALUES.EASE_OUT};
  `;
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

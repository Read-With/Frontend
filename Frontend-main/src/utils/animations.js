//공통 애니메이션 스타일 유틸리티

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
    animation: slideIn ${duration}s cubic-bezier(0.4, 0, 0.2, 1);
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
    animation: scaleIn ${duration}s cubic-bezier(0.4, 0, 0.2, 1);
  `;
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

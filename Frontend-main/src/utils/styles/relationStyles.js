import { getRelationColor } from './graphStyles';
import { COLORS, ANIMATION_VALUES, createButtonStyle } from './styles';

const styleCache = new Map();

// 하드코딩된 임계값
const HARDCODED_THRESHOLDS = {
  veryPositive: 0.6,   // 0.6 이상
  positive: 0.2,       // 0.2 이상
  neutral: -0.2,       // -0.2 이상
  negative: -0.6       // -0.6 이상
};

/**
 * positivity 값을 기반으로 관계 스타일 계산
 * @param {number} positivity - 관계의 긍정성 값
 * @returns {Object} 스타일 객체
 */
function calculateStyle(positivity) {
  const value = typeof positivity === 'number' && !Number.isNaN(positivity)
    ? Math.max(-1, Math.min(1, positivity))
    : 0;
  
  const color = getRelationColor(value);
  
  if (value >= HARDCODED_THRESHOLDS.veryPositive) return { color, text: "매우 긍정적" };
  if (value >= HARDCODED_THRESHOLDS.positive) return { color, text: "긍정적" };
  if (value >= HARDCODED_THRESHOLDS.neutral) return { color, text: "중립적" };
  if (value >= HARDCODED_THRESHOLDS.negative) return { color, text: "부정적" };
  return { color, text: "매우 부정적" };
}

/**
 * positivity 값을 기반으로 관계 스타일 가져오기
 * @param {number} positivity - 관계의 긍정성 값
 * @returns {Object} 스타일 객체
 */
export function getRelationStyle(positivity) {
  const key = Math.round(positivity * 100) / 100;
  
  if (styleCache.has(key)) {
    return styleCache.get(key);
  }
  
  const result = calculateStyle(positivity);
  styleCache.set(key, result);
  return result;
}

/** 관계 색상/라벨 단일 소스. 노드·엣지 툴팁 등에서 사용 */
export function getPositivityColor(positivity) {
  const value = (positivity === undefined || positivity === null || isNaN(positivity)) ? 0 : positivity;
  return getRelationStyle(value).color;
}

export function getPositivityLabel(positivity) {
  if (positivity === undefined || positivity === null || isNaN(positivity)) return '정보 없음';
  return getRelationStyle(positivity).text;
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
      return relation.filter(item => typeof item === 'string' && item.trim());
    }
    
    if (typeof label === 'string') {
      return label.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

/**
 * 툴팁 기본 스타일 설정
 */
export const tooltipStyles = {
  container: {
    position: "fixed",
    zIndex: 99999,
    width: "500px",
    perspective: '1200px',
  },
  flipInner: {
    position: 'relative',
    width: '100%',
    minHeight: 360,
    height: 360,
    transition: `transform ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
    transformStyle: 'preserve-3d',
  },
  front: {
    backfaceVisibility: 'hidden',
    position: 'absolute',
    width: '100%',
    height: 360,
    minHeight: 360,
    top: 0,
    left: 0,
  },
  back: {
    backfaceVisibility: 'hidden',
    transform: 'rotateY(180deg)',
    position: 'absolute',
    width: '100%',
    height: 360,
    minHeight: 360,
    top: 0,
    left: 0,
  },
  header: {
    background: COLORS.white,
    borderBottom: 'none',
    padding: '0.75rem',
  },
  relationTag: {
    background: COLORS.borderLight,
    color: COLORS.textPrimary,
    borderRadius: '0.5rem',
    padding: '0.25rem 0.75rem',
    fontSize: '0.8125rem',
    fontWeight: 500,
    display: 'inline-block',
    lineHeight: 1.2,
  },
  progressBar: {
    width: 80,
    height: 20,
    borderRadius: '0.375rem',
    opacity: 1,
    transition: `background ${ANIMATION_VALUES.DURATION.NORMAL}`,
    border: `1.5px solid ${COLORS.border}`,
    boxSizing: "border-box",
    marginBottom: 0,
  },
  button: {
    primary: createButtonStyle(ANIMATION_VALUES, 'primaryEdge'),
    secondary: createButtonStyle(ANIMATION_VALUES, 'secondaryEdge'),
  },
};

/**
 * 스타일 캐시 정리 함수
 * @returns {void}
 */
export function clearStyleCache() {
  styleCache.clear();
}

/**
 * 모든 관계 스타일 관련 리소스 정리 함수
 * @returns {void}
 */
export function cleanupRelationStyleResources() {
  clearStyleCache();
}

/**
 * 현재 임계값 정보를 반환하는 디버깅 함수
 * @returns {Object} 현재 임계값 정보
 */
export function getClassificationInfo() {
  return {
    thresholds: { ...HARDCODED_THRESHOLDS },
    cacheSize: styleCache.size
  };
}

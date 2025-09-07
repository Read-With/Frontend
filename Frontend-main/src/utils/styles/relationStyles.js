import { getRelationColor } from './graphStyles';
const styleCache = new Map();

// 데이터 기반 동적 분류를 위한 통계 정보 (실제 데이터 분석 결과)
const POSITIVITY_STATS = {
  mean: 0.148,
  std: 0.451,
  percentiles: {
    p10: -0.3,
    p25: -0.2,
    p50: 0.27,
    p75: 0.5,
    p90: 0.59
  }
};

function calculateDynamicThresholds() {
  const { mean, std, percentiles } = POSITIVITY_STATS;
  
  // Z-score 기반 임계값 (표준편차의 배수)
  const zThresholds = {
    veryPositive: mean + 1.5 * std,  // Z > 1.5
    positive: mean + 0.5 * std,      // Z > 0.5
    neutral: mean - 0.5 * std,       // Z > -0.5
    negative: mean - 1.5 * std       // Z > -1.5
  };
  
  // 백분위수 기반 임계값
  const percentileThresholds = {
    veryPositive: percentiles.p90,   // 상위 10%
    positive: percentiles.p75,       // 상위 25%
    neutral: percentiles.p25,        // 하위 25%
    negative: percentiles.p10        // 하위 10%
  };
  
  // 두 방법을 결합 (가중 평균)
  return {
    veryPositive: (zThresholds.veryPositive + percentileThresholds.veryPositive) / 2,
    positive: (zThresholds.positive + percentileThresholds.positive) / 2,
    neutral: (zThresholds.neutral + percentileThresholds.neutral) / 2,
    negative: (zThresholds.negative + percentileThresholds.negative) / 2
  };
}

function calculateStyle(positivity) {
  const value = typeof positivity === 'number' && !Number.isNaN(positivity)
    ? Math.max(-1, Math.min(1, positivity))
    : 0;
  
  const color = getRelationColor(value);
  const thresholds = calculateDynamicThresholds();
  
  if (value >= thresholds.veryPositive) return { color, text: "매우 긍정적" };
  if (value >= thresholds.positive) return { color, text: "긍정적" };
  if (value >= thresholds.neutral) return { color, text: "중립적" };
  if (value >= thresholds.negative) return { color, text: "부정적" };
  return { color, text: "매우 부정적" };
}

export function getRelationStyle(positivity) {
  // 소수점 2자리로 반올림하여 캐시 키 생성
  const key = Math.round(positivity * 100) / 100;
  
  if (styleCache.has(key)) {
    return styleCache.get(key);
  }
  
  const result = calculateStyle(positivity);
  styleCache.set(key, result);
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
      return relation.filter(item => typeof item === 'string' && item.trim());
    }
    
    if (typeof label === 'string') {
      return label.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    return [];
  } catch (error) {
    console.warn('getRelationLabels 에러:', error);
    return [];
  }
}

/**
 * 툴팁 기본 스타일 설정
 */
export const tooltipStyles = {
  container: {
    position: "fixed",
    zIndex: 9999,
    width: "500px",
    perspective: '1200px',
  },
  flipInner: {
    position: 'relative',
    width: '100%',
    minHeight: 360,
    height: 360,
    transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)',
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
    background: '#fff',
    borderBottom: 'none',
    padding: '20px',
  },
  relationTag: {
    background: '#e3e6ef',
    color: '#42506b',
    borderRadius: '8px',
    padding: '4px 12px',
    fontSize: '13px',
    fontWeight: 500,
    display: 'inline-block',
    lineHeight: 1.2,
  },
  progressBar: {
    width: 80,
    height: 24,
    borderRadius: 6,
    opacity: 1,
    transition: "background 0.3s",
    border: "1.5px solid #e5e7eb",
    boxSizing: "border-box",
    marginBottom: 0,
  },
  button: {
    primary: {
      background: '#6C8EFF',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '8px 22px',
      fontWeight: 600,
      fontSize: 15,
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(108, 142, 255, 0.2)',
      transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
      margin: '0 auto',
      display: 'inline-block',
    },
    secondary: {
      background: '#fff',
      color: '#6C8EFF',
      border: '1.5px solid #6C8EFF',
      borderRadius: 8,
      padding: '8px 22px',
      fontWeight: 600,
      fontSize: 15,
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(108, 142, 255, 0.2)',
      transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
      margin: '0 auto',
      display: 'inline-block',
    },
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

import { getRelationColor } from './graphStyles';
import { getFolderKeyFromFilename, collectPositivityValues } from '../graphData';

const styleCache = new Map();

// filename별 통계 정보 캐시
const statsCache = new Map();

// 기본 통계 정보 (fallback용)
const DEFAULT_STATS = {
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


/**
 * 숫자 배열에서 통계 정보 계산
 * @param {number[]} values - 숫자 배열
 * @returns {Object} 통계 정보
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return DEFAULT_STATS;
  }
  
  const sortedValues = [...values].sort((a, b) => a - b);
  const count = sortedValues.length;
  
  // 평균 계산
  const mean = values.reduce((sum, val) => sum + val, 0) / count;
  
  // 표준편차 계산
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
  const std = Math.sqrt(variance);
  
  // 백분위수 계산
  const percentiles = {
    p10: sortedValues[Math.floor(count * 0.1)],
    p25: sortedValues[Math.floor(count * 0.25)],
    p50: sortedValues[Math.floor(count * 0.5)],
    p75: sortedValues[Math.floor(count * 0.75)],
    p90: sortedValues[Math.floor(count * 0.9)]
  };
  
  return { mean, std, percentiles };
}

/**
 * 특정 책의 통계 정보를 가져오거나 계산
 * @param {string} filename - 파일명
 * @returns {Object} 통계 정보
 */
export function getPositivityStats(filename) {
  const folderKey = getFolderKeyFromFilename(filename);
  
  // 캐시에서 확인
  if (statsCache.has(folderKey)) {
    return statsCache.get(folderKey);
  }
  
  // 데이터 수집 및 통계 계산 (동기 버전)
  const positivityValues = collectPositivityValues(folderKey);
  const stats = calculateStats(positivityValues);
  
  // 캐시에 저장
  statsCache.set(folderKey, stats);
  
  console.log(`Calculated stats for ${folderKey}:`, {
    count: positivityValues.length,
    mean: stats.mean.toFixed(3),
    std: stats.std.toFixed(3),
    percentiles: Object.fromEntries(
      Object.entries(stats.percentiles).map(([k, v]) => [k, v.toFixed(3)])
    )
  });
  
  return stats;
}

// filename별 임계값 캐시
const thresholdsCache = new Map();

/**
 * 특정 책의 통계 정보를 기반으로 동적 임계값 계산
 * @param {Object} stats - 통계 정보
 * @returns {Object} 임계값 객체
 */
function calculateDynamicThresholds(stats) {
  const { mean, std, percentiles } = stats;
  
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

/**
 * filename과 positivity 값을 기반으로 관계 스타일 계산
 * @param {number} positivity - 관계의 긍정성 값
 * @param {string} filename - 파일명
 * @returns {Object} 스타일 객체
 */
function calculateStyle(positivity, filename) {
  const value = typeof positivity === 'number' && !Number.isNaN(positivity)
    ? Math.max(-1, Math.min(1, positivity))
    : 0;
  
  const color = getRelationColor(value);
  
  // filename 기반 통계 정보 가져오기
  const stats = getPositivityStats(filename);
  const thresholds = calculateDynamicThresholds(stats);
  
  if (value >= thresholds.veryPositive) return { color, text: "매우 긍정적" };
  if (value >= thresholds.positive) return { color, text: "긍정적" };
  if (value >= thresholds.neutral) return { color, text: "중립적" };
  if (value >= thresholds.negative) return { color, text: "부정적" };
  return { color, text: "매우 부정적" };
}

/**
 * filename과 positivity 값을 기반으로 관계 스타일 가져오기
 * @param {number} positivity - 관계의 긍정성 값
 * @param {string} filename - 파일명 (선택사항, 없으면 기본값 사용)
 * @returns {Object} 스타일 객체
 */
export function getRelationStyle(positivity, filename = 'gatsby.epub') {
  const folderKey = getFolderKeyFromFilename(filename);
  const key = `${folderKey}_${Math.round(positivity * 100) / 100}`;
  
  if (styleCache.has(key)) {
    return styleCache.get(key);
  }
  
  const result = calculateStyle(positivity, filename);
  styleCache.set(key, result);
  return result;
}

/**
 * 동기 버전의 관계 스타일 가져오기 (기본 통계 사용)
 * @param {number} positivity - 관계의 긍정성 값
 * @returns {Object} 스타일 객체
 */
export function getRelationStyleSync(positivity) {
  const value = typeof positivity === 'number' && !Number.isNaN(positivity)
    ? Math.max(-1, Math.min(1, positivity))
    : 0;
  
  const color = getRelationColor(value);
  const thresholds = calculateDynamicThresholds(DEFAULT_STATS);
  
  if (value >= thresholds.veryPositive) return { color, text: "매우 긍정적" };
  if (value >= thresholds.positive) return { color, text: "긍정적" };
  if (value >= thresholds.neutral) return { color, text: "중립적" };
  if (value >= thresholds.negative) return { color, text: "부정적" };
  return { color, text: "매우 부정적" };
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
    zIndex: 99999,
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
 * @param {string} filename - 특정 책의 캐시만 정리 (선택사항)
 * @returns {void}
 */
export function clearStyleCache(filename = null) {
  if (filename) {
    const folderKey = getFolderKeyFromFilename(filename);
    // 특정 책의 캐시만 정리
    for (const key of styleCache.keys()) {
      if (key.startsWith(`${folderKey}_`)) {
        styleCache.delete(key);
      }
    }
    statsCache.delete(folderKey);
    thresholdsCache.delete(folderKey);
  } else {
    // 모든 캐시 정리
    styleCache.clear();
    statsCache.clear();
    thresholdsCache.clear();
  }
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
 * @param {string} filename - 파일명 (선택사항)
 * @returns {Object} 현재 임계값과 통계 정보
 */
export function getClassificationInfo(filename = 'gatsby.epub') {
  const folderKey = getFolderKeyFromFilename(filename);
  const stats = getPositivityStats(filename);
  const thresholds = calculateDynamicThresholds(stats);
  
  return {
    folderKey,
    stats: { ...stats },
    thresholds: { ...thresholds },
    cacheSize: styleCache.size,
    statsCacheSize: statsCache.size
  };
}

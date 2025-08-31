// [관계 그래프에서 긍정도에 따른 색상/라벨 변환과 툴팁 UI 스타일링]
// 1. getRelationStyle(positivity) → 관계의 긍정도(-1 ~ 1)에 따라 **색상(HSL 그라데이션)과 텍스트(긍정적/우호적/중립적/비우호적/부정적)**을 결정
// 2. getRelationLabels(relation, label) → 관계 데이터가 배열이면 그대로 반환, 문자열이면 ,로 분리해 라벨 배열로 변환
// 3. tooltipStyles → 관계 툴팁(카드) UI의 기본 CSS 스타일 세트 정의 (컨테이너, 플립 카드(front/back), 헤더, 관계 태그, 프로그레스바, 버튼 등)

// graphStyles.js에서 색상 계산 함수 import (중복 제거)
import { getRelationColor } from './graphStyles';

// 스타일 캐싱을 위한 Map
const styleCache = new Map();

/**
 * 긍정도에 따른 스타일 계산 (내부 함수)
 * @param {number} positivity - 긍정도 값 (-1 ~ 1)
 * @returns {Object} 스타일 객체 { color, text }
 */
function calculateStyle(positivity) {
  // 입력 가드 및 범위 클램프
  const value = typeof positivity === 'number' && !Number.isNaN(positivity)
    ? Math.max(-1, Math.min(1, positivity))
    : 0;
  
  // 색상: graphStyles.js의 통합된 함수 사용
  const color = getRelationColor(value);
  
  // 텍스트 분류는 기존 방식 유지
  if (value > 0.6) return { color, text: "긍정적" };
  if (value > 0.3) return { color, text: "우호적" };
  if (value > -0.3) return { color, text: "중립적" };
  if (value > -0.6) return { color, text: "비우호적" };
  return { color, text: "부정적" };
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
    zIndex: 9999, // 기본값, 컴포넌트에서 오버라이드 가능
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
      background: '#2563eb',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '8px 22px',
      fontWeight: 600,
      fontSize: 15,
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
      transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
      margin: '0 auto',
      display: 'inline-block',
    },
    secondary: {
      background: '#fff',
      color: '#2563eb',
      border: '1.5px solid #2563eb',
      borderRadius: 8,
      padding: '8px 22px',
      fontWeight: 600,
      fontSize: 15,
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
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
  console.log('🧹 스타일 캐시 정리 완료');
}

/**
 * 모든 관계 스타일 관련 리소스 정리 함수
 * @returns {void}
 */
export function cleanupRelationStyleResources() {
  clearStyleCache();
  console.log('🧹 모든 관계 스타일 리소스 정리 완료');
}

import { clearStyleCache, cleanupRelationStyleResources } from './relationStyles';
import { clearRelationCache, cleanupRelationResources } from './relationUtils';
import { clearRegexCache, cleanupSearchResources } from './searchUtils';
import { clearAllCaches, clearCache, cleanupUnusedCaches, getCacheStats as getCacheStatsFromManager } from './cacheManager';

export function cleanupAllUtils(cy = null) {
  clearAllCaches();
  cleanupSearchResources(cy);
}

export function cleanupRelationUtils() {
  clearCache('relationCache');
  clearCache('styleCache');
}

/**
 * 검색 관련 리소스만 정리
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupSearchUtils(cy = null) {
  clearCache('regexCache');
  cleanupSearchResources(cy);
}

/**
 * 스타일 관련 리소스만 정리
 * @returns {void}
 */
export function cleanupStyleUtils() {
  clearCache('styleCache');
}

/**
 * 메모리 최적화를 위한 사용하지 않는 캐시 정리
 * @param {number} maxAge - 최대 나이 (ms, 기본값: 10분)
 * @returns {void}
 */
export function cleanupUnusedUtils(maxAge = 600000) {
  cleanupUnusedCaches(maxAge);
}

/**
 * 특정 캐시만 정리
 * @param {string} cacheName - 캐시 이름
 * @returns {void}
 */
export function cleanupSpecificCache(cacheName) {
  clearCache(cacheName);
}

/**
 * 캐시 통계 정보 반환
 * @returns {Object} 캐시 통계
 */
export function getCacheStats() {
  return getCacheStatsFromManager();
}

/**
 * 모든 유틸리티 파일의 캐시 및 리소스 정리 함수들을 통합
 */

// 각 유틸리티 파일에서 정리 함수들 import
import { clearStyleCache, cleanupRelationStyleResources } from './relationStyles';
import { clearRelationCache, cleanupRelationResources } from './relationUtils';
import { clearRegexCache, cleanupSearchResources } from './searchUtils';

/**
 * 모든 유틸리티 캐시 및 리소스 정리
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupAllUtils(cy = null) {
  console.log('🧹 모든 유틸리티 리소스 정리 시작...');
  
  // 관계 스타일 캐시 정리
  clearStyleCache();
  
  // 관계 유틸리티 캐시 정리
  clearRelationCache();
  
  // 검색 유틸리티 캐시 정리
  clearRegexCache();
  
  // 검색 관련 리소스 정리 (Cytoscape 효과 포함)
  cleanupSearchResources(cy);
  
  console.log('✅ 모든 유틸리티 리소스 정리 완료');
}

/**
 * 관계 관련 리소스만 정리
 * @returns {void}
 */
export function cleanupRelationUtils() {
  console.log('🧹 관계 관련 리소스 정리 시작...');
  
  clearStyleCache();
  clearRelationCache();
  
  console.log('✅ 관계 관련 리소스 정리 완료');
}

/**
 * 검색 관련 리소스만 정리
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupSearchUtils(cy = null) {
  console.log('🧹 검색 관련 리소스 정리 시작...');
  
  clearRegexCache();
  cleanupSearchResources(cy);
  
  console.log('✅ 검색 관련 리소스 정리 완료');
}

/**
 * 스타일 관련 리소스만 정리
 * @returns {void}
 */
export function cleanupStyleUtils() {
  console.log('🧹 스타일 관련 리소스 정리 시작...');
  
  clearStyleCache();
  
  console.log('✅ 스타일 관련 리소스 정리 완료');
}

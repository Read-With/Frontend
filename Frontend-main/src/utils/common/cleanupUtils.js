import { clearStyleCache, cleanupRelationStyleResources } from '../styles/relationStyles';
import { clearRelationCache, cleanupRelationResources } from '../relationUtils';
import { clearRegexCache, cleanupSearchResources } from '../searchUtils';
import { clearAllCaches, clearCache, cleanupUnusedCaches, getCacheStats as getCacheStatsFromManager } from './cache/cacheManager';

/**
 * 모든 유틸리티 리소스 정리
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupAllUtils(cy = null) {
  try {
    // 모든 캐시 정리
    clearAllCaches();
    
    // 각 유틸리티별 리소스 정리
    cleanupSearchResources(cy);
    cleanupRelationStyleResources();
    cleanupRelationResources();
  } catch (error) {
    console.error('전체 유틸리티 정리 실패:', error);
  }
}

/**
 * 관계(Relation) 관련 유틸리티 정리
 * @returns {void}
 */
export function cleanupRelationUtils() {
  try {
    // 관계 관련 캐시 정리
    clearRelationCache();
    clearStyleCache();
    
    // 관계 관련 리소스 정리
    cleanupRelationResources();
    cleanupRelationStyleResources();
  } catch (error) {
    console.error('관계 유틸리티 정리 실패:', error);
  }
}

/**
 * 검색 관련 유틸리티 정리
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupSearchUtils(cy = null) {
  try {
    // 검색 관련 캐시 정리
    clearRegexCache();
    
    // 검색 관련 리소스 정리
    cleanupSearchResources(cy);
  } catch (error) {
    console.error('검색 유틸리티 정리 실패:', error);
  }
}

/**
 * 스타일 관련 유틸리티 정리
 * @returns {void}
 */
export function cleanupStyleUtils() {
  try {
    // 스타일 관련 캐시 정리
    clearStyleCache();
    
    // 스타일 관련 리소스 정리
    cleanupRelationStyleResources();
  } catch (error) {
    console.error('스타일 유틸리티 정리 실패:', error);
  }
}

/**
 * 메모리 최적화를 위한 사용하지 않는 캐시 정리
 * @param {number} maxAge - 최대 나이 (ms, 기본값: 10분)
 * @returns {void}
 */
export function cleanupUnusedUtils(maxAge = 600000) {
  try {
    cleanupUnusedCaches(maxAge);
  } catch (error) {
    console.error('사용하지 않는 캐시 정리 실패:', error);
  }
}

/**
 * 특정 캐시만 정리
 * @param {string} cacheName - 캐시 이름
 * @returns {boolean} 정리 성공 여부
 */
export function cleanupSpecificCache(cacheName) {
  try {
    if (!cacheName || typeof cacheName !== 'string') {
      throw new Error('유효한 캐시 이름이 필요합니다');
    }
    
    clearCache(cacheName);
    return true;
  } catch (error) {
    console.error(`특정 캐시 정리 실패 (${cacheName}):`, error);
    return false;
  }
}

/**
 * 캐시 통계 정보 반환
 * @returns {Object} 캐시 통계
 */
export function getCacheStats() {
  try {
    return getCacheStatsFromManager();
  } catch (error) {
    console.error('캐시 통계 조회 실패:', error);
    return {};
  }
}

/**
 * 메모리 상태 진단 및 정리 권장사항 제공
 * @returns {Object} 진단 결과 및 권장사항
 */
export function diagnoseMemoryUsage() {
  try {
    const stats = getCacheStatsFromManager();
    const recommendations = [];
    
    // 캐시 크기 분석
    Object.entries(stats).forEach(([name, info]) => {
      if (info.size > 100) {
        recommendations.push(`${name} 캐시가 큽니다 (${info.size}개 항목)`);
      }
      if (info.age > 300000) { // 5분 이상
        recommendations.push(`${name} 캐시가 오래되었습니다 (${Math.round(info.age / 60000)}분)`);
      }
    });
    
    return {
      stats,
      recommendations,
      shouldCleanup: recommendations.length > 0
    };
  } catch (error) {
    console.error('메모리 진단 실패:', error);
    return { stats: {}, recommendations: [], shouldCleanup: false };
  }
}

/**
 * 안전한 정리 실행 (진단 후 필요시에만 정리)
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {Object} 정리 결과
 */
export function safeCleanup(cy = null) {
  try {
    const diagnosis = diagnoseMemoryUsage();
    
    if (diagnosis.shouldCleanup) {
      cleanupUnusedUtils();
      return {
        success: true,
        message: '메모리 최적화가 실행되었습니다',
        diagnosis
      };
    } else {
      return {
        success: true,
        message: '정리가 필요하지 않습니다',
        diagnosis
      };
    }
  } catch (error) {
    console.error('안전한 정리 실행 실패:', error);
    return {
      success: false,
      message: '정리 실행 중 오류가 발생했습니다',
      error: error.message
    };
  }
}

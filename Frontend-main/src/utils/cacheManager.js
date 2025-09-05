// 캐시 관리 시스템

// 캐시 등록부
const cacheRegistry = new Map();

/**
 * 캐시 등록
 * @param {string} name - 캐시 이름
 * @param {Map|Object} cache - 캐시 객체
 * @param {Object} options - 캐시 옵션
 */
export function registerCache(name, cache, options = {}) {
  const cacheInfo = {
    cache,
    options: {
      maxSize: options.maxSize || 1000,
      ttl: options.ttl || null, // Time To Live (ms)
      cleanupInterval: options.cleanupInterval || 300000, // 5분
      ...options
    },
    lastAccess: Date.now(),
    accessCount: 0
  };
  
  cacheRegistry.set(name, cacheInfo);
  
  // TTL이 설정된 경우 정리 타이머 설정
  if (cacheInfo.options.ttl) {
    setupCleanupTimer(name, cacheInfo);
  }
}

/**
 * 캐시 접근 기록
 * @param {string} name - 캐시 이름
 */
export function recordCacheAccess(name) {
  const cacheInfo = cacheRegistry.get(name);
  if (cacheInfo) {
    cacheInfo.lastAccess = Date.now();
    cacheInfo.accessCount++;
  }
}

/**
 * 캐시 크기 제한 적용
 * @param {string} name - 캐시 이름
 */
export function enforceCacheSizeLimit(name) {
  const cacheInfo = cacheRegistry.get(name);
  if (!cacheInfo) return;
  
  const { cache, options } = cacheInfo;
  if (cache.size && cache.size > options.maxSize) {
    // LRU 방식으로 오래된 항목 제거
    const entries = Array.from(cache.entries());
    const toRemove = entries.slice(0, cache.size - options.maxSize);
    
    for (const [key] of toRemove) {
      cache.delete(key);
    }
  }
}

/**
 * TTL 기반 캐시 정리 타이머 설정
 * @param {string} name - 캐시 이름
 * @param {Object} cacheInfo - 캐시 정보
 */
function setupCleanupTimer(name, cacheInfo) {
  const interval = setInterval(() => {
    const now = Date.now();
    const { cache, options } = cacheInfo;
    
    if (cache.size) {
      for (const [key, value] of cache.entries()) {
        if (value.timestamp && (now - value.timestamp) > options.ttl) {
          cache.delete(key);
        }
      }
    }
  }, cacheInfo.options.cleanupInterval);
  
  // 타이머 참조 저장 (나중에 정리용)
  cacheInfo.cleanupTimer = interval;
}

/**
 * 특정 캐시 정리
 * @param {string} name - 캐시 이름
 */
export function clearCache(name) {
  const cacheInfo = cacheRegistry.get(name);
  if (cacheInfo) {
    const { cache, cleanupTimer } = cacheInfo;
    
    // 캐시 정리
    if (cache.clear) {
      cache.clear();
    } else if (cache.size !== undefined) {
      // Map이 아닌 경우
      for (const key of Object.keys(cache)) {
        delete cache[key];
      }
    }
    
    // 타이머 정리
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
    
    // 접근 기록 초기화
    cacheInfo.lastAccess = Date.now();
    cacheInfo.accessCount = 0;
  }
}

/**
 * 모든 캐시 정리
 */
export function clearAllCaches() {
  for (const [name] of cacheRegistry) {
    clearCache(name);
  }
}

/**
 * 사용하지 않는 캐시 정리 (메모리 최적화)
 * @param {number} maxAge - 최대 나이 (ms)
 */
export function cleanupUnusedCaches(maxAge = 600000) { // 10분
  const now = Date.now();
  
  for (const [name, cacheInfo] of cacheRegistry) {
    if ((now - cacheInfo.lastAccess) > maxAge) {
      clearCache(name);
    }
  }
}

/**
 * 캐시 통계 정보 반환
 * @returns {Object} 캐시 통계
 */
export function getCacheStats() {
  const stats = {};
  
  for (const [name, cacheInfo] of cacheRegistry) {
    const { cache, lastAccess, accessCount } = cacheInfo;
    stats[name] = {
      size: cache.size || Object.keys(cache).length,
      lastAccess: new Date(lastAccess).toISOString(),
      accessCount,
      age: Date.now() - lastAccess
    };
  }
  
  return stats;
}

/**
 * 캐시 등록 해제
 * @param {string} name - 캐시 이름
 */
export function unregisterCache(name) {
  clearCache(name);
  cacheRegistry.delete(name);
}

// 페이지 언로드 시 모든 캐시 정리
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', clearAllCaches);
}

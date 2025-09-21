const cacheRegistry = new Map();

/**
 * 캐시 등록 (타이머 중복 생성 방지)
 * @param {string} name - 캐시 이름
 * @param {Map|Object} cache - 캐시 객체
 * @param {Object} options - 캐시 옵션
 */
export function registerCache(name, cache, options = {}) {
  try {
    // 기존 캐시가 있으면 먼저 정리
    if (cacheRegistry.has(name)) {
      clearCache(name);
    }

    const cacheInfo = {
      cache,
      options: {
        maxSize: options.maxSize || 1000,
        ttl: options.ttl || null, // Time To Live (ms)
        cleanupInterval: options.cleanupInterval || 300000, // 5분
        ...options
      },
      lastAccess: Date.now(),
      accessCount: 0,
      cleanupTimer: null // 타이머 참조 초기화
    };
    
    cacheRegistry.set(name, cacheInfo);
    
    // TTL이 설정된 경우 정리 타이머 설정
    if (cacheInfo.options.ttl) {
      setupCleanupTimer(name, cacheInfo);
    }
  } catch (error) {
    console.error(`캐시 등록 실패 (${name}):`, error);
    throw error;
  }
}

/**
 * 캐시 접근 기록
 * @param {string} name - 캐시 이름
 */
export function recordCacheAccess(name) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (cacheInfo) {
      cacheInfo.lastAccess = Date.now();
      cacheInfo.accessCount++;
    }
  } catch (error) {
    console.error(`캐시 접근 기록 실패 (${name}):`, error);
  }
}

/**
 * 캐시 크기 제한 적용 (진정한 LRU 구현)
 * @param {string} name - 캐시 이름
 */
export function enforceCacheSizeLimit(name) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return;
    
    const { cache, options } = cacheInfo;
    const currentSize = cache.size || Object.keys(cache).length;
    
    if (currentSize > options.maxSize) {
      // 진정한 LRU 구현: 접근 시간 기준으로 정렬
      const entries = Array.from(cache.entries());
      
      // 각 항목의 접근 시간을 기준으로 정렬 (오래된 것부터)
      entries.sort((a, b) => {
        const aTime = (a[1] && a[1].lastAccess) ? a[1].lastAccess : 0;
        const bTime = (b[1] && b[1].lastAccess) ? b[1].lastAccess : 0;
        return aTime - bTime;
      });
      
      // 제거할 항목 수 계산
      const toRemove = entries.slice(0, currentSize - options.maxSize);
      
      // 오래된 항목들 제거
      for (const [key] of toRemove) {
        if (cache.delete) {
          cache.delete(key);
        } else {
          delete cache[key];
        }
      }
    }
  } catch (error) {
    console.error(`캐시 크기 제한 적용 실패 (${name}):`, error);
  }
}

/**
 * TTL 기반 캐시 정리 타이머 설정
 * @param {string} name - 캐시 이름
 * @param {Object} cacheInfo - 캐시 정보
 */
function setupCleanupTimer(name, cacheInfo) {
  try {
    // 기존 타이머가 있으면 정리
    if (cacheInfo.cleanupTimer) {
      clearInterval(cacheInfo.cleanupTimer);
    }

    const interval = setInterval(() => {
      try {
        const now = Date.now();
        const { cache, options } = cacheInfo;
        
        if (cache.size) {
          for (const [key, value] of cache.entries()) {
            // 타입 안전성 강화: timestamp 속성 존재 확인
            if (value && typeof value === 'object' && value.timestamp && 
                (now - value.timestamp) > options.ttl) {
              if (cache.delete) {
                cache.delete(key);
              } else {
                delete cache[key];
              }
            }
          }
        }
      } catch (error) {
        console.error(`TTL 캐시 정리 중 오류 (${name}):`, error);
      }
    }, cacheInfo.options.cleanupInterval);
    
    // 타이머 참조 저장 (나중에 정리용)
    cacheInfo.cleanupTimer = interval;
  } catch (error) {
    console.error(`캐시 타이머 설정 실패 (${name}):`, error);
  }
}

/**
 * 특정 캐시 정리
 * @param {string} name - 캐시 이름
 */
export function clearCache(name) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return;
    
    const { cache, cleanupTimer } = cacheInfo;
    
    // 캐시 정리
    if (cache && typeof cache.clear === 'function') {
      cache.clear();
    } else if (cache && typeof cache === 'object') {
      // Map이 아닌 경우
      for (const key of Object.keys(cache)) {
        delete cache[key];
      }
    }
    
    // 타이머 정리
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cacheInfo.cleanupTimer = null; // 참조 초기화
    }
    
    // 접근 기록 초기화
    cacheInfo.lastAccess = Date.now();
    cacheInfo.accessCount = 0;
  } catch (error) {
    console.error(`캐시 정리 실패 (${name}):`, error);
  }
}

/**
 * 모든 캐시 정리
 */
export function clearAllCaches() {
  try {
    for (const [name] of cacheRegistry) {
      clearCache(name);
    }
  } catch (error) {
    console.error('모든 캐시 정리 실패:', error);
  }
}

/**
 * 사용하지 않는 캐시 정리 (메모리 최적화)
 * @param {number} maxAge - 최대 나이 (ms)
 */
export function cleanupUnusedCaches(maxAge = 600000) { // 10분
  try {
    const now = Date.now();
    
    for (const [name, cacheInfo] of cacheRegistry) {
      if ((now - cacheInfo.lastAccess) > maxAge) {
        clearCache(name);
      }
    }
  } catch (error) {
    console.error('사용하지 않는 캐시 정리 실패:', error);
  }
}

/**
 * 캐시 통계 정보 반환
 * @returns {Object} 캐시 통계
 */
export function getCacheStats() {
  try {
    const stats = {};
    
    for (const [name, cacheInfo] of cacheRegistry) {
      const { cache, lastAccess, accessCount } = cacheInfo;
      const cacheSize = cache && typeof cache.size === 'number' 
        ? cache.size 
        : (cache && typeof cache === 'object' ? Object.keys(cache).length : 0);
        
      stats[name] = {
        size: cacheSize,
        lastAccess: new Date(lastAccess).toISOString(),
        accessCount: accessCount || 0,
        age: Date.now() - lastAccess,
        hasTimer: !!cacheInfo.cleanupTimer
      };
    }
    
    return stats;
  } catch (error) {
    console.error('캐시 통계 조회 실패:', error);
    return {};
  }
}

/**
 * 캐시 등록 해제
 * @param {string} name - 캐시 이름
 */
export function unregisterCache(name) {
  try {
    clearCache(name);
    cacheRegistry.delete(name);
  } catch (error) {
    console.error(`캐시 등록 해제 실패 (${name}):`, error);
  }
}

/**
 * 캐시 항목 접근 시 LRU 업데이트
 * @param {string} name - 캐시 이름
 * @param {string} key - 캐시 키
 * @returns {*} 캐시 값
 */
export function getCacheItem(name, key) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return undefined;
    
    const { cache } = cacheInfo;
    const value = cache.get ? cache.get(key) : cache[key];
    
    if (value !== undefined) {
      // 접근 기록 업데이트
      recordCacheAccess(name);
      
      // LRU를 위한 접근 시간 업데이트
      if (value && typeof value === 'object') {
        value.lastAccess = Date.now();
      }
    }
    
    return value;
  } catch (error) {
    console.error(`캐시 항목 조회 실패 (${name}, ${key}):`, error);
    return undefined;
  }
}

/**
 * 캐시 항목 설정 시 LRU 업데이트
 * @param {string} name - 캐시 이름
 * @param {string} key - 캐시 키
 * @param {*} value - 캐시 값
 */
export function setCacheItem(name, key, value) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return false;
    
    const { cache } = cacheInfo;
    
    // LRU를 위한 접근 시간 추가
    const cacheValue = {
      ...value,
      lastAccess: Date.now()
    };
    
    if (cache.set) {
      cache.set(key, cacheValue);
    } else {
      cache[key] = cacheValue;
    }
    
    // 접근 기록 업데이트
    recordCacheAccess(name);
    
    // 크기 제한 적용
    enforceCacheSizeLimit(name);
    
    return true;
  } catch (error) {
    console.error(`캐시 항목 설정 실패 (${name}, ${key}):`, error);
    return false;
  }
}

// 페이지 언로드 시 모든 캐시 정리
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', clearAllCaches);
}

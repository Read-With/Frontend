const cacheRegistry = new Map();

export function getStorage(storageType = 'localStorage') {
  if (typeof window === 'undefined') return null;
  return storageType === 'sessionStorage' ? sessionStorage : localStorage;
}

function deleteFromCache(cache, key) {
  if (!cache) return;
  if (cache.delete) {
    cache.delete(key);
  } else {
    delete cache[key];
  }
}

export function loadFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return null;
  
  try {
    const stored = storage.getItem(storageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      storage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch (error) {
    storage.removeItem(storageKey);
    return null;
  }
}

export function saveToStorage(storageKey, data, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return;
  
  try {
    storage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    console.error(`스토리지 저장 실패 (${storageKey}):`, error);
  }
}

export function removeFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return;
  
  try {
    storage.removeItem(storageKey);
  } catch (error) {
    console.error(`스토리지 삭제 실패 (${storageKey}):`, error);
  }
}

export function getRawFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return null;
  
  try {
    return storage.getItem(storageKey);
  } catch (error) {
    return null;
  }
}

export function setRawToStorage(storageKey, value, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return;
  
  try {
    storage.setItem(storageKey, value);
  } catch (error) {
    console.error(`스토리지 저장 실패 (${storageKey}):`, error);
  }
}

export function registerCache(name, cache, options = {}) {
  try {
    if (cacheRegistry.has(name)) {
      clearCache(name);
    }

    const cacheInfo = {
      cache,
      options: {
        maxSize: options.maxSize || 1000,
        ttl: options.ttl || null,
        cleanupInterval: options.cleanupInterval || 300000,
        storageKey: options.storageKey || null,
        storageType: options.storageType || 'localStorage',
        persist: options.persist !== false,
        ...options
      },
      lastAccess: Date.now(),
      accessCount: 0,
      cleanupTimer: null
    };
    
    if (cacheInfo.options.storageKey && cacheInfo.options.persist) {
      const stored = loadFromStorage(cacheInfo.options.storageKey, cacheInfo.options.storageType);
      if (stored && stored.data) {
        if (cache instanceof Map) {
          Object.entries(stored.data).forEach(([key, value]) => {
            cache.set(key, value);
          });
        } else {
          Object.assign(cache, stored.data);
        }
      }
    }
    
    cacheRegistry.set(name, cacheInfo);
    
    if (cacheInfo.options.ttl) {
      setupCleanupTimer(name, cacheInfo);
    }
  } catch (error) {
    console.error(`캐시 등록 실패 (${name}):`, error);
    throw error;
  }
}

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

export function enforceCacheSizeLimit(name) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return;
    
    const { cache, options } = cacheInfo;
    const currentSize = cache.size || Object.keys(cache).length;
    
    if (currentSize > options.maxSize) {
      const entries = Array.from(cache.entries());
      
      entries.sort((a, b) => {
        const aTime = (a[1] && a[1].lastAccess) ? a[1].lastAccess : 0;
        const bTime = (b[1] && b[1].lastAccess) ? b[1].lastAccess : 0;
        return aTime - bTime;
      });
      
      const toRemove = entries.slice(0, currentSize - options.maxSize);
      
      for (const [key] of toRemove) {
        deleteFromCache(cache, key);
      }
    }
  } catch (error) {
    console.error(`캐시 크기 제한 적용 실패 (${name}):`, error);
  }
}

function setupCleanupTimer(name, cacheInfo) {
  try {
    if (cacheInfo.cleanupTimer) {
      clearInterval(cacheInfo.cleanupTimer);
    }

    const interval = setInterval(() => {
      try {
        const now = Date.now();
        const { cache, options } = cacheInfo;
        let hasChanges = false;
        
        if (cache.size) {
          for (const [key, value] of cache.entries()) {
            if (value && typeof value === 'object' && value.timestamp && 
                (now - value.timestamp) > options.ttl) {
              deleteFromCache(cache, key);
              hasChanges = true;
            }
          }
        } else if (cache && typeof cache === 'object') {
          for (const key of Object.keys(cache)) {
            const value = cache[key];
            if (value && typeof value === 'object' && value.timestamp && 
                (now - value.timestamp) > options.ttl) {
              deleteFromCache(cache, key);
              hasChanges = true;
            }
          }
        }
        
        if (hasChanges && options.storageKey && options.persist) {
          const data = cache instanceof Map 
            ? Object.fromEntries(cache.entries())
            : { ...cache };
          saveToStorage(options.storageKey, { data, timestamp: Date.now() }, options.storageType);
        }
      } catch (error) {
        console.error(`TTL 캐시 정리 중 오류 (${name}):`, error);
      }
    }, cacheInfo.options.cleanupInterval);
    
    cacheInfo.cleanupTimer = interval;
  } catch (error) {
    console.error(`캐시 타이머 설정 실패 (${name}):`, error);
  }
}

export function clearCache(name) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return;
    
    const { cache, cleanupTimer, options } = cacheInfo;
    
    if (cache && typeof cache.clear === 'function') {
      cache.clear();
    } else if (cache && typeof cache === 'object') {
      for (const key of Object.keys(cache)) {
        delete cache[key];
      }
    }
    
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cacheInfo.cleanupTimer = null;
    }
    
    if (options.storageKey) {
      removeFromStorage(options.storageKey, options.storageType);
    }
    
    cacheInfo.lastAccess = Date.now();
    cacheInfo.accessCount = 0;
  } catch (error) {
    console.error(`캐시 정리 실패 (${name}):`, error);
  }
}

export function clearAllCaches() {
  try {
    for (const [name] of cacheRegistry) {
      clearCache(name);
    }
  } catch (error) {
    console.error('모든 캐시 정리 실패:', error);
  }
}

export function cleanupUnusedCaches(maxAge = 600000) {
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

export function unregisterCache(name) {
  try {
    clearCache(name);
    cacheRegistry.delete(name);
  } catch (error) {
    console.error(`캐시 등록 해제 실패 (${name}):`, error);
  }
}

export function getCacheItem(name, key) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return undefined;
    
    const { cache, options } = cacheInfo;
    let value = cache.get ? cache.get(key) : cache[key];
    
    if (value === undefined && options.storageKey && options.persist) {
      const stored = loadFromStorage(options.storageKey, options.storageType);
      if (stored && stored.data && stored.data[key]) {
        value = stored.data[key];
        if (cache.set) {
          cache.set(key, value);
        } else {
          cache[key] = value;
        }
      }
    }
    
    if (value !== undefined) {
      recordCacheAccess(name);
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

export function setCacheItem(name, key, value) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return false;
    
    const { cache, options } = cacheInfo;
    
    const cacheValue = {
      ...value,
      lastAccess: Date.now(),
      timestamp: value.timestamp || Date.now()
    };
    
    if (cache.set) {
      cache.set(key, cacheValue);
    } else {
      cache[key] = cacheValue;
    }
    
    recordCacheAccess(name);
    enforceCacheSizeLimit(name);
    
    if (options.storageKey && options.persist) {
      const data = cache instanceof Map 
        ? Object.fromEntries(cache.entries())
        : { ...cache };
      saveToStorage(options.storageKey, { data, timestamp: Date.now() }, options.storageType);
    }
    
    return true;
  } catch (error) {
    console.error(`캐시 항목 설정 실패 (${name}, ${key}):`, error);
    return false;
  }
}

export function removeCacheItem(name, key) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return false;
    
    const { cache, options } = cacheInfo;
    deleteFromCache(cache, key);
    
    if (options.storageKey && options.persist) {
      const storage = getStorage(options.storageType);
      if (storage) {
        try {
          const stored = loadFromStorage(options.storageKey, options.storageType);
          if (stored && stored.data) {
            delete stored.data[key];
            saveToStorage(options.storageKey, stored, options.storageType);
          }
        } catch (error) {
          console.error(`캐시 항목 스토리지 삭제 실패 (${name}, ${key}):`, error);
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error(`캐시 항목 삭제 실패 (${name}, ${key}):`, error);
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', clearAllCaches);
}

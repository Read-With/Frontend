import { 
  registerCache, 
  getCacheItem, 
  setCacheItem, 
  clearCache, 
  removeCacheItem,
  getRawFromStorage,
  setRawToStorage,
  removeFromStorage
} from './cacheManager';

const STORAGE_TTL = 5 * 60 * 1000;
const storageCache = new Map();
registerCache('storageCache', storageCache, {
  maxSize: 50,
  ttl: STORAGE_TTL,
  cleanupInterval: 300000,
  storageKey: 'storageCache_data',
  storageType: 'localStorage',
  persist: true
});

const getFreshCachedValue = (key, parsed) => {
  const cached = getCacheItem('storageCache', key);
  if (!cached || !cached.timestamp || Date.now() - cached.timestamp >= STORAGE_TTL) {
    return undefined;
  }
  return cached.parsed === parsed ? cached.value : undefined;
};

const setCachedValue = (key, value, parsed) => {
  setCacheItem('storageCache', key, {
    value,
    timestamp: Date.now(),
    parsed
  });
};

export const storageUtils = {
  get: (key) => {
    const cached = getFreshCachedValue(key, false);
    if (cached !== undefined) {
      return cached;
    }
    
    const value = getRawFromStorage(key, 'localStorage');
    if (value !== null) {
      setCachedValue(key, value, false);
    }
    return value;
  },
  
  set: (key, value) => {
    setRawToStorage(key, value, 'localStorage');
    setCachedValue(key, value, false);
  },
  
  remove: (key) => {
    removeFromStorage(key, 'localStorage');
    removeCacheItem('storageCache', key);
  },
  
  getJson: (key, defaultValue = {}) => {
    const cached = getFreshCachedValue(key, true);
    if (cached !== undefined) {
      return cached;
    }
    
    try {
      const stored = getRawFromStorage(key, 'localStorage');
      const value = stored ? JSON.parse(stored) : defaultValue;
      setCachedValue(key, value, true);
      return value;
    } catch {
      setCachedValue(key, defaultValue, true);
      return defaultValue;
    }
  },
  
  setJson: (key, value) => {
    const jsonValue = JSON.stringify(value);
    setRawToStorage(key, jsonValue, 'localStorage');
    setCachedValue(key, value, true);
  },
  
  clearCache: () => {
    clearCache('storageCache');
  }
};

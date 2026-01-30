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

export const storageUtils = {
  get: (key) => {
    const cached = getCacheItem('storageCache', key);
    if (cached && cached.timestamp && Date.now() - cached.timestamp < STORAGE_TTL) {
      return cached.value;
    }
    
    const value = getRawFromStorage(key, 'localStorage');
    if (value !== null) {
      setCacheItem('storageCache', key, {
        value,
        timestamp: Date.now(),
        parsed: false
      });
    }
    return value;
  },
  
  set: (key, value) => {
    setRawToStorage(key, value, 'localStorage');
    setCacheItem('storageCache', key, {
      value,
      timestamp: Date.now(),
      parsed: false
    });
  },
  
  remove: (key) => {
    removeFromStorage(key, 'localStorage');
    removeCacheItem('storageCache', key);
  },
  
  getJson: (key, defaultValue = {}) => {
    const cached = getCacheItem('storageCache', key);
    if (cached && cached.timestamp && Date.now() - cached.timestamp < STORAGE_TTL && cached.parsed) {
      return cached.value;
    }
    
    try {
      const stored = getRawFromStorage(key, 'localStorage');
      const value = stored ? JSON.parse(stored) : defaultValue;
      setCacheItem('storageCache', key, {
        value,
        timestamp: Date.now(),
        parsed: true
      });
      return value;
    } catch {
      setCacheItem('storageCache', key, {
        value: defaultValue,
        timestamp: Date.now(),
        parsed: true
      });
      return defaultValue;
    }
  },
  
  setJson: (key, value) => {
    const jsonValue = JSON.stringify(value);
    setRawToStorage(key, jsonValue, 'localStorage');
    setCacheItem('storageCache', key, {
      value,
      timestamp: Date.now(),
      parsed: true
    });
  },
  
  clearCache: () => {
    clearCache('storageCache');
  }
};

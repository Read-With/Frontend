import { registerCache, getCacheItem, setCacheItem, clearCache, removeCacheItem } from './cacheManager';

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

function getFromStorage(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setToStorage(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error('localStorage 저장 실패:', error);
  }
}

function removeFromStorageLocal(key) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('localStorage 삭제 실패:', error);
  }
}

export const storageUtils = {
  get: (key) => {
    const cached = getCacheItem('storageCache', key);
    if (cached && cached.timestamp && Date.now() - cached.timestamp < STORAGE_TTL) {
      return cached.value;
    }
    
    const value = getFromStorage(key);
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
    setToStorage(key, value);
    setCacheItem('storageCache', key, {
      value,
      timestamp: Date.now(),
      parsed: false
    });
  },
  
  remove: (key) => {
    removeFromStorageLocal(key);
    removeCacheItem('storageCache', key);
  },
  
  getJson: (key, defaultValue = {}) => {
    const cached = getCacheItem('storageCache', key);
    if (cached && cached.timestamp && Date.now() - cached.timestamp < STORAGE_TTL && cached.parsed) {
      return cached.value;
    }
    
    try {
      const stored = getFromStorage(key);
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
    setToStorage(key, jsonValue);
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

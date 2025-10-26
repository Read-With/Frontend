/**
 * localStorage 캐시 관리 유틸리티
 * viewerUtils.js에서 분리하여 공통 모듈로 사용
 */

class StorageCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 50;
    this.ttl = 5 * 60 * 1000; // 5분
  }

  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.value;
    }
    
    const value = localStorage.getItem(key);
    this._setCache(key, value);
    return value;
  }

  set(key, value) {
    localStorage.setItem(key, value);
    this._setCache(key, value);
  }

  remove(key) {
    localStorage.removeItem(key);
    this.cache.delete(key);
  }

  getJson(key, defaultValue = {}) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttl && cached.parsed) {
      return cached.value;
    }

    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      this._setCache(key, value, true);
      return value;
    } catch {
      this._setCache(key, defaultValue, true);
      return defaultValue;
    }
  }

  setJson(key, value) {
    const jsonValue = JSON.stringify(value);
    localStorage.setItem(key, jsonValue);
    this._setCache(key, value, true);
  }

  _setCache(key, value, parsed = false) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      parsed
    });
  }

  clear() {
    this.cache.clear();
  }
}

const storageCache = new StorageCache();

export const storageUtils = {
  get: (key) => storageCache.get(key),
  set: (key, value) => storageCache.set(key, value),
  remove: (key) => storageCache.remove(key),
  getJson: (key, defaultValue = {}) => storageCache.getJson(key, defaultValue),
  setJson: (key, value) => storageCache.setJson(key, value),
  clearCache: () => storageCache.clear()
};


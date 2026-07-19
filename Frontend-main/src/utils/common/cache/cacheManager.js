import DOMPurify from 'isomorphic-dompurify';
import { LRUCache } from 'lru-cache';

export const MANIFEST_CACHE_PREFIX = 'manifest_cache_v2_';
export const MANIFEST_TTL_MS = 15 * 60 * 1000;

export const PROGRESS_CACHE_KEY = 'readwith_progress_cache';
export const PROGRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const BOOKS_CACHE_KEY = 'readwith_books_server_cache';
const BOOKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const GRAPH_BOOK_CACHE_PREFIX = 'graph_cache_';
export const CHAPTER_EVENT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const READER_PROGRESS_CACHE_PREFIX = 'reader_progress_';
export const READER_PROGRESS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export const CHAPTER_GRAPH_CACHE_SOURCE = Object.freeze({
  API: 'api',
  EMPTY: 'empty',
  INVALID: 'invalid',
  RUNTIME: 'runtime',
});

const cacheRegistry = new Map();

function getStorage(storageType = 'localStorage') {
  if (typeof window === 'undefined') return null;
  return storageType === 'sessionStorage' ? sessionStorage : localStorage;
}

const isMapLike = (cache) => cache && typeof cache.get === 'function' && typeof cache.set === 'function';

const getCacheSize = (cache) => {
  if (!cache) return 0;
  if (typeof cache.size === 'number') return cache.size;
  return typeof cache === 'object' ? Object.keys(cache).length : 0;
};

const getCacheEntries = (cache) => {
  if (!cache) return [];
  if (typeof cache.entries === 'function') return Array.from(cache.entries());
  return typeof cache === 'object' ? Object.entries(cache) : [];
};

const readFromCache = (cache, key) => (isMapLike(cache) ? cache.get(key) : cache?.[key]);

const writeToCache = (cache, key, value) => {
  if (!cache) return;
  if (isMapLike(cache)) {
    cache.set(key, value);
  } else {
    cache[key] = value;
  }
};

function deleteFromCache(cache, key) {
  if (!cache) return;
  if (cache.delete) {
    cache.delete(key);
  } else {
    delete cache[key];
  }
}

const clearCacheObject = (cache) => {
  if (cache && typeof cache.clear === 'function') {
    cache.clear();
    return;
  }
  if (cache && typeof cache === 'object') {
    for (const key of Object.keys(cache)) {
      delete cache[key];
    }
  }
};

const serializeCache = (cache) =>
  cache instanceof Map ? Object.fromEntries(cache.entries()) : { ...cache };

const persistCache = (cacheInfo) => {
  const { cache, options } = cacheInfo || {};
  if (!options?.storageKey || !options?.persist) return;
  saveToStorage(
    options.storageKey,
    { data: serializeCache(cache), timestamp: Date.now() },
    options.storageType
  );
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

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
  } catch {
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

/** timestamp 기반 TTL 검사 후 만료 시 스토리지 항목 제거 */
export function loadTtlStorage(storageKey, maxAgeMs, storageType = 'localStorage') {
  const data = loadFromStorage(storageKey, storageType);
  if (!data) return null;

  const age = Date.now() - (data.timestamp || 0);
  if (maxAgeMs > 0 && age > maxAgeMs) {
    removeFromStorage(storageKey, storageType);
    return null;
  }

  return data;
}

/** timestamp를 보장하며 스토리지에 저장 */
export function saveTtlStorage(storageKey, data, storageType = 'localStorage') {
  const payload = {
    ...data,
    timestamp: data?.timestamp ?? Date.now(),
  };
  saveToStorage(storageKey, payload, storageType);
  return payload;
}

/** 마이페이지 책 목록 persist */
export function readBooksCache() {
  const stored = loadTtlStorage(BOOKS_CACHE_KEY, BOOKS_CACHE_TTL_MS);
  if (!stored || !Array.isArray(stored.books)) return null;
  return {
    books: stored.books,
    updatedAt: Number(stored.timestamp) || Date.now(),
  };
}

export function writeBooksCache(books) {
  if (!Array.isArray(books)) return;
  saveTtlStorage(BOOKS_CACHE_KEY, { books });
}

export function clearBooksCache() {
  removeFromStorage(BOOKS_CACHE_KEY);
}

/** 메모리 캐시 미스 시 스토리지에서 로드해 캐시에 적재 */
export function hydrateCacheFromStorage(cacheName, storageKey, storageType = 'localStorage') {
  const stored = loadFromStorage(storageKey, storageType);
  if (!stored) return null;
  setCacheItem(cacheName, storageKey, stored);
  return stored;
}

function getRawFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return null;
  
  try {
    return storage.getItem(storageKey);
  } catch {
    return null;
  }
}

function setRawToStorage(storageKey, value, storageType = 'localStorage') {
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
        if (isMapLike(cache)) {
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
    const currentSize = getCacheSize(cache);
    
    if (currentSize > options.maxSize) {
      const entries = getCacheEntries(cache);
      
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
        
        for (const [key, value] of getCacheEntries(cache)) {
          if (value && typeof value === 'object' && value.timestamp && 
              (now - value.timestamp) > options.ttl) {
            deleteFromCache(cache, key);
            hasChanges = true;
          }
        }
        
        if (hasChanges) persistCache(cacheInfo);
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
    
    clearCacheObject(cache);
    
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

export function getCacheItem(name, key) {
  try {
    const cacheInfo = cacheRegistry.get(name);
    if (!cacheInfo) return undefined;
    
    const { cache, options } = cacheInfo;
    let value = readFromCache(cache, key);
    
    if (value === undefined && options.storageKey && options.persist) {
      const stored = loadFromStorage(options.storageKey, options.storageType);
      if (stored?.data && hasOwn(stored.data, key)) {
        value = stored.data[key];
        writeToCache(cache, key, value);
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
    
    const { cache } = cacheInfo;
    
    const now = Date.now();
    const cacheValue = value && typeof value === 'object' && !Array.isArray(value)
      ? {
          ...value,
          lastAccess: now,
          timestamp: value.timestamp || now
        }
      : {
          value,
          lastAccess: now,
          timestamp: now
        };
    
    writeToCache(cache, key, cacheValue);
    
    recordCacheAccess(name);
    enforceCacheSizeLimit(name);
    
    persistCache(cacheInfo);
    
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

function clearVolatileCachesOnBeforeUnload() {
  try {
    for (const [name, cacheInfo] of cacheRegistry) {
      const { options } = cacheInfo || {};
      if (options?.storageKey && options?.persist) {
        continue;
      }
      clearCache(name);
    }
  } catch (error) {
    console.error('beforeunload 캐시 정리 실패:', error);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', clearVolatileCachesOnBeforeUnload);
}

// --- TTL 메모리 캐시가 있는 localStorage 래퍼 (설정 등) ---

const STORAGE_TTL = 5 * 60 * 1000;
const storageCache = new Map();
registerCache('storageCache', storageCache, {
  maxSize: 50,
  ttl: STORAGE_TTL,
  cleanupInterval: 300000,
  storageKey: 'storageCache_data',
  storageType: 'localStorage',
  persist: true,
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
    parsed,
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
};

// --- XHTML 살균 + 로드 LRU 캐시 ---

const XHTML_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['data-chapter-index', 'data-block-index', 'epub:type'],
  FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'template'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

const CSS_SANITIZE_RULES = [
  [/\/\*[\s\S]*?\*\//g, ''],
  [/@import\b[\s\S]*?;/gi, ''],
  [/expression\s*\(/gi, 'expression-blocked('],
  [/-moz-binding\s*:/gi, 'invalid:'],
  [/behavior\s*:/gi, 'invalid:'],
  [/javascript\s*:/gi, 'invalid:'],
  [/url\s*\(\s*["']?\s*javascript:/gi, 'url(invalid:'],
  [/url\s*\(\s*["']?\s*data\s*:\s*text\/html/gi, 'url(invalid:'],
];

const XHTML_LOAD_CACHE_VERSION = 'v4';
export const XHTML_CACHE_INVALIDATED_EVENT = 'readwith:xhtml-cache-invalidated';
const MAX_CACHED_BOOKS = 5;

const xhtmlLoadCache = new LRUCache({ max: MAX_CACHED_BOOKS });

function resolveXhtmlBookId(bid) {
  return String(bid ?? '').trim();
}

function getXhtmlLoadCacheKey(bid) {
  const id = resolveXhtmlBookId(bid);
  return id ? `${XHTML_LOAD_CACHE_VERSION}::${id}` : '';
}

function sanitizeEpubStyleCss(css) {
  if (!css || typeof css !== 'string') return '';
  let sanitized = css;
  for (const [pattern, replacement] of CSS_SANITIZE_RULES) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.trim();
}

/** 문서 내 모든 style 태그 텍스트를 합쳐 살균 */
export function collectSanitizedStyleCssFromDocument(doc) {
  if (!doc?.querySelectorAll) return '';
  return Array.from(doc.querySelectorAll('style'))
    .map((el) => sanitizeEpubStyleCss(el.textContent ?? ''))
    .filter(Boolean)
    .join('\n\n');
}

/** body innerHTML 살균 (data-chapter-index 등 로케이터 속성 유지) */
export function sanitizeXhtmlBodyHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, XHTML_SANITIZE_CONFIG);
}

/** bookId에 해당하는 XHTML 로드 캐시를 제거하고, 갱신 이벤트를 broadcast한다. */
export function invalidateCachedXhtml(bid) {
  const bookId = resolveXhtmlBookId(bid);
  const cacheKey = getXhtmlLoadCacheKey(bookId);
  if (!cacheKey) return false;
  const existed = xhtmlLoadCache.has(cacheKey);
  xhtmlLoadCache.delete(cacheKey);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(XHTML_CACHE_INVALIDATED_EVENT, { detail: { bookId } })
    );
  }
  return existed;
}

/**
 * XHTML 본문 로드·파싱 결과를 LRU 캐시하고, 동시 요청은 하나의 Promise로 합칩니다.
 * 실패 시 캐시 항목을 제거해 재시도할 수 있게 합니다.
 */
export function loadCachedXhtmlContent(bid, loader, parse) {
  const cacheKey = getXhtmlLoadCacheKey(bid);
  if (!cacheKey) {
    return Promise.reject(new Error('책 ID가 없습니다.'));
  }

  const cached = xhtmlLoadCache.get(cacheKey);
  if (cached) return cached;

  const loadPromise = Promise.resolve()
    .then(() => loader(bid))
    .then((raw) => parse(raw))
    .catch((err) => {
      xhtmlLoadCache.delete(cacheKey);
      throw err;
    });

  xhtmlLoadCache.set(cacheKey, loadPromise);
  return loadPromise;
}

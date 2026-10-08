import { errorUtils } from '../valueUtils';

export const MANIFEST_CACHE_PREFIX = 'manifest_cache_v2_';
export const MANIFEST_TTL_MS = 15 * 60 * 1000;

export const PROGRESS_CACHE_KEY = 'readwith_progress_cache';
export const PROGRESS_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const BOOKS_CACHE_KEY = 'readwith_books_server_cache';
const BOOKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const GRAPH_BOOK_CACHE_PREFIX = 'graph_cache_';
export const CHAPTER_EVENT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 챕터 이벤트 localStorage 키 — v2: convert 단일 진입점 이후 elements 스키마 */
export const CHAPTER_EVENT_CACHE_PREFIX = 'chapter_events_v2_';

export const READER_PROGRESS_CACHE_PREFIX = 'reader_progress_';
export const READER_PROGRESS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export const CHAPTER_GRAPH_CACHE_SOURCE = Object.freeze({
  API: 'api',
  INVALID: 'invalid',
});

/** 과거에 write됐던 source — 재사용하지 않고 rediscover */
export const isUnusableChapterGraphCacheSource = (source) =>
  source === CHAPTER_GRAPH_CACHE_SOURCE.INVALID ||
  source === 'empty' ||
  source === 'manifest-only';

function getStorage(storageType = 'localStorage') {
  if (typeof window === 'undefined') return null;
  return storageType === 'sessionStorage' ? sessionStorage : localStorage;
}

/** 크기 제한 Map 쓰기 — 다시 쓰면 최신으로 이동, 넘치면 가장 오래된 항목 제거 */
export function setBounded(map, key, value, maxSize) {
  map.delete(key);
  map.set(key, value);
  if (map.size > maxSize) map.delete(map.keys().next().value);
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
    errorUtils.logDebug('cacheManager', `스토리지 저장 실패 (${storageKey})`, { message: error?.message });
  }
}

export function removeFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return;
  
  try {
    storage.removeItem(storageKey);
  } catch (error) {
    errorUtils.logDebug('cacheManager', `스토리지 삭제 실패 (${storageKey})`, { message: error?.message });
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

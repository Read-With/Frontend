import { registerCache, getCacheItem, setCacheItem, clearCache, removeCacheItem } from './cacheManager';
import { toLocator, progressPayloadFromData } from '../locatorUtils';

const PROGRESS_CACHE_KEY = 'readwith_progress_cache';
const PROGRESS_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

const progressCache = new Map();
registerCache('progressCache', progressCache, {
  maxSize: 1000,
  ttl: PROGRESS_CACHE_TTL_MS,
  cleanupInterval: 3600000,
  storageKey: PROGRESS_CACHE_KEY,
  storageType: 'localStorage',
  persist: true
});

const getProgressCacheFromStorage = () => {
  const cached = getCacheItem('progressCache', 'all');
  if (cached && cached.data) {
    return cached.data;
  }
  return null;
};

const saveProgressCacheToStorage = (progressMap) => {
  setCacheItem('progressCache', 'all', {
    data: progressMap,
    timestamp: Date.now()
  });
};

const resolveProgressEndpoints = (raw) => {
  if (!raw) return { start: null, end: null };
  const a = raw.anchor;
  const start =
    raw.startLocator ??
    toLocator(raw.locator) ??
    (a && (toLocator(a.startLocator) ?? toLocator(a.start) ?? toLocator(a)));
  const end =
    raw.endLocator ??
    (a &&
      (toLocator(a.endLocator) ??
        toLocator(a.end) ??
        toLocator(a.startLocator) ??
        toLocator(a.start) ??
        toLocator(a))) ??
    start;
  return { start: start ?? null, end: (end ?? start) ?? null };
};

const toStoredProgress = (item) => {
  if (!item || item.bookId == null) return null;
  const { start, end } = resolveProgressEndpoints(item);
  if (!start) return { bookId: item.bookId, startLocator: null, endLocator: null };
  return {
    bookId: item.bookId,
    startLocator: start,
    endLocator: end ?? start,
  };
};

const fromStoredProgress = (stored) => {
  if (!stored) return null;
  const { start: startLocator, end: endLocator } = resolveProgressEndpoints(stored);
  const end = endLocator ?? startLocator;
  const anchor =
    startLocator != null ? { startLocator, endLocator: end ?? startLocator } : undefined;
  return {
    bookId: stored.bookId,
    startLocator: startLocator ?? undefined,
    endLocator: end ?? undefined,
    anchor,
    chapterIdx: startLocator?.chapterIndex ?? stored.chapterIdx,
  };
};

export const setAllProgress = (progressList) => {
  if (!Array.isArray(progressList)) return;
  const progressMap = {};
  progressList.forEach((progress) => {
    if (progress && progress.bookId != null) {
      const stored = toStoredProgress(progress);
      if (stored) progressMap[String(progress.bookId)] = stored;
    }
  });
  Object.entries(progressMap).forEach(([bookId, progress]) => {
    setCacheItem('progressCache', bookId, { ...progress, timestamp: Date.now() });
  });
  saveProgressCacheToStorage(progressMap);
};

export const setProgressToCache = (progressData) => {
  if (!progressData || progressData.bookId == null) return;
  const payload = progressPayloadFromData(progressData);
  if (!payload) return;
  const bookIdStr = String(progressData.bookId);
  const progress = {
    bookId: payload.bookId,
    startLocator: payload.startLocator,
    endLocator: payload.endLocator,
    timestamp: Date.now(),
  };
  setCacheItem('progressCache', bookIdStr, progress);
  const cached = getProgressCacheFromStorage() || {};
  cached[bookIdStr] = progress;
  saveProgressCacheToStorage(cached);
};

export const getProgressFromCache = (bookId) => {
  if (!bookId) return null;
  const bookIdStr = String(bookId);
  let cached = getCacheItem('progressCache', bookIdStr);
  if (!cached) {
    const storageCached = getProgressCacheFromStorage();
    if (storageCached?.[bookIdStr]) {
      cached = storageCached[bookIdStr];
      setCacheItem('progressCache', bookIdStr, { ...cached, timestamp: Date.now() });
    }
  }
  return fromStoredProgress(cached);
};

export const removeProgressFromCache = (bookId) => {
  if (!bookId) return;
  const bookIdStr = String(bookId);
  removeCacheItem('progressCache', bookIdStr);

  const cached = getProgressCacheFromStorage();
  if (cached && cached[bookIdStr]) {
    delete cached[bookIdStr];
    saveProgressCacheToStorage(cached);
  }
};

export const getAllProgressFromCache = () => {
  const cached = getProgressCacheFromStorage();
  const allProgress = [];
  const seen = new Set();

  const pushUnique = (bookId, row) => {
    if (!row || seen.has(bookId)) return;
    const restored = fromStoredProgress(row);
    if (restored) {
      allProgress.push(restored);
      seen.add(bookId);
    }
  };

  progressCache.forEach?.((value, bookId) => pushUnique(bookId, value));
  Object.entries(cached ?? {}).forEach(([bookId, progress]) => pushUnique(bookId, progress));

  return allProgress;
};

export const clearProgressCache = () => {
  clearCache('progressCache');
};

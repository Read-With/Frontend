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

const toStoredProgress = (item) => {
  if (!item || item.bookId == null) return null;
  const start = item.startLocator ?? (item.anchor && (toLocator(item.anchor.start) ?? toLocator(item.anchor)));
  const end = item.endLocator ?? (item.anchor && (toLocator(item.anchor.end) ?? toLocator(item.anchor.start) ?? toLocator(item.anchor)));
  if (!start) return { bookId: item.bookId, startLocator: null, endLocator: null };
  return {
    bookId: item.bookId,
    startLocator: start,
    endLocator: end ?? start,
  };
};

const fromStoredProgress = (stored) => {
  if (!stored) return null;
  const start = stored.startLocator ?? (stored.anchor && (toLocator(stored.anchor.start) ?? toLocator(stored.anchor)));
  const end = stored.endLocator ?? (stored.anchor && (toLocator(stored.anchor.end) ?? toLocator(stored.anchor.start) ?? toLocator(stored.anchor)));
  const startLocator = start ?? null;
  const endLocator = end ?? start ?? null;
  const anchor = startLocator ? { start: startLocator, end: endLocator ?? startLocator } : stored.anchor ?? null;
  return {
    bookId: stored.bookId,
    startLocator: startLocator ?? undefined,
    endLocator: endLocator ?? undefined,
    anchor: anchor ?? undefined,
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
  if (!bookId) {
    return;
  }

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
  const processedBookIds = new Set();

  progressCache.forEach?.((value, bookId) => {
    if (value && !processedBookIds.has(bookId)) {
      const restored = fromStoredProgress(value);
      if (restored) {
        allProgress.push(restored);
        processedBookIds.add(bookId);
      }
    }
  });

  Object.entries(cached ?? {}).forEach(([bookId, progress]) => {
    if (progress && !processedBookIds.has(bookId)) {
      const restored = fromStoredProgress(progress);
      if (restored) {
        allProgress.push(restored);
        processedBookIds.add(bookId);
      }
    }
  });

  return allProgress;
};

export const clearProgressCache = () => {
  clearCache('progressCache');
};

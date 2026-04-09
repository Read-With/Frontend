import { registerCache, getCacheItem, setCacheItem, clearCache, removeCacheItem } from './cacheManager';
import { progressPayloadFromData, resolveProgressLocator } from '../locatorUtils';

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
  const locator = resolveProgressLocator(item);
  if (locator) return { bookId: item.bookId, locator };
  if (Number.isFinite(Number(item.startTxtOffset))) {
    return {
      bookId: item.bookId,
      startTxtOffset: Number(item.startTxtOffset),
      endTxtOffset: Number(item.endTxtOffset) || 0,
      locatorVersion: item.locatorVersion,
      updatedAt: item.updatedAt,
    };
  }
  return null;
};

const fromStoredProgress = (stored) => {
  if (!stored || stored.bookId == null) return null;
  const locator = resolveProgressLocator(stored);
  if (locator) {
    const anchor = { startLocator: locator, endLocator: locator };
    return {
      bookId: stored.bookId,
      locator,
      startLocator: locator,
      endLocator: locator,
      anchor,
      chapterIdx: locator.chapterIndex ?? stored.chapterIdx,
      updatedAt: stored.updatedAt,
    };
  }
  if (Number.isFinite(Number(stored.startTxtOffset))) {
    return {
      bookId: stored.bookId,
      startTxtOffset: stored.startTxtOffset,
      endTxtOffset: stored.endTxtOffset,
      locatorVersion: stored.locatorVersion,
      updatedAt: stored.updatedAt,
    };
  }
  return null;
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
  const locator = payload?.locator ?? resolveProgressLocator(progressData);
  const bookIdStr = String(progressData.bookId);
  let progress;
  if (locator) {
    progress = {
      bookId: progressData.bookId,
      locator,
      updatedAt: progressData.updatedAt,
      timestamp: Date.now(),
    };
  } else if (Number.isFinite(Number(progressData.startTxtOffset))) {
    progress = {
      bookId: progressData.bookId,
      startTxtOffset: Number(progressData.startTxtOffset),
      endTxtOffset: Number(progressData.endTxtOffset) || 0,
      locatorVersion: progressData.locatorVersion,
      updatedAt: progressData.updatedAt,
      timestamp: Date.now(),
    };
  } else {
    return;
  }
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

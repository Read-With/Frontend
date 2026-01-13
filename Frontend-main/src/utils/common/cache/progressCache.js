import { registerCache, getCacheItem, setCacheItem, clearCache, removeCacheItem } from './cacheManager';

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

export const setAllProgress = (progressList) => {
  if (!Array.isArray(progressList)) {
    return;
  }

  const progressMap = {};
  progressList.forEach(progress => {
    if (progress && progress.bookId !== undefined && progress.bookId !== null) {
      progressMap[String(progress.bookId)] = {
        bookId: progress.bookId,
        chapterIdx: progress.chapterIdx ?? null,
        eventIdx: progress.eventIdx ?? null,
        cfi: progress.cfi ?? null
      };
    }
  });

  Object.entries(progressMap).forEach(([bookId, progress]) => {
    setCacheItem('progressCache', bookId, {
      ...progress,
      timestamp: Date.now()
    });
  });

  saveProgressCacheToStorage(progressMap);
};

export const setProgressToCache = (progressData) => {
  if (!progressData || progressData.bookId === undefined || progressData.bookId === null) {
    return;
  }

  const bookIdStr = String(progressData.bookId);
  const progress = {
    bookId: progressData.bookId,
    chapterIdx: progressData.chapterIdx ?? null,
    eventIdx: progressData.eventIdx ?? null,
    cfi: progressData.cfi ?? null,
    timestamp: Date.now()
  };

  setCacheItem('progressCache', bookIdStr, progress);

  const cached = getProgressCacheFromStorage() || {};
  cached[bookIdStr] = progress;
  saveProgressCacheToStorage(cached);
};

export const getProgressFromCache = (bookId) => {
  if (!bookId) {
    return null;
  }

  const bookIdStr = String(bookId);

  const cached = getCacheItem('progressCache', bookIdStr);
  if (cached) {
    return {
      bookId: cached.bookId,
      chapterIdx: cached.chapterIdx,
      eventIdx: cached.eventIdx,
      cfi: cached.cfi
    };
  }

  const storageCached = getProgressCacheFromStorage();
  if (storageCached && storageCached[bookIdStr]) {
    const progress = storageCached[bookIdStr];
    setCacheItem('progressCache', bookIdStr, {
      ...progress,
      timestamp: Date.now()
    });
    return progress;
  }

  return null;
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
  if (!cached) {
    return [];
  }
  
  const allProgress = [];
  const processedBookIds = new Set();
  
  if (progressCache.forEach) {
    progressCache.forEach((value, bookId) => {
      if (value && !processedBookIds.has(bookId)) {
        allProgress.push({
          bookId: value.bookId,
          chapterIdx: value.chapterIdx,
          eventIdx: value.eventIdx,
          cfi: value.cfi
        });
        processedBookIds.add(bookId);
      }
    });
  }
  
  Object.entries(cached || {}).forEach(([bookId, progress]) => {
    if (progress && !processedBookIds.has(bookId)) {
      allProgress.push(progress);
      processedBookIds.add(bookId);
    }
  });
  
  return allProgress;
};

export const clearProgressCache = () => {
  clearCache('progressCache');
};

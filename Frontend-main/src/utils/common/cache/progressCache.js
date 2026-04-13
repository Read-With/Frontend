import { registerCache, getCacheItem, setCacheItem, clearCache, removeCacheItem } from './cacheManager';
import { progressPayloadFromData, progressResultToViewerAnchor, resolveProgressLocator } from '../locatorUtils';

export const PROGRESS_CACHE_UPDATED_EVENT = 'readwith:progress-cache-updated';

/** useBooks 마이페이지 % 폴백과 동일 키 — 새로고침 후에도 유지 */
const libraryProgressStorageKey = (bookIdStr) => `progress_${bookIdStr}`;

const syncLibraryProgressPercentToLocalStorage = (bookIdStr, pct) => {
  if (typeof window === 'undefined' || bookIdStr == null || pct == null) return;
  try {
    window.localStorage.setItem(libraryProgressStorageKey(bookIdStr), String(pct));
  } catch {
    void 0;
  }
};

const removeLibraryProgressPercentFromLocalStorage = (bookIdStr) => {
  if (typeof window === 'undefined' || bookIdStr == null) return;
  try {
    window.localStorage.removeItem(libraryProgressStorageKey(bookIdStr));
  } catch {
    void 0;
  }
};

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

/** 뷰어·서버에서 온 0–100 진행률(마이페이지 바 연동) */
export const normalizeReadingProgressPercent = (data) => {
  if (!data || typeof data !== 'object') return null;
  const r = Number(data.readingProgressPercent);
  if (Number.isFinite(r)) return Math.min(100, Math.max(0, Math.round(r)));
  const p = Number(data.progress);
  if (Number.isFinite(p) && p >= 0 && p <= 100) return Math.min(100, Math.max(0, Math.round(p)));
  return null;
};

const dispatchProgressCacheUpdated = (bookId) => {
  if (typeof window === 'undefined' || bookId == null) return;
  try {
    window.dispatchEvent(
      new CustomEvent(PROGRESS_CACHE_UPDATED_EVENT, { detail: { bookId: String(bookId) } })
    );
  } catch {
    void 0;
  }
};

const toStoredProgress = (item) => {
  if (!item || item.bookId == null) return null;
  const pct = normalizeReadingProgressPercent(item);
  const locator = resolveProgressLocator(item);
  if (locator) {
    const row = { bookId: item.bookId, locator };
    if (pct != null) row.readingProgressPercent = pct;
    return row;
  }
  if (Number.isFinite(Number(item.startTxtOffset))) {
    const row = {
      bookId: item.bookId,
      startTxtOffset: Number(item.startTxtOffset),
      endTxtOffset: Number(item.endTxtOffset) || 0,
      locatorVersion: item.locatorVersion,
      updatedAt: item.updatedAt,
    };
    if (pct != null) row.readingProgressPercent = pct;
    return row;
  }
  return null;
};

const fromStoredProgress = (stored) => {
  if (!stored || stored.bookId == null) return null;
  const pct = normalizeReadingProgressPercent(stored);
  const anchor = progressResultToViewerAnchor(stored);
  if (anchor) {
    const locator = anchor.startLocator;
    return {
      bookId: stored.bookId,
      locator,
      startLocator: locator,
      endLocator: anchor.endLocator,
      anchor,
      chapterIdx: locator.chapterIndex ?? stored.chapterIdx,
      updatedAt: stored.updatedAt,
      ...(pct != null ? { readingProgressPercent: pct } : {}),
    };
  }
  if (Number.isFinite(Number(stored.startTxtOffset))) {
    return {
      bookId: stored.bookId,
      startTxtOffset: stored.startTxtOffset,
      endTxtOffset: stored.endTxtOffset,
      locatorVersion: stored.locatorVersion,
      updatedAt: stored.updatedAt,
      ...(pct != null ? { readingProgressPercent: pct } : {}),
    };
  }
  return null;
};

export const setAllProgress = (progressList) => {
  if (!Array.isArray(progressList)) return;
  const rawExisting = getProgressCacheFromStorage() || {};
  const existingFlat = {};
  Object.keys(rawExisting).forEach((k) => {
    if (k === 'all') return;
    existingFlat[k] = rawExisting[k];
  });
  const progressMap = { ...existingFlat };
  progressList.forEach((progress) => {
    if (progress && progress.bookId != null) {
      const id = String(progress.bookId);
      const stored = toStoredProgress(progress);
      if (!stored) return;
      const prev = progressMap[id];
      const prevPct = normalizeReadingProgressPercent(prev ?? {});
      const newPct = normalizeReadingProgressPercent(stored);
      const merged = prev && typeof prev === 'object' ? { ...prev, ...stored } : { ...stored };
      if (newPct != null) merged.readingProgressPercent = newPct;
      else if (prevPct != null) merged.readingProgressPercent = prevPct;
      progressMap[id] = merged;
    }
  });
  Object.entries(progressMap).forEach(([bookId, row]) => {
    if (!row || typeof row !== 'object') return;
    setCacheItem('progressCache', bookId, { ...row, timestamp: Date.now() });
  });
  saveProgressCacheToStorage(progressMap);
  Object.entries(progressMap).forEach(([id, row]) => {
    const p = normalizeReadingProgressPercent(row ?? {});
    if (p != null) syncLibraryProgressPercentToLocalStorage(id, p);
  });
  Object.keys(progressMap).forEach((id) => dispatchProgressCacheUpdated(id));
};

export const setProgressToCache = (progressData) => {
  if (!progressData || progressData.bookId == null) return;
  const payload = progressPayloadFromData(progressData);
  const locator = payload?.locator ?? resolveProgressLocator(progressData);
  const bookIdStr = String(progressData.bookId);
  const pct = normalizeReadingProgressPercent(progressData);
  let progress;
  if (locator) {
    progress = {
      bookId: progressData.bookId,
      locator,
      updatedAt: progressData.updatedAt,
      timestamp: Date.now(),
    };
    if (pct != null) progress.readingProgressPercent = pct;
  } else if (Number.isFinite(Number(progressData.startTxtOffset))) {
    progress = {
      bookId: progressData.bookId,
      startTxtOffset: Number(progressData.startTxtOffset),
      endTxtOffset: Number(progressData.endTxtOffset) || 0,
      locatorVersion: progressData.locatorVersion,
      updatedAt: progressData.updatedAt,
      timestamp: Date.now(),
    };
    if (pct != null) progress.readingProgressPercent = pct;
  } else {
    return;
  }
  setCacheItem('progressCache', bookIdStr, progress);
  const cached = getProgressCacheFromStorage() || {};
  cached[bookIdStr] = progress;
  saveProgressCacheToStorage(cached);
  if (pct != null) syncLibraryProgressPercentToLocalStorage(bookIdStr, pct);
  dispatchProgressCacheUpdated(progressData.bookId);
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
  removeLibraryProgressPercentFromLocalStorage(bookIdStr);
  dispatchProgressCacheUpdated(bookIdStr);
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

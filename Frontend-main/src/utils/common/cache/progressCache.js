import { registerCache, getCacheItem, setCacheItem, removeCacheItem } from './cacheManager';
import { progressPayloadFromData, progressResultToViewerAnchor, resolveProgressLocator } from '../locatorUtils';
import { locatorFromBookAbsoluteOffset, normalizeLocatorForServerProgress } from './manifestCache';
import { clampNumber, clampPercent as clampPercentValue } from '../numberUtils';
import { toStringOrNull, toTrimmedStringOrNull } from '../stringUtils';

export const PROGRESS_CACHE_UPDATED_EVENT = 'readwith:progress-cache-updated';

/** 마이페이지 진행률 바용 progress_{bookId} localStorage */
export const progressStorageKey = (bookId) => `progress_${bookId}`;

export function getStoredProgressPercent(bookId) {
  const id = toTrimmedStringOrNull(bookId);
  if (!id) return null;
  try {
    const raw = localStorage.getItem(progressStorageKey(id));
    if (raw == null) return null;
    return clampPercentValue(raw);
  } catch {
    return null;
  }
}

function setStoredProgressPercent(bookId, percent) {
  const id = toTrimmedStringOrNull(bookId);
  if (!id || percent == null || typeof window === 'undefined') return;
  try {
    localStorage.setItem(progressStorageKey(id), String(percent));
  } catch {
    void 0;
  }
}

function removeStoredProgressPercent(bookId) {
  const id = toTrimmedStringOrNull(bookId);
  if (!id || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(progressStorageKey(id));
  } catch {
    void 0;
  }
}

/** locator 없이 startTxtOffset만 있을 때 manifest로 v2 locator 보강(캐시·GET 공통) */
export const ensureProgressRowLocator = (bookIdStr, row) => {
  if (!row || typeof row !== 'object') return row;
  if (resolveProgressLocator(row)) return row;
  const resolvedBookId = row.bookId != null ? String(row.bookId) : String(bookIdStr ?? '');
  const abs = Number(row.startTxtOffset);
  if (!resolvedBookId || !Number.isFinite(abs) || abs < 0) return row;
  const locator = locatorFromBookAbsoluteOffset(resolvedBookId, abs);
  if (!locator) return row;
  return {
    ...row,
    locator,
    startLocator: locator,
    endLocator: locator,
  };
};

const PROGRESS_CACHE_KEY = 'readwith_progress_cache';
const PROGRESS_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const clampPercent = (value) => Math.round(clampPercentValue(value, 0));
const clampProgress = (value) => clampNumber(value, 0, 100);
const toBookIdString = toStringOrNull;
const getEventName = (data) => data?.eventName ?? data?.eventTitle ?? data?.name;

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
  const readingProgressPercent = Number(data.readingProgressPercent);
  if (Number.isFinite(readingProgressPercent)) return clampPercent(readingProgressPercent);
  const progressPercent = Number(data.progress);
  if (Number.isFinite(progressPercent) && progressPercent >= 0 && progressPercent <= 100) {
    return clampPercent(progressPercent);
  }
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
  const locator = resolveProgressLocator(ensureProgressRowLocator(String(item.bookId), item));
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
  const row = ensureProgressRowLocator(String(stored.bookId), stored);
  const pct = normalizeReadingProgressPercent(row);
  const anchor = progressResultToViewerAnchor(row);
  if (anchor) {
    const locator = anchor.startLocator;
    const evn = Number(row.eventNum);
    const chp = Number(row.chapterProgress);
    const evName = getEventName(row);
    return {
      bookId: row.bookId,
      locator,
      startLocator: locator,
      endLocator: anchor.endLocator,
      anchor,
      chapterIdx: locator.chapterIndex ?? row.chapterIdx,
      updatedAt: row.updatedAt,
      ...(pct != null ? { readingProgressPercent: pct } : {}),
      ...(Number.isFinite(evn) && evn > 0 ? { eventNum: evn } : {}),
      ...(Number.isFinite(chp) ? { chapterProgress: clampProgress(chp) } : {}),
      ...(typeof evName === 'string' && evName.trim() ? { eventName: evName.trim() } : {}),
    };
  }
  if (Number.isFinite(Number(row.startTxtOffset))) {
    return {
      bookId: row.bookId,
      startTxtOffset: row.startTxtOffset,
      endTxtOffset: row.endTxtOffset,
      locatorVersion: row.locatorVersion,
      updatedAt: row.updatedAt,
      ...(pct != null ? { readingProgressPercent: pct } : {}),
    };
  }
  return null;
};

export const setProgressToCache = (progressData) => {
  if (!progressData || progressData.bookId == null) return;
  const bookIdStr = toBookIdString(progressData.bookId);
  let withLoc = ensureProgressRowLocator(bookIdStr, progressData);
  const locBefore = resolveProgressLocator(withLoc);
  if (locBefore) {
    const norm = normalizeLocatorForServerProgress(bookIdStr, locBefore);
    if (norm) {
      withLoc = { ...withLoc, startLocator: norm, locator: norm, endLocator: norm };
    }
  }
  const payload = progressPayloadFromData(withLoc);
  const locator = payload?.locator ?? resolveProgressLocator(withLoc);
  const pct = normalizeReadingProgressPercent(withLoc);
  let progress;
  if (locator) {
    progress = {
      bookId: withLoc.bookId,
      locator,
      updatedAt: withLoc.updatedAt,
      timestamp: Date.now(),
    };
    if (pct != null) progress.readingProgressPercent = pct;
    const evn = Number(withLoc.eventNum);
    if (Number.isFinite(evn) && evn > 0) progress.eventNum = evn;
    const chp = Number(withLoc.chapterProgress);
    if (Number.isFinite(chp)) progress.chapterProgress = clampProgress(chp);
    const evName = getEventName(withLoc);
    if (typeof evName === 'string' && evName.trim()) progress.eventName = evName.trim();
  } else if (Number.isFinite(Number(withLoc.startTxtOffset))) {
    progress = {
      bookId: withLoc.bookId,
      startTxtOffset: Number(withLoc.startTxtOffset),
      endTxtOffset: Number(withLoc.endTxtOffset) || 0,
      locatorVersion: withLoc.locatorVersion,
      updatedAt: withLoc.updatedAt,
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
  if (pct != null) setStoredProgressPercent(bookIdStr, pct);
  dispatchProgressCacheUpdated(progressData.bookId);
};

export const getProgressFromCache = (bookId) => {
  if (!bookId) return null;
  const bookIdStr = toBookIdString(bookId);
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
  const bookIdStr = toBookIdString(bookId);
  removeCacheItem('progressCache', bookIdStr);

  const cached = getProgressCacheFromStorage();
  if (cached && cached[bookIdStr]) {
    delete cached[bookIdStr];
    saveProgressCacheToStorage(cached);
  }
  removeStoredProgressPercent(bookIdStr);
  dispatchProgressCacheUpdated(bookIdStr);
};

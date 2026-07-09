import { registerCache, getCacheItem, setCacheItem, removeCacheItem } from './cacheManager';
import { progressPayloadFromData, progressResultToViewerAnchor, resolveProgressLocator } from '../locatorUtils';
import {
  locatorFromBookAbsoluteOffset,
  normalizeLocatorForServerProgress,
  resolveProgressMetricsFromLocator,
} from './manifestCache';
import {
  normalizeReadingProgressPercent,
  normalizeChapterProgressPercent,
  resolveProgressEventName,
  clampProgressPercent,
} from '../../viewer/viewerEventProgressUtils';
import { toStringOrNull } from '../stringUtils';

export const PROGRESS_CACHE_UPDATED_EVENT = 'readwith:progress-cache-updated';

const PROGRESS_CACHE_KEY = 'readwith_progress_cache';
const PROGRESS_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const toBookIdString = toStringOrNull;

const progressCache = new Map();
registerCache('progressCache', progressCache, {
  maxSize: 1000,
  ttl: PROGRESS_CACHE_TTL_MS,
  cleanupInterval: 3600000,
  storageKey: PROGRESS_CACHE_KEY,
  storageType: 'localStorage',
  persist: true,
});

/** 예전 'all' 집계 키 → per-book 엔트리로 일회성 이전 */
function migrateLegacyProgressAggregate() {
  const allEntry = progressCache.get('all');
  if (!allEntry?.data || typeof allEntry.data !== 'object') return;

  for (const [bookId, row] of Object.entries(allEntry.data)) {
    if (!row || row.bookId == null) continue;
    if (!progressCache.has(bookId)) {
      setCacheItem('progressCache', bookId, {
        ...row,
        timestamp: row.timestamp || Date.now(),
      });
    }
  }
  removeCacheItem('progressCache', 'all');
}

migrateLegacyProgressAggregate();

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

const fromStoredProgress = (stored) => {
  if (!stored || stored.bookId == null) return null;

  const bookIdStr = String(stored.bookId);
  const row = ensureProgressRowLocator(bookIdStr, stored);
  const pct =
    normalizeReadingProgressPercent(row, { bookId: bookIdStr }) ??
    (Number.isFinite(Number(row.readingProgressPercent))
      ? clampProgressPercent(row.readingProgressPercent)
      : null);
  const chp =
    normalizeChapterProgressPercent(row, { bookId: bookIdStr }) ??
    (Number.isFinite(Number(row.chapterProgress)) ? clampProgressPercent(row.chapterProgress) : null);
  const anchor = progressResultToViewerAnchor(row);

  if (anchor) {
    const locator = anchor.startLocator;
    const evn = Number(row.eventNum);
    const evName = resolveProgressEventName(row);

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
      ...(chp != null ? { chapterProgress: chp } : {}),
      ...(evName ? { eventName: evName } : {}),
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
  const metrics =
    bookIdStr && locator ? resolveProgressMetricsFromLocator(bookIdStr, locator) : null;
  const pct =
    metrics?.readingProgressPercent ??
    normalizeReadingProgressPercent(withLoc, { bookId: bookIdStr });
  const chpFromLoc =
    metrics?.chapterProgress ?? normalizeChapterProgressPercent(withLoc, { bookId: bookIdStr });

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
    if (chpFromLoc != null) progress.chapterProgress = chpFromLoc;
    const evName = resolveProgressEventName(withLoc);
    if (evName) progress.eventName = evName;
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
  dispatchProgressCacheUpdated(progressData.bookId);
};

export const getProgressFromCache = (bookId) => {
  if (!bookId) return null;
  const bookIdStr = toBookIdString(bookId);
  const cached = getCacheItem('progressCache', bookIdStr);
  return fromStoredProgress(cached);
};

export const removeProgressFromCache = (bookId) => {
  if (!bookId) return;
  const bookIdStr = toBookIdString(bookId);
  removeCacheItem('progressCache', bookIdStr);
  dispatchProgressCacheUpdated(bookIdStr);
};

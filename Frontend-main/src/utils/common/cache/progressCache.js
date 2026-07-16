import {
  registerCache,
  getCacheItem,
  setCacheItem,
  removeCacheItem,
  loadTtlStorage,
  removeFromStorage,
  PROGRESS_CACHE_KEY,
  PROGRESS_CACHE_TTL_MS,
  READER_PROGRESS_CACHE_PREFIX,
  READER_PROGRESS_MAX_AGE_MS,
} from './cacheManager';
import {
  locatorFromBookAbsoluteOffset,
  normalizeStartEndLocatorsForServer,
  resolveProgressMetricsFromLocator,
} from './manifestCache';
import { progressPayloadFromData, progressResultToViewerAnchor, resolveProgressLocator, toLocator } from '../locatorUtils';
import {
  normalizeReadingProgressPercent,
  normalizeChapterProgressPercent,
  resolveProgressEventName,
} from '../../viewer/viewerEventProgressUtils';
import { clampPercent, resolveChapterIndex, toStringOrNull, toTrimmedStringOrNull } from '../valueUtils';
import { errorUtils } from '../errorUtils';

export const PROGRESS_CACHE_UPDATED_EVENT = 'readwith:progress-cache-updated';

const progressCache = new Map();
registerCache('progressCache', progressCache, {
  maxSize: 1000,
  ttl: PROGRESS_CACHE_TTL_MS,
  cleanupInterval: 3600000,
  storageKey: PROGRESS_CACHE_KEY,
  storageType: 'localStorage',
  persist: true,
});

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

const getReaderProgressStorageKey = (bookKey) => {
  const sanitized = toTrimmedStringOrNull(bookKey);
  if (!sanitized) return null;
  return `${READER_PROGRESS_CACHE_PREFIX}${sanitized}`;
};

const progressToReaderLocation = (progress) => {
  if (!progress || progress.bookId == null) return null;
  const startLocator = progress.startLocator ?? progress.locator;
  const chapterIdx = resolveChapterIndex(startLocator);
  if (chapterIdx == null || chapterIdx < 1) return null;
  const endLocator = progress.endLocator ?? startLocator;
  const eventNum = Number(progress.eventNum);
  return {
    key: String(progress.bookId),
    bookId: progress.bookId,
    chapterIdx: progress.chapterIdx ?? chapterIdx,
    eventIdx: Number.isFinite(eventNum) && eventNum > 0 ? eventNum : null,
    eventNum: Number.isFinite(eventNum) && eventNum > 0 ? eventNum : null,
    eventId: progress.eventId ?? null,
    startLocator,
    endLocator,
    locator: startLocator,
    eventName: progress.eventName ?? null,
    chapterProgress: progress.chapterProgress ?? null,
    source: 'runtime',
    timestamp: progress.timestamp ?? Date.now(),
  };
};

const normalizeReaderLocationPayload = (bookKey, payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const resolved = resolveProgressLocator(payload);
  const startL =
    (resolved ? toLocator(resolved) ?? resolved : null) ??
    toLocator(payload.startLocator) ??
    toLocator(payload.locator);

  const startChapterIdx = resolveChapterIndex(startL);
  if (startChapterIdx == null || startChapterIdx < 1) {
    return null;
  }

  const endRaw =
    payload.endLocator ?? payload.anchor?.endLocator ?? payload.anchor?.end ?? startL;
  const endL = toLocator(endRaw) ?? startL;
  const eventNumCandidate = Number(payload.eventNum ?? payload.eventIdx);
  const normalizedEventNum =
    Number.isFinite(eventNumCandidate) && eventNumCandidate > 0 ? eventNumCandidate : null;
  const chapterProgressCandidate = Number(payload.chapterProgress);
  const normalizedChapterProgress = Number.isFinite(chapterProgressCandidate)
    ? clampPercent(chapterProgressCandidate)
    : null;
  const eventName = resolveProgressEventName(payload);

  return {
    key: bookKey,
    bookId: payload.bookId ?? null,
    chapterIdx: startChapterIdx,
    eventIdx: normalizedEventNum,
    eventNum: normalizedEventNum,
    eventId: payload.eventId ?? payload.id ?? null,
    startLocator: startL,
    endLocator: endL,
    locator: startL,
    eventName: eventName || null,
    chapterProgress: normalizedChapterProgress,
    source: payload.source ?? 'runtime',
    timestamp: Date.now(),
  };
};

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
      ? clampPercent(row.readingProgressPercent)
      : null);
  const chp =
    normalizeChapterProgressPercent(row, { bookId: bookIdStr }) ??
    (Number.isFinite(Number(row.chapterProgress)) ? clampPercent(row.chapterProgress) : null);
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
      chapterIdx: resolveChapterIndex(locator) ?? row.chapterIdx,
      updatedAt: row.updatedAt,
      timestamp: stored.timestamp,
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
      timestamp: stored.timestamp,
      ...(pct != null ? { readingProgressPercent: pct } : {}),
    };
  }

  return null;
};

export const setProgressToCache = (progressData) => {
  if (!progressData || progressData.bookId == null) return;

  const bookIdStr = toStringOrNull(progressData.bookId);
  let withLoc = ensureProgressRowLocator(bookIdStr, progressData);

  const locBefore = resolveProgressLocator(withLoc);
  if (locBefore) {
    const { startLocator, endLocator } = normalizeStartEndLocatorsForServer(
      bookIdStr,
      locBefore,
      withLoc.endLocator ?? withLoc.end ?? locBefore
    );
    if (startLocator) {
      withLoc = {
        ...withLoc,
        startLocator,
        locator: startLocator,
        endLocator: endLocator ?? startLocator,
      };
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
  const bookIdStr = toStringOrNull(bookId);
  const cached = getCacheItem('progressCache', bookIdStr);
  return fromStoredProgress(cached);
};

export const removeProgressFromCache = (bookId) => {
  if (!bookId) return;
  const bookIdStr = toStringOrNull(bookId);
  removeCacheItem('progressCache', bookIdStr);
  const storageKey = getReaderProgressStorageKey(bookIdStr);
  if (storageKey) removeFromStorage(storageKey, 'localStorage');
  dispatchProgressCacheUpdated(bookIdStr);
};

/** 뷰어 재개용 위치 — progressCache SSOT, legacy는 1회 마이그레이션 후 삭제 */
export const getCachedReaderProgress = (bookKey) => {
  try {
    const fromProgress = progressToReaderLocation(getProgressFromCache(bookKey));
    if (fromProgress) return fromProgress;

    const legacy = getLegacyReaderProgress(bookKey);
    if (!legacy) return null;

    setProgressToCache({
      bookId: legacy.bookId ?? bookKey,
      startLocator: legacy.startLocator,
      endLocator: legacy.endLocator,
      locator: legacy.locator ?? legacy.startLocator,
      eventNum: legacy.eventNum,
      eventName: legacy.eventName,
      chapterProgress: legacy.chapterProgress,
    });
    const storageKey = getReaderProgressStorageKey(bookKey);
    if (storageKey) removeFromStorage(storageKey, 'localStorage');

    return progressToReaderLocation(getProgressFromCache(bookKey)) ?? legacy;
  } catch (error) {
    errorUtils.logError('getCachedReaderProgress', error, { bookKey });
    return null;
  }
};

/** legacy reader_progress_{id}만 조회 (마이그레이션 폴백용) */
export const getLegacyReaderProgress = (bookKey) => {
  try {
    const storageKey = getReaderProgressStorageKey(bookKey);
    if (!storageKey) return null;

    const parsed = loadTtlStorage(storageKey, READER_PROGRESS_MAX_AGE_MS, 'localStorage');
    if (!parsed) return null;

    let chapterIdx = resolveChapterIndex(parsed);
    const loc = parsed?.startLocator ?? parsed?.locator;
    if (chapterIdx == null && loc && typeof loc === 'object') {
      chapterIdx = resolveChapterIndex(loc);
    }

    if (chapterIdx == null || chapterIdx < 1) {
      removeFromStorage(storageKey, 'localStorage');
      return null;
    }

    return {
      ...parsed,
      chapterIdx,
      eventIdx: Number.isFinite(Number(parsed.eventIdx)) ? Number(parsed.eventIdx) : null,
      eventNum: Number.isFinite(Number(parsed.eventNum)) ? Number(parsed.eventNum) : null,
      chapterProgress: Number.isFinite(Number(parsed.chapterProgress))
        ? clampPercent(parsed.chapterProgress)
        : null,
    };
  } catch (error) {
    errorUtils.logError('getLegacyReaderProgress', error, { bookKey });
    return null;
  }
};

/** 뷰어 위치 저장 — progressCache만 갱신 */
export const setCachedReaderProgress = (bookKey, payload) => {
  try {
    const sanitizedKey = toTrimmedStringOrNull(bookKey);
    if (!sanitizedKey) return null;

    const normalized = normalizeReaderLocationPayload(sanitizedKey, payload);
    if (!normalized) return null;

    const bookId = normalized.bookId ?? sanitizedKey;
    setProgressToCache({
      bookId,
      startLocator: normalized.startLocator,
      endLocator: normalized.endLocator,
      locator: normalized.locator,
      eventNum: normalized.eventNum,
      eventName: normalized.eventName,
      chapterProgress: normalized.chapterProgress,
      updatedAt: payload?.updatedAt,
    });

    return progressToReaderLocation(getProgressFromCache(bookId)) ?? normalized;
  } catch (error) {
    errorUtils.logError('setCachedReaderProgress', error, { bookKey });
    return null;
  }
};

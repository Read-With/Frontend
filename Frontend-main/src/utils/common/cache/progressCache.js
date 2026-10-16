/** progress/reader 캐시 + 서버 locator 정규화 */

import {
  asArray,
  resolveChapterIndex,
  clampPercent,
  toStringOrNull,
  toTrimmedStringOrNull,
  toPositiveNumberOrNull,
  errorUtils,
} from '../valueUtils';
import {
  toLocator,
  locatorsEqual,
  resolveProgressLocator,
  progressPayloadFromData,
  progressResultToViewerAnchor,
} from '../locator';
import {
  setBounded,
  loadFromStorage,
  saveToStorage,
  PROGRESS_CACHE_KEY,
  PROGRESS_CACHE_TTL_MS,
} from './cacheManager';
import { getChapterData } from './manifestCache';
import {
  locatorFromChapterLocalOffset,
  chapterLocalOffsetFromLocator,
  locatorFromBookAbsoluteOffset,
  readingProgressPercentFromLocator,
  resolveProgressMetricsFromLocator,
} from '../readingProgress';

/** POST progress — 서버 blockIndex 검증에 맞게 paragraphStarts 축으로 재매핑 */
const normalizeLocatorForServerProgress = (bookId, locator, manifestOverride = undefined) => {
  const loc = toLocator(locator);
  if (!loc) return null;
  const chapter = getChapterData(bookId, loc.chapterIndex, manifestOverride);
  if (!chapter) return loc;
  const starts = asArray(chapter.paragraphStarts);
  if (starts.length === 0) return loc;
  const local = chapterLocalOffsetFromLocator(chapter, loc);
  const out = locatorFromChapterLocalOffset(chapter, local);
  return out ?? loc;
};

/** start/end locator 서버 축 정규화 (진도·북마크 공용). 동일하면 endLocator=null */
export const normalizeStartEndLocatorsForServer = (
  bookId,
  startLocator,
  endLocator = null,
  manifestOverride = undefined
) => {
  const start =
    normalizeLocatorForServerProgress(bookId, startLocator, manifestOverride) ??
    toLocator(startLocator);
  if (!start) return { startLocator: null, endLocator: null };

  const endRaw = toLocator(endLocator) ?? start;
  const end =
    normalizeLocatorForServerProgress(bookId, endRaw, manifestOverride) ?? endRaw;

  return {
    startLocator: start,
    endLocator: locatorsEqual(start, end) ? null : end,
  };
};

/** progress 저장/캐시용 — end가 없으면 start로 채움 */
export const withNormalizedProgressLocators = (progressData, manifestOverride = undefined) => {
  if (!progressData?.bookId) return progressData;
  const bookId = String(progressData.bookId);
  const locator = resolveProgressLocator(progressData);
  if (!locator) return progressData;
  const { startLocator, endLocator } = normalizeStartEndLocatorsForServer(
    bookId,
    locator,
    progressData.endLocator ?? progressData.end ?? null,
    manifestOverride
  );
  if (!startLocator) return progressData;
  return {
    ...progressData,
    startLocator,
    locator: startLocator,
    endLocator: endLocator ?? startLocator,
  };
};


/** progress payload의 locator → 전체 진행률(0~100). 계산 불가면 null */
export const normalizeReadingProgressPercent = (data, options = {}) => {
  if (!data || typeof data !== 'object') return null;
  const bookId = options.bookId ?? data.bookId;
  const locator = resolveProgressLocator(data);
  if (bookId == null || !locator) return null;
  const value = readingProgressPercentFromLocator(bookId, locator);
  return value != null ? clampPercent(value) : null;
};


export const resolveProgressEventName = (source) => {
  if (!source || typeof source !== 'object') return '';
  const name =
    source.eventName ??
    source.eventTitle ??
    source.eventLabel ??
    source.name ??
    source.event_name ??
    source.event?.name ??
    source.event?.title ??
    source.title;
  return typeof name === 'string' ? name.trim() : '';
};

export const PROGRESS_CACHE_UPDATED_EVENT = 'readwith:progress-cache-updated';

const PROGRESS_CACHE_MAX = 1000;
const isProgressExpired = (entry) =>
  !!entry?.timestamp && Date.now() - entry.timestamp > PROGRESS_CACHE_TTL_MS;

const progressCache = new Map(
  Object.entries(loadFromStorage(PROGRESS_CACHE_KEY)?.data ?? {}).filter(
    ([, entry]) => !isProgressExpired(entry)
  )
);

const persistProgressCache = () =>
  saveToStorage(PROGRESS_CACHE_KEY, { data: Object.fromEntries(progressCache), timestamp: Date.now() });

const setProgressEntry = (bookId, entry) => {
  setBounded(progressCache, bookId, { ...entry, timestamp: entry.timestamp || Date.now() }, PROGRESS_CACHE_MAX);
  persistProgressCache();
};

const removeProgressEntry = (bookId) => {
  progressCache.delete(bookId);
  persistProgressCache();
};

const progressToReaderLocation = (progress) => {
  if (!progress || progress.bookId == null) return null;
  const startLocator = progress.startLocator ?? progress.locator;
  const chapterIdx = resolveChapterIndex(startLocator);
  if (chapterIdx == null || chapterIdx < 1) return null;
  const endLocator = progress.endLocator ?? startLocator;
  const eventNum = toPositiveNumberOrNull(progress.eventNum);
  return {
    key: String(progress.bookId),
    bookId: progress.bookId,
    chapterIdx: progress.chapterIdx ?? chapterIdx,
    eventIdx: eventNum,
    eventNum,
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
  const normalizedEventNum = toPositiveNumberOrNull(payload.eventNum ?? payload.eventIdx);
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
  // 전체·챕터 진도를 한 번에 계산 (각각 구하면 전체 진도 계산이 두 번 돎)
  const rowLocator = resolveProgressLocator(row);
  const metrics = rowLocator ? resolveProgressMetricsFromLocator(bookIdStr, rowLocator) : null;
  const pct =
    metrics?.readingProgressPercent ??
    (Number.isFinite(Number(row.readingProgressPercent))
      ? clampPercent(row.readingProgressPercent)
      : null);
  const chp =
    metrics?.chapterProgress ??
    (Number.isFinite(Number(row.chapterProgress)) ? clampPercent(row.chapterProgress) : null);
  const anchor = progressResultToViewerAnchor(row);

  if (anchor) {
    const locator = anchor.startLocator;
    const evn = toPositiveNumberOrNull(row.eventNum);
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
      ...(evn ? { eventNum: evn } : {}),
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
  const pct = metrics?.readingProgressPercent ?? null;
  const chpFromLoc = metrics?.chapterProgress ?? null;

  let progress;

  if (locator) {
    progress = {
      bookId: withLoc.bookId,
      locator,
      updatedAt: withLoc.updatedAt,
      timestamp: Date.now(),
    };
    if (pct != null) progress.readingProgressPercent = pct;
    const evn = toPositiveNumberOrNull(withLoc.eventNum);
    if (evn) progress.eventNum = evn;
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

  setProgressEntry(bookIdStr, progress);
  dispatchProgressCacheUpdated(progressData.bookId);
};

export const getProgressFromCache = (bookId) => {
  if (!bookId) return null;
  const bookIdStr = toStringOrNull(bookId);
  const cached = progressCache.get(bookIdStr);
  if (isProgressExpired(cached)) return null;
  return fromStoredProgress(cached);
};

export const removeProgressFromCache = (bookId) => {
  if (!bookId) return;
  const bookIdStr = toStringOrNull(bookId);
  removeProgressEntry(bookIdStr);
  dispatchProgressCacheUpdated(bookIdStr);
};

/** 뷰어 재개용 위치 — progressCache SSOT */
export const getCachedReaderProgress = (bookKey) =>
  progressToReaderLocation(getProgressFromCache(bookKey));

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


/** 뷰어 이벤트 매칭·manifest·진도·TopBar·저장 payload */

import {
  anchorToLocators,
  toLocator,
  progressResultToViewerAnchor,
  locatorsEqual,
  resolveProgressLocator,
} from '../common/locatorUtils';
import {
  findManifestEventInChapter,
  getLastManifestEventInChapter,
  resolveFineGraphLocatorToEventParams,
  resolveProgressMetricsFromLocator,
  readingProgressPercentFromLocator,
} from '../common/cache/manifestCache';
import { clampPercent, resolveChapterIndex, toPositiveNumberOrNull } from '../common/valueUtils';
import { eventUtils, resolveServerBookId } from './viewerCoreStateUtils';

function progressPercentFromData(data, options, pickValue) {
  if (!data || typeof data !== 'object') return null;
  const bookId = options.bookId ?? data.bookId;
  const locator = resolveProgressLocator(data);
  if (bookId == null || !locator) return null;
  const value = pickValue(bookId, locator);
  return value != null ? clampPercent(value) : null;
}

function resolveSaveMetrics(bookId, startLocator, metrics) {
  return metrics ?? resolveProgressMetricsFromLocator(bookId, startLocator);
}

export function resolveProgressEventName(source) {
  if (!source || typeof source !== 'object') return '';
  const name =
    source.eventName ??
    source.eventTitle ??
    source.name ??
    source.event_name ??
    source.event?.name ??
    source.event?.title ??
    source.title;
  return typeof name === 'string' ? name.trim() : '';
}

// --- 이벤트 매칭·manifest ---

export function eventMatchesChapter(event, chapter) {
  if (!event || typeof event !== 'object') return false;
  const eventChapter = Number(eventUtils.resolveChapterIdx(event));
  const currentChapter = Number(chapter);
  return !Number.isFinite(eventChapter) || eventChapter === currentChapter;
}

function pickReadingEventForChapter(currentEvent, prevValidEvent, currentChapter) {
  if (currentChapter == null) return currentEvent || prevValidEvent || null;
  if (eventMatchesChapter(currentEvent, currentChapter)) return currentEvent;
  if (eventMatchesChapter(prevValidEvent, currentChapter)) return prevValidEvent;
  return null;
}

export function resolveEventOrdinalForDisplay({
  currentEvent,
  prevValidEvent,
  currentChapter = null,
  progressTopBar,
  fallback = 0,
}) {
  const fromReading = eventUtils.resolveEventNum(
    pickReadingEventForChapter(currentEvent, prevValidEvent, currentChapter)
  );
  if (fromReading > 0) return fromReading;

  if (currentChapter == null || eventMatchesChapter(progressTopBar, currentChapter)) {
    const fromProgress = toPositiveNumberOrNull(progressTopBar?.eventNum);
    if (fromProgress) return fromProgress;
  }

  return toPositiveNumberOrNull(fallback) ?? 0;
}

export function getUnifiedEventInfoForTooltip({ currentEvent, prevValidEvent, eventNum }) {
  const eventToShow = currentEvent || prevValidEvent;
  if (!eventToShow) return { eventNum: eventNum || 0 };
  return {
    eventNum: eventUtils.resolveEventNum(eventToShow),
    name: resolveProgressEventName(eventToShow),
    chapterProgress: eventToShow.chapterProgress,
    currentChars: eventToShow.currentChars,
    totalChars: eventToShow.totalChars,
  };
}

function pickFineGraphResultEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const inner = event.event;
  if (
    inner &&
    typeof inner === 'object' &&
    (inner.chapterIdx != null ||
      inner.chapter != null ||
      inner.eventId != null ||
      inner.eventNum != null)
  ) {
    return inner;
  }
  if (
    eventUtils.resolveChapterIdx(event) != null &&
    (event.eventId != null || event.eventNum != null)
  ) {
    return event;
  }
  return null;
}

function resolveManifestEventMatch(event, bookId) {
  const fineEvent = pickFineGraphResultEvent(event);
  const eventId = eventUtils.resolveEventId(fineEvent);
  const chapterIdx = toPositiveNumberOrNull(
    eventUtils.resolveChapterIdx(fineEvent) ?? eventUtils.resolveChapterIdx(event)
  );
  const normalizedEventId = eventId == null ? '' : String(eventId).trim();
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  if (!normalizedBookId || !chapterIdx || !normalizedEventId) {
    return {
      title: '',
      eventNum: 0,
      eventId: normalizedEventId,
      chapterIdx: chapterIdx ?? 0,
      manifestEvent: null,
    };
  }

  const manifestEvent = findManifestEventInChapter(normalizedBookId, chapterIdx, {
    eventId: normalizedEventId,
  });

  return {
    title: resolveProgressEventName(manifestEvent),
    eventNum: eventUtils.resolveEventNum(manifestEvent),
    eventId: normalizedEventId,
    chapterIdx,
    manifestEvent,
  };
}

export function resolveServerEventMatch({
  book,
  fallbackBookId = null,
  currentChapter = null,
  event,
  eventUtils: eventUtilsRef = eventUtils,
  atLocator = null,
  resolveLocatorToEventParams = resolveFineGraphLocatorToEventParams,
}) {
  const bookId = resolveServerBookId(book) ?? toPositiveNumberOrNull(fallbackBookId);
  const anchorLocators = anchorToLocators(event?.anchor);
  const locator = toLocator(atLocator) ?? anchorLocators.startLocator;
  const endLocator = atLocator ? locator : anchorLocators.endLocator;
  const rawEventIdx = toPositiveNumberOrNull(eventUtilsRef.resolveEventNum(event));
  const rawChapter = toPositiveNumberOrNull(eventUtils.resolveChapterIdx(event) ?? currentChapter);
  const locatorChapter = toPositiveNumberOrNull(resolveChapterIndex(locator));
  const endChapter = toPositiveNumberOrNull(resolveChapterIndex(endLocator));
  const spansFromPreviousChapter =
    locatorChapter != null &&
    ((rawChapter != null && locatorChapter < rawChapter) ||
      (endChapter != null && locatorChapter < endChapter));

  if (!bookId) {
    return {
      bookId: null,
      chapterIdx: locatorChapter ?? rawChapter,
      eventIdx: rawEventIdx,
      atLocator: locator,
      source: rawEventIdx ? 'event' : 'none',
    };
  }

  const resolveLocatorMatch = () => {
    if (!locator) return null;
    const resolved = resolveLocatorToEventParams(bookId, locator, rawEventIdx ?? 1);
    const locatorEventIdx = toPositiveNumberOrNull(resolved?.eventIdx);
    if (!resolved?.resolved || !locatorEventIdx) return null;
    return {
      bookId,
      chapterIdx: toPositiveNumberOrNull(resolved.chapterIdx) ?? locatorChapter ?? rawChapter,
      eventIdx: locatorEventIdx,
      atLocator: locator,
      source: 'locator',
    };
  };

  if (spansFromPreviousChapter) {
    const boundaryLastEvent = getLastManifestEventInChapter(bookId, locatorChapter);
    const boundaryLastEventIdx = eventUtilsRef.resolveEventNum(boundaryLastEvent);
    if (boundaryLastEventIdx) {
      return {
        bookId,
        chapterIdx: locatorChapter,
        eventIdx: boundaryLastEventIdx,
        atLocator: locator,
        source: 'locator-boundary-last-event',
        manifestEvent: boundaryLastEvent,
      };
    }
    const locatorMatch = resolveLocatorMatch();
    if (locatorMatch) return locatorMatch;
  }

  const locatorMatch = resolveLocatorMatch();
  if (locatorMatch) return locatorMatch;

  const manifestMatch = resolveManifestEventMatch(event, bookId);
  if (manifestMatch.eventNum > 0) {
    return {
      bookId,
      chapterIdx: manifestMatch.chapterIdx || locatorChapter || rawChapter,
      eventIdx: manifestMatch.eventNum,
      atLocator: locator,
      source: 'manifest-event-id',
      manifestEvent: manifestMatch.manifestEvent,
    };
  }

  return {
    bookId,
    chapterIdx: locatorChapter ?? rawChapter,
    eventIdx: rawEventIdx,
    atLocator: locator,
    source: rawEventIdx ? 'event' : 'none',
  };
}

function applyChapterEventIndex(eventObj, eventIdx) {
  const normalizedEventIdx = toPositiveNumberOrNull(eventIdx);
  if (!normalizedEventIdx || !eventObj || typeof eventObj !== 'object') return eventObj;
  const previousEventIdx = eventUtils.resolveEventNum(eventObj);
  const eventChanged = previousEventIdx > 0 && previousEventIdx !== normalizedEventIdx;
  return {
    ...eventObj,
    eventNum: normalizedEventIdx,
    eventIdx: normalizedEventIdx,
    eventId: normalizedEventIdx,
    resolvedEventIdx: normalizedEventIdx,
    ...(eventChanged ? { eventName: '', eventTitle: '', name: '', title: '' } : {}),
  };
}

function applyResolvedEventMetadata(eventObj, manifestEvent) {
  if (!eventObj || !manifestEvent) return eventObj;
  const eventId = eventUtils.resolveEventId(manifestEvent);
  const eventName = resolveProgressEventName(manifestEvent);
  return {
    ...eventObj,
    ...(eventId != null ? { eventId } : {}),
    ...(eventName ? { eventName, eventTitle: eventName, name: eventName, title: eventName } : {}),
  };
}

export function resolveViewerLineEvent({
  receivedEvent,
  book,
  bookKey,
  eventUtils: eventUtilsRef = eventUtils,
  resolveLocatorToEventParams = resolveFineGraphLocatorToEventParams,
}) {
  if (!receivedEvent || typeof receivedEvent !== 'object') {
    return { nextEvent: receivedEvent, nextChapter: null, atLocator: null };
  }

  let nextEvent = receivedEvent;
  const match = resolveServerEventMatch({
    book,
    fallbackBookId: bookKey,
    event: nextEvent,
    eventUtils: eventUtilsRef,
    resolveLocatorToEventParams,
  });
  const resolvedEventIdx = toPositiveNumberOrNull(match.eventIdx) ?? 0;
  const resolvedChapter = toPositiveNumberOrNull(match.chapterIdx) ?? 0;
  const resolvedBookId = resolveServerBookId(book) ?? toPositiveNumberOrNull(bookKey);

  let nextChapter = null;
  if (resolvedChapter > 0) {
    nextChapter = resolvedChapter;
    nextEvent = { ...nextEvent, chapter: resolvedChapter, chapterIdx: resolvedChapter };
  }
  if (resolvedEventIdx > 0) nextEvent = applyChapterEventIndex(nextEvent, resolvedEventIdx);
  const manifestEvent =
    match.manifestEvent ??
    findManifestEventInChapter(
      resolvedBookId,
      resolvedChapter || eventUtils.resolveChapterIdx(nextEvent),
      { eventIdx: resolvedEventIdx }
    );
  nextEvent = applyResolvedEventMetadata(nextEvent, manifestEvent);

  return {
    nextEvent,
    nextChapter,
    atLocator: match.atLocator,
    resolvedEventIdx: eventUtils.resolveEventNum(nextEvent) || resolvedEventIdx,
  };
}

// --- 진도·TopBar·저장 payload ---

export const EMPTY_PROGRESS_TOP_BAR = {
  eventNum: null,
  chapterIdx: null,
  chapterProgress: null,
  readingProgressPercent: null,
  eventName: '',
};

export function normalizeReadingProgressPercent(data, options = {}) {
  return progressPercentFromData(data, options, (bookId, locator) =>
    readingProgressPercentFromLocator(bookId, locator)
  );
}

export function normalizeChapterProgressPercent(data, options = {}) {
  return progressPercentFromData(data, options, (bookId, locator) => {
    const metrics = resolveProgressMetricsFromLocator(bookId, locator);
    return metrics?.chapterProgress ?? null;
  });
}

export function toReadingLocatorKey(startLocator, endLocator) {
  const start = toLocator(startLocator);
  if (!start) return '';
  const end = toLocator(endLocator) ?? start;
  return JSON.stringify({ start, end });
}

/** anchor·locator 래퍼 → readingLocatorKey ({ start, end } JSON) */
export function toReadingLocatorKeyFromAnchor(anchor) {
  const { startLocator, endLocator } = anchorToLocators(anchor);
  return toReadingLocatorKey(startLocator, endLocator);
}

export function toReadingLocatorKeyFromRow(row) {
  const loc = toLocator(row?.startLocator ?? row?.locator);
  if (!loc) return '';
  return toReadingLocatorKey(loc, row?.endLocator ?? loc);
}

export function parseReadingLocatorKey(readingLocatorKey) {
  if (!readingLocatorKey) return { start: null, end: null };
  try {
    const parsed = JSON.parse(readingLocatorKey);
    const start = toLocator(parsed?.start);
    const end = toLocator(parsed?.end ?? parsed?.start) ?? start;
    return { start, end };
  } catch {
    return { start: null, end: null };
  }
}

export function resolveMetricsFromLocator(bookKey, locator, { metricsReady = true } = {}) {
  if (!bookKey || !metricsReady || !locator) return null;
  const start = toLocator(locator);
  return start ? resolveProgressMetricsFromLocator(bookKey, start) : null;
}

export function resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, options = {}) {
  if (!readingLocatorKey) return null;
  const { start } = parseReadingLocatorKey(readingLocatorKey);
  return resolveMetricsFromLocator(bookKey, start, options);
}

export function progressRowToTopBar(row, bookId = null) {
  if (!row || typeof row !== 'object') return { ...EMPTY_PROGRESS_TOP_BAR };
  const explicit = Number(row.eventNum);
  const fromId = eventUtils.resolveEventNum(row);
  const eventNum =
    Number.isFinite(explicit) && explicit > 0 ? explicit : fromId > 0 ? fromId : null;
  const loc = toLocator(row.startLocator ?? row.locator ?? row.anchor?.startLocator);
  const metrics = bookId && loc ? resolveProgressMetricsFromLocator(bookId, loc) : null;
  const chapterIdx = Number(
    eventUtils.resolveChapterIdx(row) ??
      toPositiveNumberOrNull(row.chapterNum) ??
      loc?.chapterIndex
  );
  return {
    eventNum,
    chapterIdx: Number.isFinite(chapterIdx) && chapterIdx > 0 ? chapterIdx : null,
    chapterProgress: metrics?.chapterProgress ?? null,
    readingProgressPercent: metrics?.readingProgressPercent ?? null,
    eventName: resolveProgressEventName(row),
  };
}

export function patchTopBarFromLineEvent(prev, nextEvent, lineLocator = null) {
  const previous =
    prev !== undefined && prev !== null && typeof prev === 'object'
      ? prev
      : { ...EMPTY_PROGRESS_TOP_BAR };
  const eventNum = eventUtils.resolveEventNum(nextEvent);
  const chapterIdx =
    eventUtils.resolveChapterIdx(nextEvent) ?? toPositiveNumberOrNull(resolveChapterIndex(lineLocator));
  return {
    ...previous,
    eventNum: eventNum > 0 ? eventNum : null,
    chapterIdx: Number.isFinite(chapterIdx) && chapterIdx > 0 ? chapterIdx : null,
    eventName: resolveProgressEventName(nextEvent),
  };
}

export function snapshotFromProgressRow(row, bookId) {
  const idStr = String(bookId);
  const topBar = progressRowToTopBar(row, idStr);
  return {
    topBar,
    anchor: progressResultToViewerAnchor(row),
    readingLocatorKey: toReadingLocatorKeyFromRow(row),
    readingProgressPercent: topBar.readingProgressPercent,
  };
}

export function shouldApplyCacheSnapshot(snapshot, liveLocatorKey, isViewerPageReady) {
  const cacheKey = snapshot?.readingLocatorKey ?? '';
  if (!cacheKey || !liveLocatorKey || !isViewerPageReady) return true;

  const { start: cacheStart } = parseReadingLocatorKey(cacheKey);
  const { start: liveStart } = parseReadingLocatorKey(liveLocatorKey);
  if (cacheStart && liveStart) return locatorsEqual(cacheStart, liveStart);
  return cacheKey === liveLocatorKey;
}

export function resolveReadingLocators(getCurrentLocator, currentEvent) {
  const fromViewer = getCurrentLocator?.();
  if (fromViewer) {
    const { startLocator, endLocator } = anchorToLocators(fromViewer);
    if (startLocator) return { startLocator, endLocator: endLocator ?? startLocator };
  }
  const { startLocator, endLocator } = anchorToLocators(currentEvent?.anchor);
  return { startLocator, endLocator: endLocator ?? startLocator };
}

function buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics) {
  if (!bookId || !startLocator) return null;
  return {
    resolvedMetrics: resolveSaveMetrics(bookId, startLocator, metrics),
    end: endLocator ?? startLocator,
    evName: resolveProgressEventName(currentEvent),
  };
}

export function buildProgressPayload(bookId, startLocator, endLocator, currentEvent, metrics = null) {
  const base = buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics);
  if (!base) return null;
  const { resolvedMetrics, end, evName } = base;
  const evn = Number(currentEvent?.eventNum);

  return {
    bookId: String(bookId),
    startLocator,
    endLocator: end,
    locator: startLocator,
    ...(resolvedMetrics?.readingProgressPercent != null
      ? { readingProgressPercent: resolvedMetrics.readingProgressPercent }
      : {}),
    ...(resolvedMetrics?.chapterProgress != null
      ? { chapterProgress: resolvedMetrics.chapterProgress }
      : {}),
    ...(Number.isFinite(evn) && evn > 0 ? { eventNum: evn } : {}),
    ...(evName ? { eventName: evName } : {}),
  };
}

export function buildSaveLocationPayload(bookId, startLocator, endLocator, currentEvent, metrics = null) {
  const base = buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics);
  if (!base) return null;
  const { resolvedMetrics, end, evName } = base;
  const numericBookId = Number(bookId);

  return {
    bookId: Number.isFinite(numericBookId) && numericBookId > 0 ? numericBookId : null,
    startLocator,
    endLocator: end,
    locator: startLocator,
    chapterIdx: startLocator.chapterIndex,
    eventIdx: Number(currentEvent?.eventNum),
    eventNum: Number(currentEvent?.eventNum),
    eventId: eventUtils.resolveEventId(currentEvent),
    eventName: evName || null,
    chapterProgress: resolvedMetrics?.chapterProgress ?? null,
    source: 'runtime',
  };
}

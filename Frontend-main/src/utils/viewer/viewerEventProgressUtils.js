/** 뷰어 이벤트 매칭·manifest·진도·TopBar·저장 payload */

import {
  toLocator,
  progressResultToViewerAnchor,
  locatorsEqual,
  resolveProgressLocator,
  toViewerResumeAnchor,
  anchorToLocators,
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

export function resolveProgressEventName(source) {
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
  };
}

function pickFineGraphResultEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const inner = event.event;
  const hasIdentity = (obj) => obj.eventId != null || obj.eventNum != null;
  const hasChapter = (obj) => obj.chapterIdx != null || obj.chapter != null;

  if (inner && typeof inner === 'object' && (hasChapter(inner) || hasIdentity(inner))) {
    return inner;
  }
  if (eventUtils.resolveChapterIdx(event) != null && hasIdentity(event)) {
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
    return { eventNum: 0, chapterIdx: chapterIdx ?? 0, manifestEvent: null };
  }

  const manifestEvent = findManifestEventInChapter(normalizedBookId, chapterIdx, {
    eventId: normalizedEventId,
  });
  return {
    eventNum: eventUtils.resolveEventNum(manifestEvent),
    chapterIdx,
    manifestEvent,
  };
}

function eventMatchResult({ bookId, chapterIdx, eventIdx, atLocator, source, manifestEvent }) {
  return {
    bookId,
    chapterIdx,
    eventIdx,
    atLocator,
    source,
    ...(manifestEvent ? { manifestEvent } : {}),
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

  const fallbackMatch = () =>
    eventMatchResult({
      bookId: bookId ?? null,
      chapterIdx: locatorChapter ?? rawChapter,
      eventIdx: rawEventIdx,
      atLocator: locator,
      source: rawEventIdx ? 'event' : 'none',
    });

  if (!bookId) return fallbackMatch();

  if (spansFromPreviousChapter) {
    const boundaryLastEvent = getLastManifestEventInChapter(bookId, locatorChapter);
    const boundaryLastEventIdx = eventUtilsRef.resolveEventNum(boundaryLastEvent);
    if (boundaryLastEventIdx) {
      return eventMatchResult({
        bookId,
        chapterIdx: locatorChapter,
        eventIdx: boundaryLastEventIdx,
        atLocator: locator,
        source: 'locator-boundary-last-event',
        manifestEvent: boundaryLastEvent,
      });
    }
  }

  if (locator) {
    const resolved = resolveLocatorToEventParams(bookId, locator, rawEventIdx ?? 1);
    const locatorEventIdx = toPositiveNumberOrNull(resolved?.eventIdx);
    if (resolved?.resolved && locatorEventIdx) {
      return eventMatchResult({
        bookId,
        chapterIdx: toPositiveNumberOrNull(resolved.chapterIdx) ?? locatorChapter ?? rawChapter,
        eventIdx: locatorEventIdx,
        atLocator: locator,
        source: 'locator',
      });
    }
  }

  const manifestMatch = resolveManifestEventMatch(event, bookId);
  if (manifestMatch.eventNum > 0) {
    return eventMatchResult({
      bookId,
      chapterIdx: manifestMatch.chapterIdx || locatorChapter || rawChapter,
      eventIdx: manifestMatch.eventNum,
      atLocator: locator,
      source: 'manifest-event-id',
      manifestEvent: manifestMatch.manifestEvent,
    });
  }

  return fallbackMatch();
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

const EMPTY_PROGRESS_TOP_BAR = {
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
  const metrics = resolveMetricsFromLocator(bookId, loc);
  const chapterIdx = toPositiveNumberOrNull(
    eventUtils.resolveChapterIdx(row) ??
      toPositiveNumberOrNull(row.chapterNum) ??
      loc?.chapterIndex
  );

  return {
    eventNum,
    chapterIdx,
    chapterProgress: metrics?.chapterProgress ?? null,
    readingProgressPercent: metrics?.readingProgressPercent ?? null,
    eventName: resolveProgressEventName(row),
  };
}

export function patchTopBarFromLineEvent(prev, nextEvent, lineLocator = null) {
  const previous =
    prev != null && typeof prev === 'object' ? prev : { ...EMPTY_PROGRESS_TOP_BAR };
  const eventNum = eventUtils.resolveEventNum(nextEvent);
  const chapterIdx = toPositiveNumberOrNull(
    eventUtils.resolveChapterIdx(nextEvent) ??
      toPositiveNumberOrNull(resolveChapterIndex(lineLocator))
  );

  return {
    ...previous,
    eventNum: eventNum > 0 ? eventNum : null,
    chapterIdx,
    eventName: resolveProgressEventName(nextEvent),
  };
}

export function snapshotFromProgressRow(row, bookId) {
  const idStr = String(bookId);
  const topBar = progressRowToTopBar(row, idStr);
  return {
    topBar,
    anchor: progressResultToViewerAnchor(row),
    readingLocatorKey: toReadingLocatorKey(
      row?.startLocator ?? row?.locator,
      row?.endLocator
    ),
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
    const pair = toViewerResumeAnchor(fromViewer);
    if (pair?.startLocator) return pair;
  }
  return toViewerResumeAnchor(currentEvent?.anchor) ?? { startLocator: null, endLocator: null };
}

function buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics) {
  if (!bookId || !startLocator) return null;
  return {
    startLocator,
    endLocator: endLocator ?? startLocator,
    locator: startLocator,
    resolvedMetrics: metrics ?? resolveProgressMetricsFromLocator(bookId, startLocator),
    eventName: resolveProgressEventName(currentEvent),
    eventNum: Number(currentEvent?.eventNum),
  };
}

export function buildProgressPayload(bookId, startLocator, endLocator, currentEvent, metrics = null) {
  const base = buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics);
  if (!base) return null;

  const { resolvedMetrics, eventName, eventNum, ...locs } = base;
  return {
    bookId: String(bookId),
    ...locs,
    ...(resolvedMetrics?.readingProgressPercent != null
      ? { readingProgressPercent: resolvedMetrics.readingProgressPercent }
      : {}),
    ...(resolvedMetrics?.chapterProgress != null
      ? { chapterProgress: resolvedMetrics.chapterProgress }
      : {}),
    ...(Number.isFinite(eventNum) && eventNum > 0 ? { eventNum } : {}),
    ...(eventName ? { eventName } : {}),
  };
}

export function buildSaveLocationPayload(bookId, startLocator, endLocator, currentEvent, metrics = null) {
  const base = buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics);
  if (!base) return null;

  const numericBookId = Number(bookId);
  return {
    bookId: Number.isFinite(numericBookId) && numericBookId > 0 ? numericBookId : null,
    startLocator: base.startLocator,
    endLocator: base.endLocator,
    locator: base.locator,
    chapterIdx: base.startLocator.chapterIndex,
    eventIdx: base.eventNum,
    eventNum: base.eventNum,
    eventId: eventUtils.resolveEventId(currentEvent),
    eventName: base.eventName || null,
    chapterProgress: base.resolvedMetrics?.chapterProgress ?? null,
    source: 'runtime',
  };
}

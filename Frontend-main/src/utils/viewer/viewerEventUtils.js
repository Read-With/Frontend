/** 뷰어 이벤트: 표시 번호·서버 매칭·라인 이벤트 해석 */

import { anchorToLocators, toLocator } from '../common/locatorUtils';
import {
  getChapterData,
  resolveFineGraphLocatorToEventParams,
} from '../common/cache/manifestCache';
import { toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/numberUtils';
import { getServerBookId } from './viewerUtils';

function pickReadingEvent(currentEvent, prevValidEvent) {
  return currentEvent || prevValidEvent || null;
}

export function eventMatchesChapter(event, chapter) {
  if (!event || typeof event !== 'object') return false;
  const eventChapter = Number(event.chapter ?? event.chapterIdx);
  const currentChapter = Number(chapter);
  return !Number.isFinite(eventChapter) || eventChapter === currentChapter;
}

function pickReadingEventForChapter(currentEvent, prevValidEvent, currentChapter) {
  if (currentChapter == null) {
    return pickReadingEvent(currentEvent, prevValidEvent);
  }
  if (eventMatchesChapter(currentEvent, currentChapter)) return currentEvent;
  if (eventMatchesChapter(prevValidEvent, currentChapter)) return prevValidEvent;
  return null;
}

const positiveOrZero = (value) => toPositiveNumberOrNull(value) ?? 0;

function eventNumFromStringId(raw) {
  return toPositiveNumberFromId(raw) ?? 0;
}

export function resolveDisplayedEventNum(event) {
  if (!event || typeof event !== 'object') return 0;

  const direct =
    positiveOrZero(event.eventNum) ||
    positiveOrZero(event.eventIdx) ||
    positiveOrZero(event.resolvedEventIdx) ||
    positiveOrZero(event.originalEventIdx);
  if (direct) return direct;

  const inner = event.event;
  if (inner && typeof inner === 'object') {
    const innerNum =
      positiveOrZero(inner.eventNum) ||
      positiveOrZero(inner.eventIdx) ||
      positiveOrZero(inner.idx) ||
      positiveOrZero(inner.event_idx);
    if (innerNum) return innerNum;

    const innerIdNum = eventNumFromStringId(inner.eventId) || eventNumFromStringId(inner.id);
    if (innerIdNum) return innerIdNum;
  }

  return eventNumFromStringId(event.eventId) || eventNumFromStringId(event.id);
}

export function resolveViewerDisplayEventNum({
  currentEvent,
  prevValidEvent,
  currentChapter = null,
  progressTopBar,
  fallback = 0,
}) {
  const reading = pickReadingEventForChapter(currentEvent, prevValidEvent, currentChapter);
  const fromReading = resolveDisplayedEventNum(reading);
  if (fromReading > 0) return fromReading;

  if (currentChapter == null || eventMatchesChapter(progressTopBar, currentChapter)) {
    const fromProgress = toPositiveNumberOrNull(progressTopBar?.eventNum);
    if (fromProgress) return fromProgress;
  }

  return positiveOrZero(fallback);
}

function eventFieldsForTooltip(eventToShow) {
  if (!eventToShow) return null;
  return {
    eventNum: resolveDisplayedEventNum(eventToShow),
    name: eventToShow.name || eventToShow.event_name || '',
    chapterProgress: eventToShow.chapterProgress,
    currentChars: eventToShow.currentChars,
    totalChars: eventToShow.totalChars,
  };
}

export function getUnifiedEventInfoForNodeTooltip({
  currentEvent,
  prevValidEvent,
  eventNum,
  chapterNum: _chapterNum,
  folderKey: _folderKey,
}) {
  const fields = eventFieldsForTooltip(pickReadingEvent(currentEvent, prevValidEvent));
  return fields || { eventNum: eventNum || 0 };
}

export function getUnifiedEventInfoForEdgeTooltip({ currentEvent, prevValidEvent, eventNum }) {
  const fields = eventFieldsForTooltip(pickReadingEvent(currentEvent, prevValidEvent));
  return fields || { eventNum: eventNum || 0 };
}

export function resolveViewerServerBookId(book, fallbackBookId = null) {
  return getServerBookId(book) ?? toPositiveNumberOrNull(fallbackBookId);
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
    toPositiveNumberOrNull(event.chapterIdx ?? event.chapter) != null &&
    (event.eventId != null || event.eventNum != null)
  ) {
    return event;
  }
  return null;
}

function resolveEventNumber(event) {
  return toPositiveNumberOrNull(event?.eventNum ?? event?.idx ?? event?.eventIdx);
}

export function resolveManifestEventMatch(event, bookId) {
  const fineEvent = pickFineGraphResultEvent(event);
  const eventId = fineEvent?.eventId ?? fineEvent?.id;
  const chapterIdx = toPositiveNumberOrNull(
    fineEvent?.chapterIdx ?? fineEvent?.chapter ?? event?.chapterIdx ?? event?.chapter
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

  const chapterData = getChapterData(normalizedBookId, chapterIdx);
  const events = Array.isArray(chapterData?.events) ? chapterData.events : [];
  const manifestEvent = events.find((row) => String(row?.eventId ?? '').trim() === normalizedEventId) ?? null;
  const eventNum = resolveEventNumber(manifestEvent) ?? 0;

  return {
    title: String(manifestEvent?.eventName ?? manifestEvent?.title ?? manifestEvent?.name ?? '').trim(),
    eventNum,
    eventId: normalizedEventId,
    chapterIdx,
    manifestEvent,
  };
}

function resolveChapterLastManifestEvent(bookId, chapterIdx) {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  const normalizedChapterIdx = toPositiveNumberOrNull(chapterIdx);
  if (!normalizedBookId || !normalizedChapterIdx) return null;

  const chapterData = getChapterData(normalizedBookId, normalizedChapterIdx);
  const events = Array.isArray(chapterData?.events) ? chapterData.events : [];
  return events.reduce((last, event) => {
    const eventNum = resolveEventNumber(event);
    if (!eventNum) return last;
    const lastNum = resolveEventNumber(last) ?? 0;
    return eventNum >= lastNum ? event : last;
  }, null);
}

export function resolveServerEventMatch({
  book,
  fallbackBookId = null,
  currentChapter = null,
  event,
  eventUtils,
  atLocator = null,
  resolveLocatorToEventParams = resolveFineGraphLocatorToEventParams,
}) {
  const bookId = resolveViewerServerBookId(book, fallbackBookId);
  const anchorLocators = anchorToLocators(event?.anchor);
  const locator = toLocator(atLocator) ?? anchorLocators.startLocator;
  const endLocator = atLocator ? locator : anchorLocators.endLocator;
  const rawEventIdx = toPositiveNumberOrNull(eventUtils?.extractRawEventIdx?.(event));
  const rawChapter = toPositiveNumberOrNull(event?.chapter ?? event?.chapterIdx ?? currentChapter);
  const locatorChapter = toPositiveNumberOrNull(locator?.chapterIndex);
  const endChapter = toPositiveNumberOrNull(endLocator?.chapterIndex);
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
    if (!resolved?.resolved || !locatorEventIdx) {
      return null;
    }
    return {
      bookId,
      chapterIdx: toPositiveNumberOrNull(resolved.chapterIdx) ?? locatorChapter ?? rawChapter,
      eventIdx: locatorEventIdx,
      atLocator: locator,
      source: 'locator',
    };
  };

  if (spansFromPreviousChapter) {
    const boundaryLastEvent = resolveChapterLastManifestEvent(bookId, locatorChapter);
    const boundaryLastEventIdx = resolveEventNumber(boundaryLastEvent);
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

  const locatorMatch = resolveLocatorMatch();
  if (locatorMatch) return locatorMatch;

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
  if (!normalizedEventIdx || !eventObj || typeof eventObj !== 'object') {
    return eventObj;
  }
  return {
    ...eventObj,
    eventNum: normalizedEventIdx,
    eventIdx: normalizedEventIdx,
    event_id: normalizedEventIdx,
    resolvedEventIdx: normalizedEventIdx,
  };
}

function copyPreviousEventIdentity(nextEvent, previousEvent) {
  const identityFields = ['event', 'eventId', 'id', 'name', 'title', 'eventName', 'eventTitle'];
  return identityFields.reduce((acc, field) => {
    acc[field] = previousEvent[field] ?? (field === 'eventId' ? previousEvent.id : undefined) ?? acc[field];
    return acc;
  }, { ...nextEvent });
}

function keepSameChapterEventFromRegressing(nextEvent, previousEvent) {
  if (!nextEvent || !previousEvent) {
    return nextEvent;
  }

  const nextChapter = toPositiveNumberOrNull(nextEvent.chapter ?? nextEvent.chapterIdx);
  const previousChapter = toPositiveNumberOrNull(previousEvent.chapter ?? previousEvent.chapterIdx);
  if (!nextChapter || !previousChapter || nextChapter !== previousChapter) {
    return nextEvent;
  }

  const nextIdx = resolveDisplayedEventNum(nextEvent);
  const previousIdx = resolveDisplayedEventNum(previousEvent);
  if (!nextIdx || !previousIdx || nextIdx >= previousIdx) {
    return nextEvent;
  }

  return applyChapterEventIndex(copyPreviousEventIdentity(nextEvent, previousEvent), previousIdx);
}

export function resolveViewerLineEvent({
  receivedEvent,
  book,
  cleanBookId,
  eventUtils,
  previousEvent = null,
  resolveLocatorToEventParams = resolveFineGraphLocatorToEventParams,
}) {
  if (!receivedEvent || typeof receivedEvent !== 'object') {
    return { nextEvent: receivedEvent, nextChapter: null, atLocator: null };
  }

  let nextEvent = receivedEvent;
  const match = resolveServerEventMatch({
    book,
    fallbackBookId: cleanBookId,
    event: nextEvent,
    eventUtils,
    resolveLocatorToEventParams,
  });
  const resolvedEventIdx = toPositiveNumberOrNull(match.eventIdx) ?? 0;
  const resolvedChapter = toPositiveNumberOrNull(match.chapterIdx) ?? 0;

  let nextChapter = null;
  if (resolvedChapter > 0) {
    nextChapter = resolvedChapter;
    nextEvent = {
      ...nextEvent,
      chapter: resolvedChapter,
      chapterIdx: resolvedChapter,
    };
  }

  if (resolvedEventIdx > 0) {
    nextEvent = applyChapterEventIndex(nextEvent, resolvedEventIdx);
  }

  nextEvent = keepSameChapterEventFromRegressing(nextEvent, previousEvent);

  return {
    nextEvent,
    nextChapter,
    atLocator: match.atLocator,
    resolvedEventIdx: resolveDisplayedEventNum(nextEvent) || resolvedEventIdx,
  };
}

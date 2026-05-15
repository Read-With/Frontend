import { anchorToLocators, toLocator } from '../common/locatorUtils';
import { getChapterData, resolveFineGraphLocatorToEventParams } from '../common/cache/manifestCache';
import { toPositiveNumberOrNull } from '../common/numberUtils';
import { getServerBookId } from './viewerUtils';

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

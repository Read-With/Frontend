import { toLocator } from '../common/locatorUtils';
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
  const eventNum = toPositiveNumberOrNull(manifestEvent?.eventNum ?? manifestEvent?.idx ?? manifestEvent?.eventIdx) ?? 0;

  return {
    title: String(manifestEvent?.eventName ?? manifestEvent?.title ?? manifestEvent?.name ?? '').trim(),
    eventNum,
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
  eventUtils,
  atLocator = null,
  resolveLocatorToEventParams = resolveFineGraphLocatorToEventParams,
}) {
  const bookId = resolveViewerServerBookId(book, fallbackBookId);
  const locator = toLocator(atLocator ?? event?.anchor?.startLocator ?? event?.anchor?.start);
  const rawEventIdx = toPositiveNumberOrNull(eventUtils?.extractRawEventIdx?.(event));
  const rawChapter = toPositiveNumberOrNull(event?.chapter ?? event?.chapterIdx ?? currentChapter);
  const locatorChapter = toPositiveNumberOrNull(locator?.chapterIndex);

  if (!bookId) {
    return {
      bookId: null,
      chapterIdx: locatorChapter ?? rawChapter,
      eventIdx: rawEventIdx,
      atLocator: locator,
      source: rawEventIdx ? 'event' : 'none',
    };
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

  if (locator) {
    const resolved = resolveLocatorToEventParams(bookId, locator, rawEventIdx ?? 1);
    const locatorEventIdx = toPositiveNumberOrNull(resolved?.eventIdx);
    if (resolved?.resolved && locatorEventIdx) {
      return {
        bookId,
        chapterIdx: toPositiveNumberOrNull(resolved.chapterIdx) ?? locatorChapter ?? rawChapter,
        eventIdx: locatorEventIdx,
        atLocator: locator,
        source: 'locator',
      };
    }
  }

  return {
    bookId,
    chapterIdx: locatorChapter ?? rawChapter,
    eventIdx: rawEventIdx,
    atLocator: locator,
    source: rawEventIdx ? 'event' : 'none',
  };
}

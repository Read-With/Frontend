import { getChapterData } from '../common/cache/manifestCache';
import { toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/numberUtils';
import { resolveManifestEventMatch } from './serverEventMatcher';

function pickReadingEvent(currentEvent, prevValidEvent) {
  return currentEvent || prevValidEvent || null;
}

const positiveOrZero = (value) => {
  return toPositiveNumberOrNull(value) ?? 0;
};

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

function maxEventNumFromManifest(bookId, chapterIdx) {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  const normalizedChapterIdx = toPositiveNumberOrNull(chapterIdx);
  if (!normalizedBookId || !normalizedChapterIdx) {
    return 0;
  }

  const chapterData = getChapterData(normalizedBookId, normalizedChapterIdx);
  const events = Array.isArray(chapterData?.events) ? chapterData.events : [];
  return events.reduce((max, row) => {
    const eventNum = toPositiveNumberOrNull(row?.eventNum ?? row?.idx ?? row?.eventIdx);
    return eventNum && eventNum > max ? eventNum : max;
  }, 0);
}

export function resolveViewerDisplayEventNum({
  currentEvent,
  prevValidEvent,
  progressTopBar,
  fallback = 0,
}) {
  const reading = pickReadingEvent(currentEvent, prevValidEvent);
  const fromReading = resolveDisplayedEventNum(reading);
  if (fromReading > 0) return fromReading;

  const fromProgress = toPositiveNumberOrNull(progressTopBar?.eventNum);
  if (fromProgress) return fromProgress;

  return positiveOrZero(fallback);
}

export function resolveViewerEventDisplayInfo({
  currentEvent,
  prevValidEvent,
  progressTopBar,
  bookId,
  currentChapter,
  maxEventNum,
  fallback = 0,
}) {
  const row = progressTopBar ?? {
    eventNum: null,
    chapterProgress: null,
    readingProgressPercent: null,
    eventName: '',
  };
  const reading = pickReadingEvent(currentEvent, prevValidEvent);
  const panel = bookId != null
    ? resolveManifestEventMatch(reading, bookId)
    : { title: '', eventNum: 0, eventId: '' };
  const eventNum =
    resolveViewerDisplayEventNum({ currentEvent, prevValidEvent, progressTopBar: row, fallback }) ||
    panel.eventNum;
  const loaderMax = toPositiveNumberOrNull(maxEventNum);
  const manifestMax = maxEventNumFromManifest(bookId, currentChapter);
  const totalEventNum = loaderMax || manifestMax;
  const eventDisplay =
    eventNum > 0 ? (totalEventNum >= eventNum ? `${eventNum}/${totalEventNum}` : String(eventNum)) : '?';
  const eventNameFromCurrent = String(
    reading?.name ?? reading?.event_name ?? reading?.eventTitle ?? ''
  ).trim();
  const eventNameFromProgress = String(row.eventName ?? '').trim();

  return {
    eventNum,
    totalEventNum,
    eventDisplay,
    eventTitle: panel.eventId || undefined,
    eventNameLabel: panel.title || eventNameFromCurrent || eventNameFromProgress || '',
  };
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

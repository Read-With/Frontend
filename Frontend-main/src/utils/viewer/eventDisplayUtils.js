import { toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/numberUtils';

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

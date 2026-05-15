import { resolveFineGraphLocatorToEventParams } from '../common/cache/manifestCache';
import { toPositiveNumberOrNull } from '../common/numberUtils';
import { resolveDisplayedEventNum } from './eventDisplayUtils';
import { resolveServerEventMatch } from './serverEventMatcher';

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

import { anchorToLocators } from '../common/locatorUtils';
import { resolveFineGraphLocatorToEventParams } from '../common/cache/manifestCache';
import { toPositiveNumberOrNull } from '../common/numberUtils';
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

export function resolveViewerLineEvent({
  receivedEvent,
  book,
  cleanBookId,
  eventUtils,
  resolveLocatorToEventParams = resolveFineGraphLocatorToEventParams,
}) {
  if (!receivedEvent || typeof receivedEvent !== 'object') {
    return { nextEvent: receivedEvent, nextChapter: null, atLocator: null };
  }

  let nextEvent = receivedEvent;
  const { startLocator } = anchorToLocators(nextEvent.anchor);
  const match = resolveServerEventMatch({
    book,
    fallbackBookId: cleanBookId,
    event: nextEvent,
    eventUtils,
    resolveLocatorToEventParams,
  });
  const resolvedEventIdx = toPositiveNumberOrNull(match.eventIdx) ?? 0;
  const resolvedChapter = toPositiveNumberOrNull(match.chapterIdx ?? startLocator?.chapterIndex) ?? 0;

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

  return {
    nextEvent,
    nextChapter,
    atLocator: match.atLocator,
    resolvedEventIdx,
  };
}

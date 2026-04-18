import { getChapterLastEventNums } from '../graph/graphData.js';

export function pickReadingEvent(currentEvent, prevValidEvent) {
  return currentEvent || prevValidEvent || null;
}

export function eventFieldsForTooltip(eventToShow) {
  if (!eventToShow) return null;
  return {
    eventNum: eventToShow.eventNum ?? 0,
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
  chapterNum,
  folderKey,
}) {
  const eventToShow = pickReadingEvent(currentEvent, prevValidEvent);
  const fields = eventFieldsForTooltip(eventToShow);
  if (fields) return fields;
  if (!eventNum || eventNum === 0) {
    const lastEventNums = getChapterLastEventNums(folderKey);
    return { eventNum: lastEventNums[chapterNum - 1] || 1 };
  }
  return { eventNum: eventNum || 0 };
}

export function getUnifiedEventInfoForEdgeTooltip({ currentEvent, prevValidEvent, eventNum }) {
  const eventToShow = pickReadingEvent(currentEvent, prevValidEvent);
  const fields = eventFieldsForTooltip(eventToShow);
  if (fields) return fields;
  return { eventNum: eventNum || 0 };
}

export function viewerTopBarEventLabels(eventToShow) {
  if (!eventToShow) return null;
  return {
    eventNum: eventToShow.eventNum ?? 0,
    name: eventToShow.name || eventToShow.event_name || '',
  };
}

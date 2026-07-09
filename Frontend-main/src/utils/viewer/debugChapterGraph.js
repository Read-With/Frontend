import { getBookManifest } from '../api/api';
import {
  discoverChapterEvents,
  getGraphEventState,
} from '../common/cache/chapterEventCache';
import { eventUtils } from './viewerCoreStateUtils';

const findRawEvent = (rawEvents, eventIdx) => {
  if (!Array.isArray(rawEvents)) return null;
  return rawEvents.find((event) => eventUtils.extractRawEventIdx(event) === eventIdx) ?? null;
};

/** 챕터 이벤트 1~끝 fine graph를 서버에서 조회해 콘솔에 출력 */
export async function debugChapterGraphFromServer(
  bookId,
  chapterIdx = 1,
  { forceRefresh = true, logEachEvent = true } = {}
) {
  const numericBookId = Number(bookId);
  const numericChapter = Number(chapterIdx);

  if (!Number.isFinite(numericBookId) || numericBookId <= 0) {
    console.warn('[debugChapterGraph] 유효한 bookId가 필요합니다.', { bookId });
    return null;
  }
  if (!Number.isFinite(numericChapter) || numericChapter < 1) {
    console.warn('[debugChapterGraph] 유효한 chapterIdx가 필요합니다.', { chapterIdx });
    return null;
  }

  console.log(`[debugChapterGraph] ch${numericChapter} 서버 조회 시작`, { bookId: numericBookId });

  await getBookManifest(numericBookId);
  const payload = await discoverChapterEvents(numericBookId, numericChapter, forceRefresh);
  const maxEventIdx = Number(payload?.maxEventIdx) || 0;

  if (!maxEventIdx) {
    console.warn(`[debugChapterGraph] ch${numericChapter}: 이벤트 없음`, payload);
    return { bookId: numericBookId, chapterIdx: numericChapter, maxEventIdx: 0, events: [] };
  }

  const events = [];

  for (let eventIdx = 1; eventIdx <= maxEventIdx; eventIdx += 1) {
    const graphState = getGraphEventState(numericBookId, numericChapter, eventIdx);
    const rawEvent = findRawEvent(payload.rawEvents, eventIdx);

    const characters = graphState?.characters ?? rawEvent?.characters ?? [];
    const relations = rawEvent?.relations ?? [];
    const elements = graphState?.elements ?? [];

    const row = {
      eventIdx,
      eventMeta: graphState?.eventMeta ?? rawEvent?.event ?? null,
      characters,
      relations,
      elements,
      counts: {
        characters: characters.length,
        relations: relations.length,
        elements: elements.length,
      },
    };
    events.push(row);

    if (logEachEvent) {
      console.group(`[debugChapterGraph] ch${numericChapter} event ${eventIdx}/${maxEventIdx}`);
      console.log('eventMeta', row.eventMeta);
      console.log('characters', row.characters);
      console.log('relations', row.relations);
      console.log('elements (graph nodes/edges)', row.elements);
      console.groupEnd();
    }
  }

  const summary = {
    bookId: numericBookId,
    chapterIdx: numericChapter,
    maxEventIdx,
    totalEvents: events.length,
    eventSummaries: payload.eventSummaries ?? [],
    events,
  };

  console.log(
    `[debugChapterGraph] ch${numericChapter} 완료 (event 1~${maxEventIdx})`,
    summary
  );
  console.table(
    events.map((event) => ({
      eventIdx: event.eventIdx,
      characters: event.counts.characters,
      relations: event.counts.relations,
      elements: event.counts.elements,
      title: event.eventMeta?.name ?? event.eventMeta?.title ?? '',
    }))
  );

  return summary;
}

import { getBookManifest, getFineGraph } from '../api/api';
import { resolveFineGraphEventToLocator } from '../common/cache/manifestCache';

/** event 1 ~ throughEventIdx — Fine Graph API response.result 날것 출력 (캐시·누적 가공 없음) */
export async function debugChapterGraphFromServer(
  bookId,
  chapterIdx = 1,
  { throughEventIdx = null, logEachEvent = true } = {}
) {
  const numericBookId = Number(bookId);
  const numericChapter = Number(chapterIdx);
  const through = Number(throughEventIdx);

  if (!Number.isFinite(numericBookId) || numericBookId <= 0) {
    console.warn('[debugChapterGraph] 유효한 bookId가 필요합니다.', { bookId });
    return null;
  }
  if (!Number.isFinite(numericChapter) || numericChapter < 1) {
    console.warn('[debugChapterGraph] 유효한 chapterIdx가 필요합니다.', { chapterIdx });
    return null;
  }
  if (!Number.isFinite(through) || through < 1) {
    console.warn('[debugChapterGraph] throughEventIdx(현재 event)가 필요합니다.', { throughEventIdx });
    return null;
  }

  console.log(
    `[debugChapterGraph] ch${numericChapter} Fine Graph API 날것 (event 1~${through})`,
    { bookId: numericBookId }
  );

  await getBookManifest(numericBookId);

  const rows = [];

  for (let eventIdx = 1; eventIdx <= through; eventIdx += 1) {
    const atLocator = resolveFineGraphEventToLocator(numericBookId, numericChapter, eventIdx);
    const response = await getFineGraph(numericBookId, numericChapter, eventIdx, atLocator);
    const raw = response?.result ?? null;

    const row = {
      eventIdx,
      locator: atLocator,
      isSuccess: Boolean(response?.isSuccess),
      code: response?.code ?? '',
      message: response?.message ?? '',
      raw,
    };
    rows.push(row);

    if (logEachEvent) {
      console.group(
        `[debugChapterGraph] ch${numericChapter} event ${eventIdx} API 날것`
      );
      console.log('locator', atLocator);
      console.log('response', response);
      console.log('result (날것)', raw);
      if (raw) {
        console.log('characters', raw.characters);
        console.log('relations', raw.relations);
        console.log('scope', raw.scope);
        console.log('eventId', raw.eventId);
        console.log('chapterIndex', raw.chapterIndex);
      }
      console.groupEnd();
    }
  }

  const summary = {
    bookId: numericBookId,
    chapterIdx: numericChapter,
    throughEventIdx: through,
    totalEvents: rows.length,
    rows,
  };

  console.log(
    `[debugChapterGraph] ch${numericChapter} 완료 — event 1~${through} API 날것`,
    summary
  );
  console.table(
    rows.map((row) => ({
      eventIdx: row.eventIdx,
      isSuccess: row.isSuccess,
      code: row.code,
      chapterIndex: row.raw?.chapterIndex ?? '',
      scope: row.raw?.scope ?? '',
      eventId: row.raw?.eventId ?? '',
      characters: Array.isArray(row.raw?.characters) ? row.raw.characters.length : 0,
      relations: Array.isArray(row.raw?.relations) ? row.raw.relations.length : 0,
    }))
  );

  return summary;
}

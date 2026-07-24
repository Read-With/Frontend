/** 뷰어 그래프 파이프라인: API/캐시 조회·변환·타깃 계산 */

import { processRelations } from '../graph/graphCore';
import {
  buildNodeWeights,
  createCharacterMaps,
  toNodeWeightsOrNull,
  aggregateCharactersFromEvents,
  convertRelationsToElements,
  getGraphEventState,
  getChapterEventFallbackData,
  getCachedChapterEvents,
} from '../graph/graphModel';
import {
  enrichGraphCharacters,
  applyDisplayNamesToElements,
} from '../graph/graphCore';
import { resolveGraphElementsProfileImages } from '../common/urlUtils';
import { resolveChapterIndex, toPositiveInt, toPositiveNumberOrNull } from '../common/valueUtils';
import { cacheKeyUtils, eventUtils } from './viewerCore';
import { resolveServerEventMatch } from './viewerSession';

export const DEFAULT_GRAPH_TRANSFORM_DEPS = {
  createCharacterMaps,
  buildNodeWeights,
  convertRelationsToElements,
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** elements 설정 + 프로필 이미지 비동기 resolve (stale guard 지원) */
export function commitVisibleGraphElements(setElements, nextElements, { applyTokenRef } = {}) {
  const visibleElements = Array.isArray(nextElements) ? nextElements : [];
  setElements(visibleElements);
  const token = applyTokenRef ? ++applyTokenRef.current : null;
  void resolveGraphElementsProfileImages(visibleElements).then((resolved) => {
    if (applyTokenRef && token !== applyTokenRef.current) return;
    setElements(resolved);
  });
  return visibleElements;
}

/** deltas 누적 graph 호출 컨텍스트 (book/chapter/eventIdx/callKey) */
export function resolveGraphCallContext({ book, currentChapter, currentEvent }) {
  const match = resolveServerEventMatch({ book, currentChapter, event: currentEvent });
  const bookId = Number(match.bookId);
  const chapter =
    toPositiveInt(eventUtils.resolveChapterIdx(currentEvent), 0) ||
    toPositiveInt(match.chapterIdx, 0) ||
    Number(currentChapter);
  const eventIdx = eventUtils.resolveEventNum(currentEvent, toPositiveInt(match.eventIdx, 0));

  if (!bookId || !chapter) return null;

  return {
    bookId,
    chapter,
    eventIdx,
    callKey: cacheKeyUtils.createEventKey(bookId, chapter, eventIdx),
  };
}

export const VIEWER_GRAPH_PIPELINE = {
  PREFETCH_AHEAD_EVENTS: 2,
  /** 다음 챕터 진입 시 바로 쓸 수 있도록 최소 이벤트 수 */
  PREFETCH_NEXT_CHAPTER_EVENTS: 3,
  HARD_RELOAD_SETTLE_MS: 1000,
  DISCOVERY_WAIT_MS: 30000,
  DISCOVERY_POLL_MS: 16,
};

export function getCachedChapterMaxEventIdx(bookId, chapter) {
  return Number(getCachedChapterEvents(bookId, chapter)?.maxEventIdx) || 0;
}

/** 캐시에 throughEventIdx까지 쓸 수 있는 데이터가 있는지 */
export function hasCachedChapterThrough(bookId, chapter, throughEventIdx = 1) {
  const through = Number(throughEventIdx);
  const need = Number.isFinite(through) && through >= 1 ? through : 1;
  return getCachedChapterMaxEventIdx(bookId, chapter) >= need;
}

export function buildChapterCharacterSearchData(events, currentChapter) {
  if (!currentChapter || !Array.isArray(events) || events.length === 0) {
    return { characters: [] };
  }
  const chapterEvents = events.filter(
    (evt) => Number(eventUtils.resolveChapterIdx(evt)) === Number(currentChapter),
  );
  return { characters: Array.from(aggregateCharactersFromEvents(chapterEvents).values()) };
}

export function toCommitGraphArgs(chapter, eventIdx, source) {
  return {
    graphChapter: chapter,
    apiEventIdx: eventIdx,
    elements: source.elements,
    eventMeta: source.eventMeta,
    normalizedEvent: source.normalizedEvent ?? undefined,
    characters: source.characters,
    relations: source.relations,
  };
}

export async function awaitPendingChapterDiscovery(pending) {
  if (!pending) return false;
  try {
    await pending;
  } catch {
    /* discovery 쪽에서 에러 상태 기록 */
  }
  return true;
}

/** 캐시 max 또는 discovery status로 through 커버리지 판정 */
export function resolveChapterDiscoveryCoverage(refs, bookId, chapter, eventIdx) {
  if (getCachedChapterMaxEventIdx(bookId, chapter) >= eventIdx) {
    return { ready: true };
  }
  const status = refs.chapterEventDiscoveryRef.current.get(
    cacheKeyUtils.createChapterKey(bookId, chapter),
  );
  if (typeof status === 'number' && status >= eventIdx) return { ready: true };
  if (status === 'missing') return { ready: false, reason: 'missing' };
  return null;
}

export function clearViewerGraphPipelineMaps(refs) {
  refs.chapterSyncStatusRef.current.clear();
  refs.chapterEventDiscoveryRef.current.clear();
  refs.chapterDiscoveryPromiseRef.current.clear();
}

export function resolvePipelineBookId(book) {
  return toPositiveNumberOrNull(book?.id);
}

export function fallbackEventMeta(chapter, eventIdx) {
  return {
    chapterIdx: chapter,
    chapter,
    eventIdx,
    eventNum: eventIdx,
    eventId: String(eventIdx),
  };
}

/** API/캐시 graph payload → cytoscape elements + 메타 */
export function convertGraphSourceToElements(
  source,
  chapter,
  eventIdx,
  deps = DEFAULT_GRAPH_TRANSFORM_DEPS,
  previousNodeWeights = null,
  options = null
) {
  const eventMeta = source?.event ?? source?.eventMeta ?? fallbackEventMeta(chapter, eventIdx);
  const bookId = options?.bookId ?? source?.bookId ?? null;
  const characters = enrichGraphCharacters(asArray(source?.characters), { bookId });
  const relations = asArray(source?.relations);
  const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(eventMeta);
  const elements = graphDataTransformUtils.convertToElements(
    { characters, relations, event: eventMeta },
    normalizedEvent,
    deps,
    previousNodeWeights,
    { bookId }
  );
  return { elements, normalizedEvent, eventMeta, characters, relations };
}

/** API 응답에서 result 객체 추출 */
export function pickGraphApiResult(response) {
  const result = response?.result;
  return result && typeof result === 'object' ? result : null;
}

/** graph event state 캐시 스냅샷 (표시 가능한 payload만) */
export function getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventStateFn) {
  if (!bookId || !chapter || eventIdx < 1) return null;
  const cached = getGraphEventStateFn(bookId, chapter, eventIdx);
  if (!cached || typeof cached !== 'object') return null;
  if (asArray(cached.elements).length === 0 && asArray(cached.characters).length === 0) {
    return null;
  }
  return cached;
}

/** event 1~eventIdx 누적 그래프 (표시용) */
export function resolveCumulativeGraphForDisplay(
  bookId,
  chapter,
  eventIdx,
  deps = DEFAULT_GRAPH_TRANSFORM_DEPS
) {
  const cached = getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventState);
  if (!cached) return null;

  const cachedElements = asArray(cached.elements);
  const characters = asArray(cached.characters);
  const resolved =
    cachedElements.length > 0
      ? {
          elements: applyDisplayNamesToElements(cachedElements, {
            bookId,
            characters,
          }),
          eventMeta: cached.eventMeta ?? null,
          characters: enrichGraphCharacters(characters, { bookId }),
          relations: [],
          normalizedEvent: null,
        }
      : convertGraphSourceToElements(cached, chapter, eventIdx, deps, null, { bookId });

  const fallback = getChapterEventFallbackData(bookId, chapter, eventIdx);
  const resolvedCharacters = resolved.characters.length
    ? resolved.characters
    : enrichGraphCharacters(fallback?.characters ?? [], { bookId });

  return {
    elements: applyDisplayNamesToElements(resolved.elements, {
      bookId,
      characters: resolvedCharacters,
    }),
    eventMeta: resolved.eventMeta ?? fallback?.event ?? null,
    characters: resolvedCharacters,
    relations: fallback?.relations ?? resolved.relations,
    normalizedEvent: resolved.normalizedEvent ?? null,
  };
}

export const graphDataTransformUtils = {
  normalizeApiEvent: (apiEvent) => {
    if (!apiEvent || typeof apiEvent !== 'object') return null;
    const chapterIdx = resolveChapterIndex(apiEvent);
    if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
    const eventNum = eventUtils.resolveEventOrdinal(apiEvent);
    if (!eventNum) return null;
    return {
      ...apiEvent,
      chapter: chapterIdx,
      chapterIdx,
      chapterIndex: chapterIdx,
      eventNum,
      eventIdx: eventNum,
      startTxtOffset: apiEvent.startTxtOffset ?? null,
      endTxtOffset: apiEvent.endTxtOffset ?? null,
    };
  },

  convertToElements: (resultData, normalizedEvent, deps, previousNodeWeights = null, options = null) => {
    const bookId = options?.bookId ?? resultData?.bookId ?? null;
    const chars = enrichGraphCharacters(asArray(resultData.characters), { bookId });
    const rels = processRelations(asArray(resultData.relations));
    if (chars.length === 0 && rels.length === 0) return [];

    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } =
      deps.createCharacterMaps(chars);
    const nodeWeights = deps.buildNodeWeights(chars, previousNodeWeights);

    return deps.convertRelationsToElements({
      relations: rels,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      nodeWeights: toNodeWeightsOrNull(nodeWeights),
      eventData: normalizedEvent,
      idToProfileImage,
      charactersOrphanMerge: chars.length > 0 ? chars : null,
      bookId,
    });
  },

  createNextEventData: (normalizedEvent, currentChapter, apiEventIdx, resultData) => {
    const apiEventNum = normalizedEvent ? Number(normalizedEvent.eventNum) : NaN;
    const eventNum = Number.isFinite(apiEventNum) && apiEventNum > 0 ? apiEventNum : apiEventIdx;
    const originalEventIdx = normalizedEvent
      ? eventUtils.resolveEventNum(normalizedEvent)
      : apiEventIdx;
    const relations = asArray(resultData.relations);
    const characters = asArray(resultData.characters);

    const withEventFields = (base, rawId) => ({
      ...base,
      chapter: eventUtils.resolveChapterIdx(base) ?? currentChapter,
      chapterIdx: eventUtils.resolveChapterIdx(base) ?? currentChapter,
      eventNum,
      eventIdx: eventNum,
      eventId: rawId != null ? rawId : eventNum,
      resolvedEventIdx: apiEventIdx,
      originalEventIdx,
      relations,
      characters,
    });

    if (normalizedEvent) {
      return withEventFields(normalizedEvent, eventUtils.resolveEventId(normalizedEvent));
    }

    const raw = resultData?.event;
    const parsed = raw ? graphDataTransformUtils.normalizeApiEvent(raw) : null;
    return withEventFields(
      { chapter: currentChapter, chapterIdx: currentChapter },
      eventUtils.resolveEventId(raw) ?? eventUtils.resolveEventId(parsed)
    );
  },
};

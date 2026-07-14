/** 뷰어 그래프 유틸: API/캐시 조회·변환·타깃 계산 */

import { processRelations } from '../graph/relationUtils';
import { buildNodeWeights, createCharacterMaps, toNodeWeightsOrNull } from '../graph/characterUtils';
import { convertRelationsToElements } from '../graph/graphDataUtils';
import { hasGraphPayload } from '../graph/graphData';
import { resolveGraphElementsProfileImages } from '../common/urlUtils';
import {
  getGraphEventState,
  getChapterEventFallbackData,
} from '../common/cache/chapterEventCache';
import { resolveChapterIndex, toPositiveInt } from '../common/valueUtils';
import { cacheKeyUtils, eventUtils } from './viewerCoreStateUtils';
import { resolveServerEventMatch } from './viewerEventProgressUtils';

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

/** fine graph API 호출 컨텍스트 (book/chapter/eventIdx/callKey) */
export function resolveFineGraphCallContext({ book, currentChapter, currentEvent }) {
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
    atLocator: match.atLocator ?? null,
  };
}

function hasNonEmptyArrays(obj, keys) {
  if (!obj || typeof obj !== 'object') return false;
  return keys.some((key) => asArray(obj[key]).length > 0);
}

function isFineGraphNotFoundError(error) {
  const message = error?.message || '';
  return error?.status === 404 || message.includes('404') || message.includes('찾을 수 없습니다');
}

/** fine graph API 요청 + payload 검증 */
export async function requestFineGraph(getFineGraph, bookId, chapter, eventIdx, atLocator = null) {
  try {
    const response = await getFineGraph(bookId, chapter, eventIdx, atLocator);
    const result = pickFineGraphResult(response);
    return {
      success: Boolean(response?.isSuccess && hasFineGraphPayload(result)),
      response,
      result,
      notFound: false,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      response: null,
      result: null,
      notFound: isFineGraphNotFoundError(error),
      error,
    };
  }
}

/** characters/relations(+event) 소스 → cytoscape elements + 메타 */
function convertGraphSourceToElements(
  source,
  chapter,
  eventIdx,
  deps = DEFAULT_GRAPH_TRANSFORM_DEPS,
  previousNodeWeights = null
) {
  const eventMeta = source?.eventMeta ?? source?.event ?? null;
  const characters = asArray(source?.characters);
  const relations = asArray(source?.relations);
  const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(
    eventMeta ?? fallbackEventMeta(chapter, eventIdx)
  );
  const elements = graphDataTransformUtils.convertToElements(
    { characters, relations, event: eventMeta },
    normalizedEvent,
    deps,
    previousNodeWeights
  );
  return { elements, normalizedEvent, eventMeta, characters, relations };
}

/** fine graph API result → cytoscape elements + 메타 */
export function convertFineGraphToElements(
  fineResult,
  chapter,
  eventIdx,
  deps = DEFAULT_GRAPH_TRANSFORM_DEPS,
  previousNodeWeights = null
) {
  const converted = convertGraphSourceToElements(
    fineResult,
    chapter,
    eventIdx,
    deps,
    previousNodeWeights
  );
  return {
    ...converted,
    // fine API는 .event 필드가 SSOT (eventMeta 무시)
    eventMeta: fineResult?.event ?? fallbackEventMeta(chapter, eventIdx),
  };
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

/** fine graph API 응답에 표시 가능한 데이터가 있는지 */
export function hasFineGraphPayload(result) {
  return hasGraphPayload(result);
}

/** fine graph API 응답에서 result 객체 추출 */
export function pickFineGraphResult(response) {
  const result = response?.result;
  return result && typeof result === 'object' ? result : null;
}

/** graph event state 캐시 스냅샷 (표시 가능한 payload만) */
export function getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventStateFn) {
  if (!bookId || !chapter || eventIdx < 1) return null;
  const cached = getGraphEventStateFn(bookId, chapter, eventIdx);
  if (!hasNonEmptyArrays(cached, ['elements', 'characters'])) return null;
  return cached;
}

/** graph event state 캐시 → elements·메타 (elements 없으면 characters로 변환) */
function elementsFromGraphEventState(cached, chapter, eventIdx, deps) {
  const elements = asArray(cached.elements);
  const eventMeta = cached.eventMeta ?? null;
  const characters = asArray(cached.characters);

  if (elements.length > 0) {
    return { elements, eventMeta, characters, relations: [] };
  }

  const converted = convertGraphSourceToElements(cached, chapter, eventIdx, deps);
  return { elements: converted.elements, eventMeta, characters, relations: [] };
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

  const resolved = elementsFromGraphEventState(cached, chapter, eventIdx, deps);
  const fallback = getChapterEventFallbackData(bookId, chapter, eventIdx);

  return {
    elements: resolved.elements,
    eventMeta: resolved.eventMeta ?? fallback?.event ?? null,
    characters: resolved.characters.length
      ? resolved.characters
      : (fallback?.characters ?? []),
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

  convertToElements: (resultData, normalizedEvent, deps, previousNodeWeights = null) => {
    const chars = asArray(resultData.characters);
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
    });
  },

  createNextEventData: (normalizedEvent, currentChapter, apiEventIdx, resultData) => {
    const apiEventNum = normalizedEvent ? Number(normalizedEvent.eventNum) : NaN;
    const eventNum = Number.isFinite(apiEventNum) && apiEventNum > 0 ? apiEventNum : apiEventIdx;
    const originalEventIdx = normalizedEvent
      ? eventUtils.resolveEventNum(normalizedEvent)
      : apiEventIdx;
    const relations = resultData.relations || [];
    const characters = resultData.characters || [];

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

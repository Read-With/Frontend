/** 뷰어 그래프 유틸: API/캐시 조회·변환·타깃 계산 */

import { processRelations } from '../graph/graphUtils';
import { buildNodeWeights, createCharacterMaps, toNodeWeightsOrNull } from '../graph/characterUtils';
import { convertRelationsToElements } from '../graph/graphDataUtils';
import { resolveGraphElementsProfileImages } from '../common/assetUrlFetch';
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
  previousNodeWeights = null
) {
  const eventMeta = source?.event ?? source?.eventMeta ?? fallbackEventMeta(chapter, eventIdx);
  const characters = asArray(source?.characters);
  const relations = asArray(source?.relations);
  const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(eventMeta);
  const elements = graphDataTransformUtils.convertToElements(
    { characters, relations, event: eventMeta },
    normalizedEvent,
    deps,
    previousNodeWeights
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
          elements: cachedElements,
          eventMeta: cached.eventMeta ?? null,
          characters,
          relations: [],
          normalizedEvent: null,
        }
      : convertGraphSourceToElements(cached, chapter, eventIdx, deps);

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

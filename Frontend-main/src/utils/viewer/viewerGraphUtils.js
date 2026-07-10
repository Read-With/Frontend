/** 뷰어 그래프 유틸: API/캐시 조회·변환·타깃 계산 */

import { processRelations, directedEdgeElementId } from '../graph/relationUtils';
import { uniqueStrings } from '../graph/graphUtils';
import { buildNodeWeights, createCharacterMaps, toNodeWeightsOrNull } from '../graph/characterUtils';
import { convertRelationsToElements } from '../graph/graphDataUtils';
import { resolveGraphElementsProfileImages } from '../common/artifactUrlUtils';
import {
  getGraphEventState,
  getChapterEventFallbackData,
} from '../common/cache/chapterEventCache';
import { cacheKeyUtils, eventUtils, resolveEventIdxOrFallback } from './viewerCoreStateUtils';
import { resolveServerEventMatch } from './viewerEventProgressUtils';

export const DEFAULT_GRAPH_TRANSFORM_DEPS = {
  createCharacterMaps,
  buildNodeWeights,
  convertRelationsToElements,
};

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
  const directChapter = Number(eventUtils.resolveChapterIdx(currentEvent) ?? 0);
  const matchedChapter = Number(match.chapterIdx ?? 0);
  const matchedEvent = Number(match.eventIdx ?? 0);
  const chapter =
    directChapter >= 1 ? directChapter
      : matchedChapter >= 1 ? matchedChapter
        : Number(currentChapter);
  const eventIdx = resolveEventIdxOrFallback(
    currentEvent,
    matchedEvent >= 1 ? matchedEvent : 0
  );

  if (!bookId || !chapter) return null;

  const callKey = cacheKeyUtils.createEventKey(bookId, chapter, eventIdx);
  return { bookId, chapter, eventIdx, callKey, atLocator: match.atLocator ?? null };
}

function hasNonEmptyArrays(obj, keys) {
  if (!obj || typeof obj !== 'object') return false;
  return keys.some((key) => (Array.isArray(obj[key]) ? obj[key] : []).length > 0);
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

/** fine graph API result → cytoscape elements + 메타 */
function convertGraphSourceToElements(
  source,
  chapter,
  eventIdx,
  deps,
  { previousNodeWeights = null, relationsOverride = null } = {}
) {
  const eventMeta = source.eventMeta ?? source.event ?? null;
  const characters = Array.isArray(source.characters) ? source.characters : [];
  const relations = relationsOverride ?? (Array.isArray(source.relations) ? source.relations : []);
  const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(
    eventMeta ?? fallbackEventMeta(chapter, eventIdx)
  );
  const elements = graphDataTransformUtils.convertToElements(
    { characters, relations, event: eventMeta },
    false,
    normalizedEvent,
    deps.createCharacterMaps,
    deps.buildNodeWeights,
    deps.convertRelationsToElements,
    previousNodeWeights
  );
  return { elements, normalizedEvent, eventMeta, characters, relations };
}

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
    { previousNodeWeights, relationsOverride: fineResult?.relations || [] }
  );
  return {
    elements: converted.elements,
    normalizedEvent: converted.normalizedEvent,
    eventMeta: fineResult?.event ?? fallbackEventMeta(chapter, eventIdx),
    characters: converted.characters,
    relations: converted.relations,
  };
}

/** graph event state 캐시에 표시 가능한 데이터가 있는지 */
function hasGraphCachePayload(cached) {
  return hasNonEmptyArrays(cached, ['elements', 'characters']);
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
  return hasNonEmptyArrays(result, ['relations', 'characters']);
}

/** fine graph API 응답에서 result 객체 추출 */
export function pickFineGraphResult(response) {
  const result = response?.result;
  return result && typeof result === 'object' ? result : null;
}

/** relationship-graph 응답에 그래프 본문이 있는지 */
export function hasFineGraphEventSlot(result) {
  return hasFineGraphPayload(result);
}

/** graph event state 캐시 스냅샷 (표시 가능한 payload만) */
export function getCachedGraphSnapshot(bookId, chapter, eventIdx, getGraphEventState) {
  if (!bookId || !chapter || eventIdx < 1) return null;
  const cached = getGraphEventState(bookId, chapter, eventIdx);
  if (!hasGraphCachePayload(cached)) return null;
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

  const resolved = elementsFromGraphEventState(cached, chapter, eventIdx, deps);
  const fallback = getChapterEventFallbackData(bookId, chapter, eventIdx);

  return {
    elements: resolved.elements,
    eventMeta: resolved.eventMeta ?? fallback?.event ?? null,
    characters: resolved.characters?.length
      ? resolved.characters
      : (fallback?.characters ?? []),
    relations: fallback?.relations ?? resolved.relations ?? [],
    normalizedEvent: resolved.normalizedEvent ?? null,
  };
}

/** graph event state 캐시 → elements·메타 (elements 없으면 characters로 변환) */
export function elementsFromGraphEventState(
  cached,
  chapter,
  eventIdx,
  deps = DEFAULT_GRAPH_TRANSFORM_DEPS
) {
  const elements = Array.isArray(cached.elements) ? cached.elements : [];
  const eventMeta = cached.eventMeta ?? null;
  const characters = Array.isArray(cached.characters) ? cached.characters : [];

  if (elements.length > 0) {
    return { elements, eventMeta, characters, relations: [] };
  }

  const converted = convertGraphSourceToElements(
    cached,
    chapter,
    eventIdx,
    deps
  );
  return { elements: converted.elements, eventMeta, characters, relations: [] };
}

export const graphDataTransformUtils = {
  normalizeApiEvent: (apiEvent) => {
    if (!apiEvent || typeof apiEvent !== 'object') return null;
    const chapterIdx = Number(apiEvent.chapterIdx ?? apiEvent.chapterIndex);
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

  convertToElements: (
    resultData,
    usedCache,
    normalizedEvent,
    createCharacterMaps,
    buildNodeWeights,
    convertRelationsToElements,
    previousNodeWeights = null
  ) => {
    if (usedCache && Array.isArray(resultData.elements) && resultData.elements.length > 0) {
      return resultData.elements;
    }

    const chars = Array.isArray(resultData.characters) ? resultData.characters : [];
    const rawRels = Array.isArray(resultData.relations) ? resultData.relations : [];
    const rels = processRelations(rawRels);
    if (chars.length === 0 && rels.length === 0) {
      return [];
    }

    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } =
      createCharacterMaps(chars);
    const nodeWeights = buildNodeWeights(chars, previousNodeWeights);

    return convertRelationsToElements(
      rels,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      'api',
      toNodeWeightsOrNull(nodeWeights),
      null,
      normalizedEvent,
      idToProfileImage,
      chars.length > 0 ? chars : null
    );
  },

  mergeElementsWithPrevious: (convertedElements, prevData, currentChapter, apiEventIdx) => {
    const prevChapter = Number(prevData.chapterIdx);
    const curChapter = Number(currentChapter);

    const edgeDedupKey = (el) => {
      const d = el?.data;
      if (!d) return null;
      if (d.id != null && String(d.id).trim() !== '') {
        return String(d.id);
      }
      if (d.source != null && d.target != null) {
        return directedEdgeElementId(d.source, d.target);
      }
      return null;
    };

    const mergeRelationArrays = (a, b) => {
      const toArr = (v) => {
        if (Array.isArray(v)) return v;
        if (v === undefined || v === null || v === '') return [];
        return [v];
      };
      return uniqueStrings([...toArr(a), ...toArr(b)]);
    };

    const conv = Array.isArray(convertedElements) ? convertedElements : [];
    const prevEls = Array.isArray(prevData.elements) ? prevData.elements : [];
    const prevIdx = Number(prevData.eventIdx) || 0;
    const apiIdx = Number(apiEventIdx) || 0;
    const hasComparableChapter = Number.isFinite(prevChapter) && Number.isFinite(curChapter);
    const isDifferentChapter = hasComparableChapter && curChapter !== prevChapter;
    const isEarlierThanPrevious =
      hasComparableChapter &&
      (curChapter < prevChapter || (curChapter === prevChapter && apiIdx > 0 && apiIdx < prevIdx));
    if (isDifferentChapter || isEarlierThanPrevious) {
      return conv;
    }
    if (conv.length === 0 && prevEls.length > 0) {
      return prevEls;
    }
    if (prevEls.length === 0 || prevIdx === 0) {
      return conv;
    }

    const prevNodes = eventUtils.filterNodes(prevEls);
    const existingNodeIds = new Set(prevNodes.map((e) => e.data.id));
    const newNodes = eventUtils.filterNodes(conv).filter((e) => !existingNodeIds.has(e.data.id));

    const prevEdges = eventUtils.filterEdges(prevEls);
    const newEdges = eventUtils.filterEdges(conv);
    const edgeByKey = new Map();
    for (const el of prevEdges) {
      const key = edgeDedupKey(el);
      if (key) edgeByKey.set(key, el);
    }
    for (const el of newEdges) {
      const key = edgeDedupKey(el);
      if (!key) continue;
      const prevEl = edgeByKey.get(key);
      if (!prevEl) {
        edgeByKey.set(key, el);
        continue;
      }
      const previousData = prevEl.data || {};
      const nextData = el.data || {};
      const nextPos = Number(nextData.positivity);
      const prevPos = Number(previousData.positivity);
      const positivity = Number.isFinite(nextPos) ? nextPos : Number.isFinite(prevPos) ? prevPos : 0;

      edgeByKey.set(key, {
        ...prevEl,
        ...el,
        data: {
          ...previousData,
          ...nextData,
          relation: mergeRelationArrays(previousData.relation, nextData.relation),
          label:
            nextData.label != null && String(nextData.label).trim() !== ''
              ? nextData.label
              : previousData.label || '',
          positivity,
        },
      });
    }

    const mergedEdges = Array.from(edgeByKey.values());
    return [...prevNodes, ...newNodes, ...mergedEdges];
  },

  createNextEventData: (normalizedEvent, currentChapter, apiEventIdx, resultData) => {
    const resolvedEventIdx = apiEventIdx;
    const originalEventIdx = normalizedEvent
      ? eventUtils.extractRawEventIdx(normalizedEvent)
      : resolvedEventIdx;
    const apiEventNum = normalizedEvent ? Number(normalizedEvent.eventNum) : NaN;
    const eventNum = Number.isFinite(apiEventNum) && apiEventNum > 0 ? apiEventNum : resolvedEventIdx;
    const relations = resultData.relations || [];
    const characters = resultData.characters || [];

    const buildEventPayload = (base, rawId) => ({
      ...base,
      chapter: eventUtils.resolveChapterIdx(base) ?? currentChapter,
      chapterIdx: eventUtils.resolveChapterIdx(base) ?? currentChapter,
      eventNum,
      eventIdx: eventNum,
      eventId: rawId != null ? rawId : eventNum,
      resolvedEventIdx,
      originalEventIdx: base === normalizedEvent ? originalEventIdx : resolvedEventIdx,
      relations,
      characters,
    });

    if (normalizedEvent) {
      return buildEventPayload(
        normalizedEvent,
        eventUtils.resolveEventId(normalizedEvent)
      );
    }

    const raw = resultData?.event;
    const parsed = raw ? graphDataTransformUtils.normalizeApiEvent(raw) : null;
    return buildEventPayload(
      {
        chapter: currentChapter,
        chapterIdx: currentChapter,
      },
      eventUtils.resolveEventId(raw) ?? (parsed ? eventUtils.resolveEventId(parsed) : null)
    );
  },
};


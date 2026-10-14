/** 챕터 그래프 캐시: payload·재구성(커서)·이벤트 조회·캐시→events. 탐색·프리페치·책 단위 보장은 graphChapterDiscovery */

import { normalizeElementId } from './graphCore';
import { extractCharacterId } from './graphCharacterNames';
import { eventUtils, cacheKeyUtils, ELEMENTS_TO_RELATIONS_OPTS } from '../viewer/viewerCore';
import {
  asArray,
  extractApiBookId,
  resolveChapterIndex,
  toNumberOrNull,
  toPositiveInt,
  toPositiveNumberOrNull,
  errorUtils,
  compareLocale,
} from '../common/valueUtils';
import {
  setBounded,
  loadTtlStorage,
  saveToStorage,
  removeFromStorage,
  CHAPTER_EVENT_CACHE_MAX_AGE_MS,
  CHAPTER_EVENT_CACHE_PREFIX,
} from '../common/cache/cacheManager';
import { buildElementsFromGraphPayload, calcGraphDiff, deepEqual } from './graphElements';

export const CHAPTER_GRAPH_CACHE_SOURCE = Object.freeze({
  API: 'api',
  INVALID: 'invalid',
});

/** 과거에 write됐던 source — 재사용하지 않고 rediscover */
export const isUnusableChapterGraphCacheSource = (source) =>
  source === CHAPTER_GRAPH_CACHE_SOURCE.INVALID ||
  source === 'empty' ||
  source === 'manifest-only';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Character maps (프로필 URL 정규화·이미지 resolve는 graphProfileImages)
 * ═══════════════════════════════════════════════════════════════════════════ */

const cloneArray = (arr) => (Array.isArray(arr) ? arr.map((item) => structuredClone(item)) : []);

const computeCharacterDiff = (prevCharacters, nextCharacters) => {
  const prevMap = new Map();
  const nextMap = new Map();
  asArray(prevCharacters).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) prevMap.set(id, character);
  });
  asArray(nextCharacters).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) nextMap.set(id, character);
  });
  const added = [];
  const updated = [];
  const removedIds = [];
  nextMap.forEach((character, id) => {
    const prev = prevMap.get(id);
    if (!prev) added.push(structuredClone(character));
    else if (!deepEqual(prev, character)) updated.push(structuredClone(character));
  });
  prevMap.forEach((_character, id) => {
    if (!nextMap.has(id)) removedIds.push(id);
  });
  return { added, updated, removedIds };
};

const toKeyedMap = (items, getKey) => {
  const map = new Map();
  for (const item of asArray(items)) {
    const id = getKey(item);
    if (id) map.set(id, item);
  }
  return map;
};

/**
 * remove → update → add 를 map에 제자리 반영. 항목은 복제하지 않고 참조 공유.
 * Map.set은 기존 key 위치를 유지하므로 매 diff마다 배열에서 Map을 다시 만든 것과 순서가 같음.
 */
const applyKeyedDiffInPlace = (map, diff, getKey) => {
  const put = (item) => {
    const id = getKey(item);
    if (id) map.set(id, item);
  };
  (diff?.removedIds || []).forEach((id) => id && map.delete(String(id)));
  (diff?.updated || []).forEach(put);
  (diff?.added || []).forEach(put);
};

/** 노드 먼저, 그다음 id 순 (Map key가 곧 id) */
const sortedElementsOf = (elementMap) => {
  const rows = Array.from(elementMap, ([id, el]) => ({ id, el, isEdge: Boolean(el?.data?.source) }));
  rows.sort((a, b) => {
    if (a.isEdge !== b.isEdge) return a.isEdge ? 1 : -1;
    return compareLocale(a.id, b.id);
  });
  return rows.map((row) => row.el);
};

/** 이벤트 1건 → elements/characters/summary (캐시 payload 루프용) */
function buildEventSnapshotRow(bookId, chapterIdx, event) {
  const inner = event.event ?? null;
  const relations = asArray(event.relations);
  let convertedElements = [];
  let snapshotCharacters = [];
  try {
    const built = buildElementsFromGraphPayload({
      characters: asArray(event.characters),
      relations,
      eventData: inner,
      bookId,
    });
    convertedElements = built.elements;
    snapshotCharacters = built.characters;
  } catch (error) {
    errorUtils.logError('buildElementsFromGraphPayload', error);
  }

  const summaryIdx = Number(event.eventIdx) || 0;
  const summary = {
    bookId,
    chapterIdx,
    eventIdx: summaryIdx,
    eventNum: toPositiveNumberOrNull(event.eventNum) ?? summaryIdx,
    eventId: eventUtils.resolveEventId(event) ?? eventUtils.resolveEventId(inner) ?? null,
    startTxtOffset: event.startTxtOffset ?? null,
    endTxtOffset: event.endTxtOffset ?? null,
    title: inner?.name ?? inner?.title ?? inner?.eventName ?? null,
    text: inner?.text ?? null,
    hasCharacters: snapshotCharacters.length > 0,
    hasRelations: relations.length > 0,
  };

  return { convertedElements, snapshotCharacters, summary };
}

export const buildChapterCachePayload = (
  bookId,
  chapterIdx,
  events,
  source = CHAPTER_GRAPH_CACHE_SOURCE.API
) => {
  const timestamp = Date.now();
  const sortedEvents = eventUtils.sortEventsByIdx(events);
  if (!sortedEvents.length) {
    return {
      bookId,
      chapterIdx,
      maxEventIdx: 0,
      events: [],
      baseSnapshot: null,
      diffs: [],
      timestamp,
      source,
    };
  }

  const diffs = [];
  const eventSummaries = [];
  let baseSnapshot = null;
  let prevElements = [];
  let prevCharacters = [];

  sortedEvents.forEach((event, index) => {
    // API는 이벤트별 누적 스냅샷을 주므로 이어 붙이지 않고 해당 시점 값을 그대로 사용
    const { convertedElements, snapshotCharacters, summary } = buildEventSnapshotRow(
      bookId,
      chapterIdx,
      event
    );

    // 이벤트 객체는 normalizeEventFromDeltasGraphResult에서 한 번 복제된 뒤 변경되지 않음 — 여기선 참조 공유
    const currentElements = convertedElements;
    const currentCharacters = snapshotCharacters;
    if (index === 0) {
      baseSnapshot = {
        eventIdx: eventUtils.resolveEventNum(event) || 1,
        elements: currentElements,
        characters: currentCharacters,
        eventMeta: event?.event ? structuredClone(event.event) : null,
      };
    } else {
      // diff 항목은 currentElements를 그대로 참조 (읽기 전용)
      const { added, updated, removed } = calcGraphDiff(prevElements, currentElements);
      diffs.push({
        eventIdx: eventUtils.resolveEventNum(event) || (baseSnapshot?.eventIdx ?? 1),
        eventMeta: event?.event ? structuredClone(event.event) : null,
        elementDiff: {
          added,
          updated,
          removedIds: removed.map((element) => normalizeElementId(element)).filter(Boolean),
        },
        characterDiff: computeCharacterDiff(prevCharacters, currentCharacters),
      });
    }
    prevElements = currentElements;
    prevCharacters = currentCharacters;
    eventSummaries.push(summary);
  });

  const maxEventIdx = sortedEvents.reduce(
    (max, event) => Math.max(max, eventUtils.resolveEventNum(event) || 0),
    0
  );

  return {
    bookId,
    chapterIdx,
    maxEventIdx,
    events: eventSummaries,
    baseSnapshot,
    diffs,
    timestamp,
    source,
    // sortEventsByIdx가 새 배열을 반환 — 항목은 불변이라 복제하지 않음
    rawEvents: sortedEvents,
  };
};

/**
 * baseSnapshot + diffs → 시점별 그래프 상태를 돌려주는 조회 함수.
 * 오름차순으로 조회하면 diff를 한 번만 순회 (이벤트마다 처음부터 재생하면 O(k²)).
 * 내림차순 조회는 base부터 다시 재생 — 결과는 같고 느릴 뿐. 반환값은 매번 독립 복제본.
 * diff는 Map에 O(Δ)로 반영하고, 배열 변환·정렬은 조회 시 1회 (diff마다 O(N log N) 하지 않음).
 * readOnly: 반환값을 읽기만 할 때 복제 생략 (캐시 항목을 그대로 노출 — 변경 금지)
 * sortElements=false: elements를 정렬하지 않고 Map 순서로 (순서 무관한 조회용, readOnly 전용)
 */
export const createChapterGraphStateCursor = (
  cachePayload,
  { readOnly = false, sortElements = true } = {}
) => {
  const baseSnapshot = cachePayload?.baseSnapshot;
  if (!baseSnapshot || !Array.isArray(baseSnapshot.elements)) return () => null;

  const baseIdx = Number(baseSnapshot.eventIdx) || 1;
  // diffs는 eventIdx 오름차순으로 생성됨 — 정렬 키와 비교 키가 같아 break로 끊어도 결과 동일
  const diffs = eventUtils.sortEventsByIdx(cachePayload.diffs || []);
  // null이면 diff 미적용 — base 배열을 그대로 사용
  let elementMap;
  let characterMap;
  let eventMeta;
  let appliedEventIdx;
  let nextDiff;
  // 마지막 diff 적용 이후 만든 출력 배열 (다음 diff 전까지 재사용, 반환 후 변경하지 않음)
  let outElements;
  let outCharacters;
  const reset = () => {
    elementMap = null;
    characterMap = null;
    eventMeta = baseSnapshot.eventMeta ?? null;
    appliedEventIdx = baseIdx;
    nextDiff = 0;
    outElements = null;
    outCharacters = null;
  };
  reset();
  let lastTarget = -Infinity;

  const snapshot = (els, chars, meta, eventIdx) =>
    readOnly
      ? { elements: els, characters: chars, eventMeta: meta ?? null, eventIdx }
      : {
          elements: cloneArray(els),
          characters: cloneArray(chars),
          eventMeta: meta ? structuredClone(meta) : null,
          eventIdx,
        };

  return (targetEventIdx) => {
    const target = Number(targetEventIdx);
    // partial(through만 적재)은 base 이전 이벤트가 없음 — base를 돌려주면 이후 관계가 노출됨
    if (cachePayload.partial && target < baseIdx) return null;
    if (!Number.isFinite(target) || target <= baseIdx) {
      return snapshot(baseSnapshot.elements, baseSnapshot.characters || [], baseSnapshot.eventMeta, baseIdx);
    }

    if (target < lastTarget) reset();
    lastTarget = target;
    for (; nextDiff < diffs.length; nextDiff += 1) {
      const diff = diffs[nextDiff];
      const diffIdx = Number(diff?.eventIdx);
      if (!Number.isFinite(diffIdx)) continue;
      if (diffIdx > target) break;
      if (!elementMap) {
        elementMap = toKeyedMap(baseSnapshot.elements, normalizeElementId);
        characterMap = toKeyedMap(baseSnapshot.characters, extractCharacterId);
      }
      applyKeyedDiffInPlace(elementMap, diff?.elementDiff, normalizeElementId);
      applyKeyedDiffInPlace(characterMap, diff?.characterDiff, extractCharacterId);
      if (diff?.eventMeta) eventMeta = diff.eventMeta;
      appliedEventIdx = diffIdx;
      outElements = null;
      outCharacters = null;
    }
    if (!elementMap) {
      return snapshot(baseSnapshot.elements, baseSnapshot.characters || [], eventMeta, appliedEventIdx);
    }
    outElements ??=
      sortElements || !readOnly ? sortedElementsOf(elementMap) : Array.from(elementMap.values());
    outCharacters ??= Array.from(characterMap.values());
    return snapshot(outElements, outCharacters, eventMeta, appliedEventIdx);
  };
};

/** 단건 조회. 여러 시점을 볼 때는 createChapterGraphStateCursor 사용 */
const reconstructChapterGraphState = (cachePayload, targetEventIdx) => {
  if (!cachePayload || typeof cachePayload !== 'object') return null;
  return createChapterGraphStateCursor(cachePayload)(targetEventIdx);
};

const chapterEventMemoryCache = new Map();

const CHAPTER_EVENT_MEMORY_MAX = 30;

/**
 * 메모리 우선 → localStorage(TTL) 순 조회, 스토리지 적중 시 메모리 재적재.
 * 메모리 우선: discover 폴링이 매 tick 전체 JSON을 파싱하지 않도록, 스토리지 저장 실패 시에도 표시 가능하도록
 */
export const readTtlCache = (memoryCache, maxSize, key, label) => {
  if (!key) return null;
  try {
    const cached = memoryCache.get(key);
    if (cached && Date.now() - (Number(cached.timestamp) || 0) <= CHAPTER_EVENT_CACHE_MAX_AGE_MS) {
      return cached;
    }
    const stored = loadTtlStorage(key, CHAPTER_EVENT_CACHE_MAX_AGE_MS, 'localStorage');
    if (stored) setBounded(memoryCache, key, stored, maxSize);
    return stored;
  } catch (error) {
    errorUtils.logDebug('graphChapterCache', `${label} 로드 실패`, { message: error?.message });
    return null;
  }
};

/**
 * book/chapter/eventIdx 누적 그래프 상태 조회 (챕터 TTL 캐시 기반).
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number} eventIdx
 * @returns {{ elements: Array, characters: Array, eventMeta: Object|null, eventIdx: number }|null}
 */
export const getGraphEventState = (bookId, chapterIdx, eventIdx) => {
  const chapterPayload = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterPayload) return null;
  return reconstructChapterGraphState(chapterPayload, eventIdx);
};

/**
 * deltas 누적 graph 스냅샷 한 건 → 챕터 캐시 이벤트 행.
 * (graphFetch.mapLegacyOrSummaryEvent와 별도; 입력은 deltas walker snapshot)
 */
export const normalizeEventFromDeltasGraphResult = (
  bookId,
  chapterIdx,
  eventIdx,
  result,
  manifestStructure
) => {
  const safe = result && typeof result === 'object' ? result : {};
  const { characters, relations, event: nestedEvent } = safe;
  const hasCharacters = Array.isArray(characters) && characters.length > 0;
  const hasRelations = Array.isArray(relations) && relations.length > 0;
  const resolvedChapterIdx = resolveChapterIndex(safe) ?? chapterIdx;
  // walker event는 { eventId, chapterIndex }뿐 — ordinal을 뽑으면 eventId 끝자리 숫자가 되므로 캐시 키(eventIdx) 기준 유지
  const resolvedEventNum =
    Number(manifestStructure?.eventNum ?? manifestStructure?.eventIdx ?? eventIdx) || eventIdx;
  const resolvedEventId =
    safe.eventId ??
    eventUtils.resolveEventId(nestedEvent) ??
    manifestStructure?.eventId ??
    null;
  const startTxtOffset = nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null;
  const endTxtOffset = nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null;

  return {
    bookId: Number(safe.bookId) || bookId,
    chapterIdx: resolvedChapterIdx,
    eventIdx,
    eventNum: resolvedEventNum,
    characters: hasCharacters ? characters.map((character) => structuredClone(character)) : [],
    relations: hasRelations ? relations.map((relation) => structuredClone(relation)) : [],
    event: {
      idx: eventIdx,
      chapterIdx: resolvedChapterIdx,
      chapterIndex: resolvedChapterIdx,
      eventId: resolvedEventId ?? eventIdx,
      startTxtOffset,
      endTxtOffset,
      startLocator: nestedEvent?.startLocator,
      endLocator: nestedEvent?.endLocator,
      rawText: nestedEvent?.rawText ?? null,
      ...(nestedEvent && typeof nestedEvent === 'object' ? nestedEvent : {}),
      eventNum: resolvedEventNum,
    },
    startTxtOffset,
    endTxtOffset,
    eventId: resolvedEventId,
  };
};

const getChapterEventCacheKey = (bookId, chapterIdx) => {
  const bookIdNum = toPositiveNumberOrNull(bookId);
  const chapterIdxNum = toPositiveNumberOrNull(chapterIdx);
  if (bookIdNum === null || chapterIdxNum === null) return null;
  return `${CHAPTER_EVENT_CACHE_PREFIX}${cacheKeyUtils.createChapterKey(bookIdNum, chapterIdxNum)}`;
};

/**
 * 챕터 이벤트 TTL 캐시 로드.
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @returns {Object|null}
 */
export const getCachedChapterEvents = (bookId, chapterIdx) =>
  readTtlCache(chapterEventMemoryCache, CHAPTER_EVENT_MEMORY_MAX, getChapterEventCacheKey(bookId, chapterIdx), '챕터 이벤트 캐시');

export const setCachedChapterEvents = (bookId, chapterIdx, eventData) => {
  try {
    if (!eventData) return false;
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return false;

    const cacheData = {
      bookId,
      chapterIdx,
      maxEventIdx: Number(eventData.maxEventIdx) || 0,
      events: asArray(eventData.events),
      baseSnapshot: eventData.baseSnapshot ?? null,
      diffs: asArray(eventData.diffs),
      rawEvents: asArray(eventData.rawEvents),
      timestamp: Number(eventData.timestamp) || Date.now(),
      source: eventData.source || null,
      partial: eventData.partial === true,
      capped: eventData.capped === true,
    };

    setBounded(chapterEventMemoryCache, cacheKey, cacheData, CHAPTER_EVENT_MEMORY_MAX);
    // rawEvents(이벤트별 누적 스냅샷 전체)는 discover 이어받기용 메모리 전용 — 스토리지에 넣으면 용량 초과로 저장 자체가 실패함
    const { rawEvents: _rawEvents, ...storedData } = cacheData;
    if (!saveToStorage(cacheKey, storedData, 'localStorage')) {
      // 용량 초과 등: 이전 세션의 낡은 항목이 남아 다음 로드에 쓰이지 않도록 제거 (현재 세션은 메모리로 표시)
      removeFromStorage(cacheKey, 'localStorage');
    }
    return true;
  } catch (error) {
    errorUtils.logDebug('graphChapterCache', '챕터 이벤트 캐시 저장 실패', { message: error?.message });
    return false;
  }
};

export function getCachedChapterMaxEventIdx(bookId, chapter) {
  return Number(getCachedChapterEvents(bookId, chapter)?.maxEventIdx) || 0;
}

/* ─── 챕터 캐시 → events state (뷰어·툴팁 조회용) ─── */

/**
 * readOnly cursor 결과 → 외부로 나가는 payload. relations는 변환 시 새 객체(relation 배열도 복사)라
 * elements는 복제할 필요 없음 — 캐시와 공유되는 characters만 복제
 */
const graphPayloadFromReconstructed = (reconstructed) => ({
  characters: cloneArray(reconstructed?.characters),
  relations: eventUtils.convertElementsToRelations(
    asArray(reconstructed?.elements),
    ELEMENTS_TO_RELATIONS_OPTS
  ),
});

const isLegacyRawEventRow = (event) =>
  Boolean(
    (event?.event && typeof event.event === 'object') ||
    Array.isArray(event?.relations) ||
    Array.isArray(event?.characters)
  );

const withEventTitleAliases = (title) => {
  const t = title ?? null;
  return { title: t, name: t, eventName: t };
};

const withEventOffsetFields = (start, end, { alsoTxtOffset = false } = {}) => {
  const s = start ?? null;
  const e = end ?? null;
  return alsoTxtOffset
    ? { startTxtOffset: s, endTxtOffset: e, start: s, end: e }
    : { start: s, end: e };
};

function baseChapterEventFields(targetChapter, eventIdx, eventNum, eventId) {
  return {
    chapter: targetChapter,
    chapterIdx: targetChapter,
    eventIdx,
    eventNum,
    eventId,
  };
}

const mapLegacyOrSummaryEvent = (event, targetChapter) => {
  const eventIdx = eventUtils.resolveEventNum(event, null);
  if (eventIdx == null || eventIdx <= 0) return null;

  const eventNum = toPositiveInt(event.eventNum, eventIdx);
  const eventId = eventUtils.resolveEventId(event) ?? event.eventId ?? eventIdx;
  const base = baseChapterEventFields(targetChapter, eventIdx, eventNum, eventId);

  if (isLegacyRawEventRow(event)) {
    return {
      ...(event.event && typeof event.event === 'object' ? event.event : {}),
      ...event,
      ...base,
      relations: asArray(event.relations),
      characters: asArray(event.characters),
      ...withEventOffsetFields(
        event?.startPos ?? event?.start ?? event?.startTxtOffset,
        event?.endPos ?? event?.end ?? event?.endTxtOffset
      ),
    };
  }

  return {
    ...base,
    ...withEventOffsetFields(event.startTxtOffset, event.endTxtOffset, { alsoTxtOffset: true }),
    ...withEventTitleAliases(event.title ?? null),
    text: event.text ?? null,
    relations: [],
    characters: [],
  };
};

function buildEventsFromChapterCache(chapterPayload, targetChapter, throughEventIdx = null) {
  if (!chapterPayload?.events?.length) return [];

  const hasDiffCache = chapterPayload.baseSnapshot && Array.isArray(chapterPayload.diffs);
  const through = Number(throughEventIdx);
  const eventMetas = Number.isFinite(through) && through > 0
    ? chapterPayload.events.filter((event) => {
        const idx = Number(event?.eventIdx) || 0;
        return idx > 0 && idx <= through;
      })
    : chapterPayload.events;

  if (!hasDiffCache) {
    return eventMetas.map((event) => mapLegacyOrSummaryEvent(event, targetChapter)).filter(Boolean);
  }

  // 이벤트마다 그래프 전체를 복제하지 않음 — 밖으로 나가는 값만 graphPayloadFromReconstructed·eventMeta에서 복제
  const stateAt = createChapterGraphStateCursor(chapterPayload, { readOnly: true });
  return eventMetas.map((eventMeta) => {
    const eventIdx = Number(eventMeta?.eventIdx) || 0;
    const eventNum = toPositiveInt(eventMeta?.eventNum, eventIdx);
    const reconstructed = stateAt(eventIdx);
    const { characters, relations } = graphPayloadFromReconstructed(reconstructed);
    const reconstructedMeta = reconstructed?.eventMeta ? structuredClone(reconstructed.eventMeta) : null;
    const title = eventMeta.title ?? reconstructedMeta?.name ?? reconstructedMeta?.title ?? null;

    return {
      ...eventMeta,
      ...baseChapterEventFields(targetChapter, eventIdx, eventNum, (
        eventUtils.resolveEventId(reconstructedMeta) ??
        eventUtils.resolveEventId(eventMeta) ??
        eventIdx
      )),
      event: reconstructedMeta ?? eventMeta?.event ?? null,
      ...withEventTitleAliases(title),
      relations,
      characters,
      ...withEventOffsetFields(
        eventMeta.startTxtOffset ?? reconstructedMeta?.startTxtOffset,
        eventMeta.endTxtOffset ?? reconstructedMeta?.endTxtOffset
      ),
    };
  });
}

/** diff 캐시 행의 표시 순번 — buildEventsFromChapterCache 결과의 eventNum과 같은 규칙 */
const diffCacheRowEventNum = (eventMeta) =>
  toPositiveInt(eventMeta?.eventNum, Number(eventMeta?.eventIdx) || 0);

function getEventsForChapter(chapter, folderKey, eventIndex) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) return [];

  const snapshot = getCachedChapterEvents(bookId, chapter);
  if (!snapshot?.events?.length || isUnusableChapterGraphCacheSource(snapshot.source)) {
    return [];
  }

  // 한 건만 필요하면 그 이벤트만 재구성 (전체 재구성 후 find 하지 않음).
  // 순번이 없는 행은 재구성 후 eventId로 매칭될 수 있으므로 남김
  const hasDiffCache = snapshot.baseSnapshot && Array.isArray(snapshot.diffs);
  const scoped = hasDiffCache
    ? {
        ...snapshot,
        events: snapshot.events.filter((meta) => {
          const num = diffCacheRowEventNum(meta);
          return !num || num === eventIndex;
        }),
      }
    : snapshot;
  return buildEventsFromChapterCache(scoped, chapter);
}

export function getEventDataByIndex(folderKey, chapter, eventIndex) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1 || !eventIndex || eventIndex < 1) {
    return null;
  }

  const events = getEventsForChapter(chapter, folderKey, toNumberOrNull(eventIndex));
  if (!events.length) {
    return null;
  }

  const event = events.find(
    (entry) => eventUtils.resolveEventNum(entry) === toNumberOrNull(eventIndex)
  );
  if (!event) {
    return null;
  }

  const resolvedEventIdx = eventUtils.resolveEventNum(event) || Number(eventIndex);
  return {
    ...baseChapterEventFields(chapter, resolvedEventIdx, resolvedEventIdx, (
      eventUtils.resolveEventId(event) ?? resolvedEventIdx
    )),
    relations: asArray(event.relations),
    characters: asArray(event.characters),
    event: event.event || null,
  };
}

/** 챕터 이벤트 캐시 → events state에 병합 (React setState용) */
export function applyChapterEventsFromCache(
  prevEvents,
  bookId,
  targetChapter,
  throughEventIdx = null
) {
  const chapterPayload = getCachedChapterEvents(bookId, targetChapter);
  if (!chapterPayload?.events) {
    return { applied: false, hasPayload: false, isEmpty: false, events: prevEvents };
  }
  if (!chapterPayload.events.length) {
    return { applied: false, hasPayload: true, isEmpty: true, events: prevEvents };
  }

  const enrichedEvents = buildEventsFromChapterCache(chapterPayload, targetChapter, throughEventIdx);
  if (!enrichedEvents.length) {
    return { applied: false, hasPayload: true, isEmpty: false, events: prevEvents };
  }

  const events = eventUtils.mergeEventsInState(prevEvents, enrichedEvents, targetChapter);
  return { applied: true, hasPayload: true, isEmpty: false, events };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. Chapter discover / prefetch / ensure
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 챕터 그래프: 챕터 캐시(payload·재구성·이벤트 조회) + 이벤트 탐색·프리페치·책 단위 캐시 예열 */

import {
  normalizeElementId,
  extractCharacterId,
  eventUtils,
  cacheKeyUtils,
  ELEMENTS_TO_RELATIONS_OPTS,
  resolveManifestEventId,
} from './graphCore';
import {
  asArray,
  resolveChapterIndex,
  toNumberOrNull,
  toPositiveInt,
  toPositiveNumberOrNull,
  errorUtils,
  compareLocale,
  sleep,
  resolveEventId,
  sortEventsByIdx,
  resolveEventNum,
} from '../common/valueUtils';
import {
  setBounded,
  loadTtlStorage,
  saveToStorage,
  removeFromStorage,
  CHAPTER_EVENT_CACHE_MAX_AGE_MS,
  CHAPTER_EVENT_CACHE_PREFIX,
  saveTtlStorage,
  awaitTracked,
  GRAPH_BOOK_CACHE_PREFIX,
} from '../common/cache/cacheManager';
import { buildElementsFromGraphPayload } from './graphElements';
import { getBookManifest } from '../api/booksApi';
import { getChapterData, getManifestFromCache } from '../common/cache/manifestCache';
import {
  sortDeltasForAccumulate,
  createDeltaAccumulateWalker,
  ensureBookRelationshipDeltas,
} from './graphDeltas';

/* ─── 챕터 그래프 캐시: payload·재구성(커서)·이벤트 조회·캐시→events ─── */

const CHAPTER_GRAPH_CACHE_SOURCE = Object.freeze({
  API: 'api',
  INVALID: 'invalid',
});

/** 과거에 write됐던 source — 재사용하지 않고 rediscover */
const isUnusableChapterGraphCacheSource = (source) =>
  source === CHAPTER_GRAPH_CACHE_SOURCE.INVALID ||
  source === 'empty' ||
  source === 'manifest-only';

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. Chapter cache payload / reconstruct / book summary
 * ═══════════════════════════════════════════════════════════════════════════ */

function deepEqual(obj1, obj2, depth = 0) {
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    return obj1 === obj2;
  }

  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;

  if (typeof obj1 !== 'object') return obj1 === obj2;

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!deepEqual(obj1[i], obj2[i], depth + 1)) return false;
    }
    return true;
  }

  if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  const keys2Set = new Set(keys2);

  for (const key of keys1) {
    if (!keys2Set.has(key)) return false;
    if (!deepEqual(obj1[key], obj2[key], depth + 1)) return false;
  }

  return true;
}


const cloneArray = (arr) => (Array.isArray(arr) ? arr.map((item) => structuredClone(item)) : []);

const toKeyedMap = (items, getKey) => {
  const map = new Map();
  for (const item of asArray(items)) {
    const id = getKey(item);
    if (id) map.set(id, item);
  }
  return map;
};

/** key 기준 added/updated/removedIds. 항목은 복제하지 않고 next 참조를 그대로 담음 */
const diffByKey = (prevItems, nextItems, getKey, isSame) => {
  const prevMap = toKeyedMap(prevItems, getKey);
  const nextMap = toKeyedMap(nextItems, getKey);
  const added = [];
  const updated = [];
  nextMap.forEach((item, id) => {
    const prev = prevMap.get(id);
    if (!prev) added.push(item);
    else if (!isSame(prev, item)) updated.push(item);
  });
  const removedIds = [...prevMap.keys()].filter((id) => !nextMap.has(id));
  return { added, updated, removedIds };
};

// 수정: id는 같지만 data가 다름 (position은 id 시드로 결정적이라 비교 불필요)
const diffElements = (prev, next) =>
  diffByKey(prev, next, normalizeElementId, (a, b) => deepEqual(a.data, b.data));

const diffCharacters = (prev, next) => {
  const diff = diffByKey(prev, next, extractCharacterId, deepEqual);
  return { ...diff, added: cloneArray(diff.added), updated: cloneArray(diff.updated) };
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
    eventId: resolveEventId(event) ?? resolveEventId(inner) ?? null,
    startTxtOffset: event.startTxtOffset ?? null,
    endTxtOffset: event.endTxtOffset ?? null,
    title: inner?.name ?? inner?.title ?? inner?.eventName ?? null,
    text: inner?.text ?? null,
    hasCharacters: snapshotCharacters.length > 0,
    hasRelations: relations.length > 0,
  };

  return { convertedElements, snapshotCharacters, summary };
}

const buildChapterCachePayload = (
  bookId,
  chapterIdx,
  events,
  source = CHAPTER_GRAPH_CACHE_SOURCE.API
) => {
  const timestamp = Date.now();
  const sortedEvents = sortEventsByIdx(events);
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
        eventIdx: resolveEventNum(event) || 1,
        elements: currentElements,
        characters: currentCharacters,
        eventMeta: event?.event ? structuredClone(event.event) : null,
      };
    } else {
      // diff 항목은 currentElements를 그대로 참조 (읽기 전용)
      diffs.push({
        eventIdx: resolveEventNum(event) || (baseSnapshot?.eventIdx ?? 1),
        eventMeta: event?.event ? structuredClone(event.event) : null,
        elementDiff: diffElements(prevElements, currentElements),
        characterDiff: diffCharacters(prevCharacters, currentCharacters),
      });
    }
    prevElements = currentElements;
    prevCharacters = currentCharacters;
    eventSummaries.push(summary);
  });

  const maxEventIdx = sortedEvents.reduce(
    (max, event) => Math.max(max, resolveEventNum(event) || 0),
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
 * 챕터 캐시(baseSnapshot + 이벤트별 diffs) 재생 공통 규칙.
 * 앞으로 가는 조회는 이전 위치부터 diff를 이어서 적용하고, 뒤로 가면 onReset 후 처음부터 다시 적용.
 * advance(target) 결과:
 *  - 'missing': partial 캐시(through만 적재)인데 base 이전 이벤트 — base를 돌려주면 이후 관계가 노출됨
 *  - 'base': target이 base 이하(또는 숫자 아님) — 호출부가 base 그대로 사용
 *  - 'replayed': target 이하의 diff를 applyDiff로 모두 반영함
 * diffs는 eventIdx 오름차순으로 생성됨 — 정렬 키와 비교 키가 같아 break로 끊어도 결과 동일
 */
export function createDiffReplay(cachePayload, { onReset, applyDiff }) {
  const baseIdx = Number(cachePayload.baseSnapshot.eventIdx) || 1;
  const diffs = sortEventsByIdx(cachePayload.diffs || []);
  let nextDiff = 0;
  let lastTarget = -Infinity;

  const advance = (targetEventIdx) => {
    const target = Number(targetEventIdx);
    if (cachePayload.partial && target < baseIdx) return 'missing';
    if (!Number.isFinite(target) || target <= baseIdx) return 'base';

    if (target < lastTarget) {
      nextDiff = 0;
      onReset();
    }
    lastTarget = target;
    for (; nextDiff < diffs.length; nextDiff += 1) {
      const diff = diffs[nextDiff];
      const diffIdx = Number(diff?.eventIdx);
      if (!Number.isFinite(diffIdx)) continue;
      if (diffIdx > target) break;
      applyDiff(diff, diffIdx);
    }
    return 'replayed';
  };

  return { baseIdx, advance };
}

/**
 * baseSnapshot + diffs → 시점별 그래프 상태를 돌려주는 조회 함수.
 * 오름차순으로 조회하면 diff를 한 번만 순회 (이벤트마다 처음부터 재생하면 O(k²)).
 * 내림차순 조회는 base부터 다시 재생 — 결과는 같고 느릴 뿐. 반환값은 매번 독립 복제본.
 * diff는 Map에 O(Δ)로 반영하고, 배열 변환·정렬은 조회 시 1회 (diff마다 O(N log N) 하지 않음).
 * readOnly: 반환값을 읽기만 할 때 복제 생략 (캐시 항목을 그대로 노출 — 변경 금지)
 * sortElements=false: elements를 정렬하지 않고 Map 순서로 (순서 무관한 조회용, readOnly 전용)
 */
const createChapterGraphStateCursor = (
  cachePayload,
  { readOnly = false, sortElements = true } = {}
) => {
  const baseSnapshot = cachePayload?.baseSnapshot;
  if (!baseSnapshot || !Array.isArray(baseSnapshot.elements)) return () => null;

  // null이면 diff 미적용 — base 배열을 그대로 사용
  let elementMap;
  let characterMap;
  let eventMeta;
  let appliedEventIdx;
  // 마지막 diff 적용 이후 만든 출력 배열 (다음 diff 전까지 재사용, 반환 후 변경하지 않음)
  let outElements;
  let outCharacters;

  const replay = createDiffReplay(cachePayload, {
    onReset: () => resetState(),
    applyDiff: (diff, diffIdx) => {
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
    },
  });
  const resetState = () => {
    elementMap = null;
    characterMap = null;
    eventMeta = baseSnapshot.eventMeta ?? null;
    appliedEventIdx = replay.baseIdx;
    outElements = null;
    outCharacters = null;
  };
  resetState();

  const snapshot = (els, chars, meta, eventIdx) =>
    readOnly
      ? { elements: els, characters: chars, eventMeta: meta ?? null, eventIdx }
      : {
          elements: cloneArray(els),
          characters: cloneArray(chars),
          eventMeta: meta ? structuredClone(meta) : null,
          eventIdx,
        };
  const baseCharacters = baseSnapshot.characters || [];

  return (targetEventIdx) => {
    const state = replay.advance(targetEventIdx);
    if (state === 'missing') return null;
    if (state === 'base') {
      return snapshot(baseSnapshot.elements, baseCharacters, baseSnapshot.eventMeta, replay.baseIdx);
    }
    if (!elementMap) {
      return snapshot(baseSnapshot.elements, baseCharacters, eventMeta, appliedEventIdx);
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
const readTtlCache = (memoryCache, maxSize, key) => {
  if (!key) return null;
  const cached = memoryCache.get(key);
  if (cached && Date.now() - (Number(cached.timestamp) || 0) <= CHAPTER_EVENT_CACHE_MAX_AGE_MS) {
    return cached;
  }
  // 스토리지 접근 실패는 loadTtlStorage가 null로 처리
  const stored = loadTtlStorage(key, CHAPTER_EVENT_CACHE_MAX_AGE_MS, 'localStorage');
  if (stored) setBounded(memoryCache, key, stored, maxSize);
  return stored;
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
 * (mapLegacyOrSummaryEvent와 별도; 입력은 deltas walker snapshot)
 */
const normalizeEventFromDeltasGraphResult = (
  bookId,
  chapterIdx,
  eventIdx,
  result,
  manifestStructure
) => {
  const safe = result && typeof result === 'object' ? result : {};
  const { characters, relations, event: nestedEvent } = safe;
  const resolvedChapterIdx = resolveChapterIndex(safe) ?? chapterIdx;
  // walker event는 { eventId, chapterIndex }뿐 — ordinal을 뽑으면 eventId 끝자리 숫자가 되므로 캐시 키(eventIdx) 기준 유지
  const resolvedEventNum =
    Number(manifestStructure?.eventNum ?? manifestStructure?.eventIdx ?? eventIdx) || eventIdx;
  const resolvedEventId =
    safe.eventId ??
    resolveEventId(nestedEvent) ??
    manifestStructure?.eventId ??
    null;
  const startTxtOffset = nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null;
  const endTxtOffset = nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null;

  return {
    bookId: Number(safe.bookId) || bookId,
    chapterIdx: resolvedChapterIdx,
    eventIdx,
    eventNum: resolvedEventNum,
    characters: cloneArray(characters),
    relations: cloneArray(relations),
    event: {
      idx: eventIdx,
      chapterIdx: resolvedChapterIdx,
      eventId: resolvedEventId ?? eventIdx,
      startTxtOffset,
      endTxtOffset,
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
  readTtlCache(chapterEventMemoryCache, CHAPTER_EVENT_MEMORY_MAX, getChapterEventCacheKey(bookId, chapterIdx));

const setCachedChapterEvents = (bookId, chapterIdx, eventData) => {
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
  const eventIdx = resolveEventNum(event, null);
  if (eventIdx == null || eventIdx <= 0) return null;

  const eventNum = toPositiveInt(event.eventNum, eventIdx);
  const eventId = resolveEventId(event) ?? eventIdx;
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
        resolveEventId(reconstructedMeta) ??
        resolveEventId(eventMeta) ??
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

function getEventsForChapter(bookId, chapter, eventIndex) {
  if (!chapter || chapter < 1) return [];

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

/** 챕터 캐시에서 한 이벤트의 relations·characters (bookId는 서버 숫자 id) */
export function getEventDataByIndex(bookId, chapter, eventIndex) {
  const id = toPositiveNumberOrNull(bookId);
  if (!id || !chapter || chapter < 1 || !eventIndex || eventIndex < 1) {
    return null;
  }

  const events = getEventsForChapter(id, chapter, toNumberOrNull(eventIndex));
  if (!events.length) {
    return null;
  }

  const event = events.find(
    (entry) => resolveEventNum(entry) === toNumberOrNull(eventIndex)
  );
  if (!event) {
    return null;
  }

  const resolvedEventIdx = resolveEventNum(event) || Number(eventIndex);
  return {
    ...baseChapterEventFields(chapter, resolvedEventIdx, resolvedEventIdx, (
      resolveEventId(event) ?? resolvedEventIdx
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

/* ─── 챕터 이벤트 탐색·프리페치·보장 + 책 단위 그래프 캐시 예열(ensureGraphBookCache) ─── */


const graphBookMemoryCache = new Map();

const GRAPH_BOOK_MEMORY_MAX = 50;

const graphBuildPromises = new Map();

const chapterDiscoverPromises = new Map();

const getGraphBookCacheKey = (bookId) => {
  const numeric = toPositiveNumberOrNull(bookId);
  if (numeric === null) return null;
  return `${GRAPH_BOOK_CACHE_PREFIX}${numeric}`;
};

// 챕터 캐시와 같은 TTL — 챕터 캐시 만료 후에도 prewarm이 영구 생략되지 않도록
const readGraphBookCache = (bookId) =>
  readTtlCache(graphBookMemoryCache, GRAPH_BOOK_MEMORY_MAX, getGraphBookCacheKey(bookId));

const writeGraphBookCache = (bookId, payload) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const normalized = { ...payload, timestamp: Date.now() };

  setBounded(graphBookMemoryCache, key, normalized, GRAPH_BOOK_MEMORY_MAX);
  saveTtlStorage(key, normalized, 'localStorage');

  return normalized;
};

/**
 * 책 전체 챕터 이벤트 캐시 예열(서재에서 호출). 끝나면 완료 표시를 메모리 + localStorage에 기록.
 * @param {string|number} bookId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Object|null>}
 */
export const ensureGraphBookCache = async (bookId, { signal } = {}) => {
  const numericId = toPositiveNumberOrNull(bookId);
  if (numericId === null) return null;

  const existing = readGraphBookCache(numericId);
  if (existing) return existing;

  // 공유 빌드는 합류한 모든 호출자가 abort했을 때만 중단 (signal 없는 호출자가 있으면 계속)
  const inflight = graphBuildPromises.get(numericId);
  if (inflight) {
    inflight.signals.push(signal ?? null);
    return inflight.promise;
  }

  const signals = [signal ?? null];
  const buildPromise = (async () => {
    await getBookManifest(numericId, { forceRefresh: false });
    const manifest = getManifestFromCache(numericId);

    const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];

    const normalizedChapterIndices = [...new Set(
      chapters
        .map((chapter) => toNumberOrNull(chapter?.idx))
        .filter((v) => v != null && v > 0)
    )].sort((a, b) => a - b);

    let hasFailedChapter = false;

    for (const chapterIdx of normalizedChapterIndices) {
      if (signals.every((s) => s?.aborted)) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const chapterCache = getCachedChapterEvents(numericId, chapterIdx);
      if (chapterCache && !chapterCache.partial && !chapterCache.capped) continue;
      try {
        await discoverChapterEvents(numericId, chapterIdx, false);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        hasFailedChapter = true;
      }
    }

    // 예열 완료 표시만 저장 (챕터 데이터는 챕터 캐시에 있음).
    // 실패 챕터가 있으면 표시하지 않음 — TTL 동안 재시도가 막히지 않도록
    const marker = { bookId: numericId, builtAt: Date.now() };
    return hasFailedChapter ? marker : writeGraphBookCache(numericId, marker);
  })();

  return awaitTracked(graphBuildPromises, numericId, buildPromise, { promise: buildPromise, signals });
};

function loadManifestEventStructures(bookId, chapterIdx) {
  try {
    const manifestChapter = getChapterData(bookId, chapterIdx);
    if (!manifestChapter?.events?.length) return [];
    return manifestChapter.events
      .map((rawEvent, index) => {
        const eventIdx = resolveEventNum(rawEvent) || Number(index + 1);
        const eventNum = toPositiveNumberOrNull(rawEvent.eventNum) ?? eventIdx;
        return {
          eventIdx,
          eventNum,
          eventId: resolveEventId(rawEvent),
          startTxtOffset: rawEvent.startTxtOffset ?? null,
          endTxtOffset: rawEvent.endTxtOffset ?? null,
        };
      })
      .filter((e) => e.eventIdx > 0);
  } catch (error) {
    errorUtils.logDebug('graphChapters', 'manifest 이벤트 구조 로드 실패', { message: error?.message });
    return [];
  }
}

function buildManifestEventIndex(manifestEventStructures) {
  const manifestEventMap = new Map();
  const manifestEventIndices = [];
  manifestEventStructures.forEach((structure) => {
    const idx = Number(structure?.eventIdx);
    if (!Number.isFinite(idx) || idx <= 0 || manifestEventMap.has(idx)) return;
    manifestEventMap.set(idx, structure);
    manifestEventIndices.push(idx);
  });
  return {
    manifestEventMap,
    sortedManifestIndices: manifestEventIndices.sort((a, b) => a - b),
  };
}

/** partial=true: through 이벤트만 적재된 상태 (백필 전) */
/** capped=true: maxEventIdx 이후 이벤트를 의도적으로 생략한 prefix 캐시 (prefetch) */
function publishChapterPartialCache(bookId, chapterIdx, apiEvents, onPartialCache, partial = false, capped = false) {
  if (!apiEvents.length) return null;
  const payload = {
    ...buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API),
    partial,
    capped,
  };
  setCachedChapterEvents(bookId, chapterIdx, payload);
  if (typeof onPartialCache === 'function') {
    try {
      onPartialCache(payload);
    } catch (error) {
      errorUtils.logDebug('graphChapters', 'onPartialCache 콜백 실패', { message: error?.message });
    }
  }
  return payload;
}

function appendSnapshotEventToContext(ctx, eventIdx, manifestStructure, snapshot) {
  ctx.apiEvents.push(
    normalizeEventFromDeltasGraphResult(ctx.bookId, ctx.chapterIdx, eventIdx, snapshot, manifestStructure)
  );
  ctx.fetchedEventIdxSet.add(eventIdx);
}

/** apiEvents에서 eventIdx 직전 이벤트 O(n) 스캔 (Phase 1 through 선적재로 순서 무보장) */
/**
 * eventIdx보다 순번(resolveEventNum)이 작은 이벤트 중 순번 최대인 것을 찾는 커서 — 같은 순번이면 apiEvents 뒤쪽 항목.
 * before()는 eventIdx 오름차순으로 호출. 호출마다 apiEvents 전체를 훑지 않음 (O(E²) → O(E log E)).
 * 커서 생성 뒤 apiEvents에 push한 이벤트는 add로 알린다.
 */
function createPreviousEventCursor(apiEvents) {
  const toCandidate = (event, seq) => ({ n: resolveEventNum(event) || 0, seq, event });
  const existing = apiEvents.map(toCandidate).filter((c) => c.n > 0).sort((a, b) => a.n - b.n || a.seq - b.seq);
  let seq = apiEvents.length;
  let next = 0;
  let pending = [];
  let best = null;

  const consider = (c) => {
    if (!best || c.n > best.n || (c.n === best.n && c.seq > best.seq)) best = c;
  };

  return {
    before(eventIdx) {
      while (next < existing.length && existing[next].n < eventIdx) consider(existing[next++]);
      if (pending.length) {
        const waiting = [];
        for (const c of pending) (c.n < eventIdx ? consider(c) : waiting.push(c));
        pending = waiting;
      }
      return best?.event ?? null;
    },
    add(event) {
      const c = toCandidate(event, seq++);
      if (c.n > 0) pending.push(c);
    },
  };
}

/** 매크로태스크로 양보 — 마이크로태스크(Promise.resolve)로는 렌더·타이머가 끼어들지 못함 */
const yieldToMainThread = () => sleep(0);

/** 정렬된 deltas → 이벤트 스냅샷 증분 적재 (through 우선 + 백필) */
async function appendEventsFromSortedDeltas(ctx, sourceBookId, sortedDeltas, eventEntries, chapterEventIdOrder) {
  if (!eventEntries.length) return;

  const { chapterIdx, fetchedEventIdxSet, apiEvents, onPartialCache } = ctx;
  const walkerOpts = { chapterIndex: chapterIdx, chapterEventIdOrder };
  const lastEntry = eventEntries[eventEntries.length - 1];
  let publishedPartial = false;

  // Phase 1: through 이벤트 우선
  if (lastEntry?.eventId && !fetchedEventIdxSet.has(lastEntry.eventIdx)) {
    const throughWalker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
    appendSnapshotEventToContext(
      ctx,
      lastEntry.eventIdx,
      lastEntry.structure,
      throughWalker.snapshotThrough(lastEntry.eventId)
    );
    publishChapterPartialCache(ctx.bookId, chapterIdx, apiEvents, onPartialCache, true, ctx.capped);
    publishedPartial = true;
    // through 결과를 먼저 그리고 ensureChapterEventsDiscovered가 반환할 틈을 줌
    await yieldToMainThread();
  }

  // Phase 2: 전체 구간 백필 (eventEntries는 eventIdx 오름차순)
  const walker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
  const previousEvent = createPreviousEventCursor(apiEvents);
  let appended = 0;
  for (let i = 0; i < eventEntries.length; i += 1) {
    const { eventIdx, eventId, structure } = eventEntries[i];

    // 이미 캐시에 있으면 finalize(비김) 생략하고 누적 커서만 전진
    if (fetchedEventIdxSet.has(eventIdx)) {
      if (eventId) walker.advanceThrough(eventId);
      if (i > 0 && i % 16 === 0) await yieldToMainThread();
      continue;
    }

    let snapshot;
    if (!eventId) {
      const prev = previousEvent.before(eventIdx);
      snapshot = {
        bookId: sourceBookId,
        chapterIndex: chapterIdx,
        eventId: null,
        // normalizeEventFromDeltasGraphResult가 복제하므로 여기선 참조만 넘김
        characters: Array.isArray(prev?.characters) ? prev.characters : [],
        relations: Array.isArray(prev?.relations) ? prev.relations : [],
        event: {
          chapterIndex: chapterIdx,
          chapterIdx,
          eventId: null,
          startTxtOffset: structure?.startTxtOffset ?? null,
          endTxtOffset: structure?.endTxtOffset ?? null,
        },
      };
    } else {
      snapshot = walker.snapshotThrough(eventId);
    }

    appendSnapshotEventToContext(ctx, eventIdx, structure, snapshot);
    previousEvent.add(apiEvents[apiEvents.length - 1]);
    appended += 1;

    if (i > 0 && i % 8 === 0) await yieldToMainThread();
  }
  // 백필할 게 없었어도 Phase 1의 partial 표시는 해제해야 함
  if (appended > 0 || publishedPartial) {
    ctx.finalPayload = publishChapterPartialCache(ctx.bookId, chapterIdx, apiEvents, onPartialCache, false, ctx.capped);
  }
}

/** 1회 deltas fetch 후 증분 누적 */
async function collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap) {
  if (!indicesToFetch.length) return;

  const { bookId, chapterIdx } = ctx;
  // 실패는 삼키지 않음 — 삼키면 discoverWithoutManifest가 같은 요청을 반복하고 api_error가 cache_missing으로 바뀜
  const fetched = await ensureBookRelationshipDeltas(bookId, {
    chapterIndex: chapterIdx,
  });

  const eventEntries = indicesToFetch.map((eventIdx) => {
    const structure = manifestEventMap.get(eventIdx) ?? null;
    return {
      eventIdx,
      eventId: resolveManifestEventId(structure),
      structure,
    };
  });
  const chapterEventIdOrder = eventEntries.map((e) => e.eventId).filter(Boolean);
  const sortedDeltas = sortDeltasForAccumulate(fetched.deltas, chapterEventIdOrder);
  await appendEventsFromSortedDeltas(
    ctx,
    fetched.bookId ?? bookId,
    sortedDeltas,
    eventEntries,
    chapterEventIdOrder
  );
}

/** manifest 이벤트 없을 때: 챕터 단위 deltas + 로컬 누적 */
async function discoverWithoutManifest(ctx, cappedMaxEventIdx) {
  const { bookId, chapterIdx } = ctx;
  const fetched = await ensureBookRelationshipDeltas(bookId, {
    chapterIndex: chapterIdx,
  });
  const deltas = Array.isArray(fetched?.deltas) ? fetched.deltas : [];
  if (!deltas.length) return;

  const sortedDeltas = sortDeltasForAccumulate(deltas);
  const seenIds = new Set();
  for (const delta of sortedDeltas) {
    const eventId = typeof delta?.eventId === 'string' ? delta.eventId.trim() : '';
    if (!eventId || seenIds.has(eventId)) continue;
    // 해당 챕터 delta만 (chapterIndex가 있으면 필터)
    const deltaChapter = Number(delta?.chapterIndex);
    if (Number.isFinite(deltaChapter) && deltaChapter !== chapterIdx) continue;
    seenIds.add(eventId);
  }
  const allIds = [...seenIds];
  const idsToBuild = cappedMaxEventIdx ? allIds.slice(0, cappedMaxEventIdx) : allIds;
  ctx.capped = idsToBuild.length < allIds.length;
  const eventEntries = idsToBuild.map((eventId, index) => ({
    eventIdx: index + 1,
    eventId,
    structure: { eventIdx: index + 1, eventId },
  }));
  ctx.targetIndices = eventEntries.map((entry) => entry.eventIdx);
  await appendEventsFromSortedDeltas(
    ctx,
    fetched.bookId ?? bookId,
    sortedDeltas,
    eventEntries,
    idsToBuild
  );
}

/** 비-partial 캐시가 챕터 전체이거나, cap까지 prefix가 적재됐는지 */
const isCompleteThrough = (cached, cappedMaxEventIdx) => {
  if (!cached || cached.partial || isUnusableChapterGraphCacheSource(cached.source)) return false;
  // capped 아닌 캐시는 챕터 전체 — cap이 챕터 끝을 넘어도 충족
  if (!cached.capped) return true;
  return Boolean(cappedMaxEventIdx) && (Number(cached.maxEventIdx) || 0) >= cappedMaxEventIdx;
};

/** discover 1회 실행 상태. 기존(partial) 캐시의 rawEvents를 이어받는다 */
function createDiscoverContext(bookId, chapterIdx, { forceRefresh, cappedMaxEventIdx, onPartialCache }) {
  const existingCache = !forceRefresh ? getCachedChapterEvents(bookId, chapterIdx) : null;
  const apiEvents = Array.isArray(existingCache?.rawEvents)
    ? [...existingCache.rawEvents] // push용 배열 복사 — 이벤트 항목은 불변
    : [];
  const fetchedEventIdxSet = new Set(
    apiEvents.map((event) => resolveEventNum(event) || 0).filter((idx) => idx > 0)
  );
  return {
    bookId,
    chapterIdx,
    apiEvents,
    fetchedEventIdxSet,
    onPartialCache,
    // 기존(partial) 캐시가 cap 뒤 이벤트를 갖고 있으면 cap을 늘려 prefix 연속성 유지
    capThrough: cappedMaxEventIdx ? Math.max(cappedMaxEventIdx, ...fetchedEventIdxSet) : null,
    capped: false,
    /** appendEventsFromSortedDeltas가 최종(비-partial) 캐시를 저장했으면 그 payload */
    finalPayload: null,
    /** 이번 요청이 채워야 하는 eventIdx 목록 */
    targetIndices: null,
  };
}

/**
 * 두 탐색 경로 공통 마무리. 대상 이벤트를 전부 확보했을 때만 새로 저장 —
 * deltas가 비어 기존 캐시 이벤트만 있을 때 capped 캐시를 완성본으로 덮지 않도록
 */
function finalizeChapterCache(ctx) {
  const { bookId, chapterIdx, apiEvents, fetchedEventIdxSet } = ctx;
  if (ctx.finalPayload) return ctx.finalPayload;
  const covered =
    ctx.targetIndices?.length > 0 &&
    ctx.targetIndices.every((idx) => fetchedEventIdxSet.has(idx));
  if (!covered) {
    return (
      getCachedChapterEvents(bookId, chapterIdx) ??
      buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API)
    );
  }
  const payload = {
    ...buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API),
    capped: ctx.capped,
  };
  setCachedChapterEvents(bookId, chapterIdx, payload);
  return payload;
}

/** manifest 이벤트 기준 탐색 → 결과가 없으면 deltas의 eventId 순서로 탐색 */
async function runChapterDiscovery(ctx) {
  const { bookId, chapterIdx, apiEvents, capThrough } = ctx;
  const manifestEventStructures = loadManifestEventStructures(bookId, chapterIdx);
  const { manifestEventMap, sortedManifestIndices } = buildManifestEventIndex(manifestEventStructures);

  if (sortedManifestIndices.length > 0) {
    const indicesToFetch = capThrough
      ? sortedManifestIndices.filter((idx) => idx <= capThrough)
      : sortedManifestIndices;
    ctx.capped = indicesToFetch.length < sortedManifestIndices.length;
    ctx.targetIndices = indicesToFetch;

    await collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap);
    if (apiEvents.length > 0) return finalizeChapterCache(ctx);
  }

  await discoverWithoutManifest(ctx, capThrough);

  if (!apiEvents.length) {
    if (import.meta.env.DEV) {
      errorUtils.logDebug('graphChapters', 'relationship-deltas 이벤트 없음', { chapterIdx });
    }
    // EMPTY를 캐시에 쓰지 않음 — "빈 성공" 고착 방지 (재요청 가능)
    return null;
  }

  return finalizeChapterCache(ctx);
}

const discoverChapterEvents = async (
  bookId,
  chapterIdx,
  forceRefresh = false,
  options = {}
) => {
  const { maxEventIdx = null, onPartialCache = null } = options;
  const cappedMaxEventIdx =
    Number.isFinite(Number(maxEventIdx)) && Number(maxEventIdx) > 0 ? Number(maxEventIdx) : null;

  if (!bookId || !chapterIdx || chapterIdx < 1) {
    return buildChapterCachePayload(bookId, chapterIdx, [], CHAPTER_GRAPH_CACHE_SOURCE.INVALID);
  }

  if (!forceRefresh) {
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (isCompleteThrough(cached, cappedMaxEventIdx)) {
      return cached;
    }
  }

  const discoverKey = cacheKeyUtils.createChapterKey(bookId, chapterIdx);
  if (!forceRefresh && chapterDiscoverPromises.has(discoverKey)) {
    await chapterDiscoverPromises.get(discoverKey);
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (isCompleteThrough(cached, cappedMaxEventIdx)) {
      return cached;
    }
  }

  const ctx = createDiscoverContext(bookId, chapterIdx, { forceRefresh, cappedMaxEventIdx, onPartialCache });
  const discoverPromise = runChapterDiscovery(ctx).catch((error) => {
    if (import.meta.env.DEV) {
      errorUtils.logDebug('graphChapters', '챕터 이벤트 discover 실패', { chapterIdx, message: error?.message || String(error) });
    }
    throw error;
  });

  return awaitTracked(chapterDiscoverPromises, discoverKey, discoverPromise);
};

/**
 * 읽기 위치 기준으로 필요한 이벤트만 선행 캐시 (TTL 스토리지 기록).
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number} throughEventIdx
 * @returns {Promise<Object|null>}
 */
export const prefetchChapterEvents = (bookId, chapterIdx, throughEventIdx) => {
  const through = Number(throughEventIdx);
  if (!bookId || !chapterIdx || !Number.isFinite(through) || through < 1) {
    return Promise.resolve(null);
  }
  return discoverChapterEvents(bookId, chapterIdx, false, {
    maxEventIdx: through,
  });
};

/**
 * through 시점까지 사용 가능 캐시 여부.
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number|null} [throughEventIdx]
 * @returns {boolean}
 */
export const hasUsableChapterCacheThrough = (bookId, chapterIdx, throughEventIdx = null) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  if (!cached || isUnusableChapterGraphCacheSource(cached.source)) return false;
  const through = Number(throughEventIdx);
  if (!Number.isFinite(through) || through < 1) return !cached.partial && !cached.capped;
  // partial은 through 우선 적재 후 백필 중이라 중간 구간이 비어 있을 수 있음 — 해당 이벤트가 있어야 사용 가능
  if (cached.partial) {
    return asArray(cached.events).some((e) => Number(e?.eventIdx) === through);
  }
  // capped 아닌 캐시는 챕터 전체 — through가 챕터 끝을 넘어도 충족 (isCompleteThrough와 동일 기준)
  if (!cached.capped) return true;
  const cachedMax = Number(cached.maxEventIdx) || 0;
  return cachedMax >= through;
};

/**
 * 챕터 이벤트 캐시 확보. through 시점이 준비되면 즉시 success (백필은 백그라운드 계속).
 * @param {string|number} bookId
 * @param {number} chapter
 * @param {Object} [options]
 * @param {Function|null} [options.onPartialCache]
 * @param {number|null} [options.throughEventIdx]
 * @returns {Promise<{ success: boolean, reason?: string, error?: Error }>}
 */
/**
 * 16ms마다 isReady 확인. 작업이 끝나기 전에 준비되면 true, 끝났는데도 준비 안 됐으면 false.
 * promise가 실패하면 throw.
 */
async function waitUntilReady(promise, isReady) {
  for (;;) {
    if (isReady()) return true;
    const race = await Promise.race([
      promise.then(() => 'done'),
      new Promise((resolve) => {
        setTimeout(() => resolve('tick'), 16);
      }),
    ]);
    if (race === 'done') return isReady();
  }
}

export async function ensureChapterEventsDiscovered(
  bookId,
  chapter,
  { onPartialCache = null, throughEventIdx = null } = {}
) {
  if (!bookId || !chapter || chapter < 1) {
    return { success: false, reason: 'invalid_args' };
  }
  if (hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx)) {
    return { success: true };
  }

  const isReady = () => hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx);
  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const discoverPromise = discoverChapterEvents(bookId, chapter, attempt > 0, {
        maxEventIdx: throughEventIdx,
        onPartialCache,
      });
      // 아래에서 race 없이 조기 반환하면 이후 rejection이 unhandled가 되므로 흡수 (실패는 아래 race가 throw해 catch에서 처리)
      discoverPromise.catch(() => {});

      // through 캐시가 생기는 순간 반환 (전체 이벤트 백필 완료를 기다리지 않음)
      if (await waitUntilReady(discoverPromise, isReady)) {
        return { success: true };
      }
    } catch (error) {
      // clearBookRelationshipDeltas로 취소됨 — 재시도하면 떠난 책을 다시 받음
      if (error?.name === 'AbortError') {
        return { success: false, reason: 'aborted', error };
      }
      lastError = error;
    }
  }

  if (lastError) {
    return { success: false, reason: 'api_error', error: lastError };
  }
  return { success: false, reason: 'cache_missing' };
}

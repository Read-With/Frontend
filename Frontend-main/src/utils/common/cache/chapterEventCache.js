import { sortEventsByIdx } from '../../graph/graphData';
import {
  aggregateCharactersFromEvents,
  buildNodeWeightsFromEvents,
  createCharacterMaps,
  extractCharacterId,
  toNodeWeightsOrNull,
} from '../../graph/characterUtils';
import { getFineGraph, getBookManifest } from '../../api/api';
import {
  getChapterData as getManifestChapterData,
  getManifestFromCache,
  calculateMaxChapterFromChapters,
  resolveFineGraphEventToLocator,
} from './manifestCache';
import { convertRelationsToElements, calcGraphDiff } from '../../graph/graphDataUtils';
import { normalizeElementId } from '../../graph/graphUtils';
import { 
  registerCache, 
  getCacheItem, 
  setCacheItem,
  loadFromStorage,
  saveToStorage,
  removeFromStorage,
  getRawFromStorage,
} from './cacheManager';
import { eventUtils, cacheKeyUtils } from '../../viewer/viewerCoreStateUtils';
import { resolveProgressLocator, toLocator } from '../locatorUtils';
import { toNumberOrNull, toPositiveNumberOrNull } from '../numberUtils';
import { toTrimmedStringOrNull } from '../stringUtils';

/** 챕터 그래프 캐시 출처 (fine graph result 집계와 동일 스키마) */
const CHAPTER_GRAPH_CACHE_SOURCE = Object.freeze({
  API: 'api',
  EMPTY: 'empty',
  INVALID: 'invalid',
  RUNTIME: 'runtime',
});

const READER_PROGRESS_CACHE_PREFIX = 'reader_progress_';
const READER_PROGRESS_MAX_AGE = 3 * 24 * 60 * 60 * 1000;

const GRAPH_BOOK_CACHE_PREFIX = 'graph_cache_';
const graphBookMemoryCache = new Map();
registerCache('graphBookCache', graphBookMemoryCache, {
  maxSize: 50,
  ttl: null,
  cleanupInterval: 3600000
});
const graphBuildPromises = new Map();
const chapterDiscoverPromises = new Map();

const getChapterDiscoverKey = (bookId, chapterIdx) => `${bookId}-${chapterIdx}`;

export const isChapterEventsDiscovering = (bookId, chapterIdx) => {
  return chapterDiscoverPromises.has(getChapterDiscoverKey(bookId, chapterIdx));
};

const getGraphBookCacheKey = (bookId) => {
  const numeric = toPositiveNumberOrNull(bookId);
  if (numeric === null) return null;
  return `${GRAPH_BOOK_CACHE_PREFIX}${numeric}`;
};

const readGraphBookCache = (bookId) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const cached = getCacheItem('graphBookCache', key);
  if (cached) {
    return cached;
  }

  try {
    const stored = loadFromStorage(key, 'localStorage');
    if (stored) {
      setCacheItem('graphBookCache', key, stored);
      return stored;
    }
    return null;
  } catch (error) {
    console.warn('그래프 책 캐시 로드 실패:', error);
    return null;
  }
};

const writeGraphBookCache = (bookId, payload) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const normalized = {
    ...payload,
    bookId: Number(bookId),
    builtAt: payload?.builtAt ?? Date.now(),
    timestamp: Date.now()
  };

  setCacheItem('graphBookCache', key, normalized);
  saveToStorage(key, normalized, 'localStorage');

  return normalized;
};

export const getGraphBookCache = (bookId) => readGraphBookCache(bookId);

export const isGraphBookCacheBuilding = (bookId) => {
  const numericId = toPositiveNumberOrNull(bookId);
  if (numericId === null) {
    return false;
  }
  return graphBuildPromises.has(numericId);
};

export const ensureGraphBookCache = async (
  bookId,
  { forceRefresh = false, signal } = {}
) => {
  const numericId = toPositiveNumberOrNull(bookId);
  if (numericId === null) {
    return null;
  }

  if (!forceRefresh) {
    const existing = getGraphBookCache(numericId);
    if (existing) {
      return existing;
    }
  }

  if (graphBuildPromises.has(numericId)) {
    return graphBuildPromises.get(numericId);
  }

  const buildPromise = (async () => {
    await getBookManifest(numericId, { forceRefresh });
    const manifest = getManifestFromCache(numericId);

    const chapters = Array.isArray(manifest?.chapters)
      ? manifest.chapters
      : [];

    const normalizedChapterIndices = chapters
      .map((chapter) => {
        const v = toNumberOrNull(chapter?.idx);
        return v != null && v > 0 ? v : null;
      })
      .filter((idx, idxIndex, self) => idx != null && self.indexOf(idx) === idxIndex)
      .sort((a, b) => a - b);

    const chapterSummaries = [];

    for (const chapterIdx of normalizedChapterIndices) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let chapterCache = forceRefresh ? null : getCachedChapterEvents(numericId, chapterIdx);
      if (!chapterCache) {
        chapterCache = await discoverChapterEvents(numericId, chapterIdx, true);
      }

      if (chapterCache) {
        chapterSummaries.push({
          chapterIdx,
          maxEventIdx: Number(chapterCache.maxEventIdx) || 0,
          totalEvents: Array.isArray(chapterCache.events)
            ? chapterCache.events.length
            : 0,
          source: chapterCache.source ?? 'cache',
        });
      }
    }

    const summaryPayload = writeGraphBookCache(numericId, {
      bookId: numericId,
      chapters: chapterSummaries,
      maxChapter: calculateMaxChapterFromChapters(chapters),
      builtAt: Date.now(),
    });

    return summaryPayload;
  })();

  graphBuildPromises.set(numericId, buildPromise);

  try {
    const result = await buildPromise;
    return result;
  } finally {
    graphBuildPromises.delete(numericId);
  }
};

/** eventIdx 시점 누적 그래프 상태 복원 */
export const getGraphEventState = (bookId, chapterIdx, eventIdx) => {
  const chapterPayload = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterPayload) {
    return null;
  }
  return reconstructChapterGraphState(chapterPayload, eventIdx);
};

const getReaderProgressCacheKey = (bookKey) => {
  const sanitized = toTrimmedStringOrNull(bookKey);
  if (!sanitized) return null;
  return `${READER_PROGRESS_CACHE_PREFIX}${sanitized}`;
};

const deepClone = (value) => {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch (error) {
    console.warn('structuredClone 실패, JSON 직렬화로 대체합니다.', error);
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('deepClone 실패:', error);
    return value;
  }
};

const getElementId = normalizeElementId;

const cloneArray = (arr) => Array.isArray(arr) ? arr.map(deepClone) : [];


const safeCompare = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (error) {
    console.warn('safeCompare 실패:', error);
    return false;
  }
};

const computeCharacterDiff = (prevCharacters, nextCharacters) => {
  const prevMap = new Map();
  const nextMap = new Map();

  (Array.isArray(prevCharacters) ? prevCharacters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (!id) return;
    prevMap.set(id, character);
  });

  (Array.isArray(nextCharacters) ? nextCharacters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (!id) return;
    nextMap.set(id, character);
  });

  const added = [];
  const updated = [];
  const removedIds = [];

  nextMap.forEach((character, id) => {
    const prev = prevMap.get(id);
    if (!prev) {
      added.push(deepClone(character));
    } else if (!safeCompare(prev, character)) {
      updated.push(deepClone(character));
    }
  });

  prevMap.forEach((character, id) => {
    if (!nextMap.has(id)) {
      removedIds.push(id);
    }
  });

  return {
    added,
    updated,
    removedIds
  };
};

const applyCharacterDiff = (prevCharacters, diff) => {
  const map = new Map();

  (Array.isArray(prevCharacters) ? prevCharacters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (!id) return;
    map.set(id, deepClone(character));
  });

  (diff?.removedIds || []).forEach((id) => {
    if (!id) return;
    map.delete(String(id));
  });

  (diff?.updated || []).forEach((character) => {
    const id = extractCharacterId(character);
    if (!id) return;
    map.set(id, deepClone(character));
  });

  (diff?.added || []).forEach((character) => {
    const id = extractCharacterId(character);
    if (!id) return;
    map.set(id, deepClone(character));
  });

  return Array.from(map.values());
};

const applyElementDiff = (prevElements, diff) => {
  const map = new Map();

  (Array.isArray(prevElements) ? prevElements : []).forEach((element) => {
    const id = getElementId(element);
    if (!id) return;
    map.set(id, deepClone(element));
  });

  (diff?.removedIds || []).forEach((id) => {
    if (!id) return;
    map.delete(String(id));
  });

  (diff?.updated || []).forEach((element) => {
    const id = getElementId(element);
    if (!id) return;
    map.set(id, deepClone(element));
  });

  (diff?.added || []).forEach((element) => {
    const id = getElementId(element);
    if (!id) return;
    map.set(id, deepClone(element));
  });

  const result = Array.from(map.values());
  result.sort((a, b) => {
    const aIsEdge = Boolean(a?.data?.source);
    const bIsEdge = Boolean(b?.data?.source);
    if (aIsEdge !== bIsEdge) {
      return aIsEdge ? 1 : -1;
    }
    const idA = getElementId(a) || '';
    const idB = getElementId(b) || '';
    return idA.localeCompare(idB);
  });
  return result;
};

/** fine graph 응답 한 건 → 챕터 캐시 이벤트 행 (서버 result 스키마 + manifest 보조) */
const normalizeEventFromFineGraphResponse = (
  bookId,
  chapterIdx,
  eventIdx,
  response,
  manifestStructure
) => {
  const result = response?.result || {};
  const { characters, relations, event: nestedEvent } = result;
  const hasCharacters = Array.isArray(characters) && characters.length > 0;
  const hasRelations = Array.isArray(relations) && relations.length > 0;
  const hasManifestMeta = Boolean(manifestStructure);
  const hasNestedEventMeta =
    nestedEvent &&
    typeof nestedEvent === 'object' &&
    (eventUtils.resolveEventId(nestedEvent) !== null ||
      nestedEvent.name ||
      nestedEvent.title ||
      nestedEvent.startTxtOffset !== undefined ||
      nestedEvent.endTxtOffset !== undefined ||
      nestedEvent.startLocator !== undefined ||
      nestedEvent.endLocator !== undefined);

  if (!hasCharacters && !hasRelations && !hasNestedEventMeta && !hasManifestMeta) {
    return { skip: true, hadGraphData: false };
  }

  const resolvedChapterIdx =
    Number(result.chapterIndex ?? result.chapterIdx ?? chapterIdx) || chapterIdx;
  const ord = nestedEvent ? eventUtils.resolveEventOrdinal(nestedEvent) : null;
  const resolvedEventNum =
    Number.isFinite(ord) && ord > 0
      ? ord
      : Number(manifestStructure?.eventNum ?? manifestStructure?.eventIdx ?? eventIdx);
  const resolvedEventId =
    result.eventId ??
    eventUtils.resolveEventId(nestedEvent) ??
    manifestStructure?.eventId ??
    null;

  return {
    skip: false,
    hadGraphData: hasCharacters || hasRelations || hasNestedEventMeta || hasManifestMeta,
    event: {
      bookId: Number(result.bookId) || bookId,
      chapterIdx: resolvedChapterIdx,
      eventIdx,
      eventNum: resolvedEventNum,
      characters: hasCharacters ? characters.map((character) => deepClone(character)) : [],
      relations: hasRelations ? relations.map((relation) => deepClone(relation)) : [],
      scope: result.scope ?? 'book',
      event: {
        idx: eventIdx,
        chapterIdx: resolvedChapterIdx,
        chapterIndex: resolvedChapterIdx,
        eventId: resolvedEventId ?? eventIdx,
        startTxtOffset:
          nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null,
        endTxtOffset:
          nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null,
        startLocator: nestedEvent?.startLocator,
        endLocator: nestedEvent?.endLocator,
        rawText: nestedEvent?.rawText ?? null,
        ...(nestedEvent && typeof nestedEvent === 'object' ? nestedEvent : {}),
        eventNum: resolvedEventNum,
      },
      startTxtOffset:
        nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null,
      endTxtOffset:
        nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null,
      eventId: resolvedEventId,
    },
  };
};

const buildChapterCachePayload = (
  bookId,
  chapterIdx,
  events,
  source = CHAPTER_GRAPH_CACHE_SOURCE.RUNTIME,
  folderKey = 'api'
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
      eventSummaries: [],
      timestamp,
      source
    };
  }

  const aggregatedRelations = [];
  const diffs = [];
  const eventSummaries = [];
  let baseSnapshot = null;
  let prevElements = [];
  let prevCharacters = [];

  sortedEvents.forEach((event, index) => {
    const relations = Array.isArray(event?.relations) ? event.relations : [];
    const rawCharacters = Array.isArray(event?.characters) ? event.characters : [];
    relations.forEach((relation) => aggregatedRelations.push(deepClone(relation)));

    const eventsUpToCurrent = sortedEvents.slice(0, index + 1);
    const aggregatedCharacters = Array.from(aggregateCharactersFromEvents(eventsUpToCurrent).values())
      .sort((a, b) => {
        const idA = extractCharacterId(a) || '';
        const idB = extractCharacterId(b) || '';
        return idA.localeCompare(idB);
      });
    const nodeWeights = buildNodeWeightsFromEvents(eventsUpToCurrent);

    const {
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      idToProfileImage
    } = createCharacterMaps(aggregatedCharacters);

    let convertedElements = [];
    try {
      convertedElements = convertRelationsToElements(
        aggregatedRelations,
        idToName,
        idToDesc,
        idToDescKo,
        idToMain,
        idToNames,
        folderKey,
        toNodeWeightsOrNull(nodeWeights),
        null,
        event?.event ?? null,
        idToProfileImage,
        aggregatedCharacters.length > 0 ? aggregatedCharacters : null
      );
    } catch (error) {
      console.error('convertRelationsToElements 실패:', error);
      convertedElements = [];
    }

    const currentElements = cloneArray(convertedElements);
    const currentCharacters = cloneArray(aggregatedCharacters);

    if (index === 0) {
      const currentEventIdx = eventUtils.extractRawEventIdx(event) || 1;
      baseSnapshot = {
        eventIdx: currentEventIdx,
        elements: currentElements,
        characters: currentCharacters,
        eventMeta: event?.event ? deepClone(event.event) : null
      };
    } else {
      const elementDiffRaw = calcGraphDiff(prevElements, convertedElements);
      const elementDiff = {
        added: cloneArray(elementDiffRaw?.added || []),
        updated: cloneArray(elementDiffRaw?.updated || []),
        removedIds: (elementDiffRaw?.removed || [])
          .map((element) => getElementId(element))
          .filter(Boolean)
      };
      const characterDiff = computeCharacterDiff(prevCharacters, aggregatedCharacters);

      const currentEventIdx = eventUtils.extractRawEventIdx(event) || (baseSnapshot?.eventIdx ?? 1);
      diffs.push({
        eventIdx: currentEventIdx,
        eventMeta: event?.event ? deepClone(event.event) : null,
        elementDiff,
        characterDiff
      });
    }

    prevElements = currentElements;
    prevCharacters = currentCharacters;

    const summaryEventNum = Number(event.eventNum);
    const summaryIdx = Number(event.eventIdx) || 0;
    eventSummaries.push({
      bookId,
      chapterIdx,
      eventIdx: summaryIdx,
      eventNum: Number.isFinite(summaryEventNum) && summaryEventNum > 0 ? summaryEventNum : summaryIdx,
      eventId: eventUtils.resolveEventId(event) ?? eventUtils.resolveEventId(event?.event) ?? null,
      startTxtOffset: event?.startTxtOffset ?? null,
      endTxtOffset: event?.endTxtOffset ?? null,
      title:
        event?.event?.name ??
        event?.event?.title ??
        event?.event?.eventName ??
        null,
      text: event?.event?.text ?? null,
      hasCharacters: rawCharacters.length > 0,
      hasRelations: relations.length > 0
    });
  });

  const maxEventIdx = sortedEvents.reduce((max, event) => {
    const idx = eventUtils.extractRawEventIdx(event) || 0;
    return idx > max ? idx : max;
  }, 0);

  return {
    bookId,
    chapterIdx,
    maxEventIdx,
    events: eventSummaries.map((summary) => deepClone(summary)),
    baseSnapshot,
    diffs,
    eventSummaries,
    timestamp,
    source,
    rawEvents: sortedEvents.map((event) => deepClone(event)),
  };
};

const normalizeReaderProgressPayload = (bookKey, payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const resolved = resolveProgressLocator(payload);
  const startL =
    (resolved ? toLocator(resolved) ?? resolved : null) ??
    toLocator(payload.startLocator) ??
    toLocator(payload.locator);

  if (!startL || !Number.isFinite(Number(startL.chapterIndex)) || Number(startL.chapterIndex) < 1) {
    return null;
  }

  const endRaw =
    payload.endLocator ??
    payload.anchor?.endLocator ??
    payload.anchor?.end ??
    startL;
  const endL = toLocator(endRaw) ?? startL;

  const eventNumCandidate = Number(payload.eventNum);
  const normalizedEventNum =
    Number.isFinite(eventNumCandidate) && eventNumCandidate > 0 ? eventNumCandidate : null;

  const chapterProgressCandidate = Number(payload.chapterProgress);
  const normalizedChapterProgress = Number.isFinite(chapterProgressCandidate)
    ? Math.max(Math.min(chapterProgressCandidate, 100), 0)
    : null;

  return {
    key: bookKey,
    bookId: payload.bookId ?? null,
    chapterIdx: Number(startL.chapterIndex),
    eventIdx: normalizedEventNum,
    eventNum: normalizedEventNum,
    eventId: payload.eventId ?? payload.id ?? null,
    startLocator: startL,
    endLocator: endL,
    locator: startL,
    eventName:
      payload.eventName ??
      payload.eventTitle ??
      payload.eventLabel ??
      payload.name ??
      payload.title ??
      (payload.event && (payload.event.name ?? payload.event.title)) ??
      null,
    chapterProgress: normalizedChapterProgress,
    source: payload.source ?? CHAPTER_GRAPH_CACHE_SOURCE.RUNTIME,
    timestamp: Date.now(),
  };
};

const getChapterEventCacheKey = (bookId, chapterIdx) => {
  const bookIdNum = toPositiveNumberOrNull(bookId);
  const chapterIdxNum = toPositiveNumberOrNull(chapterIdx);
  if (bookIdNum === null || chapterIdxNum === null) {
    return null;
  }
  return cacheKeyUtils.createChapterKey(bookIdNum, chapterIdxNum);
};

export const getCachedChapterEvents = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return null;
    
    const cacheData = loadFromStorage(cacheKey, 'localStorage');
    if (!cacheData) return null;
    
    const now = Date.now();
    const cacheAge = now - (cacheData.timestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000;
    
    if (cacheAge > maxAge) {
      removeFromStorage(cacheKey, 'localStorage');
      return null;
    }
    
    return cacheData;
  } catch (error) {
    console.error('챕터 이벤트 캐시 로드 실패:', error);
    return null;
  }
};

export const setCachedChapterEvents = (bookId, chapterIdx, eventData) => {
  try {
    if (!eventData) {
      return false;
    }
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return false;
    const cacheData = {
      bookId,
      chapterIdx,
      maxEventIdx: Number(eventData.maxEventIdx) || 0,
      events: Array.isArray(eventData.events) ? eventData.events : [],
      baseSnapshot: eventData.baseSnapshot ? deepClone(eventData.baseSnapshot) : null,
      diffs: Array.isArray(eventData.diffs) ? deepClone(eventData.diffs) : [],
      eventSummaries: Array.isArray(eventData.eventSummaries) ? deepClone(eventData.eventSummaries) : [],
      rawEvents: Array.isArray(eventData.rawEvents) ? deepClone(eventData.rawEvents) : [],
      timestamp: Number(eventData.timestamp) || Date.now(),
      source: eventData.source || null
    };
    
    saveToStorage(cacheKey, cacheData, 'localStorage');
    return true;
  } catch (error) {
    console.error('챕터 이벤트 캐시 저장 실패:', error);
    return false;
  }
};

export const getCachedReaderProgress = (bookKey) => {
  try {
    const cacheKey = getReaderProgressCacheKey(bookKey);
    if (!cacheKey) return null;

    const parsed = loadFromStorage(cacheKey, 'localStorage');
    if (!parsed) return null;

    const timestamp = parsed?.timestamp ?? 0;

    let chapterIdx = Number(parsed?.chapterIdx);
    const loc = parsed?.startLocator ?? parsed?.locator;
    if ((!Number.isFinite(chapterIdx) || chapterIdx <= 0) && loc && typeof loc === 'object') {
      const fromLoc = Number(loc.chapterIndex ?? loc.chapterIdx);
      if (Number.isFinite(fromLoc) && fromLoc >= 1) {
        chapterIdx = fromLoc;
      }
    }

    if (!Number.isFinite(chapterIdx) || chapterIdx <= 0) {
      removeFromStorage(cacheKey, 'localStorage');
      return null;
    }

    if (Date.now() - timestamp > READER_PROGRESS_MAX_AGE) {
      removeFromStorage(cacheKey, 'localStorage');
      return null;
    }

    return {
      ...parsed,
      chapterIdx,
      eventIdx: Number.isFinite(Number(parsed.eventIdx)) ? Number(parsed.eventIdx) : null,
      eventNum: Number.isFinite(Number(parsed.eventNum)) ? Number(parsed.eventNum) : null,
      chapterProgress: Number.isFinite(Number(parsed.chapterProgress))
        ? Number(parsed.chapterProgress)
        : null
    };
  } catch (error) {
    console.error('독서 위치 캐시 로드 실패:', error);
    return null;
  }
};

export const setCachedReaderProgress = (bookKey, payload) => {
  try {
    const cacheKey = getReaderProgressCacheKey(bookKey);
    if (!cacheKey) return null;

    const normalized = normalizeReaderProgressPayload(toTrimmedStringOrNull(bookKey), payload);
    if (!normalized) return null;

    saveToStorage(cacheKey, normalized, 'localStorage');
    return normalized;
  } catch (error) {
    console.error('독서 위치 캐시 저장 실패:', error);
    return null;
  }
};

export const discoverChapterEvents = async (
  bookId,
  chapterIdx,
  forceRefresh = false,
  options = {}
) => {
  const { urgent = false, maxEventIdx = null, onPartialCache = null } = options;
  const cappedMaxEventIdx = Number.isFinite(Number(maxEventIdx)) && Number(maxEventIdx) > 0
    ? Number(maxEventIdx)
    : null;
  if (!bookId || !chapterIdx || chapterIdx < 1) {
    return {
      bookId,
      chapterIdx,
      maxEventIdx: 0,
      events: [],
      baseSnapshot: null,
      diffs: [],
      eventSummaries: [],
      timestamp: Date.now(),
      source: CHAPTER_GRAPH_CACHE_SOURCE.INVALID
    };
  }

  if (!forceRefresh) {
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (cached && cached.source !== 'manifest-only') {
      const cachedMax = Number(cached.maxEventIdx) || 0;
      if (!cappedMaxEventIdx || cachedMax >= cappedMaxEventIdx) {
        return cached;
      }
    }
  }

  const discoverKey = getChapterDiscoverKey(bookId, chapterIdx);
  if (!forceRefresh && chapterDiscoverPromises.has(discoverKey)) {
    return chapterDiscoverPromises.get(discoverKey);
  }

  const discoverPromise = (async () => {
  const existingCache = !forceRefresh ? getCachedChapterEvents(bookId, chapterIdx) : null;
  const apiEvents = Array.isArray(existingCache?.rawEvents)
    ? existingCache.rawEvents.map((event) => deepClone(event))
    : [];
  const fetchedEventIdxSet = new Set(
    apiEvents
      .map((event) => eventUtils.extractRawEventIdx(event) || 0)
      .filter((idx) => idx > 0)
  );
  
  let manifestEventStructures = [];
  try {
  const manifestChapter = getManifestChapterData(bookId, chapterIdx);
  if (manifestChapter?.events?.length) {
      manifestEventStructures = manifestChapter.events.map((rawEvent, index) => {
        const eventIdx = eventUtils.extractRawEventIdx(rawEvent) || Number(index + 1);
        const fromApi = Number(rawEvent.eventNum);
        const eventNum =
          Number.isFinite(fromApi) && fromApi > 0 ? fromApi : eventIdx;
        return {
          eventIdx,
          eventNum,
          eventId: eventUtils.resolveEventId(rawEvent),
          startTxtOffset: rawEvent.startTxtOffset ?? null,
          endTxtOffset: rawEvent.endTxtOffset ?? null,
        };
      }).filter((e) => e.eventIdx > 0);
    }
  } catch (error) {
    console.warn('manifest 이벤트 구조 로드 실패:', error);
  }

  const publishPartialCache = () => {
    if (!apiEvents.length) return;
    const payload = buildChapterCachePayload(
      bookId,
      chapterIdx,
      apiEvents,
      CHAPTER_GRAPH_CACHE_SOURCE.API
    );
    setCachedChapterEvents(bookId, chapterIdx, payload);
    if (typeof onPartialCache === 'function') {
      try {
        onPartialCache(payload);
      } catch (error) {
        console.warn('onPartialCache 콜백 실패:', error);
      }
    }
  };

  const manifestEventMap = new Map();
  const manifestEventIndices = [];
  manifestEventStructures.forEach((structure) => {
    const idx = Number(structure?.eventIdx);
    if (!Number.isFinite(idx) || idx <= 0 || manifestEventMap.has(idx)) {
      return;
    }
    manifestEventMap.set(idx, structure);
    manifestEventIndices.push(idx);
  });

  const sortedManifestIndices = manifestEventIndices.sort((a, b) => a - b);

  const collectEvent = async (eventIdx, manifestStructure = null) => {
    try {
      const atLocator = resolveFineGraphEventToLocator(bookId, chapterIdx, eventIdx);
      const response = await getFineGraph(bookId, chapterIdx, eventIdx, atLocator);
      const norm = normalizeEventFromFineGraphResponse(
        bookId,
        chapterIdx,
        eventIdx,
        response,
        manifestStructure
      );
      if (norm.skip) {
        return false;
      }
      apiEvents.push(norm.event);
      fetchedEventIdxSet.add(eventIdx);
      if (!urgent) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return norm.hadGraphData;
    } catch (error) {
      console.warn(`⚠️ 이벤트 ${eventIdx} fine 그래프 API 호출 실패:`, error);
      return false;
    }
  };

  if (sortedManifestIndices.length > 0) {
    const indicesToFetch = cappedMaxEventIdx != null
      ? sortedManifestIndices.filter((idx) => idx <= cappedMaxEventIdx)
      : sortedManifestIndices;

    for (const eventIdx of indicesToFetch) {
      if (fetchedEventIdxSet.has(eventIdx)) {
        continue;
      }
      const manifestStructure = manifestEventMap.get(eventIdx);
      await collectEvent(eventIdx, manifestStructure);
      publishPartialCache();
    }
    if (apiEvents.length > 0) {
      return getCachedChapterEvents(bookId, chapterIdx) ?? buildChapterCachePayload(
        bookId,
        chapterIdx,
        apiEvents,
        CHAPTER_GRAPH_CACHE_SOURCE.API
      );
    }
  }

  let eventIdx = fetchedEventIdxSet.size > 0
    ? Math.max(...fetchedEventIdxSet) + 1
    : 1;
  let emptyStreak = 0;
  const EMPTY_STREAK_LIMIT = 2;
  const MAX_DYNAMIC_SCAN = cappedMaxEventIdx ?? 500;

  while (eventIdx <= MAX_DYNAMIC_SCAN && emptyStreak < EMPTY_STREAK_LIMIT) {
    if (!fetchedEventIdxSet.has(eventIdx)) {
      const hadData = await collectEvent(eventIdx, null);
      publishPartialCache();
      if (hadData) {
        emptyStreak = 0;
      } else {
        emptyStreak += 1;
      }
    }
    eventIdx += 1;
  }

  if (!apiEvents.length) {
    console.warn(`⚠️ 챕터 ${chapterIdx}: fine 그래프 API에서 이벤트를 찾을 수 없음`);
    const emptyPayload = {
      bookId,
      chapterIdx,
      maxEventIdx: 0,
      events: [],
      baseSnapshot: null,
      diffs: [],
      eventSummaries: [],
      timestamp: Date.now(),
      source: CHAPTER_GRAPH_CACHE_SOURCE.EMPTY
    };
    setCachedChapterEvents(bookId, chapterIdx, emptyPayload);
    return emptyPayload;
  }

  const payload = buildChapterCachePayload(
    bookId,
    chapterIdx,
    apiEvents,
    CHAPTER_GRAPH_CACHE_SOURCE.API
  );

  setCachedChapterEvents(bookId, chapterIdx, payload);
  return payload;
  })();

  chapterDiscoverPromises.set(discoverKey, discoverPromise);
  try {
    return await discoverPromise;
  } finally {
    chapterDiscoverPromises.delete(discoverKey);
  }
};

/** 읽기 위치 기준으로 필요한 이벤트만 선행 캐시 */
export const prefetchChapterEvents = (bookId, chapterIdx, throughEventIdx) => {
  const through = Number(throughEventIdx);
  if (!bookId || !chapterIdx || !Number.isFinite(through) || through < 1) {
    return Promise.resolve(null);
  }
  return discoverChapterEvents(bookId, chapterIdx, false, {
    urgent: true,
    maxEventIdx: through,
  });
};

const hasUsableChapterCache = (bookId, chapterIdx) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  if (!cached) return false;
  if (cached.source === CHAPTER_GRAPH_CACHE_SOURCE.INVALID) return false;
  if (cached.source === 'manifest-only') return false;
  return true;
};

const hasUsableChapterCacheThrough = (bookId, chapterIdx, throughEventIdx = null) => {
  if (!hasUsableChapterCache(bookId, chapterIdx)) return false;
  const through = Number(throughEventIdx);
  if (!Number.isFinite(through) || through < 1) return true;
  const cachedMax = Number(getCachedChapterEvents(bookId, chapterIdx)?.maxEventIdx) || 0;
  return cachedMax >= through;
};

/** 챕터 이벤트 캐시 확보 (재시도 포함, UI 무관) */
export async function ensureChapterEventsDiscovered(
  bookId,
  chapter,
  { maxAttempts = 2, onPartialCache = null, throughEventIdx = null } = {}
) {
  if (!bookId || !chapter || chapter < 1) {
    return { success: false, reason: 'invalid_args' };
  }
  if (hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx)) {
    return { success: true, isEmpty: !getCachedChapterEvents(bookId, chapter)?.events?.length };
  }

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await discoverChapterEvents(bookId, chapter, attempt > 0, {
        urgent: true,
        maxEventIdx: throughEventIdx,
        onPartialCache,
      });
      if (hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx)) {
        return {
          success: true,
          isEmpty: !getCachedChapterEvents(bookId, chapter)?.events?.length,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return { success: false, reason: 'api_error', error: lastError };
  }
  return { success: false, reason: 'cache_missing' };
}

/** baseSnapshot + diffs로 eventIdx 시점 그래프 상태 재구성 */
export const reconstructChapterGraphState = (cachePayload, targetEventIdx) => {
  if (!cachePayload || typeof cachePayload !== 'object') {
    return null;
  }

  const baseSnapshot = cachePayload.baseSnapshot;
  if (!baseSnapshot || !Array.isArray(baseSnapshot.elements)) {
    return null;
  }

  const baseIdx = Number(baseSnapshot.eventIdx) || 1;
  const normalizedTarget = Number(targetEventIdx);

  let currentElements = cloneArray(baseSnapshot.elements);
  let currentCharacters = cloneArray(baseSnapshot.characters || []);
  let currentEventMeta = baseSnapshot.eventMeta ? deepClone(baseSnapshot.eventMeta) : null;
  let appliedEventIdx = baseIdx;

  if (!Number.isFinite(normalizedTarget) || normalizedTarget <= baseIdx) {
    return {
      elements: currentElements,
      characters: currentCharacters,
      eventMeta: currentEventMeta,
      eventIdx: appliedEventIdx
    };
  }

  const sortedDiffs = sortEventsByIdx(cachePayload.diffs || []);

  sortedDiffs.forEach((diff) => {
    const diffIdx = Number(diff?.eventIdx);
    if (!Number.isFinite(diffIdx) || diffIdx > normalizedTarget) {
      return;
    }

    currentElements = applyElementDiff(currentElements, diff?.elementDiff);
    currentCharacters = applyCharacterDiff(currentCharacters, diff?.characterDiff);
    currentEventMeta = diff?.eventMeta ? deepClone(diff.eventMeta) : currentEventMeta;
    appliedEventIdx = diffIdx;
  });

  return {
    elements: currentElements,
    characters: currentCharacters,
    eventMeta: currentEventMeta,
    eventIdx: appliedEventIdx
  };
};

/** 캐시된 fine 집계 행만 반환 (네트워크 없음) */
export const getChapterEventFallbackData = (bookId, chapterIdx, eventIdx) => {
  const chapterCache = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterCache) return null;

  const reconstructed = reconstructChapterGraphState(chapterCache, eventIdx);
  if (reconstructed) {
    const characters = reconstructed.characters || [];
    const elements = reconstructed.elements || [];
    if (characters.length || elements.length) {
      const relations = eventUtils.convertElementsToRelations(elements, {
        includeLabel: true,
        includeCount: false,
        positivityDefault: null,
      });
      return {
        characters,
        relations,
        event: reconstructed.eventMeta || null,
      };
    }
  }

  const rawEvents = Array.isArray(chapterCache.rawEvents) ? chapterCache.rawEvents : [];
  const fallbackEvent = eventUtils.findEventInCache(rawEvents, eventIdx);
  if (fallbackEvent && (fallbackEvent.characters?.length || fallbackEvent.relations?.length)) {
    return {
      characters: Array.isArray(fallbackEvent.characters) ? fallbackEvent.characters : [],
      relations: Array.isArray(fallbackEvent.relations) ? fallbackEvent.relations : [],
      event: fallbackEvent.event || null,
    };
  }

  return null;
};

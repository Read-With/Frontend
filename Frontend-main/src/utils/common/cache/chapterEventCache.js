import { sortEventsByIdx } from '../../graph/eventUtils';
import { buildNodeWeights, extractCharacterId } from '../../graph/characterUtils';
import { getFineGraph, getBookManifest } from '../../api/api';
import {
  getChapterData as getManifestChapterData,
  getManifestFromCache,
  calculateMaxChapterFromChapters,
} from './manifestCache';
import { createCharacterMaps } from '../../graph/characterUtils';
import { convertRelationsToElements, calcGraphDiff } from '../../graph/graphDataUtils';
import { 
  registerCache, 
  getCacheItem, 
  setCacheItem,
  loadFromStorage,
  saveToStorage,
  removeFromStorage,
  getRawFromStorage,
  getStorage
} from './cacheManager';
import { eventUtils, resolveFineGraphEventOrdinal } from '../../viewer/viewerUtils';
import { resolveProgressLocator, toLocator } from '../locatorUtils';
import { toNumberOrNull } from '../numberUtils';

/**
 * 뷰어·내장 분할 그래프(단독 그래프 페이지 제외)의 챕터 그래프 캐시 출처.
 * 행·이벤트 메타는 GET /api/v2/graph/fine 의 result(characters, relations, event)를 집계한 것과 동일 스키마다.
 */
export const CHAPTER_GRAPH_CACHE_SOURCE = Object.freeze({
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

const getGraphBookCacheKey = (bookId) => {
  if (bookId === null || bookId === undefined) return null;
  const numeric = Number(bookId);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
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

export const hasGraphBookCache = (bookId) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return false;
  const cached = getCacheItem('graphBookCache', key);
  if (cached) return true;
  return getRawFromStorage(key, 'localStorage') !== null;
};

export const isGraphBookCacheBuilding = (bookId) => {
  const numericId = Number(bookId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return false;
  }
  return graphBuildPromises.has(numericId);
};

export const ensureGraphBookCache = async (
  bookId,
  { forceRefresh = false, signal } = {}
) => {
  const numericId = Number(bookId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
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

      const chapterCache = forceRefresh
        ? null
        : getCachedChapterEvents(numericId, chapterIdx);

      if (!chapterCache) {
        chapterCache = await discoverChapterEvents(
          numericId,
          chapterIdx,
          true
        );
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

/** 특정 eventIdx 시점의 누적 그래프 상태(fine API 기반 캐시에서 복원). */
export const getGraphEventState = (bookId, chapterIdx, eventIdx) => {
  const chapterPayload = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterPayload) {
    return null;
  }
  return reconstructChapterGraphState(chapterPayload, eventIdx);
};

const sanitizeBookKey = (bookKey) => {
  if (bookKey === null || bookKey === undefined) return null;
  const normalized = String(bookKey).trim();
  return normalized.length > 0 ? normalized : null;
};

const getReaderProgressCacheKey = (bookKey) => {
  const sanitized = sanitizeBookKey(bookKey);
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

const getElementId = (element) => {
  if (!element) return null;
  return (
    element.id ??
    element.data?.id ??
    null
  );
};

const cloneElements = (elements) => {
  if (!Array.isArray(elements)) return [];
  return elements.map((element) => deepClone(element));
};

const cloneCharacters = (characters) => {
  if (!Array.isArray(characters)) return [];
  return characters.map((character) => deepClone(character));
};


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

/** GET /api/v2/graph/fine 응답(result) 한 건을 챕터 캐시에 넣을 이벤트 행으로 정규화한다. */
const normalizeEventFromFineGraphResponse = (
  bookId,
  chapterIdx,
  eventIdx,
  response,
  manifestStructure
) => {
  const { characters, relations, event } = response?.result || {};
  const hasCharacters = Array.isArray(characters) && characters.length > 0;
  const hasRelations = Array.isArray(relations) && relations.length > 0;
  const hasEventMeta =
    event &&
    (event.eventId !== undefined ||
      event.event_id !== undefined ||
      event.name ||
      event.title ||
      event.startTxtOffset !== undefined ||
      event.endTxtOffset !== undefined ||
      event.startLocator !== undefined ||
      event.endLocator !== undefined);

  if (!hasCharacters && !hasRelations && !hasEventMeta && !manifestStructure) {
    return { skip: true, hadGraphData: false };
  }

  const ord = event ? resolveFineGraphEventOrdinal(event) : null;
  const resolvedEventNum = Number.isFinite(ord) && ord > 0 ? ord : eventIdx;

  return {
    skip: false,
    hadGraphData: hasCharacters || hasRelations || hasEventMeta,
    event: {
      bookId,
      chapterIdx,
      eventIdx,
      eventNum: resolvedEventNum,
      characters: hasCharacters ? characters.map((character) => deepClone(character)) : [],
      relations: hasRelations ? relations.map((relation) => deepClone(relation)) : [],
      event: {
        idx: eventIdx,
        chapterIdx,
        event_id: event?.event_id ?? eventIdx,
        startTxtOffset: event?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null,
        endTxtOffset: event?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null,
        startLocator: event?.startLocator,
        endLocator: event?.endLocator,
        rawText: event?.rawText ?? null,
        eventId: event?.eventId ?? event?.id ?? null,
        ...(event || {}),
        eventNum: resolvedEventNum,
      },
      startTxtOffset: event?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null,
      endTxtOffset: event?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null,
      eventId: event?.eventId ?? event?.event_id ?? event?.id ?? manifestStructure?.eventId ?? null,
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
  const aggregatedCharactersMap = new Map();
  const diffs = [];
  const eventSummaries = [];
  let baseSnapshot = null;
  let prevElements = [];
  let prevCharacters = [];

  sortedEvents.forEach((event, index) => {
    const relations = Array.isArray(event?.relations) ? event.relations : [];
    relations.forEach((relation) => aggregatedRelations.push(deepClone(relation)));

    const rawCharacters = Array.isArray(event?.characters) ? event.characters : [];
    rawCharacters.forEach((character) => {
      const id = extractCharacterId(character);
      if (!id) return;
      aggregatedCharactersMap.set(id, deepClone(character));
    });

    const aggregatedCharacters = Array.from(aggregatedCharactersMap.values());
    aggregatedCharacters.sort((a, b) => {
      const idA = extractCharacterId(a) || '';
      const idB = extractCharacterId(b) || '';
      return idA.localeCompare(idB);
    });

    const {
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      idToProfileImage
    } = createCharacterMaps(aggregatedCharacters);

    const nodeWeights = buildNodeWeights(aggregatedCharacters);

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
        Object.keys(nodeWeights).length ? nodeWeights : null,
        null,
        event?.event ?? null,
        idToProfileImage,
        aggregatedCharacters.length > 0 ? aggregatedCharacters : null
      );
    } catch (error) {
      console.error('convertRelationsToElements 실패:', error);
      convertedElements = [];
    }

    const currentElements = cloneElements(convertedElements);
    const currentCharacters = cloneCharacters(aggregatedCharacters);

    if (index === 0) {
      baseSnapshot = {
        eventIdx: Number(event.eventIdx) || 1,
        elements: currentElements,
        characters: currentCharacters,
        /** GET /api/v2/graph/fine result.event 스냅샷(정규화·idx 보강 포함) */
        eventMeta: event?.event ? deepClone(event.event) : null
      };
    } else {
      const elementDiffRaw = calcGraphDiff(prevElements, convertedElements);
      const elementDiff = {
        added: cloneElements(elementDiffRaw?.added || []),
        updated: cloneElements(elementDiffRaw?.updated || []),
        removedIds: (elementDiffRaw?.removed || [])
          .map((element) => getElementId(element))
          .filter(Boolean)
      };
      const characterDiff = computeCharacterDiff(prevCharacters, aggregatedCharacters);

      diffs.push({
        eventIdx: Number(event.eventIdx) || (baseSnapshot?.eventIdx ?? 1),
        /** fine API result.event */
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
      eventId: event?.eventId ?? event?.event?.eventId ?? null,
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
    const idx = Number(event?.eventIdx) || 0;
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
    source
  };
};

/**
 * 매니페스트 챕터의 이벤트 메타만 정규화한다.
 * 뷰어 그래프 본문은 fine API 전용이며, 이 배열로 그래프를 채우지 않는다.
 */
export const normalizeManifestEvents = (bookId, chapterIdx, manifestChapter) => {
  if (!manifestChapter?.events?.length) {
    return [];
  }

  return manifestChapter.events
    .map((rawEvent) => {
      if (!rawEvent) return null;

      const eventIdx = toNumberOrNull(rawEvent.idx);
      if (eventIdx == null || eventIdx < 1) {
        return null;
      }

      const startTxtOffset = toNumberOrNull(rawEvent.startTxtOffset);
      const endTxtOffset = toNumberOrNull(rawEvent.endTxtOffset);

      const characters = Array.isArray(rawEvent.characters)
        ? rawEvent.characters.map((character) => deepClone(character))
        : [];
      const relations = Array.isArray(rawEvent.relations)
        ? rawEvent.relations.map((relation) => deepClone(relation))
        : [];

      return {
        bookId,
        chapterIdx,
        eventIdx,
        eventNum: eventIdx,
        characters,
        relations,
        event: {
          ...deepClone(rawEvent),
          idx: eventIdx,
          chapterIdx,
          eventNum: eventIdx,
          startTxtOffset,
          endTxtOffset
        },
        startTxtOffset,
        endTxtOffset,
        eventId: rawEvent.eventId != null ? String(rawEvent.eventId) : null
      };
    })
    .filter(Boolean);
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
  const bookIdNum = Number(bookId);
  const chapterIdxNum = Number(chapterIdx);
  if (!Number.isFinite(bookIdNum) || !Number.isFinite(chapterIdxNum) || chapterIdxNum <= 0) {
    return null;
  }
  return `${bookIdNum}-${chapterIdxNum}`;
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

    const normalized = normalizeReaderProgressPayload(sanitizeBookKey(bookKey), payload);
    if (!normalized) return null;

    saveToStorage(cacheKey, normalized, 'localStorage');
    return normalized;
  } catch (error) {
    console.error('독서 위치 캐시 저장 실패:', error);
    return null;
  }
};

export const clearCachedReaderProgress = (bookKey) => {
  try {
    const cacheKey = getReaderProgressCacheKey(bookKey);
    if (!cacheKey) return false;

    removeFromStorage(cacheKey, 'localStorage');
    return true;
  } catch (error) {
    console.error('독서 위치 캐시 삭제 실패:', error);
    return false;
  }
};

export const discoverChapterEvents = async (bookId, chapterIdx, forceRefresh = false) => {
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
      return cached;
    }
  }
  
  let manifestEventStructures = [];
  try {
  const manifestChapter = getManifestChapterData(bookId, chapterIdx);
  if (manifestChapter?.events?.length) {
      manifestEventStructures = manifestChapter.events.map((rawEvent, index) => {
        const eventIdx = Number(rawEvent.idx ?? rawEvent.eventIdx ?? index + 1);
        const fromApi = Number(rawEvent.eventNum);
        const eventNum =
          Number.isFinite(fromApi) && fromApi > 0 ? fromApi : eventIdx;
        return {
          eventIdx,
          eventNum,
          eventId: rawEvent.eventId ?? null,
          startTxtOffset: rawEvent.startTxtOffset ?? null,
          endTxtOffset: rawEvent.endTxtOffset ?? null,
        };
      }).filter((e) => e.eventIdx > 0);
    }
  } catch (error) {
    console.warn('manifest 이벤트 구조 로드 실패:', error);
  }

  const apiEvents = [];

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
      const response = await getFineGraph(bookId, chapterIdx, eventIdx);
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
      await new Promise((resolve) => setTimeout(resolve, 50));
      return norm.hadGraphData;
    } catch (error) {
      console.warn(`⚠️ 이벤트 ${eventIdx} fine 그래프 API 호출 실패:`, error);
      return false;
    }
  };

  if (sortedManifestIndices.length > 0) {
    for (const eventIdx of sortedManifestIndices) {
      const manifestStructure = manifestEventMap.get(eventIdx);
      await collectEvent(eventIdx, manifestStructure);
    }
    if (apiEvents.length > 0) {
      const payload = buildChapterCachePayload(
        bookId,
        chapterIdx,
        apiEvents,
        CHAPTER_GRAPH_CACHE_SOURCE.API
      );
      setCachedChapterEvents(bookId, chapterIdx, payload);
      return payload;
    }
  }

  let eventIdx = 1;
  let emptyStreak = 0;
  const EMPTY_STREAK_LIMIT = 2;
  const MAX_DYNAMIC_SCAN = 500;

  while (eventIdx <= MAX_DYNAMIC_SCAN && emptyStreak < EMPTY_STREAK_LIMIT) {
    const hadData = await collectEvent(eventIdx, null);
    if (hadData) {
      emptyStreak = 0;
    } else {
      emptyStreak += 1;
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
};

/** 누적 그래프 상태 복원. baseSnapshot·diffs 의 eventMeta 는 fine 의 result.event 스냅샷이다. */
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

  let currentElements = cloneElements(baseSnapshot.elements);
  let currentCharacters = cloneCharacters(baseSnapshot.characters || []);
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

export const getEventData = async (bookId, chapterIdx, eventIdx) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  
  if (cached && cached.events) {
    const event = cached.events.find(e => e.eventIdx === eventIdx);
    if (event) {
      return event;
    }
  }
  
  try {
    const response = await getFineGraph(bookId, chapterIdx, eventIdx);
    
    if (response?.isSuccess && response?.result) {
      const { characters, relations, event } = response.result;
      
      return {
        eventIdx,
        chapterIdx,
        characters,
        relations,
        event,
        startTxtOffset: event?.startTxtOffset,
        endTxtOffset: event?.endTxtOffset,
        eventId: event?.eventId ?? event?.event_id,
        event_id: event?.event_id
      };
    }
  } catch (error) {
    console.error('이벤트 데이터 가져오기 실패:', error);
  }
  
  return null;
};

export const getMaxEventIdx = async (bookId, chapterIdx) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  
  if (cached) {
    return cached.maxEventIdx;
  }
  
  const result = await discoverChapterEvents(bookId, chapterIdx);
  return result.maxEventIdx;
};

export const clearChapterEventCache = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return false;
    removeFromStorage(cacheKey, 'localStorage');
    return true;
  } catch (error) {
    console.error('챕터 이벤트 캐시 삭제 실패:', error);
    return false;
  }
};

export const clearAllChapterEventCaches = (bookId) => {
  try {
    const storage = getStorage('localStorage');
    if (!storage) return 0;
    
    const keys = Object.keys(storage);
    const bookIdNum = Number(bookId);
    if (!Number.isFinite(bookIdNum)) {
      return 0;
    }
    
    let count = 0;
    keys.forEach(key => {
      const segments = key.split('-');
      if (segments.length === 2) {
        const [storedBookId, storedChapterIdx] = segments;
        if (Number(storedBookId) === bookIdNum && Number.isFinite(Number(storedChapterIdx))) {
          removeFromStorage(key, 'localStorage');
          count++;
        }
      }
    });
    
    return count;
  } catch (error) {
    console.error('모든 챕터 이벤트 캐시 삭제 실패:', error);
    return 0;
  }
};

export const clearAllChapterEventCachesGlobally = () => {
  try {
    const storage = getStorage('localStorage');
    if (!storage) return 0;
    
    const keys = Object.keys(storage);
    let count = 0;
    keys.forEach(key => {
      const segments = key.split('-');
      if (segments.length === 2) {
        const [storedBookId, storedChapterIdx] = segments;
        if (
          Number.isFinite(Number(storedBookId)) &&
          Number.isFinite(Number(storedChapterIdx))
        ) {
          removeFromStorage(key, 'localStorage');
          count++;
        }
      }
    });
    
    return count;
  } catch (error) {
    console.error('글로벌 챕터 이벤트 캐시 삭제 실패:', error);
    return 0;
  }
};

/** 챕터 캐시에 이미 있는 fine 집계 행만 반환한다(네트워크 호출 없음). */
export const getChapterEventFallbackData = (bookId, chapterIdx, eventIdx) => {
  const chapterCache = getCachedChapterEvents(bookId, chapterIdx);
  if (chapterCache?.events && Array.isArray(chapterCache.events)) {
    const fallbackEvent = eventUtils.findEventInCache(chapterCache.events, eventIdx);
    
    if (fallbackEvent && (fallbackEvent.characters || fallbackEvent.relations)) {
      return {
        characters: Array.isArray(fallbackEvent.characters) ? fallbackEvent.characters : [],
        relations: Array.isArray(fallbackEvent.relations) ? fallbackEvent.relations : [],
        event: fallbackEvent.event || null
      };
    }
  }
  return null;
};
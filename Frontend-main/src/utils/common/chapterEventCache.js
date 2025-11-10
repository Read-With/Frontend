import { getFineGraph, getBookManifest } from './api';
import { getChapterData as getManifestChapterData, getManifestFromCache } from './manifestCache';
import { createCharacterMaps } from '../characterUtils';
import { convertRelationsToElements, calcGraphDiff } from '../graphDataUtils';

const READER_PROGRESS_CACHE_PREFIX = 'reader_progress_';
const READER_PROGRESS_MAX_AGE = 3 * 24 * 60 * 60 * 1000; // 3일

const GRAPH_BOOK_CACHE_PREFIX = 'graph_cache_';
const graphBookMemoryCache = new Map();
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

  if (graphBookMemoryCache.has(key)) {
    return graphBookMemoryCache.get(key);
  }

  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    graphBookMemoryCache.set(key, parsed);
    return parsed;
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
  };

  graphBookMemoryCache.set(key, normalized);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(normalized));
    } catch (error) {
      console.warn('그래프 책 캐시 저장 실패:', error);
    }
  }

  return normalized;
};

export const getGraphBookCache = (bookId) => readGraphBookCache(bookId);

export const hasGraphBookCache = (bookId) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return false;
  if (graphBookMemoryCache.has(key)) return true;
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(key) !== null;
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
      .map((chapter, index) => {
        const idxCandidate =
          chapter?.chapterIdx ??
          chapter?.idx ??
          chapter?.chapter ??
          chapter?.number ??
          index + 1;
        const numericIdx = Number(idxCandidate);
        return Number.isFinite(numericIdx) && numericIdx > 0
          ? numericIdx
          : null;
      })
      .filter((idx, idxIndex, self) => idx && self.indexOf(idx) === idxIndex)
      .sort((a, b) => a - b);

    const chapterSummaries = [];

    for (const chapterIdx of normalizedChapterIndices) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let chapterCache = forceRefresh
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
      maxChapter: chapterSummaries.length
        ? Math.max(...chapterSummaries.map((item) => item.chapterIdx))
        : 0,
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

const extractCharacterId = (character) => {
  if (!character || typeof character !== 'object') return null;
  const candidate =
    character.id ??
    character.characterId ??
    character.character_id ??
    character.char_id ??
    character.pk ??
    character.node_id ??
    null;
  if (candidate === null || candidate === undefined) return null;
  const normalized = String(candidate).trim();
  return normalized.length > 0 ? normalized : null;
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

const buildNodeWeights = (characters) => {
  const weights = {};
  (Array.isArray(characters) ? characters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (!id) return;
    const weight = typeof character?.weight === 'number' ? character.weight : null;
    const count = typeof character?.count === 'number' ? character.count : null;
    if (weight !== null || count !== null) {
      weights[id] = {
        weight: weight ?? 3,
        count: count ?? 0
      };
    }
  });
  return weights;
};

const sortEventsByIdx = (events) => {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => {
    const idxA = Number(a?.eventIdx) || 0;
    const idxB = Number(b?.eventIdx) || 0;
    return idxA - idxB;
  });
};

const buildChapterCachePayload = (bookId, chapterIdx, events, source = 'runtime', folderKey = 'api') => {
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
        idToProfileImage
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
        eventMeta: event?.event ? deepClone(event.event) : null,
        elementDiff,
        characterDiff
      });
    }

    prevElements = currentElements;
    prevCharacters = currentCharacters;

    eventSummaries.push({
      bookId,
      chapterIdx,
      eventIdx: Number(event.eventIdx) || 0,
      eventId: event?.eventId ?? event?.event?.event_id ?? null,
      start: event?.startPos ?? event?.start ?? null,
      end: event?.endPos ?? event?.end ?? null,
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

const normalizeManifestEvents = (bookId, chapterIdx, manifestChapter) => {
  if (!manifestChapter?.events?.length) {
    return [];
  }

  return manifestChapter.events
    .map((rawEvent, index) => {
      if (!rawEvent) return null;

      const rawIdx =
        rawEvent.idx ??
        rawEvent.eventIdx ??
        rawEvent.index ??
        rawEvent.id ??
        index + 1;
      const eventIdx = Number(rawIdx);
      if (!Number.isFinite(eventIdx) || eventIdx <= 0) {
        return null;
      }

      const startPos =
        typeof rawEvent.startPos === 'number'
          ? rawEvent.startPos
          : rawEvent.start ?? null;
      const endPos =
        typeof rawEvent.endPos === 'number'
          ? rawEvent.endPos
          : rawEvent.end ?? null;

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
        characters,
        relations,
        event: {
          ...deepClone(rawEvent),
          idx: eventIdx,
          chapterIdx,
          start: startPos,
          end: endPos
        },
        startPos,
        endPos,
        eventId:
          rawEvent.eventId ??
          rawEvent.event_id ??
          rawEvent.id ??
          null
      };
    })
    .filter(Boolean);
};

const normalizeReaderProgressPayload = (bookKey, payload) => {
  if (!payload) return null;

  const chapterIdxCandidate =
    payload.chapterIdx ??
    payload.chapter ??
    payload.chapterIndex ??
    payload.chapterNumber ??
    payload.chapterId;
  const chapterIdx = Number(chapterIdxCandidate);

  if (!Number.isFinite(chapterIdx) || chapterIdx <= 0) {
    return null;
  }

  const rawEventIdx =
    payload.eventIdx ??
    payload.eventNum ??
    payload.event_id ??
    payload.eventId ??
    payload.idx ??
    payload.id;
  const eventIdx = Number(rawEventIdx);
  const normalizedEventIdx = Number.isFinite(eventIdx) && eventIdx > 0 ? eventIdx : null;

  const eventNumCandidate = Number(payload.eventNum);
  const normalizedEventNum =
    Number.isFinite(eventNumCandidate) && eventNumCandidate > 0
      ? eventNumCandidate
      : normalizedEventIdx;

  const chapterProgressCandidate = Number(payload.chapterProgress);
  const normalizedChapterProgress = Number.isFinite(chapterProgressCandidate)
    ? Math.max(Math.min(chapterProgressCandidate, 100), 0)
    : null;

  const normalized = {
    key: bookKey,
    bookId: payload.bookId ?? null,
    chapterIdx: chapterIdx,
    eventIdx: normalizedEventIdx,
    eventNum: normalizedEventNum,
    eventId: payload.eventId ?? payload.event_id ?? payload.id ?? null,
    cfi: typeof payload.cfi === 'string' ? payload.cfi : null,
    eventName:
      payload.eventName ??
      payload.eventTitle ??
      payload.eventLabel ??
      payload.name ??
      payload.title ??
      (payload.event && (payload.event.name ?? payload.event.title)) ??
      null,
    chapterProgress: normalizedChapterProgress,
    source: payload.source ?? 'runtime',
    timestamp: Date.now()
  };

  return normalized;
};

/**
 * 챕터별 이벤트 캐시 키 생성
 */
const getChapterEventCacheKey = (bookId, chapterIdx) => {
  const bookIdNum = Number(bookId);
  const chapterIdxNum = Number(chapterIdx);
  if (!Number.isFinite(bookIdNum) || !Number.isFinite(chapterIdxNum) || chapterIdxNum <= 0) {
    return null;
  }
  return `${bookIdNum}-${chapterIdxNum}`;
};

/**
 * 캐시된 챕터 이벤트 정보 가져오기
 */
export const getCachedChapterEvents = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return null;
    const cached = localStorage.getItem(cacheKey);
    
    if (!cached) return null;
    
    const cacheData = JSON.parse(cached);
    
    // 캐시 유효성 검사 (24시간)
    const now = Date.now();
    const cacheAge = now - (cacheData.timestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000; // 24시간
    
    if (cacheAge > maxAge) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    return cacheData;
  } catch (error) {
    console.error('챕터 이벤트 캐시 로드 실패:', error);
    return null;
  }
};

/**
 * 챕터 이벤트 정보 캐시에 저장
 */
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
    
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
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

    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    const timestamp = parsed?.timestamp ?? 0;

    if (!Number.isFinite(Number(parsed?.chapterIdx))) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    if (Date.now() - timestamp > READER_PROGRESS_MAX_AGE) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return {
      ...parsed,
      chapterIdx: Number(parsed.chapterIdx),
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

    localStorage.setItem(cacheKey, JSON.stringify(normalized));
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

    localStorage.removeItem(cacheKey);
    return true;
  } catch (error) {
    console.error('독서 위치 캐시 삭제 실패:', error);
    return false;
  }
};

/**
 * 특정 챕터의 모든 이벤트를 순차적으로 탐색
 * 
 * @param {number} bookId - 책 ID
 * @param {number} chapterIdx - 챕터 인덱스
 * @param {boolean} forceRefresh - 캐시 무시하고 강제로 다시 탐색
 * @returns {Promise<{maxEventIdx: number, events: Array}>}
 */
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
      source: 'invalid'
    };
  }

  if (!forceRefresh) {
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (cached) {
      return cached;
    }
  }
  
  // manifest에서 이벤트 구조(startPos/endPos) 가져오기
  let manifestEventStructures = [];
  try {
  const manifestChapter = getManifestChapterData(bookId, chapterIdx);
  if (manifestChapter?.events?.length) {
      manifestEventStructures = manifestChapter.events.map((rawEvent, index) => ({
        eventIdx: Number(rawEvent.idx ?? rawEvent.eventIdx ?? index + 1),
        startPos: rawEvent.startPos ?? rawEvent.start ?? null,
        endPos: rawEvent.endPos ?? rawEvent.end ?? null,
        rawText: rawEvent.rawText ?? null
      })).filter(e => e.eventIdx > 0);
    }
  } catch (error) {
    console.warn('manifest 이벤트 구조 로드 실패:', error);
  }

  // API로 각 이벤트의 그래프 데이터 가져오기
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

      const { characters, relations, event } = response?.result || {};
      const hasCharacters = Array.isArray(characters) && characters.length > 0;
      const hasRelations = Array.isArray(relations) && relations.length > 0;
      const hasEventMeta =
        event &&
        (event.event_id !== undefined ||
          event.eventId !== undefined ||
          event.name ||
          event.title ||
          event.start !== undefined ||
          event.end !== undefined);

      if (!hasCharacters && !hasRelations && !hasEventMeta && !manifestStructure) {
        return false;
      }

      const normalizedEvent = {
        bookId,
        chapterIdx,
        eventIdx,
        characters: hasCharacters ? characters.map((character) => deepClone(character)) : [],
        relations: hasRelations ? relations.map((relation) => deepClone(relation)) : [],
        event: {
          idx: eventIdx,
          chapterIdx,
          start: manifestStructure?.startPos ?? manifestStructure?.start ?? event?.start ?? null,
          end: manifestStructure?.endPos ?? manifestStructure?.end ?? event?.end ?? null,
          startPos: manifestStructure?.startPos ?? manifestStructure?.start ?? event?.start ?? null,
          endPos: manifestStructure?.endPos ?? manifestStructure?.end ?? event?.end ?? null,
          rawText: manifestStructure?.rawText ?? event?.rawText ?? null,
          event_id: event?.event_id ?? event?.eventId ?? null,
          ...(event || {})
        },
        startPos: manifestStructure?.startPos ?? manifestStructure?.start ?? event?.start ?? null,
        endPos: manifestStructure?.endPos ?? manifestStructure?.end ?? event?.end ?? null,
        eventId: event?.event_id ?? event?.eventId ?? null
      };

      apiEvents.push(normalizedEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));
      return hasCharacters || hasRelations || hasEventMeta;
    } catch (error) {
      console.warn(`⚠️ 이벤트 ${eventIdx} API 호출 실패, manifest 구조만 사용:`, error);

      if (manifestStructure) {
        apiEvents.push({
          bookId,
          chapterIdx,
          eventIdx,
          characters: [],
          relations: [],
          event: {
            idx: eventIdx,
            chapterIdx,
            start: manifestStructure.startPos ?? manifestStructure.start ?? null,
            end: manifestStructure.endPos ?? manifestStructure.end ?? null,
            startPos: manifestStructure.startPos ?? manifestStructure.start ?? null,
            endPos: manifestStructure.endPos ?? manifestStructure.end ?? null,
            rawText: manifestStructure.rawText ?? null
          },
          startPos: manifestStructure.startPos ?? manifestStructure.start ?? null,
          endPos: manifestStructure.endPos ?? manifestStructure.end ?? null,
          eventId: null
        });
        return true;
      }

      return false;
    }
  };

  if (sortedManifestIndices.length > 0) {
    for (const eventIdx of sortedManifestIndices) {
      await collectEvent(eventIdx, manifestEventMap.get(eventIdx));
    }
  } else {
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
  }
  
  if (!apiEvents.length) {
    console.warn(`⚠️ 챕터 ${chapterIdx}: API 및 manifest 모두에서 이벤트를 찾을 수 없음`);
    const emptyPayload = {
      bookId,
      chapterIdx,
      maxEventIdx: 0,
      events: [],
      baseSnapshot: null,
      diffs: [],
      eventSummaries: [],
      timestamp: Date.now(),
      source: 'empty'
    };
    setCachedChapterEvents(bookId, chapterIdx, emptyPayload);
    return emptyPayload;
  }

  const payload = buildChapterCachePayload(
    bookId,
    chapterIdx,
    apiEvents,
    'hybrid'
  );

  setCachedChapterEvents(bookId, chapterIdx, payload);
  return payload;
};

/**
 * diff 기반 캐시에서 그래프 상태 복원
 * @param {object} cachePayload - 캐시된 챕터 이벤트 데이터
 * @param {number} targetEventIdx - 복원할 이벤트 인덱스
 * @returns {{elements:Array, characters:Array, eventMeta:Object|null, eventIdx:number}|null}
 */
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

/**
 * 특정 이벤트 데이터 가져오기 (캐시 우선)
 */
export const getEventData = async (bookId, chapterIdx, eventIdx) => {
  // 캐시된 챕터 이벤트 확인
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  
  if (cached && cached.events) {
    const event = cached.events.find(e => e.eventIdx === eventIdx);
    if (event) {
      return event;
    }
  }
  
  // 캐시에 없으면 API 호출
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
        startPos: event?.start,
        endPos: event?.end,
        eventId: event?.event_id
      };
    }
  } catch (error) {
    console.error('이벤트 데이터 가져오기 실패:', error);
  }
  
  return null;
};

/**
 * 챕터의 최대 이벤트 인덱스 가져오기
 */
export const getMaxEventIdx = async (bookId, chapterIdx) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  
  if (cached) {
    return cached.maxEventIdx;
  }
  
  // 캐시에 없으면 탐색
  const result = await discoverChapterEvents(bookId, chapterIdx);
  return result.maxEventIdx;
};

/**
 * 챕터 이벤트 캐시 삭제
 */
export const clearChapterEventCache = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return false;
    localStorage.removeItem(cacheKey);
    return true;
  } catch (error) {
    console.error('챕터 이벤트 캐시 삭제 실패:', error);
    return false;
  }
};

/**
 * 모든 챕터 이벤트 캐시 삭제
 */
export const clearAllChapterEventCaches = (bookId) => {
  try {
    const keys = Object.keys(localStorage);
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
        localStorage.removeItem(key);
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
    const keys = Object.keys(localStorage);
    let count = 0;
    keys.forEach(key => {
      const segments = key.split('-');
      if (segments.length === 2) {
        const [storedBookId, storedChapterIdx] = segments;
        if (
          Number.isFinite(Number(storedBookId)) &&
          Number.isFinite(Number(storedChapterIdx))
        ) {
          localStorage.removeItem(key);
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


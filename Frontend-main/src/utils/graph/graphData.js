/** 챕터·이벤트 스냅샷, eventIdx 유틸, 매크로 그래프 캐시 로더 */
import { toNumberOrNull } from '../common/numberUtils';
import { errorUtils } from '../common/errorUtils';
import {
  aggregateCharactersFromEvents,
} from './characterUtils';
import { extractApiBookId, toApiFolderKey, toPositiveInt } from './graphUtils';
import {
  getMaxChapter,
  getManifestFromCache,
  calculateMaxChapterFromChapters,
} from '../common/cache/manifestCache';
import {
  getCachedChapterEvents,
  getChapterEventFallbackData,
  reconstructChapterGraphState,
} from '../common/cache/chapterEventCache';
import {
  loadFromStorage,
  saveToStorage,
  removeFromStorage,
} from '../common/cache/cacheManager';
import { eventUtils, cacheKeyUtils, MACRO_GRAPH_STORAGE_KEY_RE } from '../viewer/viewerCoreStateUtils';

const getChapterEventsSnapshot = (bookId, chapterIdx) => {
  if (!bookId || !chapterIdx || chapterIdx < 1) {
    return null;
  }

  const cachedEvents = getCachedChapterEvents(bookId, chapterIdx);
  if (
    cachedEvents?.events?.length &&
    cachedEvents.source !== 'manifest-only'
  ) {
    return cachedEvents;
  }

  return null;
};

export const getFolderKeyFromFilename = toApiFolderKey;

/** manifest chapters·progressMetadata.maxChapter 중 큰 값 (없으면 1) */
export const resolveMaxChapter = (bookId, manifest = null) => {
  const manifestData = manifest ?? (bookId ? getManifestFromCache(bookId) : null);
  const chapters = Array.isArray(manifestData?.chapters) ? manifestData.chapters : [];
  const fromChapters = calculateMaxChapterFromChapters(chapters);
  const fromMeta = toPositiveInt(manifestData?.progressMetadata?.maxChapter, 0);
  const m = Math.max(fromChapters, fromMeta);
  return m > 0 ? m : 1;
};

export function getDetectedMaxChapter(folderKey) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId) return 0;

  const manifestMax = getMaxChapter(bookId);
  return manifestMax && manifestMax > 0 ? manifestMax : 0;
}

const convertElementsToRelations = (elements) => {
  return eventUtils.convertElementsToRelations(elements, {
    includeLabel: true,
    includeCount: false,
    positivityDefault: null
  });
};

const isLegacyRawEventRow = (event) =>
  Boolean(
    (event?.event && typeof event.event === 'object') ||
    Array.isArray(event?.relations) ||
    Array.isArray(event?.characters)
  );

const mapLegacyOrSummaryEvent = (event, targetChapter) => {
  const normalizedIdx = getEventOrderIdx(event);
  if (normalizedIdx === null || normalizedIdx <= 0) return null;

  if (isLegacyRawEventRow(event)) {
    const resolvedEventNum = toPositiveInt(event.eventNum, normalizedIdx);
    return {
      ...(event.event && typeof event.event === 'object' ? event.event : {}),
      ...event,
      chapter: targetChapter,
      chapterIdx: targetChapter,
      eventIdx: normalizedIdx,
      eventNum: resolvedEventNum,
      eventId: eventUtils.resolveEventId(event) ?? normalizedIdx,
      resolvedEventIdx: normalizedIdx,
      originalEventIdx: normalizedIdx,
      relations: Array.isArray(event.relations) ? event.relations : [],
      characters: Array.isArray(event.characters) ? event.characters : [],
      start: event?.startPos ?? event?.start ?? event?.startTxtOffset ?? null,
      end: event?.endPos ?? event?.end ?? event?.endTxtOffset ?? null,
    };
  }

  const title = event.title ?? null;
  const resolvedEventNum = toPositiveInt(event.eventNum, normalizedIdx);
  return {
    chapter: targetChapter,
    chapterIdx: targetChapter,
    eventIdx: normalizedIdx,
    eventNum: resolvedEventNum,
    eventId: eventUtils.resolveEventId(event) ?? event.eventId ?? normalizedIdx,
    resolvedEventIdx: normalizedIdx,
    originalEventIdx: normalizedIdx,
    startTxtOffset: event.startTxtOffset ?? null,
    endTxtOffset: event.endTxtOffset ?? null,
    start: event.startTxtOffset ?? null,
    end: event.endTxtOffset ?? null,
    title,
    name: title,
    eventName: title,
    eventTitle: title,
    text: event.text ?? null,
    relations: [],
    characters: [],
  };
};

function buildEventsFromChapterCache(chapterPayload, targetChapter, throughEventIdx = null) {
  if (!chapterPayload || !Array.isArray(chapterPayload.events) || !chapterPayload.events.length) {
    return [];
  }

  const hasDiffCache =
    chapterPayload.baseSnapshot && Array.isArray(chapterPayload.diffs);
  const through = Number(throughEventIdx);
  const eventMetas = (Number.isFinite(through) && through > 0
    ? chapterPayload.events.filter((event) => {
        const idx = Number(event?.eventIdx) || 0;
        return idx > 0 && idx <= through;
      })
    : chapterPayload.events);

  if (!hasDiffCache) {
    return eventMetas
      .map((event) => mapLegacyOrSummaryEvent(event, targetChapter))
      .filter(Boolean);
  }

  return eventMetas.map((eventMeta) => {
    const targetEventIdx = Number(eventMeta?.eventIdx) || 0;
    const resolvedEventNum = toPositiveInt(eventMeta?.eventNum, targetEventIdx);
    const reconstructed = reconstructChapterGraphState(chapterPayload, targetEventIdx);

    const characters = reconstructed?.characters || [];
    const relations = convertElementsToRelations(reconstructed?.elements || []);
    const title = eventMeta.title ?? reconstructed?.eventMeta?.name ?? reconstructed?.eventMeta?.title ?? null;

    return {
      ...eventMeta,
      chapter: targetChapter,
      chapterIdx: targetChapter,
      eventNum: resolvedEventNum,
      eventId:
        eventUtils.resolveEventId(reconstructed?.eventMeta) ??
        eventUtils.resolveEventId(eventMeta) ??
        targetEventIdx,
      event: reconstructed?.eventMeta ?? eventMeta?.event ?? null,
      title,
      name: title,
      eventName: title,
      eventTitle: title,
      relations,
      characters,
      start: eventMeta.startTxtOffset ?? reconstructed?.eventMeta?.startTxtOffset ?? null,
      end: eventMeta.endTxtOffset ?? reconstructed?.eventMeta?.endTxtOffset ?? null,
    };
  });
}

export function getEventsForChapter(chapter, folderKey) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) {
    return [];
  }

  const snapshot = getChapterEventsSnapshot(bookId, chapter);
  if (!snapshot) {
    return [];
  }

  return buildEventsFromChapterCache(snapshot, chapter);
}

export function getEventDataByIndex(folderKey, chapter, eventIndex) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1 || !eventIndex || eventIndex < 1) {
    return null;
  }

  const events = getEventsForChapter(chapter, folderKey);
  if (!events.length) {
    return null;
  }

  const event = events.find(
    (entry) => eventUtils.extractRawEventIdx(entry) === toNumberOrNull(eventIndex)
  );
  if (!event) {
    return null;
  }

  const resolvedEventIdx = eventUtils.extractRawEventIdx(event) || Number(eventIndex);
  return {
    chapter,
    chapterIdx: chapter,
    eventIdx: resolvedEventIdx,
    eventNum: resolvedEventIdx,
    eventId: eventUtils.resolveEventId(event) ?? resolvedEventIdx,
    relations: Array.isArray(event.relations) ? event.relations : [],
    characters: Array.isArray(event.characters) ? event.characters : [],
    event: event.event || null,
  };
}

function getCharactersData(folderKey, chapter) {
  const events = getEventsForChapter(chapter, folderKey);
  if (!events.length) {
    return { characters: [] };
  }

  const characterMap = aggregateCharactersFromEvents(events);

  return { characters: Array.from(characterMap.values()) };
}

export function getCharactersDataFromMaxChapter(folderKey) {
  const maxChapter = getDetectedMaxChapter(folderKey);
  if (!maxChapter || maxChapter < 1) {
    return null;
  }
  return getCharactersData(folderKey, maxChapter);
}

// --- eventIdx 정렬·필터 ---

const truncEventIdx = (value) => {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
};

const normalizeTargetIdx = (targetIdx) => {
  const target = truncEventIdx(targetIdx);
  return target === null || target < 0 ? null : target;
};

export const getEventOrderIdx = (event) =>
  truncEventIdx(event?.eventIdx) ??
  truncEventIdx(event?.idx) ??
  truncEventIdx(event?.eventNum);

const compareNullableIdxAsc = (idxA, idxB) => {
  if (idxA === null && idxB === null) return 0;
  if (idxA === null) return 1;
  if (idxB === null) return -1;
  return idxA - idxB;
};

const compareEventsByIdx = (a, b) =>
  compareNullableIdxAsc(getEventOrderIdx(a), getEventOrderIdx(b));

const filterEventsByIdx = (events, targetIdx, predicate) => {
  if (!Array.isArray(events)) return [];
  const target = normalizeTargetIdx(targetIdx);
  if (target === null) return [];
  return events.filter((entry) => {
    const eventIdx = getEventOrderIdx(entry);
    return eventIdx !== null && predicate(eventIdx, target);
  });
};

export const sortEventsByIdx = (events) => {
  if (!Array.isArray(events)) return [];
  return [...events].sort(compareEventsByIdx);
};

/** 챕터 이벤트 캐시 → events state에 병합 */
export function mergeChapterCacheEventsIntoState(
  prevEvents,
  chapterPayload,
  targetChapter,
  throughEventIdx = null
) {
  if (!chapterPayload || !Array.isArray(chapterPayload.events)) {
    return { merged: false, events: prevEvents };
  }

  const enrichedEvents = buildEventsFromChapterCache(
    chapterPayload,
    targetChapter,
    throughEventIdx
  );
  if (!enrichedEvents.length) {
    return { merged: false, events: prevEvents };
  }

  let merged = false;
  let nextEvents = prevEvents;
  enrichedEvents.forEach((normalizedEvent) => {
    merged = true;
    nextEvents = eventUtils.updateEventsInState(nextEvents, normalizedEvent, targetChapter);
  });

  return { merged, events: nextEvents };
}

/** 챕터 이벤트 캐시 → events state에 병합 (React setState용) */
export function applyChapterEventsFromCache(
  prevEvents,
  bookId,
  targetChapter,
  throughEventIdx = null
) {
  const chapterPayload = getCachedChapterEvents(bookId, targetChapter);
  if (!chapterPayload || !Array.isArray(chapterPayload.events)) {
    return { applied: false, hasPayload: false, isEmpty: false, events: prevEvents };
  }
  if (!chapterPayload.events.length) {
    return { applied: false, hasPayload: true, isEmpty: true, events: prevEvents };
  }
  const { merged, events } = mergeChapterCacheEventsIntoState(
    prevEvents,
    chapterPayload,
    targetChapter,
    throughEventIdx
  );
  return { applied: merged, hasPayload: true, isEmpty: false, events };
}

export const filterEventsUpTo = (events, targetIdx) =>
  filterEventsByIdx(events, targetIdx, (eventIdx, target) => eventIdx <= target);

export const filterEventsBefore = (events, targetIdx) =>
  filterEventsByIdx(events, targetIdx, (eventIdx, target) => eventIdx < target);

export const getMaxEventIdx = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 0;
  return events.reduce((max, event) => {
    const idx = getEventOrderIdx(event);
    if (idx === null) return max;
    return Math.max(max, idx);
  }, 0);
};

export const clampEventIdxToMax = (requestedIdx, maxIdx) => {
  const maxRaw = toNumberOrNull(maxIdx);
  const hasUpper = maxRaw !== null && Number.isFinite(maxRaw);
  const maxInt = hasUpper ? (toPositiveInt(maxRaw, 0) ?? 0) : null;
  const reqInt = truncEventIdx(requestedIdx);

  if (hasUpper && maxInt === 0) return 0;
  if (!hasUpper) {
    if (reqInt !== null && reqInt >= 1) return reqInt;
    return 1;
  }
  if (reqInt === null || reqInt < 1) return maxInt;
  return Math.min(reqInt, maxInt);
};

// --- 매크로 그래프 세션·localStorage 캐시 ---

const GRAPH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const macroSessionCache = new Map();
const inflightRequests = new Map();

const isValidChapterRef = (bookId, chapter) =>
  toPositiveInt(bookId) !== null && toPositiveInt(chapter) !== null;

export const hasMacroSessionCache = (bookId, chapter) =>
  macroSessionCache.has(cacheKeyUtils.macroSession(bookId, chapter));

const getMacroFromSessionCache = (bookId, chapter) =>
  macroSessionCache.get(cacheKeyUtils.macroSession(bookId, chapter));

const saveMacroToSessionCache = (bookId, chapter, data) =>
  macroSessionCache.set(cacheKeyUtils.macroSession(bookId, chapter), data);

const checkLocalStorageCache = (cacheKey) => {
  const data = loadFromStorage(cacheKey, 'localStorage');
  if (!data) return null;
  if (data._savedAt && Date.now() - data._savedAt > GRAPH_CACHE_TTL_MS) {
    removeFromStorage(cacheKey, 'localStorage');
    return null;
  }
  return data;
};

const saveToLocalStorageCache = (cacheKey, data) => {
  saveToStorage(cacheKey, { ...data, _savedAt: Date.now() }, 'localStorage');
};

export const checkChapterEventsCache = (bookId, chapter, eventIdx) => {
  const chapterCache = getCachedChapterEvents(bookId, chapter);
  if (!chapterCache) return null;

  const reconstructed = reconstructChapterGraphState(chapterCache, eventIdx);
  if (reconstructed) {
    const characters = reconstructed.characters || [];
    const relations = convertElementsToRelations(reconstructed.elements || []);
    if (characters.length || relations.length) {
      return {
        characters,
        relations,
        event: reconstructed.eventMeta || null,
      };
    }
  }

  const rawEvents = Array.isArray(chapterCache.rawEvents) ? chapterCache.rawEvents : [];
  const targetEvent = eventUtils.findEventInCache(rawEvents, eventIdx);
  if (!targetEvent || (!targetEvent.characters?.length && !targetEvent.relations?.length)) {
    return null;
  }

  return {
    characters: Array.isArray(targetEvent.characters) ? targetEvent.characters : [],
    relations: Array.isArray(targetEvent.relations) ? targetEvent.relations : [],
    event: targetEvent.event || null,
  };
};

export const getFallbackData = (bookId, chapter, eventIdx, macroData) => {
  const fallbackEventData = getChapterEventFallbackData(bookId, chapter, eventIdx);
  if (fallbackEventData) return fallbackEventData;
  return macroData ?? null;
};

const hasGraphPayload = (data) => {
  if (!data || typeof data !== 'object') return false;
  const chars = Array.isArray(data.characters) ? data.characters.length : 0;
  const rels = Array.isArray(data.relations) ? data.relations.length : 0;
  return chars > 0 || rels > 0;
};

export const hasMacroGraphStorageCache = (bookId, chapter) => {
  const normalizedBookId = toPositiveInt(bookId);
  const normalizedChapter = toPositiveInt(chapter);
  if (!isValidChapterRef(normalizedBookId, normalizedChapter)) return false;
  if (macroSessionCache.has(cacheKeyUtils.macroSession(normalizedBookId, normalizedChapter))) return true;
  const cacheKey = cacheKeyUtils.macroGraphStorage(normalizedBookId, normalizedChapter);
  return hasGraphPayload(checkLocalStorageCache(cacheKey));
};

const handleLoaderSuccess = (data, onSuccess, cacheKey) => {
  if (cacheKey && hasGraphPayload(data)) {
    saveToLocalStorageCache(cacheKey, data);
    const m = MACRO_GRAPH_STORAGE_KEY_RE.exec(cacheKey);
    if (m) saveMacroToSessionCache(m[1], m[2], data);
  }
  onSuccess?.(data);
};

const handleLoaderFallback = (bookId, chapter, eventIdx, macroData, onSuccess, logMessage) => {
  const fallbackData = getFallbackData(bookId, chapter, eventIdx, macroData);
  if (!fallbackData) return null;
  errorUtils.logInfo('GraphDataLoader', logMessage, { bookId, chapter, eventIdx, source: 'fallback' });
  onSuccess?.(fallbackData);
  return { data: fallbackData, source: 'fallback' };
};

const processApiResponse = (response, cacheKey, onSuccess, bookId, chapter, eventIdx, macroData, onError) => {
  if (response?.isSuccess && response?.result) {
    handleLoaderSuccess(response.result, onSuccess, cacheKey);
    return { data: response.result, source: 'api' };
  }

  const apiError = new Error(response?.message || 'API 응답이 실패했습니다');
  apiError.status = response?.code || null;
  errorUtils.logWarning('GraphDataLoader', 'API 응답 실패', { bookId, chapter, eventIdx, response });

  const fallbackResult = handleLoaderFallback(bookId, chapter, eventIdx, macroData, onSuccess, '폴백 데이터 사용');
  if (fallbackResult) return fallbackResult;

  onError?.(apiError);
  return { data: null, source: 'none' };
};

export const prefetchMacroGraphToCache = async (bookId, chapter, apiCall) => {
  const normalizedBookId = toPositiveInt(bookId);
  const normalizedChapter = toPositiveInt(chapter);
  if (!isValidChapterRef(normalizedBookId, normalizedChapter)) return;
  if (macroSessionCache.has(cacheKeyUtils.macroSession(normalizedBookId, normalizedChapter))) return;
  const cacheKey = cacheKeyUtils.macroGraphStorage(normalizedBookId, normalizedChapter);
  if (hasGraphPayload(checkLocalStorageCache(cacheKey))) return;
  try {
    const response = await apiCall();
    if (response?.isSuccess && response?.result && hasGraphPayload(response.result)) {
      saveToLocalStorageCache(cacheKey, response.result);
      saveMacroToSessionCache(normalizedBookId, normalizedChapter, response.result);
    }
  } catch {
    /* 프리페치 실패 무시 */
  }
};

export const loadGraphDataWithCache = async ({
  bookId,
  chapter,
  eventIdx,
  cacheKey,
  apiCall,
  macroData = null,
  onSuccess,
  onError,
}) => {
  const macroMatch = cacheKey && MACRO_GRAPH_STORAGE_KEY_RE.exec(cacheKey);
  if (macroMatch) {
    const sessionData = getMacroFromSessionCache(macroMatch[1], macroMatch[2]);
    if (hasGraphPayload(sessionData)) {
      onSuccess?.(sessionData);
      return { data: sessionData, source: 'session' };
    }
  }

  const localStorageData = checkLocalStorageCache(cacheKey);
  if (hasGraphPayload(localStorageData)) {
    if (macroMatch) saveMacroToSessionCache(macroMatch[1], macroMatch[2], localStorageData);
    onSuccess?.(localStorageData);
    return { data: localStorageData, source: 'localStorage' };
  }

  if (eventIdx !== undefined && eventIdx !== null) {
    const chapterEventsData = checkChapterEventsCache(bookId, chapter, eventIdx);
    if (chapterEventsData) {
      handleLoaderSuccess(chapterEventsData, onSuccess, cacheKey);
      return { data: chapterEventsData, source: 'chapterEvents' };
    }
  }

  try {
    let requestPromise = cacheKey ? inflightRequests.get(cacheKey) : null;
    if (!requestPromise) {
      requestPromise = apiCall();
      if (cacheKey) {
        inflightRequests.set(cacheKey, requestPromise);
        requestPromise.finally(() => inflightRequests.delete(cacheKey));
      }
    }
    const response = await requestPromise;
    return processApiResponse(response, cacheKey, onSuccess, bookId, chapter, eventIdx, macroData, onError);
  } catch (error) {
    if (cacheKey) inflightRequests.delete(cacheKey);
    errorUtils.logError('GraphDataLoader', error, { bookId, chapter, eventIdx, cacheKey });

    const fallbackResult = handleLoaderFallback(
      bookId,
      chapter,
      eventIdx,
      macroData,
      onSuccess,
      '에러 후 폴백 데이터 사용'
    );
    if (fallbackResult) return fallbackResult;

    onError?.(error);
    return { data: null, source: 'error' };
  }
};

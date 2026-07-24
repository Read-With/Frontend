/** 챕터·이벤트 스냅샷, 매크로 그래프 캐시 로더, relation timeline fetch */
import { toNumberOrNull, toPositiveInt, toTrimmedStringOrNull } from '../common/valueUtils';
import { errorUtils } from '../common/urlUtils';
import { extractApiBookId, isSamePair, isGraphEdgeElement } from './graphCore';
import {
  loadFromStorage,
  saveToStorage,
  removeFromStorage,
  registerCache,
  getCacheItem,
  setCacheItem,
  enforceCacheSizeLimit,
} from '../common/cache/cacheManager';
import { eventUtils, cacheKeyUtils, MACRO_GRAPH_STORAGE_KEY_RE } from '../viewer/viewerCore';
import {
  accumulateDeltasToGraphResult,
  resolveChapterEventIdOrder,
  FETCH_STATUS,
  GRAPH_LOAD_SOURCE,
  statusFromGraphSource,
} from '../api/graphApi';
import {
  findManifestEventInChapter,
  resolveLastEventIdxForChapter,
} from '../common/cache/manifestCache';
import { clampPositivity } from '../styles/graphStyles';
import { pickGraphApiResult } from '../viewer/viewerGraph';

import {
  getCachedChapterEvents,
  getChapterEventFallbackData,
  reconstructChapterGraphState,
  ensureBookRelationshipDeltas,
} from './graphModel';

export {
  getCachedChapterEvents,
  ensureBookRelationshipDeltas,
  prefetchChapterEvents,
  ensureChapterEventsDiscovered,
  ensureGraphBookCache,
  clearBookRelationshipDeltas,
} from './graphModel';

export { FETCH_STATUS, GRAPH_LOAD_SOURCE } from '../api/graphApi';

const asArray = (value) => (Array.isArray(value) ? value : []);

const ELEMENTS_TO_RELATIONS_OPTS = {
  includeLabel: true,
  includeCount: false,
  positivityDefault: null,
};

const graphPayloadFromReconstructed = (reconstructed) => ({
  characters: asArray(reconstructed?.characters),
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
  return { title: t, name: t, eventName: t, eventTitle: t };
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
    resolvedEventIdx: eventIdx,
    originalEventIdx: eventIdx,
  };
}

const mapLegacyOrSummaryEvent = (event, targetChapter) => {
  const eventIdx = eventUtils.resolveEventOrdinal(event);
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

  return eventMetas.map((eventMeta) => {
    const eventIdx = Number(eventMeta?.eventIdx) || 0;
    const eventNum = toPositiveInt(eventMeta?.eventNum, eventIdx);
    const reconstructed = reconstructChapterGraphState(chapterPayload, eventIdx);
    const { characters, relations } = graphPayloadFromReconstructed(reconstructed);
    const title = eventMeta.title ?? reconstructed?.eventMeta?.name ?? reconstructed?.eventMeta?.title ?? null;

    return {
      ...eventMeta,
      ...baseChapterEventFields(targetChapter, eventIdx, eventNum, (
        eventUtils.resolveEventId(reconstructed?.eventMeta) ??
        eventUtils.resolveEventId(eventMeta) ??
        eventIdx
      )),
      event: reconstructed?.eventMeta ?? eventMeta?.event ?? null,
      ...withEventTitleAliases(title),
      relations,
      characters,
      ...withEventOffsetFields(
        eventMeta.startTxtOffset ?? reconstructed?.eventMeta?.startTxtOffset,
        eventMeta.endTxtOffset ?? reconstructed?.eventMeta?.endTxtOffset
      ),
    };
  });
}

function getEventsForChapter(chapter, folderKey) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) return [];

  const snapshot = getCachedChapterEvents(bookId, chapter);
  if (!snapshot?.events?.length || snapshot.source === 'manifest-only') return [];

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

  const events = enrichedEvents.reduce(
    (acc, normalizedEvent) => eventUtils.updateEventsInState(acc, normalizedEvent, targetChapter),
    prevEvents
  );
  return { applied: true, hasPayload: true, isEmpty: false, events };
}

// --- 매크로 그래프 세션·localStorage 캐시 ---

const GRAPH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const macroSessionCache = new Map();
const inflightRequests = new Map();

function getOrCreateInflightRequest(cacheKey, apiCall) {
  if (!cacheKey) return apiCall();
  let requestPromise = inflightRequests.get(cacheKey);
  if (!requestPromise) {
    requestPromise = Promise.resolve().then(() => apiCall());
    inflightRequests.set(cacheKey, requestPromise);
    requestPromise.finally(() => {
      if (inflightRequests.get(cacheKey) === requestPromise) {
        inflightRequests.delete(cacheKey);
      }
    });
  }
  return requestPromise;
}

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

const checkChapterEventsCache = (bookId, chapter, eventIdx) => {
  const chapterCache = getCachedChapterEvents(bookId, chapter);
  if (!chapterCache) return null;

  const reconstructed = reconstructChapterGraphState(chapterCache, eventIdx);
  if (reconstructed) {
    const payload = graphPayloadFromReconstructed(reconstructed);
    if (hasGraphPayload(payload)) {
      return { ...payload, event: reconstructed.eventMeta || null };
    }
  }

  const targetEvent = eventUtils.findEventInCache(asArray(chapterCache.rawEvents), eventIdx);
  if (!hasGraphPayload(targetEvent)) return null;

  return {
    characters: asArray(targetEvent.characters),
    relations: asArray(targetEvent.relations),
    event: targetEvent.event || null,
  };
};

/** characters 또는 relations가 하나라도 있으면 true (fine/macro 공용) */
export const hasGraphPayload = (data) => {
  if (!data || typeof data !== 'object') return false;
  return asArray(data.characters).length > 0 || asArray(data.relations).length > 0;
};

export const hasMacroGraphStorageCache = (bookId, chapter) => {
  const normalizedBookId = toPositiveInt(bookId);
  const normalizedChapter = toPositiveInt(chapter);
  if (!isValidChapterRef(normalizedBookId, normalizedChapter)) return false;
  if (macroSessionCache.has(cacheKeyUtils.macroSession(normalizedBookId, normalizedChapter))) return true;
  const cacheKey = cacheKeyUtils.macroGraphStorage(normalizedBookId, normalizedChapter);
  return hasGraphPayload(checkLocalStorageCache(cacheKey));
};

const handleLoaderSuccess = (data, onSuccess, cacheKey, source = GRAPH_LOAD_SOURCE.API) => {
  if (cacheKey && hasGraphPayload(data)) {
    saveToLocalStorageCache(cacheKey, data);
    const m = MACRO_GRAPH_STORAGE_KEY_RE.exec(cacheKey);
    if (m) saveMacroToSessionCache(m[1], m[2], data);
  }
  const meta = { source, status: statusFromGraphSource(source) };
  onSuccess?.(data, meta);
  return { data, source, status: meta.status };
};

const handleLoaderFallback = (bookId, chapter, eventIdx, onSuccess, logMessage) => {
  const fallbackData = getChapterEventFallbackData(bookId, chapter, eventIdx) ?? null;
  if (!fallbackData) return null;
  errorUtils.logInfo('GraphDataLoader', logMessage, {
    bookId,
    chapter,
    eventIdx,
    source: GRAPH_LOAD_SOURCE.FALLBACK,
  });
  const meta = {
    source: GRAPH_LOAD_SOURCE.FALLBACK,
    status: FETCH_STATUS.FALLBACK,
  };
  onSuccess?.(fallbackData, meta);
  return { data: fallbackData, source: GRAPH_LOAD_SOURCE.FALLBACK, status: FETCH_STATUS.FALLBACK };
};

const tryLoaderFallback = (bookId, chapter, eventIdx, onSuccess, onError, logMessage, error) => {
  const fallbackResult = handleLoaderFallback(bookId, chapter, eventIdx, onSuccess, logMessage);
  if (fallbackResult) return fallbackResult;
  onError?.(error);
  return {
    data: null,
    source: error ? GRAPH_LOAD_SOURCE.ERROR : GRAPH_LOAD_SOURCE.NONE,
    status: FETCH_STATUS.ERROR,
  };
};

const processApiResponse = (response, cacheKey, onSuccess, bookId, chapter, eventIdx, onError) => {
  if (response?.isSuccess && response?.result) {
    return handleLoaderSuccess(response.result, onSuccess, cacheKey, GRAPH_LOAD_SOURCE.API);
  }

  const apiError = new Error(response?.message || 'API 응답이 실패했습니다');
  apiError.status = response?.code || null;
  errorUtils.logWarning('GraphDataLoader', 'API 응답 실패', { bookId, chapter, eventIdx, response });

  const fallbackResult = handleLoaderFallback(bookId, chapter, eventIdx, onSuccess, '폴백 데이터 사용');
  if (fallbackResult) return fallbackResult;
  onError?.(apiError);
  return { data: null, source: GRAPH_LOAD_SOURCE.NONE, status: FETCH_STATUS.ERROR };
};

export const prefetchMacroGraphToCache = async (bookId, chapter, apiCall) => {
  const normalizedBookId = toPositiveInt(bookId);
  const normalizedChapter = toPositiveInt(chapter);
  if (!isValidChapterRef(normalizedBookId, normalizedChapter)) return;
  if (macroSessionCache.has(cacheKeyUtils.macroSession(normalizedBookId, normalizedChapter))) return;
  const cacheKey = cacheKeyUtils.macroGraphStorage(normalizedBookId, normalizedChapter);
  if (hasGraphPayload(checkLocalStorageCache(cacheKey))) return;
  try {
    const response = await getOrCreateInflightRequest(cacheKey, apiCall);
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
  onSuccess,
  onError,
}) => {
  const macroMatch = cacheKey && MACRO_GRAPH_STORAGE_KEY_RE.exec(cacheKey);
  if (macroMatch) {
    const sessionData = getMacroFromSessionCache(macroMatch[1], macroMatch[2]);
    if (hasGraphPayload(sessionData)) {
      const meta = {
        source: GRAPH_LOAD_SOURCE.SESSION,
        status: FETCH_STATUS.OK,
      };
      onSuccess?.(sessionData, meta);
      return { data: sessionData, ...meta };
    }
  }

  const localStorageData = checkLocalStorageCache(cacheKey);
  if (hasGraphPayload(localStorageData)) {
    if (macroMatch) saveMacroToSessionCache(macroMatch[1], macroMatch[2], localStorageData);
    const meta = {
      source: GRAPH_LOAD_SOURCE.LOCAL_STORAGE,
      status: FETCH_STATUS.OK,
    };
    onSuccess?.(localStorageData, meta);
    return { data: localStorageData, ...meta };
  }

  if (eventIdx !== undefined && eventIdx !== null) {
    const chapterEventsData = checkChapterEventsCache(bookId, chapter, eventIdx);
    if (chapterEventsData) {
      return handleLoaderSuccess(
        chapterEventsData,
        onSuccess,
        cacheKey,
        GRAPH_LOAD_SOURCE.CHAPTER_EVENTS
      );
    }
  }

  try {
    const response = await getOrCreateInflightRequest(cacheKey, apiCall);
    return processApiResponse(response, cacheKey, onSuccess, bookId, chapter, eventIdx, onError);
  } catch (error) {
    if (cacheKey) inflightRequests.delete(cacheKey);
    errorUtils.logError('GraphDataLoader', error, { bookId, chapter, eventIdx, cacheKey });
    return tryLoaderFallback(
      bookId,
      chapter,
      eventIdx,
      onSuccess,
      onError,
      '에러 후 폴백 데이터 사용',
      error
    );
  }
};

/** 엣지 툴팁 relation timeline용 헬퍼·캐시·fetch */

const CACHE_DURATION = 5 * 60 * 1000;
const CACHE_PREFIX = 'relation-timeline-';
const MAX_CACHE_SIZE = 50;

const relationTimelineCache = new Map();
registerCache('relationTimelineCache', relationTimelineCache, {
  maxSize: MAX_CACHE_SIZE,
  ttl: CACHE_DURATION,
  cleanupInterval: 300000,
  storageType: 'sessionStorage',
});

export function buildGraphResponseFromDeltas(
  bookId,
  chapter,
  eventIdx,
  deltasBundle,
  chapterEventIdOrder,
  previousResult = null
) {
  const structure = findManifestEventInChapter(bookId, chapter, { eventIdx });
  const eventId = toTrimmedStringOrNull(
    eventUtils.resolveEventId(structure) ?? structure?.eventId
  );
  const isSuccess = deltasBundle.isSuccess !== false;
  const makeResponse = (result) => ({ isSuccess, code: 'SUCCESS', result });

  if (!eventId) {
    const prev = previousResult?.result;
    return makeResponse({
      bookId: deltasBundle.bookId ?? bookId,
      chapterIndex: chapter,
      eventId: null,
      characters: asArray(prev?.characters),
      relations: asArray(prev?.relations),
      event: { chapterIndex: chapter, chapterIdx: chapter, eventId: null },
    });
  }

  return makeResponse(
    accumulateDeltasToGraphResult(deltasBundle.bookId ?? bookId, deltasBundle.deltas, {
      chapterIndex: chapter,
      throughEventId: eventId,
      chapterEventIdOrder,
    })
  );
}

export function getRelationTimelineCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

export function getCachedRelationTimeline(cacheKey) {
  return getCacheItem('relationTimelineCache', cacheKey)?.result ?? null;
}

export function setCachedRelationTimeline(cacheKey, result) {
  setCacheItem('relationTimelineCache', cacheKey, {
    result,
    timestamp: Date.now(),
  });
  enforceCacheSizeLimit('relationTimelineCache');
}

export function findRelationInResult(relations, id1, id2) {
  const list = asArray(relations);
  if (!list.length) return null;
  return list.find((rel) => isSamePair(rel, id1, id2)) ?? null;
}

export function findRelationInElements(elements, id1, id2) {
  if (!Array.isArray(elements)) return null;
  return (
    elements.find((element) => {
      if (!isGraphEdgeElement(element)) return false;
      return isSamePair(eventUtils.resolveRelationNodeIds(element.data), id1, id2);
    }) ?? null
  );
}

export function relationPointFromElement(edgeElement) {
  const raw = edgeElement?.data?.positivity;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? clampPositivity(numeric) : 0;
}

export function withNoRelation(result, fallbackNoRelation = true) {
  const safeResult = result ?? { points: [], labelInfo: [] };
  const points = Array.isArray(safeResult.points) ? safeResult.points : [];
  const status = safeResult.status ?? (points.length === 0 ? FETCH_STATUS.EMPTY : FETCH_STATUS.OK);
  // 네트워크/로드 에러는 noRelation으로 취급하지 않음
  const noRelation =
    status === FETCH_STATUS.ERROR
      ? false
      : (safeResult.noRelation ?? (points.length === 0 ? fallbackNoRelation : false));
  return {
    ...safeResult,
    points,
    labelInfo: Array.isArray(safeResult.labelInfo) ? safeResult.labelInfo : [],
    noRelation,
    status,
    incomplete: Boolean(safeResult.incomplete),
    failedIds: Array.isArray(safeResult.failedIds) ? safeResult.failedIds : null,
    error: safeResult.error ?? null,
  };
}

export function padSingleEvent(points, labels) {
  if (!Array.isArray(points) || !Array.isArray(labels) || points.length !== 1) {
    return { points, labels };
  }

  return {
    points: Array.from({ length: 11 }, (_, index) => (index === 5 ? points[0] : null)),
    labels: Array.from({ length: 11 }, (_, index) => (index === 5 ? labels[0] : '')),
  };
}


/** relation timeline fetch (캐시·deltas·API probe) */

const PROBE_EVENT_HARD_MAX = 512;
const timelineInflight = new Map();

function emptyTimeline({ noRelation = false, status = null, error = null, incomplete = false, failedIds = null } = {}) {
  const resolvedStatus =
    status ??
    (error ? FETCH_STATUS.ERROR : noRelation ? FETCH_STATUS.EMPTY : FETCH_STATUS.OK);
  return {
    points: [],
    labelInfo: [],
    noRelation: resolvedStatus === FETCH_STATUS.ERROR ? false : noRelation,
    status: resolvedStatus,
    error: error ?? null,
    incomplete: Boolean(incomplete),
    failedIds: Array.isArray(failedIds) ? failedIds : null,
  };
}

function timelineError(message, cause = null) {
  const err = cause instanceof Error ? cause : new Error(message);
  if (!(cause instanceof Error) && cause) err.cause = cause;
  return emptyTimeline({ status: FETCH_STATUS.ERROR, error: err, noRelation: false });
}

function withTimelineInflight(cacheKey, run) {
  const existing = timelineInflight.get(cacheKey);
  if (existing) return existing;

  const pending = Promise.resolve()
    .then(run)
    .finally(() => {
      if (timelineInflight.get(cacheKey) === pending) {
        timelineInflight.delete(cacheKey);
      }
    });
  timelineInflight.set(cacheKey, pending);
  return pending;
}

function pickSuccessfulResult(data) {
  if (!data?.isSuccess) return null;
  const result = pickGraphApiResult(data);
  return hasGraphPayload(result) ? result : null;
}

function relationEventFromApiResult(fineData, id1, id2, idx) {
  const fineResult = pickSuccessfulResult(fineData);
  const relation = findRelationInResult(asArray(fineResult?.relations), id1, id2);
  if (!relation) return null;
  return { idx, positivity: relation.positivity || 0 };
}

function findEdgeInReconstructedChapter(chapterPayload, eventIdx, id1, id2) {
  return findRelationInElements(
    reconstructChapterGraphState(chapterPayload, eventIdx)?.elements,
    id1,
    id2
  );
}

function collectIndexedRelationEvents(lastEventIdx, lastOnly, getEdgeAt) {
  const relationEvents = [];
  const indices = lastOnly
    ? Array.from({ length: lastEventIdx }, (_, i) => lastEventIdx - i)
    : Array.from({ length: lastEventIdx }, (_, i) => i + 1);

  for (const idx of indices) {
    const edge = getEdgeAt(idx);
    if (!edge) continue;
    relationEvents.push({ idx, positivity: relationPointFromElement(edge) });
    if (lastOnly) break;
  }
  return relationEvents;
}

function collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly) {
  return collectIndexedRelationEvents(
    lastEventIdx,
    lastOnly,
    (idx) => findEdgeInReconstructedChapter(chapterPayload, idx, id1, id2)
  );
}

function buildEventTimeline(eventCount, getPointAt, { fillGaps = true } = {}) {
  const points = [];
  const labelInfo = [];
  let started = false;

  for (let idx = 1; idx <= eventCount; idx += 1) {
    const point = getPointAt(idx, started);
    if (point === null) {
      if (!started) continue;
      if (fillGaps) {
        points.push(0);
        labelInfo.push(`E${idx}`);
      }
      continue;
    }
    if (point === undefined) continue;

    started = true;
    points.push(point);
    labelInfo.push(`E${idx}`);
  }

  return started
    ? { points, labelInfo, noRelation: false, status: FETCH_STATUS.OK }
    : emptyTimeline({ noRelation: true, status: FETCH_STATUS.EMPTY });
}

function buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum) {
  const chapterPayload = getCachedChapterEvents(bookId, chapterNum);
  if (!chapterPayload?.baseSnapshot) return null;

  return buildEventTimeline(eventNum, (idx, started) => {
    const edge = findEdgeInReconstructedChapter(chapterPayload, idx, id1, id2);
    if (!edge) return started ? null : undefined;
    return relationPointFromElement(edge);
  }, { fillGaps: true });
}

async function collectRelationEventsViaApi(fetchEventData, chapter, lastEventIdx, id1, id2, lastOnly) {
  if (!(lastEventIdx > 0)) {
    return { events: [], incomplete: false, failedIds: [] };
  }

  const relationEvents = [];
  const failedIds = [];
  const indices = lastOnly
    ? Array.from({ length: lastEventIdx }, (_, i) => lastEventIdx - i)
    : Array.from({ length: lastEventIdx }, (_, i) => i + 1);

  for (const idx of indices) {
    try {
      const event = relationEventFromApiResult(await fetchEventData(chapter, idx), id1, id2, idx);
      if (!event) continue;
      relationEvents.push(event);
      if (lastOnly) break;
    } catch {
      failedIds.push(`${chapter}:${idx}`);
    }
  }
  return {
    events: relationEvents,
    incomplete: failedIds.length > 0,
    failedIds,
  };
}

async function probeLastEventIdxByApi(fetchEventData, chapter) {
  let low = 1;
  let high = 1;
  let lastGood = 0;

  while (high <= PROBE_EVENT_HARD_MAX) {
    try {
      if (!pickSuccessfulResult(await fetchEventData(chapter, high))) break;
      lastGood = high;
      low = high + 1;
      high *= 2;
    } catch {
      break;
    }
  }

  if (lastGood === 0) return 0;

  let left = low;
  let right = Math.min(high - 1, PROBE_EVENT_HARD_MAX);
  let chapterLastEventIdx = lastGood;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    try {
      if (pickSuccessfulResult(await fetchEventData(chapter, mid))) {
        chapterLastEventIdx = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    } catch {
      right = mid - 1;
    }
  }

  return chapterLastEventIdx;
}

async function resolveChapterLastEventIdx(bookId, chapter, fetchEventData) {
  const fromManifest = resolveLastEventIdxForChapter(bookId, chapter);
  if (Number.isFinite(fromManifest) && fromManifest >= 1) return fromManifest;

  const cachedMax = Number(getCachedChapterEvents(bookId, chapter)?.maxEventIdx);
  if (Number.isFinite(cachedMax) && cachedMax >= 1) return cachedMax;

  return probeLastEventIdxByApi(fetchEventData, chapter);
}

async function fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return emptyTimeline({ noRelation: true, status: FETCH_STATUS.EMPTY });
  }
  try {
    const eventCache = new Map();
    const chapterRelationCache = new Map();
    const chapterDeltasCache = new Map();
    const chapterEventOrderCache = new Map();

    const loadChapterDeltas = async (chapter) => {
      if (chapterDeltasCache.has(chapter)) return chapterDeltasCache.get(chapter);
      const pending = ensureBookRelationshipDeltas(bookId, { chapterIndex: chapter });
      chapterDeltasCache.set(chapter, pending);
      return pending;
    };

    const getChapterEventOrder = (chapter) => {
      if (!chapterEventOrderCache.has(chapter)) {
        chapterEventOrderCache.set(chapter, resolveChapterEventIdOrder(bookId, chapter));
      }
      return chapterEventOrderCache.get(chapter);
    };

    const fetchEventData = async (chapter, eventIdx) => {
      const cacheKey = cacheKeyUtils.createCacheKey(chapter, eventIdx);
      if (eventCache.has(cacheKey)) return eventCache.get(cacheKey);

      const data = buildGraphResponseFromDeltas(
        bookId,
        chapter,
        eventIdx,
        await loadChapterDeltas(chapter),
        getChapterEventOrder(chapter),
        eventIdx > 1 ? eventCache.get(cacheKeyUtils.createCacheKey(chapter, eventIdx - 1)) ?? null : null
      );
      eventCache.set(cacheKey, data);
      return data;
    };

    const getRelationEventsForChapter = async (chapter, lastOnly) => {
      const cacheKey = `${chapter}:${lastOnly ? 'last' : 'all'}`;
      if (chapterRelationCache.has(cacheKey)) return chapterRelationCache.get(cacheKey);

      const chapterPayload = getCachedChapterEvents(bookId, chapter);
      let relationEvents;
      let incomplete = false;
      let failedIds = [];

      if (chapterPayload?.baseSnapshot) {
        const cachedMax = Number(chapterPayload.maxEventIdx);
        const lastEventIdx =
          Number.isFinite(cachedMax) && cachedMax >= 1
            ? cachedMax
            : await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);

        relationEvents =
          lastEventIdx > 0
            ? collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly)
            : [];
      } else {
        const lastEventIdx = await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);
        const collected = await collectRelationEventsViaApi(
          fetchEventData,
          chapter,
          lastEventIdx,
          id1,
          id2,
          lastOnly
        );
        relationEvents = collected.events;
        incomplete = collected.incomplete;
        failedIds = collected.failedIds;
      }

      const packed = { events: relationEvents, incomplete, failedIds };
      chapterRelationCache.set(cacheKey, packed);
      return packed;
    };

    const points = [];
    const labelInfo = [];
    const allFailedIds = [];
    let incomplete = false;

    for (let chapter = 1; chapter <= selectedChapter; chapter += 1) {
      const lastOnly = chapter < selectedChapter;
      const { events: relationEvents, incomplete: chapterIncomplete, failedIds } =
        await getRelationEventsForChapter(chapter, lastOnly);
      if (chapterIncomplete) incomplete = true;
      if (failedIds?.length) allFailedIds.push(...failedIds);
      if (!relationEvents.length) continue;

      if (lastOnly) {
        const lastEvent = relationEvents[relationEvents.length - 1];
        points.push(lastEvent.positivity || 0);
        labelInfo.push(`Ch${chapter}`);
      } else {
        for (const event of relationEvents) {
          points.push(event.positivity || 0);
          labelInfo.push(`E${event.idx}`);
        }
      }
    }

    if (!points.length) {
      return emptyTimeline({
        noRelation: true,
        status: FETCH_STATUS.EMPTY,
        incomplete,
        failedIds: allFailedIds,
      });
    }

    return {
      points,
      labelInfo,
      noRelation: false,
      status: FETCH_STATUS.OK,
      incomplete,
      failedIds: allFailedIds.length ? allFailedIds : null,
    };
  } catch (error) {
    return timelineError('누적 관계 타임라인 로드 실패', error);
  }
}

async function fetchCachedTimeline(cacheKey, inflightPrefix, loadCached, fetchUncached) {
  const cached = loadCached();
  if (cached) return withNoRelation(cached);

  return withTimelineInflight(`${inflightPrefix}:${cacheKey}`, async () => {
    const again = loadCached();
    if (again) return withNoRelation(again);

    try {
      const result = await fetchUncached();
      if (result?.status === FETCH_STATUS.ERROR) {
        return withNoRelation(result, false);
      }
      if (Array.isArray(result?.points) && result.points.length > 0) {
        setCachedRelationTimeline(cacheKey, result);
      }
      return withNoRelation(result);
    } catch (error) {
      return timelineError('관계 타임라인 로드 실패', error);
    }
  });
}

export async function fetchRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return emptyTimeline({ noRelation: true, status: FETCH_STATUS.EMPTY });
  }

  const cacheKey = getRelationTimelineCacheKey(bookId, selectedChapter, id1, id2);
  return fetchCachedTimeline(
    cacheKey,
    'cum',
    () => getCachedRelationTimeline(cacheKey),
    () => fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter)
  );
}

export async function fetchRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum) {
  if (!bookId || chapterNum < 1 || eventNum < 1) {
    return emptyTimeline({ noRelation: true, status: FETCH_STATUS.EMPTY });
  }

  const cachedTimeline = buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum);
  if (cachedTimeline) return withNoRelation(cachedTimeline);

  const inflightKey = `view:${bookId}:${chapterNum}:${eventNum}:${id1}:${id2}`;
  return withTimelineInflight(inflightKey, async () => {
    const again = buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum);
    if (again) return withNoRelation(again);

    try {
      const deltasBundle = await ensureBookRelationshipDeltas(bookId, { chapterIndex: chapterNum });
      const chapterEventIdOrder = resolveChapterEventIdOrder(bookId, chapterNum);
      const cachedEvents = new Map();
      const failedIds = [];

      const timeline = buildEventTimeline(eventNum, (idx, started) => {
        try {
          const fineData = buildGraphResponseFromDeltas(
            bookId,
            chapterNum,
            idx,
            deltasBundle,
            chapterEventIdOrder,
            cachedEvents.get(idx - 1) ?? null
          );
          cachedEvents.set(idx, fineData);
          const relation = findRelationInResult(
            asArray(pickSuccessfulResult(fineData)?.relations),
            id1,
            id2
          );
          if (!relation) return started ? null : undefined;
          return relation.positivity || 0;
        } catch {
          failedIds.push(`${chapterNum}:${idx}`);
          return started ? null : undefined;
        }
      }, { fillGaps: true });

      const incomplete = failedIds.length > 0;
      if (timeline.noRelation) {
        return emptyTimeline({
          noRelation: true,
          status: FETCH_STATUS.EMPTY,
          incomplete,
          failedIds,
        });
      }
      return withNoRelation({
        ...timeline,
        incomplete,
        failedIds: incomplete ? failedIds : null,
        status: FETCH_STATUS.OK,
      });
    } catch (error) {
      return timelineError('뷰어 관계 타임라인 로드 실패', error);
    }
  });
}

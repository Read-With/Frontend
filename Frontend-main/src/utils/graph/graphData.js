/** 챕터·이벤트 스냅샷, eventIdx 유틸, 매크로 그래프 캐시 로더, relation timeline */
import { toNumberOrNull, toPositiveInt, toTrimmedStringOrNull } from '../common/valueUtils';
import { errorUtils } from '../common/errorUtils';
import { extractApiBookId, isSamePair } from './graphUtils';
import {
  getCachedChapterEvents,
  getChapterEventFallbackData,
  reconstructChapterGraphState,
  ensureBookRelationshipDeltas,
} from '../common/cache/chapterEventCache';
import {
  loadFromStorage,
  saveToStorage,
  removeFromStorage,
  registerCache,
  getCacheItem,
  setCacheItem,
  enforceCacheSizeLimit,
} from '../common/cache/cacheManager';
import { eventUtils, cacheKeyUtils, MACRO_GRAPH_STORAGE_KEY_RE } from '../viewer/viewerCoreStateUtils';
import { accumulateDeltasToGraphResult, resolveChapterEventIdOrder } from '../api/api';
import {
  findManifestEventInChapter,
  resolveLastEventIdxForChapter,
} from '../common/cache/manifestCache';
import { clampPositivity } from '../styles/graphStyles';
import { pickGraphApiResult } from '../viewer/viewerGraphUtils';

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

const graphPayloadFromReconstructed = (reconstructed) => ({
  characters: reconstructed?.characters || [],
  relations: convertElementsToRelations(reconstructed?.elements || []),
});

const mapLegacyOrSummaryEvent = (event, targetChapter) => {
  const normalizedIdx = eventUtils.resolveEventOrdinal(event);
  if (normalizedIdx == null || normalizedIdx <= 0) return null;

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
      ...withEventOffsetFields(
        event?.startPos ?? event?.start ?? event?.startTxtOffset,
        event?.endPos ?? event?.end ?? event?.endTxtOffset
      ),
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
    ...withEventOffsetFields(event.startTxtOffset, event.endTxtOffset, { alsoTxtOffset: true }),
    ...withEventTitleAliases(title),
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
    const { characters, relations } = graphPayloadFromReconstructed(reconstructed);
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
    (entry) => eventUtils.resolveEventNum(entry) === toNumberOrNull(eventIndex)
  );
  if (!event) {
    return null;
  }

  const resolvedEventIdx = eventUtils.resolveEventNum(event) || Number(eventIndex);
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

/** 챕터 이벤트 캐시 → events state에 병합 */
function mergeChapterCacheEventsIntoState(
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
    const { characters, relations } = graphPayloadFromReconstructed(reconstructed);
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

const getFallbackData = (bookId, chapter, eventIdx) => {
  return getChapterEventFallbackData(bookId, chapter, eventIdx) ?? null;
};

/** characters 또는 relations가 하나라도 있으면 true (fine/macro 공용) */
export const hasGraphPayload = (data) => {
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

const handleLoaderFallback = (bookId, chapter, eventIdx, onSuccess, logMessage) => {
  const fallbackData = getFallbackData(bookId, chapter, eventIdx);
  if (!fallbackData) return null;
  errorUtils.logInfo('GraphDataLoader', logMessage, { bookId, chapter, eventIdx, source: 'fallback' });
  onSuccess?.(fallbackData);
  return { data: fallbackData, source: 'fallback' };
};

const processApiResponse = (response, cacheKey, onSuccess, bookId, chapter, eventIdx, onError) => {
  if (response?.isSuccess && response?.result) {
    handleLoaderSuccess(response.result, onSuccess, cacheKey);
    return { data: response.result, source: 'api' };
  }

  const apiError = new Error(response?.message || 'API 응답이 실패했습니다');
  apiError.status = response?.code || null;
  errorUtils.logWarning('GraphDataLoader', 'API 응답 실패', { bookId, chapter, eventIdx, response });

  const fallbackResult = handleLoaderFallback(bookId, chapter, eventIdx, onSuccess, '폴백 데이터 사용');
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
    const response = await getOrCreateInflightRequest(cacheKey, apiCall);
    return processApiResponse(response, cacheKey, onSuccess, bookId, chapter, eventIdx, onError);
  } catch (error) {
    if (cacheKey) inflightRequests.delete(cacheKey);
    errorUtils.logError('GraphDataLoader', error, { bookId, chapter, eventIdx, cacheKey });

    const fallbackResult = handleLoaderFallback(
      bookId,
      chapter,
      eventIdx,
      onSuccess,
      '에러 후 폴백 데이터 사용'
    );
    if (fallbackResult) return fallbackResult;

    onError?.(error);
    return { data: null, source: 'error' };
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

  if (!eventId) {
    const prev = previousResult?.result;
    const snapshot = {
      bookId: deltasBundle.bookId ?? bookId,
      chapterIndex: chapter,
      eventId: null,
      characters: Array.isArray(prev?.characters) ? prev.characters : [],
      relations: Array.isArray(prev?.relations) ? prev.relations : [],
      event: { chapterIndex: chapter, chapterIdx: chapter, eventId: null },
    };
    return {
      isSuccess: deltasBundle.isSuccess !== false,
      code: 'SUCCESS',
      result: snapshot,
    };
  }

  const snapshot = accumulateDeltasToGraphResult(deltasBundle.bookId ?? bookId, deltasBundle.deltas, {
    chapterIndex: chapter,
    throughEventId: eventId,
    chapterEventIdOrder,
  });
  return {
    isSuccess: deltasBundle.isSuccess !== false,
    code: 'SUCCESS',
    result: snapshot,
  };
}

export function getRelationTimelineCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

export function getCachedRelationTimeline(cacheKey) {
  const cached = getCacheItem('relationTimelineCache', cacheKey);
  if (cached && cached.result) {
    return cached.result;
  }
  return null;
}

export function setCachedRelationTimeline(cacheKey, result) {
  setCacheItem('relationTimelineCache', cacheKey, {
    result,
    timestamp: Date.now(),
  });
  enforceCacheSizeLimit('relationTimelineCache');
}

export function findRelationInResult(relations, id1, id2) {
  if (!Array.isArray(relations) || relations.length === 0) return null;
  return relations.find((rel) => isSamePair(rel, id1, id2)) ?? null;
}

export function findRelationInElements(elements, id1, id2) {
  if (!Array.isArray(elements)) return null;
  return (
    elements.find((element) => {
      const data = element?.data;
      if (!data?.source || !data?.target) return false;
      const pair = eventUtils.resolveRelationNodeIds(data);
      return isSamePair(pair, id1, id2);
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
  return {
    ...safeResult,
    points,
    labelInfo: Array.isArray(safeResult.labelInfo) ? safeResult.labelInfo : [],
    noRelation: safeResult.noRelation ?? (points.length === 0 ? fallbackNoRelation : false),
  };
}

export function padSingleEvent(points, labels) {
  if (!Array.isArray(points) || !Array.isArray(labels) || points.length !== 1) {
    return { points, labels };
  }

  const paddedLabels = Array(11)
    .fill('')
    .map((_, index) => (index === 5 ? labels[0] : ''));
  const paddedTimeline = Array(11)
    .fill(null)
    .map((_, index) => (index === 5 ? points[0] : null));

  return { points: paddedTimeline, labels: paddedLabels };
}

/** 간선 관계 타임라인 차트 UX */
const EDGE_CHART_UX = {
  LONG_THRESHOLD: 12,
  /** positivity -1~1 기준 유의미 변화 */
  SIGNIFICANT_DELTA: 0.15,
};

export function isLongEdgeTimeline(pointCount) {
  return pointCount >= EDGE_CHART_UX.LONG_THRESHOLD;
}

/** 변곡·시작점에 isSignificant 표시 */
export function annotateSignificantEdgePoints(pairs, delta = EDGE_CHART_UX.SIGNIFICANT_DELTA) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((pair, i) => {
    if (i === 0 || i === pairs.length - 1) {
      return { ...pair, isSignificant: true };
    }
    const prev = pairs[i - 1]?.value;
    const cur = pair?.value;
    if (typeof prev !== 'number' || typeof cur !== 'number') {
      return { ...pair, isSignificant: false };
    }
    return {
      ...pair,
      isSignificant: Math.abs(cur - prev) >= delta,
    };
  });
}

/**
 * X축 라벨용 tick.
 * 챕터가 많아도 겹치지 않도록 개수를 제한하고 간격을 유지한다.
 * (항상: 첫·끝·현재 / 챕터는 균등 샘플)
 */
export function getSparseEdgeTickValues(lineData, { maxTicks = 6 } = {}) {
  if (!Array.isArray(lineData) || lineData.length === 0) return [];
  if (lineData.length <= maxTicks) {
    return lineData.map((d) => d.x);
  }

  const byX = new Map(lineData.map((d) => [d.x, d]));
  const chosen = new Set();

  chosen.add(lineData[0].x);
  chosen.add(lineData[lineData.length - 1].x);
  lineData.forEach((d) => {
    if (d.isCurrent) chosen.add(d.x);
  });

  const chapters = lineData.filter((d) => d.isChapter);
  if (chapters.length > 0) {
    const chapterBudget = Math.max(2, maxTicks - chosen.size);
    if (chapters.length <= chapterBudget) {
      chapters.forEach((d) => chosen.add(d.x));
    } else {
      chosen.add(chapters[0].x);
      chosen.add(chapters[chapters.length - 1].x);
      const innerSlots = Math.max(0, chapterBudget - 2);
      for (let i = 1; i <= innerSlots; i += 1) {
        const idx = Math.round((i * (chapters.length - 1)) / (innerSlots + 1));
        chosen.add(chapters[idx].x);
      }
    }
  }

  if (chosen.size < 3) {
    chosen.add(lineData[Math.floor(lineData.length / 2)].x);
  }

  const sorted = [...chosen].sort((a, b) => a - b);
  const minGap = Math.max(1, Math.floor(lineData.length / maxTicks));
  const thinned = [];

  sorted.forEach((x) => {
    const point = byX.get(x);
    if (thinned.length === 0) {
      thinned.push(x);
      return;
    }
    const prevX = thinned[thinned.length - 1];
    if (x - prevX >= minGap) {
      thinned.push(x);
      return;
    }
    const prev = byX.get(prevX);
    const preferCurrent = point?.isCurrent && !prev?.isCurrent;
    const preferEnd =
      x === lineData[lineData.length - 1].x && prevX !== lineData[lineData.length - 1].x;
    if (preferCurrent || preferEnd) {
      thinned[thinned.length - 1] = x;
    }
  });

  if (thinned[0] !== lineData[0].x) thinned.unshift(lineData[0].x);
  const lastX = lineData[lineData.length - 1].x;
  if (thinned[thinned.length - 1] !== lastX) thinned.push(lastX);

  return [...new Set(thinned)].sort((a, b) => a - b);
}

/**
 * 차트 표시용 라벨. E12 → event 12, Ch는 유지.
 */
export function formatEdgeTimelineDisplayLabel(label, numericLabel, fallbackIndex = 0) {
  if (typeof label === 'string') {
    const trimmed = label.trim();
    if (/^Ch\d+/i.test(trimmed)) return trimmed;
    const eventMatch = trimmed.match(/^E(\d+)$/i);
    if (eventMatch) return `event ${eventMatch[1]}`;
  }
  if (Number.isFinite(numericLabel) && numericLabel > 0) {
    return `event ${numericLabel}`;
  }
  return `event ${fallbackIndex + 1}`;
}

/** relation timeline fetch (캐시·deltas·API probe) */

const PROBE_EVENT_HARD_MAX = 512;
const timelineInflight = new Map();

function emptyTimeline() {
  return { points: [], labelInfo: [] };
}

function emptyNoRelation() {
  return { points: [], labelInfo: [], noRelation: true };
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
  if (!fineResult || !Array.isArray(fineResult.relations) || fineResult.relations.length === 0) {
    return null;
  }
  const relation = findRelationInResult(fineResult.relations, id1, id2);
  if (!relation) return null;
  return { idx, positivity: relation.positivity || 0 };
}

function buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum) {
  const chapterPayload = getCachedChapterEvents(bookId, chapterNum);
  if (!chapterPayload?.baseSnapshot) return null;

  const points = [];
  const labelInfo = [];
  let started = false;

  for (let idx = 1; idx <= eventNum; idx += 1) {
    const edge = findRelationInElements(
      reconstructChapterGraphState(chapterPayload, idx)?.elements,
      id1,
      id2
    );
    if (!started) {
      if (!edge) continue;
      started = true;
    }
    points.push(edge ? relationPointFromElement(edge) : 0);
    labelInfo.push(`E${idx}`);
  }

  return started ? { points, labelInfo, noRelation: false } : emptyNoRelation();
}

function collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly) {
  const relationEvents = [];

  if (lastOnly) {
    for (let idx = lastEventIdx; idx >= 1; idx -= 1) {
      const edge = findRelationInElements(
        reconstructChapterGraphState(chapterPayload, idx)?.elements,
        id1,
        id2
      );
      if (edge) {
        relationEvents.push({ idx, positivity: relationPointFromElement(edge) });
        break;
      }
    }
    return relationEvents;
  }

  for (let idx = 1; idx <= lastEventIdx; idx += 1) {
    const edge = findRelationInElements(
      reconstructChapterGraphState(chapterPayload, idx)?.elements,
      id1,
      id2
    );
    if (edge) {
      relationEvents.push({ idx, positivity: relationPointFromElement(edge) });
    }
  }
  return relationEvents;
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

async function collectRelationEventsViaApi(fetchEventData, chapter, lastEventIdx, id1, id2, lastOnly) {
  const relationEvents = [];
  if (!(lastEventIdx > 0)) return relationEvents;

  if (lastOnly) {
    for (let idx = lastEventIdx; idx >= 1; idx -= 1) {
      try {
        const event = relationEventFromApiResult(await fetchEventData(chapter, idx), id1, id2, idx);
        if (event) {
          relationEvents.push(event);
          break;
        }
      } catch {
        // continue probing earlier events
      }
    }
    return relationEvents;
  }

  for (let idx = 1; idx <= lastEventIdx; idx += 1) {
    try {
      const event = relationEventFromApiResult(await fetchEventData(chapter, idx), id1, id2, idx);
      if (event) relationEvents.push(event);
    } catch {
      // skip event
    }
  }
  return relationEvents;
}

async function fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) return emptyTimeline();

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
        relationEvents = await collectRelationEventsViaApi(
          fetchEventData,
          chapter,
          lastEventIdx,
          id1,
          id2,
          lastOnly
        );
      }

      chapterRelationCache.set(cacheKey, relationEvents);
      return relationEvents;
    };

    const points = [];
    const labelInfo = [];

    for (let chapter = 1; chapter <= selectedChapter; chapter += 1) {
      const lastOnly = chapter < selectedChapter;
      const relationEvents = await getRelationEventsForChapter(chapter, lastOnly);
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

    return { points, labelInfo };
  } catch {
    return emptyTimeline();
  }
}

export async function fetchRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) return emptyNoRelation();

  const cacheKey = getRelationTimelineCacheKey(bookId, selectedChapter, id1, id2);
  const cached = getCachedRelationTimeline(cacheKey);
  if (cached) return withNoRelation(cached);

  return withTimelineInflight(`cum:${cacheKey}`, async () => {
    const again = getCachedRelationTimeline(cacheKey);
    if (again) return withNoRelation(again);

    try {
      const result = await fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter);
      if (Array.isArray(result?.points) && result.points.length > 0) {
        setCachedRelationTimeline(cacheKey, result);
      }
      return withNoRelation(result);
    } catch {
      return emptyNoRelation();
    }
  });
}

export async function fetchRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum) {
  if (!bookId || chapterNum < 1 || eventNum < 1) return emptyNoRelation();

  const cachedTimeline = buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum);
  if (cachedTimeline) return cachedTimeline;

  const inflightKey = `view:${bookId}:${chapterNum}:${eventNum}:${id1}:${id2}`;
  return withTimelineInflight(inflightKey, async () => {
    const again = buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum);
    if (again) return again;

    try {
      const deltasBundle = await ensureBookRelationshipDeltas(bookId, { chapterIndex: chapterNum });
      const chapterEventIdOrder = resolveChapterEventIdOrder(bookId, chapterNum);
      const cachedEvents = new Map();
      const points = [];
      const labelInfo = [];
      let started = false;

      for (let idx = 1; idx <= eventNum; idx += 1) {
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

          const fineResult = pickSuccessfulResult(fineData);
          const relation = fineResult?.relations
            ? findRelationInResult(fineResult.relations, id1, id2)
            : null;

          if (!started) {
            if (!relation) continue;
            started = true;
          }

          points.push(relation?.positivity || 0);
          labelInfo.push(`E${idx}`);
        } catch {
          if (started) {
            points.push(0);
            labelInfo.push(`E${idx}`);
          }
        }
      }

      return started ? withNoRelation({ points, labelInfo }) : emptyNoRelation();
    } catch {
      return emptyNoRelation();
    }
  });
}

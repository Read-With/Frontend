/** 매크로 그래프 캐시 로더, relation timeline fetch */
import { toPositiveInt, toTrimmedStringOrNull, asArray, clampPositivity, errorUtils, compareLocale } from '../common/valueUtils';
import { isSamePair, isGraphEdgeElement, normalizeElementId } from './graphCore';
import {
  loadTtlStorage,
  saveTtlStorage,
  setBounded,
  withInflight,
} from '../common/cache/cacheManager';
import { eventUtils, cacheKeyUtils, MACRO_GRAPH_STORAGE_KEY_RE, ELEMENTS_TO_RELATIONS_OPTS } from '../viewer/viewerCore';
import { FETCH_STATUS, hasGraphPayload } from '../api/graphApi';
import {
  findManifestEventInChapter,
  resolveLastEventIdxForChapter,
} from '../common/cache/manifestCache';

import {
  getCachedChapterEvents,
  createChapterGraphStateCursor,
  ensureBookRelationshipDeltas,
  accumulateDeltasToGraphResult,
  resolveChapterEventIdOrder,
} from './graphModel';

/** API 응답에서 result 객체 추출 */
function pickGraphApiResult(response) {
  const result = response?.result;
  return result && typeof result === 'object' ? result : null;
}

// --- 매크로 그래프 세션·localStorage 캐시 ---

const GRAPH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — stale 매크로 고착 완화
const macroSessionCache = new Map();
const inflightRequests = new Map();
const timelineInflight = new Map();

const isValidChapterRef = (bookId, chapter) =>
  toPositiveInt(bookId) !== null && toPositiveInt(chapter) !== null;

export const hasMacroSessionCache = (bookId, chapter) =>
  macroSessionCache.has(cacheKeyUtils.macroSession(bookId, chapter));

const getMacroFromSessionCache = (bookId, chapter) =>
  macroSessionCache.get(cacheKeyUtils.macroSession(bookId, chapter));

const saveMacroToSessionCache = (bookId, chapter, data) =>
  macroSessionCache.set(cacheKeyUtils.macroSession(bookId, chapter), data);

const checkLocalStorageCache = (cacheKey) => loadTtlStorage(cacheKey, GRAPH_CACHE_TTL_MS);

const saveToLocalStorageCache = (cacheKey, data) => {
  saveTtlStorage(cacheKey, data);
};

function resolveMacroCacheRefs(bookId, chapter) {
  const normalizedBookId = toPositiveInt(bookId);
  const normalizedChapter = toPositiveInt(chapter);
  if (!isValidChapterRef(normalizedBookId, normalizedChapter)) return null;
  return {
    bookId: normalizedBookId,
    chapter: normalizedChapter,
    sessionKey: cacheKeyUtils.macroSession(normalizedBookId, normalizedChapter),
    storageKey: cacheKeyUtils.macroGraphStorage(normalizedBookId, normalizedChapter),
  };
}

export const hasMacroGraphStorageCache = (bookId, chapter) => {
  const refs = resolveMacroCacheRefs(bookId, chapter);
  if (!refs) return false;
  if (macroSessionCache.has(refs.sessionKey)) return true;
  return hasGraphPayload(checkLocalStorageCache(refs.storageKey));
};

const handleLoaderSuccess = (data, onSuccess, cacheKey) => {
  if (cacheKey && hasGraphPayload(data)) {
    saveToLocalStorageCache(cacheKey, data);
    const m = MACRO_GRAPH_STORAGE_KEY_RE.exec(cacheKey);
    if (m) saveMacroToSessionCache(m[1], m[2], data);
  }
  onSuccess?.(data);
  return data;
};

const processApiResponse = (response, cacheKey, onSuccess, bookId, chapter, onError) => {
  if (response?.isSuccess && response?.result) {
    return handleLoaderSuccess(response.result, onSuccess, cacheKey);
  }

  const apiError = new Error(response?.message || 'API 응답이 실패했습니다');
  apiError.status = response?.code || null;
  errorUtils.logWarning('GraphDataLoader', 'API 응답 실패', {
    bookId,
    chapter,
    response,
  });
  onError?.(apiError);
  return null;
};

export const prefetchMacroGraphToCache = async (bookId, chapter, apiCall) => {
  const refs = resolveMacroCacheRefs(bookId, chapter);
  if (!refs) return;
  if (macroSessionCache.has(refs.sessionKey)) return;
  if (hasGraphPayload(checkLocalStorageCache(refs.storageKey))) return;
  try {
    const response = await withInflight(inflightRequests, refs.storageKey, apiCall);
    if (response?.isSuccess && response?.result) {
      handleLoaderSuccess(response.result, null, refs.storageKey);
    }
  } catch {
    /* 프리페치 실패 무시 */
  }
};

/** book-scope(macro) 그래프: session → localStorage → API */
export const loadGraphDataWithCache = async ({
  bookId,
  chapter,
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
      return sessionData;
    }
  }

  const localStorageData = checkLocalStorageCache(cacheKey);
  if (hasGraphPayload(localStorageData)) {
    if (macroMatch) saveMacroToSessionCache(macroMatch[1], macroMatch[2], localStorageData);
    onSuccess?.(localStorageData);
    return localStorageData;
  }

  try {
    const response = await withInflight(inflightRequests, cacheKey, apiCall);
    return processApiResponse(response, cacheKey, onSuccess, bookId, chapter, onError);
  } catch (error) {
    errorUtils.logError('GraphDataLoader', error, { bookId, chapter, cacheKey });
    onError?.(error);
    return null;
  }
};

/** 엣지 툴팁 relation timeline용 헬퍼·캐시·fetch */

const CACHE_DURATION = 5 * 60 * 1000;
const CACHE_PREFIX = 'relation-timeline-';
const MAX_CACHE_SIZE = 50;

const relationTimelineCache = new Map();

function buildGraphResponseFromDeltas(
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
  const isSuccess = deltasBundle?.isSuccess !== false;
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

function getRelationTimelineCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

function getCachedRelationTimeline(cacheKey) {
  const cached = relationTimelineCache.get(cacheKey);
  if (!cached || Date.now() - cached.timestamp > CACHE_DURATION) return null;
  return cached.result;
}

function setCachedRelationTimeline(cacheKey, result) {
  setBounded(relationTimelineCache, cacheKey, { result, timestamp: Date.now() }, MAX_CACHE_SIZE);
}

function findRelationInResult(relations, id1, id2) {
  const list = asArray(relations);
  if (!list.length) return null;
  return list.find((rel) => isSamePair(rel, id1, id2)) ?? null;
}

/** 양방향 간선이 둘 다 있으면 id 정렬상 앞선 쪽 — 정렬된 elements에서 find한 결과와 동일 (입력 순서 무관) */
function findRelationInElements(elements, id1, id2) {
  if (!Array.isArray(elements)) return null;
  let best = null;
  for (const element of elements) {
    if (!isGraphEdgeElement(element)) continue;
    if (!isSamePair(eventUtils.resolveRelationNodeIds(element.data), id1, id2)) continue;
    if (!best || compareLocale(String(normalizeElementId(element)), String(normalizeElementId(best))) < 0) {
      best = element;
    }
  }
  return best;
}

function withNoRelation(result, fallbackNoRelation = true) {
  const safeResult = result ?? { points: [], labelInfo: [] };
  const points = asArray(safeResult.points);
  const status = safeResult.status ?? (points.length === 0 ? FETCH_STATUS.EMPTY : FETCH_STATUS.OK);
  // 네트워크/로드 에러는 noRelation으로 취급하지 않음
  const noRelation =
    status === FETCH_STATUS.ERROR
      ? false
      : (safeResult.noRelation ?? (points.length === 0 ? fallbackNoRelation : false));
  return {
    ...safeResult,
    points,
    labelInfo: asArray(safeResult.labelInfo),
    noRelation,
    status,
    incomplete: Boolean(safeResult.incomplete),
    failedIds: Array.isArray(safeResult.failedIds) ? safeResult.failedIds : null,
    error: safeResult.error ?? null,
    usedProbe: Boolean(safeResult.usedProbe),
  };
}


/** relation timeline fetch (캐시·deltas·API probe) */

const PROBE_EVENT_HARD_MAX = 512;

function emptyTimeline({
  noRelation = false,
  status = null,
  error = null,
  incomplete = false,
  failedIds = null,
  usedProbe = false,
} = {}) {
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
    usedProbe: Boolean(usedProbe),
  };
}

function timelineError(message, cause = null) {
  const err = cause instanceof Error ? cause : new Error(message);
  if (!(cause instanceof Error) && cause) err.cause = cause;
  return emptyTimeline({ status: FETCH_STATUS.ERROR, error: err, noRelation: false });
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
  const positivity = readEdgePositivityValue(relation);
  if (positivity == null) return null;
  return { idx, positivity };
}

/** 챕터 캐시에서 idx 시점의 id1–id2 간선 조회 함수 (diff 순회를 조회 간에 이어감) */
function createReconstructedEdgeFinder(chapterPayload, id1, id2) {
  const maxIdx = Number(chapterPayload?.maxEventIdx);
  // 간선 조회만 하므로 시점마다 전체 복제·정렬하지 않음 (O(k·N log N) → O(k·N))
  const stateAt = createChapterGraphStateCursor(chapterPayload, { readOnly: true, sortElements: false });
  return (eventIdx) => {
    // 캐시에 없는 이벤트는 마지막 스냅샷을 반복하지 않음 (잘못된 평탄 차트 방지)
    if (Number.isFinite(maxIdx) && maxIdx >= 1 && Number(eventIdx) > maxIdx) {
      return null;
    }
    return findRelationInElements(stateAt(eventIdx)?.elements, id1, id2);
  };
}

function readEdgePositivityValue(edgeOrRelation) {
  const raw = edgeOrRelation?.data?.positivity ?? edgeOrRelation?.positivity;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampPositivity(n) : null;
}

function walkEventIndices(lastEventIdx, lastOnly) {
  if (!(lastEventIdx > 0)) return [];
  return lastOnly
    ? Array.from({ length: lastEventIdx }, (_, i) => lastEventIdx - i)
    : Array.from({ length: lastEventIdx }, (_, i) => i + 1);
}

function collectIndexedRelationEvents(lastEventIdx, lastOnly, getEdgeAt) {
  const relationEvents = [];
  for (const idx of walkEventIndices(lastEventIdx, lastOnly)) {
    const edge = getEdgeAt(idx);
    if (!edge) continue;
    const positivity = readEdgePositivityValue(edge);
    if (positivity == null) continue;
    relationEvents.push({ idx, positivity });
    if (lastOnly) break;
  }
  return relationEvents;
}

function collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly) {
  const findEdgeAt = createReconstructedEdgeFinder(chapterPayload, id1, id2);
  const events = collectIndexedRelationEvents(lastEventIdx, false, findEdgeAt);
  // lastOnly: 커서는 오름차순 조회만 빠름 — 내려가며 찾으면 단계마다 base부터 재생하므로 한 번 훑고 마지막 것만
  return lastOnly ? events.slice(-1) : events;
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
        // 관계 공백은 0%(중립)이 아니라 null — 차트에서 선이 끊김
        points.push(null);
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

  const findEdgeAt = createReconstructedEdgeFinder(chapterPayload, id1, id2);
  return buildEventTimeline(eventNum, (idx, started) => {
    const edge = findEdgeAt(idx);
    if (!edge) return started ? null : undefined;
    const positivity = readEdgePositivityValue(edge);
    if (positivity == null) return started ? null : undefined;
    return positivity;
  }, { fillGaps: true });
}

async function collectRelationEventsViaApi(fetchEventData, chapter, lastEventIdx, id1, id2, lastOnly) {
  if (!(lastEventIdx > 0)) {
    return { events: [], incomplete: false, failedIds: [] };
  }

  const relationEvents = [];
  const failedIds = [];

  for (const idx of walkEventIndices(lastEventIdx, lastOnly)) {
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
  if (Number.isFinite(fromManifest) && fromManifest >= 1) {
    return { lastEventIdx: fromManifest, usedProbe: false };
  }

  // capped/partial 캐시의 maxEventIdx는 챕터 마지막 이벤트가 아님
  const cached = getCachedChapterEvents(bookId, chapter);
  const cachedMax = cached?.capped || cached?.partial ? NaN : Number(cached?.maxEventIdx);
  if (Number.isFinite(cachedMax) && cachedMax >= 1) {
    return { lastEventIdx: cachedMax, usedProbe: false };
  }

  const probed = await probeLastEventIdxByApi(fetchEventData, chapter);
  return { lastEventIdx: probed, usedProbe: true };
}

/** fetchRelationTimelineCumulative가 bookId·selectedChapter 검증 후 호출 */
async function fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter) {
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
      let usedProbe = false;

      if (chapterPayload?.baseSnapshot) {
        incomplete = Boolean(chapterPayload.capped || chapterPayload.partial);
        const cachedMax = Number(chapterPayload.maxEventIdx);
        let lastEventIdx;
        if (Number.isFinite(cachedMax) && cachedMax >= 1) {
          lastEventIdx = cachedMax;
        } else {
          const resolved = await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);
          lastEventIdx = resolved.lastEventIdx;
          usedProbe = resolved.usedProbe;
        }

        relationEvents =
          lastEventIdx > 0
            ? collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly)
            : [];
      } else {
        const resolved = await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);
        usedProbe = resolved.usedProbe;
        const collected = await collectRelationEventsViaApi(
          fetchEventData,
          chapter,
          resolved.lastEventIdx,
          id1,
          id2,
          lastOnly
        );
        relationEvents = collected.events;
        incomplete = collected.incomplete;
        failedIds = collected.failedIds;
      }

      const packed = { events: relationEvents, incomplete, failedIds, usedProbe };
      chapterRelationCache.set(cacheKey, packed);
      return packed;
    };

    const points = [];
    const labelInfo = [];
    const allFailedIds = [];
    let incomplete = false;
    let usedProbe = false;

    for (let chapter = 1; chapter <= selectedChapter; chapter += 1) {
      const lastOnly = chapter < selectedChapter;
      const {
        events: relationEvents,
        incomplete: chapterIncomplete,
        failedIds,
        usedProbe: chapterUsedProbe,
      } = await getRelationEventsForChapter(chapter, lastOnly);
      if (chapterIncomplete) incomplete = true;
      if (chapterUsedProbe) usedProbe = true;
      if (failedIds?.length) allFailedIds.push(...failedIds);
      if (!relationEvents.length) continue;

      if (lastOnly) {
        const lastEvent = relationEvents[relationEvents.length - 1];
        points.push(clampPositivity(lastEvent.positivity));
        labelInfo.push(`Ch${chapter}`);
      } else {
        for (const event of relationEvents) {
          points.push(clampPositivity(event.positivity));
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
        usedProbe,
      });
    }

    return {
      points,
      labelInfo,
      noRelation: false,
      status: FETCH_STATUS.OK,
      incomplete,
      failedIds: allFailedIds.length ? allFailedIds : null,
      usedProbe,
    };
  } catch (error) {
    return timelineError('누적 관계 타임라인 로드 실패', error);
  }
}

async function fetchCachedTimeline(cacheKey, inflightPrefix, loadCached, fetchUncached) {
  const cached = loadCached();
  if (cached) return withNoRelation(cached);

  return withInflight(timelineInflight, `${inflightPrefix}:${cacheKey}`, async () => {
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
  return withInflight(timelineInflight, inflightKey, async () => {
    const again = buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum);
    if (again) return withNoRelation(again);

    try {
      const deltasBundle = await ensureBookRelationshipDeltas(bookId, { chapterIndex: chapterNum });
      if (deltasBundle?.isSuccess === false) {
        return timelineError(
          deltasBundle?.response?.message || '관계 델타를 불러오지 못했습니다.'
        );
      }

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

          if (fineData?.isSuccess === false) {
            failedIds.push(`${chapterNum}:${idx}`);
            return started ? null : undefined;
          }

          const relation = findRelationInResult(
            asArray(pickSuccessfulResult(fineData)?.relations),
            id1,
            id2
          );
          if (!relation) return started ? null : undefined;
          const positivity = readEdgePositivityValue(relation);
          if (positivity == null) return started ? null : undefined;
          return positivity;
        } catch {
          failedIds.push(`${chapterNum}:${idx}`);
          return started ? null : undefined;
        }
      }, { fillGaps: true });

      const incomplete = failedIds.length > 0;
      if (timeline.noRelation) {
        // 전부 이벤트 구성 실패면 '없음'이 아니라 로드 실패
        if (incomplete && failedIds.length >= eventNum) {
          return timelineError('관계 타임라인을 구성하지 못했습니다.');
        }
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

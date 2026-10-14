/** 매크로 그래프 캐시 로더, relation timeline fetch */
import { toPositiveInt, toTrimmedStringOrNull, asArray, clampPositivity, toPositivityOrNull, errorUtils, compareLocale } from '../common/valueUtils';
import { isSamePair, isGraphEdgeElement, normalizeElementId } from './graphCore';
import {
  loadTtlStorage,
  saveTtlStorage,
  withInflight,
} from '../common/cache/cacheManager';
import { eventUtils, cacheKeyUtils, MACRO_GRAPH_STORAGE_KEY_RE } from '../viewer/viewerCore';
import { hasGraphPayload } from '../api/graphApi';
import {
  findManifestEventInChapter,
  resolveLastEventIdxForChapter,
} from '../common/cache/manifestCache';

import { getCachedChapterEvents } from './graphChapterCache';
import {
  ensureBookRelationshipDeltas,
  accumulateDeltasToGraphResult,
  resolveChapterEventIdOrder,
  createChapterRelationPairReader,
} from './graphDeltas';

/** API 응답에서 result 객체 추출 */
function pickGraphApiResult(response) {
  const result = response?.result;
  return result && typeof result === 'object' ? result : null;
}

// --- 매크로 그래프 세션·localStorage 캐시 ---

const GRAPH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — stale 매크로 고착 완화
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

/** 동기 캐시 조회 (session → localStorage). 없으면 null */
export const readMacroGraphCache = (bookId, chapter) => {
  const refs = resolveMacroCacheRefs(bookId, chapter);
  if (!refs) return null;
  const sessionData = macroSessionCache.get(refs.sessionKey);
  if (hasGraphPayload(sessionData)) return sessionData;
  const storageData = checkLocalStorageCache(refs.storageKey);
  if (!hasGraphPayload(storageData)) return null;
  macroSessionCache.set(refs.sessionKey, storageData);
  return storageData;
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

/** 엣지 툴팁 relation timeline 헬퍼·fetch (결과 캐시·중복 요청 방지는 react-query 담당) */

/** manifest 기준 챕터 이벤트의 eventId (없으면 null) */
function resolveChapterEventId(bookId, chapter, eventIdx) {
  const structure = findManifestEventInChapter(bookId, chapter, { eventIdx });
  return toTrimmedStringOrNull(eventUtils.resolveEventId(structure) ?? structure?.eventId);
}

function buildGraphResponseFromDeltas(
  bookId,
  chapter,
  eventIdx,
  deltasBundle,
  chapterEventIdOrder,
  previousResult = null
) {
  const eventId = resolveChapterEventId(bookId, chapter, eventIdx);
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

/** relation timeline fetch (캐시·deltas·API probe) */

const PROBE_EVENT_HARD_MAX = 512;

/** 관계 타임라인 결과. 실패는 반환하지 않고 throw (react-query가 error로 전달) */
const EMPTY_TIMELINE = Object.freeze({ points: [], labelInfo: [], noRelation: true, incomplete: false, usedProbe: false });

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

/**
 * 챕터 캐시에서 idx 시점의 id1–id2 간선 조회 함수 (diff 순회를 조회 간에 이어감).
 * createChapterGraphStateCursor와 같은 diff 규칙을 따르되 이 쌍의 간선만 추적한다 —
 * 시점마다 전체 elements 배열을 만들고 훑지 않음 (O(K·N) → O(N + Σdiff)).
 */
function createReconstructedEdgeFinder(chapterPayload, id1, id2) {
  const maxIdx = Number(chapterPayload?.maxEventIdx);
  const baseSnapshot = chapterPayload?.baseSnapshot;
  if (!baseSnapshot || !Array.isArray(baseSnapshot.elements)) return () => null;

  const isPairEdge = (el) =>
    isGraphEdgeElement(el) && isSamePair(eventUtils.resolveRelationNodeIds(el.data), id1, id2);
  const baseIdx = Number(baseSnapshot.eventIdx) || 1;
  const diffs = eventUtils.sortEventsByIdx(chapterPayload.diffs || []);
  // diff 적용 전에는 커서가 base 배열을 그대로 쓰므로 (중복 id 포함) 같은 후보를 쓴다
  const basePairEdges = baseSnapshot.elements.filter(isPairEdge);
  let pairMap; // 첫 diff 적용 시 생성 (커서의 elementMap에서 이 쌍만)
  let nextDiff;
  let lastTarget = -Infinity;
  const reset = () => {
    pairMap = null;
    nextDiff = 0;
  };
  reset();

  const putIfPair = (item) => {
    const id = normalizeElementId(item);
    if (!id) return;
    // 같은 id가 다른 쌍으로 바뀌면 이 쌍에서 빠짐
    if (isPairEdge(item)) pairMap.set(id, item);
    else pairMap.delete(id);
  };

  return (eventIdx) => {
    // 캐시에 없는 이벤트는 마지막 스냅샷을 반복하지 않음 (잘못된 평탄 차트 방지)
    if (Number.isFinite(maxIdx) && maxIdx >= 1 && Number(eventIdx) > maxIdx) {
      return null;
    }
    const target = Number(eventIdx);
    // partial(through만 적재)은 base 이전 이벤트가 없음
    if (chapterPayload.partial && target < baseIdx) return null;
    if (!Number.isFinite(target) || target <= baseIdx) return findRelationInElements(basePairEdges, id1, id2);

    if (target < lastTarget) reset();
    lastTarget = target;
    for (; nextDiff < diffs.length; nextDiff += 1) {
      const diff = diffs[nextDiff];
      const diffIdx = Number(diff?.eventIdx);
      if (!Number.isFinite(diffIdx)) continue;
      if (diffIdx > target) break;
      if (!pairMap) {
        // 커서의 toKeyedMap과 같이 base 전체를 뒤에서 덮어쓰는 순서로 반영 (같은 id의 다른 요소가 쌍 간선을 대체할 수 있음)
        pairMap = new Map();
        baseSnapshot.elements.forEach(putIfPair);
      }
      const elementDiff = diff?.elementDiff;
      (elementDiff?.removedIds || []).forEach((id) => id && pairMap.delete(String(id)));
      (elementDiff?.updated || []).forEach(putIfPair);
      (elementDiff?.added || []).forEach(putIfPair);
    }
    return findRelationInElements(pairMap ? [...pairMap.values()] : basePairEdges, id1, id2);
  };
}

function readEdgePositivityValue(edgeOrRelation) {
  return toPositivityOrNull(edgeOrRelation?.data?.positivity ?? edgeOrRelation?.positivity);
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

/** E1..eventCount 긍정도 타임라인. 첫 관계 이전 구간은 생략, 이후 공백은 null(차트 선 끊김) */
function buildEventTimeline(eventCount, getEdgeAt) {
  const points = [];
  const labelInfo = [];
  let started = false;

  for (let idx = 1; idx <= eventCount; idx += 1) {
    const positivity = readEdgePositivityValue(getEdgeAt(idx));
    if (positivity == null && !started) continue;
    started = true;
    // 관계 공백은 0%(중립)이 아니라 null
    points.push(positivity);
    labelInfo.push(`E${idx}`);
  }

  return started ? { ...EMPTY_TIMELINE, points, labelInfo, noRelation: false } : EMPTY_TIMELINE;
}

function buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum) {
  const chapterPayload = getCachedChapterEvents(bookId, chapterNum);
  if (!chapterPayload?.baseSnapshot) return null;

  return buildEventTimeline(eventNum, createReconstructedEdgeFinder(chapterPayload, id1, id2));
}

/**
 * lastOnly: 챕터의 마지막 관계만 필요 — 관계는 누적만 되고(삭제 없음) 긍정도도 이전 값을 이어받으므로
 * eventId가 있는 마지막 이벤트 한 곳만 보면 된다. 거기 없으면 그 이전 이벤트에도 없다.
 * (이전: 뒤에서부터 이벤트마다 delta 전체를 다시 정렬·누적 → 챕터당 O(K·D log D). 지금 O(D log D))
 * eventId 없는 이벤트는 역순 탐색에선 항상 빈 결과라 누적 없이 건너뛴다.
 */
async function collectRelationEventsViaApi(fetchEventData, bookId, chapter, lastEventIdx, id1, id2, lastOnly) {
  const relationEvents = [];
  let incomplete = false;

  for (const idx of walkEventIndices(lastEventIdx, lastOnly)) {
    if (lastOnly && !resolveChapterEventId(bookId, chapter, idx)) continue;
    try {
      const event = relationEventFromApiResult(await fetchEventData(chapter, idx), id1, id2, idx);
      if (event) relationEvents.push(event);
    } catch {
      // 챕터 delta 로드 실패는 모든 이벤트에서 같은 캐시된 실패 → 한 번이면 충분
      incomplete = true;
    }
    if (lastOnly) break;
  }
  return { events: relationEvents, incomplete };
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
/** fetchRelationTimelineCumulative가 bookId·selectedChapter 검증 후 호출. 실패는 throw */
async function fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter) {
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
      const { lastEventIdx, usedProbe: probed } =
        await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);
      usedProbe = probed;
      if (lastOnly) {
        ({ events: relationEvents, incomplete } = await collectRelationEventsViaApi(
          fetchEventData, bookId, chapter, lastEventIdx, id1, id2, true
        ));
      } else {
        try {
          const deltasBundle = await loadChapterDeltas(chapter);
          const relationAt =
            deltasBundle?.isSuccess === false
              ? () => null
              : createChapterRelationPairReader(bookId, chapter, deltasBundle.deltas, id1, id2);
          relationEvents = collectIndexedRelationEvents(lastEventIdx, false, relationAt);
        } catch {
          // 챕터 delta 로드 실패: 관계 없음이 아니라 불완전으로 표시
          relationEvents = [];
          incomplete = lastEventIdx > 0;
        }
      }
    }

    const packed = { events: relationEvents, incomplete, usedProbe };
    chapterRelationCache.set(cacheKey, packed);
    return packed;
  };

  // 챕터 캐시가 없는 챕터가 하나라도 있으면 1..selectedChapter deltas를 한 번에 확보.
  // (챕터마다 ensureBookRelationshipDeltas를 순서대로 부르면 미캐시 챕터 수만큼 네트워크 왕복이 직렬로 쌓임)
  // 실패는 무시 — 아래 챕터별 경로가 다시 시도하고 incomplete로 표시한다.
  const needsDeltas = Array.from({ length: selectedChapter }, (_, i) => i + 1)
    .some((chapter) => !getCachedChapterEvents(bookId, chapter)?.baseSnapshot);
  if (needsDeltas) {
    try {
      await loadChapterDeltas(selectedChapter);
    } catch {
      /* 선택 챕터는 캐시된 실패를 재사용(원래와 같은 1회 시도), 나머지 챕터는 각자 재시도 */
    }
  }

  const points = [];
  const labelInfo = [];
  let incomplete = false;
  let usedProbe = false;

  for (let chapter = 1; chapter <= selectedChapter; chapter += 1) {
    const lastOnly = chapter < selectedChapter;
    const {
      events: relationEvents,
      incomplete: chapterIncomplete,
      usedProbe: chapterUsedProbe,
    } = await getRelationEventsForChapter(chapter, lastOnly);
    if (chapterIncomplete) incomplete = true;
    if (chapterUsedProbe) usedProbe = true;
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

  return { points, labelInfo, noRelation: points.length === 0, incomplete, usedProbe };
}

export async function fetchRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) return EMPTY_TIMELINE;
  return fetchRelationTimelineCumulativeUncached(bookId, id1, id2, selectedChapter);
}

export async function fetchRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum) {
  if (!bookId || chapterNum < 1 || eventNum < 1) return EMPTY_TIMELINE;

  const cachedTimeline = buildRelationTimelineFromChapterCache(bookId, id1, id2, chapterNum, eventNum);
  if (cachedTimeline) return cachedTimeline;

  const deltasBundle = await ensureBookRelationshipDeltas(bookId, { chapterIndex: chapterNum });
  if (deltasBundle?.isSuccess === false) {
    throw new Error(deltasBundle?.response?.message || '관계 델타를 불러오지 못했습니다.');
  }
  return buildEventTimeline(
    eventNum,
    createChapterRelationPairReader(bookId, chapterNum, deltasBundle.deltas, id1, id2)
  );
}

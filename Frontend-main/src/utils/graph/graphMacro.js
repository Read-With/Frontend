/** 매크로 그래프(책 전체 누적): API 응답 shape 변환 + 캐시 로더, relation timeline fetch */

import {
  resolveManifestEventId,
  isSamePair,
  normalizeElementId,
  isGraphEdgeElement,
  eventUtils,
  cacheKeyUtils,
} from './graphCore';
import {
  asArray,
  toNumberOrNull,
  toTrimmedStringOrNull,
  errorUtils,
  toPositiveInt,
  clampPositivity,
  toPositivityOrNull,
  compareLocale,
} from '../common/valueUtils';
import { buildGraphEventMeta, hasGraphPayload } from '../api/graphApi';
import { requireBookId } from '../api/client';
import {
  getLastManifestEventInChapter,
  findManifestEventInChapter,
  resolveLastEventIdxForChapter,
} from '../common/cache/manifestCache';
import {
  accumulateDeltasToGraphResult,
  resolveChapterEventIdOrder,
  ensureBookRelationshipDeltas,
  createChapterRelationPairReader,
} from './graphDeltas';
import { loadTtlStorage, saveTtlStorage, withInflight } from '../common/cache/cacheManager';
import { getCachedChapterEvents, createDiffReplay } from './graphChapters';

/* ─── 책 전체 누적 그래프 → API 응답 shape (매크로 그래프) ─── */

const handleApiError = (error, context) => {
  const statusCode = error.status || 'unknown';
  const statusMessage = errorUtils.getUserFriendlyMessage(error);
  errorUtils.logError('graphApi', error, { context, status: statusCode });
  // 상태 코드가 없으면 statusMessage가 원본 메시지 자체일 수 있음 — 같은 문장을 두 번 붙이지 않음
  const detail = error.message || '알 수 없는 오류';
  throw new Error(
    `${context}: ${statusMessage} (${statusCode})${detail === statusMessage ? '' : ` - ${detail}`}`
  );
};

const emptyAccumulatedGraphResult = (overrides = {}) => ({
  bookId: null,
  chapterIndex: null,
  eventId: null,
  characters: [],
  relations: [],
  event: null,
  ...overrides,
});

const normalizeAccumulatedGraphResult = (payload) => {
  if (!payload || typeof payload !== 'object') return emptyAccumulatedGraphResult();
  const eventId = toTrimmedStringOrNull(payload.eventId);
  const chapterIndex = payload.chapterIndex ?? null;
  return {
    ...payload,
    bookId: payload.bookId ?? null,
    chapterIndex,
    eventId,
    characters: asArray(payload.characters),
    relations: asArray(payload.relations),
    event:
      payload.event && typeof payload.event === 'object'
        ? payload.event
        : buildGraphEventMeta(eventId, chapterIndex),
  };
};

const createRelationshipDeltasResponse = (isSuccess, code, message, result) => ({
  isSuccess,
  code,
  message,
  result: normalizeAccumulatedGraphResult(result),
});

const toGraphApiResponse = ({ response, result, empty }) => {
  const resolved = result || empty;
  const hasPayload = hasGraphPayload(resolved);
  // soft-empty는 fetch 단계에서 success로 정규화됨. 여기선 누적 payload로 부분 실패 보정.
  const failed = (!response || response.isSuccess === false) && !hasPayload;
  const code = failed ? response?.code || 'ERROR' : hasPayload ? 'SUCCESS' : 'NOT_FOUND';
  const message = failed
    ? response?.message || '관계 델타 조회에 실패했습니다.'
    : hasPayload
      ? '관계 델타를 성공적으로 조회했습니다.'
      : '관계 델타를 찾을 수 없습니다.';
  return createRelationshipDeltasResponse(!failed, code, message, failed ? empty : resolved);
};

/** 매크로 그래프: 해당 챕터까지(챕터 단위) 책 전체 누적 */
export const getBookScopeRelationshipGraph = async (bookId, uptoChapter = null) => {
  requireBookId(bookId);

  const chapterIndex = toNumberOrNull(uptoChapter);
  const bookIdNum = Number(bookId) || null;
  if (chapterIndex == null) {
    return createRelationshipDeltasResponse(
      false,
      'INVALID_PARAMS',
      'chapterIndex가 필요합니다.',
      emptyAccumulatedGraphResult({ bookId: bookIdNum })
    );
  }

  const resolvedTo = resolveManifestEventId(getLastManifestEventInChapter(bookId, chapterIndex));
  const empty = emptyAccumulatedGraphResult({
    bookId: bookIdNum,
    chapterIndex,
    eventId: resolvedTo,
  });

  try {
    const fetched = await ensureBookRelationshipDeltas(bookId, {
      chapterIndex,
    });
    return toGraphApiResponse({
      response: fetched.response,
      result: accumulateDeltasToGraphResult(fetched.bookId, fetched.deltas, {
        chapterIndex,
        throughEventId: resolvedTo,
        chapterEventIdOrder: resolveChapterEventIdOrder(bookId, chapterIndex),
      }),
      empty,
    });
  } catch (error) {
    handleApiError(error, '관계 델타 조회 실패');
  }
};

/* ─── 매크로 그래프 캐시 로더, relation timeline fetch ─── */


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
  const storageData = loadTtlStorage(refs.storageKey, GRAPH_CACHE_TTL_MS);
  if (!hasGraphPayload(storageData)) return null;
  macroSessionCache.set(refs.sessionKey, storageData);
  return storageData;
};

const handleLoaderSuccess = (data, onSuccess, refs) => {
  if (hasGraphPayload(data)) {
    saveTtlStorage(refs.storageKey, data);
    macroSessionCache.set(refs.sessionKey, data);
  }
  onSuccess?.(data);
  return data;
};

const processApiResponse = (response, refs, onSuccess, onError) => {
  const { bookId, chapter } = refs;
  if (response?.isSuccess && response?.result) {
    return handleLoaderSuccess(response.result, onSuccess, refs);
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
  if (hasGraphPayload(loadTtlStorage(refs.storageKey, GRAPH_CACHE_TTL_MS))) return;
  try {
    const response = await withInflight(inflightRequests, refs.storageKey, apiCall);
    if (response?.isSuccess && response?.result) {
      handleLoaderSuccess(response.result, null, refs);
    }
  } catch {
    /* 프리페치 실패 무시 */
  }
};

/** book-scope(macro) 그래프: session → localStorage → API */
export const loadGraphDataWithCache = async ({ bookId, chapter, apiCall, onSuccess, onError }) => {
  const refs = resolveMacroCacheRefs(bookId, chapter);
  if (!refs) {
    onError?.(new Error('유효하지 않은 bookId·chapter'));
    return null;
  }

  const cached = readMacroGraphCache(bookId, chapter);
  if (cached) {
    onSuccess?.(cached);
    return cached;
  }

  try {
    const response = await withInflight(inflightRequests, refs.storageKey, apiCall);
    return processApiResponse(response, refs, onSuccess, onError);
  } catch (error) {
    errorUtils.logError('GraphDataLoader', error, { bookId, chapter, cacheKey: refs.storageKey });
    onError?.(error);
    return null;
  }
};

/** 엣지 툴팁 relation timeline 헬퍼·fetch (결과 캐시·중복 요청 방지는 react-query 담당) */

/** manifest 기준 챕터 이벤트의 eventId (없으면 null) */
function resolveChapterEventId(bookId, chapter, eventIdx) {
  const structure = findManifestEventInChapter(bookId, chapter, { eventIdx });
  return resolveManifestEventId(structure);
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
  // diff 적용 전에는 커서가 base 배열을 그대로 쓰므로 (중복 id 포함) 같은 후보를 쓴다
  const basePairEdges = baseSnapshot.elements.filter(isPairEdge);
  let pairMap = null; // 첫 diff 적용 시 생성 (커서의 elementMap에서 이 쌍만)

  const putIfPair = (item) => {
    const id = normalizeElementId(item);
    if (!id) return;
    // 같은 id가 다른 쌍으로 바뀌면 이 쌍에서 빠짐
    if (isPairEdge(item)) pairMap.set(id, item);
    else pairMap.delete(id);
  };

  const replay = createDiffReplay(chapterPayload, {
    onReset: () => {
      pairMap = null;
    },
    applyDiff: (diff) => {
      if (!pairMap) {
        // 커서의 toKeyedMap과 같이 base 전체를 뒤에서 덮어쓰는 순서로 반영 (같은 id의 다른 요소가 쌍 간선을 대체할 수 있음)
        pairMap = new Map();
        baseSnapshot.elements.forEach(putIfPair);
      }
      const elementDiff = diff?.elementDiff;
      (elementDiff?.removedIds || []).forEach((id) => id && pairMap.delete(String(id)));
      (elementDiff?.updated || []).forEach(putIfPair);
      (elementDiff?.added || []).forEach(putIfPair);
    },
  });

  return (eventIdx) => {
    // 캐시에 없는 이벤트는 마지막 스냅샷을 반복하지 않음 (잘못된 평탄 차트 방지)
    if (Number.isFinite(maxIdx) && maxIdx >= 1 && Number(eventIdx) > maxIdx) {
      return null;
    }
    const state = replay.advance(eventIdx);
    if (state === 'missing') return null;
    const candidates = state === 'replayed' && pairMap ? [...pairMap.values()] : basePairEdges;
    return findRelationInElements(candidates, id1, id2);
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

/**
 * 타임라인 1회 계산용 조회 함수 묶음. 같은 챕터 deltas·이벤트 순서·이벤트 응답을 이 계산 안에서 재사용
 * (결과 캐시·중복 요청 방지는 react-query 담당)
 */
function createTimelineFetchers(bookId) {
  const eventCache = new Map();
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

  return { loadChapterDeltas, fetchEventData };
}

/**
 * 한 챕터의 id1–id2 관계 이벤트들. 챕터 캐시가 있으면 캐시 재생, 없으면 deltas(또는 lastOnly면 API 역순 탐색).
 * @returns {Promise<{ events: Array<{ idx: number, positivity: number }>, incomplete: boolean, usedProbe: boolean }>}
 */
async function getChapterRelationEvents(bookId, chapter, id1, id2, lastOnly, { loadChapterDeltas, fetchEventData }) {
  const chapterPayload = getCachedChapterEvents(bookId, chapter);

  if (chapterPayload?.baseSnapshot) {
    const incomplete = Boolean(chapterPayload.capped || chapterPayload.partial);
    const cachedMax = Number(chapterPayload.maxEventIdx);
    let lastEventIdx = cachedMax;
    let usedProbe = false;
    if (!(Number.isFinite(cachedMax) && cachedMax >= 1)) {
      ({ lastEventIdx, usedProbe } = await resolveChapterLastEventIdx(bookId, chapter, fetchEventData));
    }
    const events =
      lastEventIdx > 0
        ? collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly)
        : [];
    return { events, incomplete, usedProbe };
  }

  const { lastEventIdx, usedProbe } = await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);
  if (lastOnly) {
    const { events, incomplete } = await collectRelationEventsViaApi(
      fetchEventData, bookId, chapter, lastEventIdx, id1, id2, true
    );
    return { events, incomplete, usedProbe };
  }

  try {
    const deltasBundle = await loadChapterDeltas(chapter);
    const relationAt =
      deltasBundle?.isSuccess === false
        ? () => null
        : createChapterRelationPairReader(bookId, chapter, deltasBundle.deltas, id1, id2);
    return { events: collectIndexedRelationEvents(lastEventIdx, false, relationAt), incomplete: false, usedProbe };
  } catch {
    // 챕터 delta 로드 실패: 관계 없음이 아니라 불완전으로 표시
    return { events: [], incomplete: lastEventIdx > 0, usedProbe };
  }
}

/** 챕터 1..selectedChapter 누적 관계 타임라인 (이전 챕터는 마지막 값만, 선택 챕터는 이벤트별). 실패는 throw */
export async function fetchRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) return EMPTY_TIMELINE;
  const fetchers = createTimelineFetchers(bookId);

  // 챕터 캐시가 없는 챕터가 하나라도 있으면 1..selectedChapter deltas를 한 번에 확보.
  // (챕터마다 ensureBookRelationshipDeltas를 순서대로 부르면 미캐시 챕터 수만큼 네트워크 왕복이 직렬로 쌓임)
  // 실패는 무시 — 아래 챕터별 경로가 다시 시도하고 incomplete로 표시한다.
  const needsDeltas = Array.from({ length: selectedChapter }, (_, i) => i + 1)
    .some((chapter) => !getCachedChapterEvents(bookId, chapter)?.baseSnapshot);
  if (needsDeltas) {
    try {
      await fetchers.loadChapterDeltas(selectedChapter);
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
    const result = await getChapterRelationEvents(bookId, chapter, id1, id2, lastOnly, fetchers);
    if (result.incomplete) incomplete = true;
    if (result.usedProbe) usedProbe = true;
    if (!result.events.length) continue;

    if (lastOnly) {
      points.push(clampPositivity(result.events[result.events.length - 1].positivity));
      labelInfo.push(`Ch${chapter}`);
    } else {
      for (const event of result.events) {
        points.push(clampPositivity(event.positivity));
        labelInfo.push(`E${event.idx}`);
      }
    }
  }

  return { points, labelInfo, noRelation: points.length === 0, incomplete, usedProbe };
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

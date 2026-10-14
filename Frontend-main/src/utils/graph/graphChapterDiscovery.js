/** 챕터 이벤트 탐색·프리페치·보장 + 책 단위 그래프 캐시 예열(ensureGraphBookCache) */

import { resolveManifestEventId } from './graphCore';
import { eventUtils } from '../viewer/viewerCore';
import {
  asArray,
  toNumberOrNull,
  toPositiveNumberOrNull,
  sleep,
  errorUtils,
} from '../common/valueUtils';
import { getBookManifest } from '../api/booksApi';
import { getChapterData, getManifestFromCache, calculateMaxChapterFromChapters } from '../common/cache/manifestCache';
import {
  setBounded,
  saveTtlStorage,
  awaitTracked,
  GRAPH_BOOK_CACHE_PREFIX,
} from '../common/cache/cacheManager';
import { sortDeltasForAccumulate, createDeltaAccumulateWalker, ensureBookRelationshipDeltas } from './graphDeltas';
import {
  CHAPTER_GRAPH_CACHE_SOURCE,
  buildChapterCachePayload,
  getCachedChapterEvents,
  isUnusableChapterGraphCacheSource,
  normalizeEventFromDeltasGraphResult,
  readTtlCache,
  setCachedChapterEvents,
} from './graphChapterCache';

const graphBookMemoryCache = new Map();

const GRAPH_BOOK_MEMORY_MAX = 50;

const graphBuildPromises = new Map();

const chapterDiscoverPromises = new Map();

const getChapterDiscoverKey = (bookId, chapterIdx) => `${bookId}-${chapterIdx}`;

const getGraphBookCacheKey = (bookId) => {
  const numeric = toPositiveNumberOrNull(bookId);
  if (numeric === null) return null;
  return `${GRAPH_BOOK_CACHE_PREFIX}${numeric}`;
};

// 챕터 캐시와 같은 TTL — 챕터 캐시 만료 후에도 prewarm이 영구 생략되지 않도록
const readGraphBookCache = (bookId) =>
  readTtlCache(graphBookMemoryCache, GRAPH_BOOK_MEMORY_MAX, getGraphBookCacheKey(bookId), '그래프 책 캐시');

const writeGraphBookCache = (bookId, payload) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const normalized = {
    ...payload,
    bookId: Number(bookId),
    builtAt: payload?.builtAt ?? Date.now(),
    timestamp: Date.now(),
  };

  setBounded(graphBookMemoryCache, key, normalized, GRAPH_BOOK_MEMORY_MAX);
  saveTtlStorage(key, normalized, 'localStorage');

  return normalized;
};

/**
 * 책 단위 챕터 요약 캐시 빌드/보장. 메모리 + localStorage 기록.
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

    const chapterSummaries = [];
    let hasFailedChapter = false;

    for (const chapterIdx of normalizedChapterIndices) {
      if (signals.every((s) => s?.aborted)) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let chapterCache = getCachedChapterEvents(numericId, chapterIdx);
      if (!chapterCache || chapterCache.partial || chapterCache.capped) {
        try {
          chapterCache = await discoverChapterEvents(numericId, chapterIdx, false);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          // 실패 챕터는 요약에서 제외
          chapterCache = null;
          hasFailedChapter = true;
        }
      }

      if (chapterCache) {
        chapterSummaries.push({
          chapterIdx,
          maxEventIdx: Number(chapterCache.maxEventIdx) || 0,
          totalEvents: Array.isArray(chapterCache.events) ? chapterCache.events.length : 0,
          source: chapterCache.source ?? 'cache',
        });
      }
    }

    const summary = {
      bookId: numericId,
      chapters: chapterSummaries,
      maxChapter: calculateMaxChapterFromChapters(chapters),
      builtAt: Date.now(),
    };
    // 실패 챕터가 있으면 캐시하지 않음 — TTL 동안 재시도가 막히지 않도록
    return hasFailedChapter ? summary : writeGraphBookCache(numericId, summary);
  })();

  return awaitTracked(graphBuildPromises, numericId, buildPromise, { promise: buildPromise, signals });
};

function loadManifestEventStructures(bookId, chapterIdx) {
  try {
    const manifestChapter = getChapterData(bookId, chapterIdx);
    if (!manifestChapter?.events?.length) return [];
    return manifestChapter.events
      .map((rawEvent, index) => {
        const eventIdx = eventUtils.resolveEventNum(rawEvent) || Number(index + 1);
        const eventNum = toPositiveNumberOrNull(rawEvent.eventNum) ?? eventIdx;
        return {
          eventIdx,
          eventNum,
          eventId: eventUtils.resolveEventId(rawEvent),
          startTxtOffset: rawEvent.startTxtOffset ?? null,
          endTxtOffset: rawEvent.endTxtOffset ?? null,
        };
      })
      .filter((e) => e.eventIdx > 0);
  } catch (error) {
    errorUtils.logDebug('graphChapterCache', 'manifest 이벤트 구조 로드 실패', { message: error?.message });
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
      errorUtils.logDebug('graphChapterCache', 'onPartialCache 콜백 실패', { message: error?.message });
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
function findPreviousApiEventBeforeIdx(apiEvents, eventIdx) {
  let best = null;
  let bestIdx = -1;
  for (let i = 0; i < apiEvents.length; i += 1) {
    const n = eventUtils.resolveEventNum(apiEvents[i]) || 0;
    if (n > 0 && n < eventIdx && n >= bestIdx) {
      bestIdx = n;
      best = apiEvents[i];
    }
  }
  return best;
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

  // Phase 2: 전체 구간 백필
  const walker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
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
      const prev = findPreviousApiEventBeforeIdx(apiEvents, eventIdx);
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

  const discoverKey = getChapterDiscoverKey(bookId, chapterIdx);
  if (!forceRefresh && chapterDiscoverPromises.has(discoverKey)) {
    await chapterDiscoverPromises.get(discoverKey);
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (isCompleteThrough(cached, cappedMaxEventIdx)) {
      return cached;
    }
  }

  const discoverPromise = (async () => {
    const existingCache = !forceRefresh ? getCachedChapterEvents(bookId, chapterIdx) : null;
    const apiEvents = Array.isArray(existingCache?.rawEvents)
      ? [...existingCache.rawEvents] // push용 배열 복사 — 이벤트 항목은 불변
      : [];
    const fetchedEventIdxSet = new Set(
      apiEvents.map((event) => eventUtils.resolveEventNum(event) || 0).filter((idx) => idx > 0)
    );
    // 기존(partial) 캐시가 cap 뒤 이벤트를 갖고 있으면 cap을 늘려 prefix 연속성 유지
    const capThrough = cappedMaxEventIdx
      ? Math.max(cappedMaxEventIdx, ...fetchedEventIdxSet)
      : null;

    const ctx = {
      bookId,
      chapterIdx,
      apiEvents,
      fetchedEventIdxSet,
      onPartialCache,
      capped: false,
      /** appendEventsFromSortedDeltas가 최종(비-partial) 캐시를 저장했으면 그 payload */
      finalPayload: null,
      /** 이번 요청이 채워야 하는 eventIdx 목록 */
      targetIndices: null,
    };

    // 두 경로 공통 마무리. 대상 이벤트를 전부 확보했을 때만 새로 저장 —
    // deltas가 비어 기존 캐시 이벤트만 있을 때 capped 캐시를 완성본으로 덮지 않도록
    const finalizeChapterCache = () => {
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
    };

    const manifestEventStructures = loadManifestEventStructures(bookId, chapterIdx);
    const { manifestEventMap, sortedManifestIndices } = buildManifestEventIndex(manifestEventStructures);

    if (sortedManifestIndices.length > 0) {
      const indicesToFetch = capThrough
        ? sortedManifestIndices.filter((idx) => idx <= capThrough)
        : sortedManifestIndices;
      ctx.capped = indicesToFetch.length < sortedManifestIndices.length;
      ctx.targetIndices = indicesToFetch;

      await collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap);
      if (apiEvents.length > 0) return finalizeChapterCache();
    }

    await discoverWithoutManifest(ctx, capThrough);

    if (!apiEvents.length) {
      if (import.meta.env.DEV) {
        errorUtils.logDebug('graphChapterCache', 'relationship-deltas 이벤트 없음', { chapterIdx });
      }
      // EMPTY를 캐시에 쓰지 않음 — "빈 성공" 고착 방지 (재요청 가능)
      return null;
    }

    return finalizeChapterCache();
  })().catch((error) => {
    if (import.meta.env.DEV) {
      errorUtils.logDebug('graphChapterCache', '챕터 이벤트 discover 실패', { chapterIdx, message: error?.message || String(error) });
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

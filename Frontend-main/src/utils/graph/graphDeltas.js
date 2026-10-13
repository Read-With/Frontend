/** relationship-deltas 누적·책 단위 delta 캐시 (graphModel에서 분리) */

import {
  directedEdgeElementId,
  uniqueStrings,
  pickCharacterDisplayName,
  rememberCharacterDisplayName,
  resolveManifestEventId,
  appendRelationLabelHistory,
} from './graphCore';
import { eventUtils } from '../viewer/viewerCore';
import {
  asArray,
  toNumberOrNull,
  toPositiveInt,
  toPositiveNumberOrNull,
  toTrimmedStringOrNull,
  clampPositivity,
  stringOrEmpty,
} from '../common/valueUtils';
import { buildGraphEventMeta, fetchRelationshipDeltasList } from '../api/graphApi';
import { requireBookId } from '../api/authApi';
import {
  getChapterData,
  getManifestFromCache,
  getLastManifestEventInChapter,
  getFirstManifestEventInChapter,
  listBookManifestEventIds,
} from '../common/cache/manifestCache';
import { awaitTracked } from '../common/cache/cacheManager';

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. Book relationship deltas
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── relationship-deltas 누적 (graphApi에서 이동) ─── */

const orderIndexOf = (orderIndex, eventId) => {
  const id = toTrimmedStringOrNull(eventId);
  if (id == null || !orderIndex?.has(id)) return null;
  return orderIndex.get(id);
};

const resolveManifestCharacterMeta = (bookId) => {
  const byId = new Map();
  for (const character of asArray(getManifestFromCache(bookId)?.characters)) {
    const id = Number(character?.id);
    if (Number.isFinite(id)) byId.set(id, character);
  }
  return byId;
};

const normalizeEventIdOrder = (chapterEventIdOrder) =>
  asArray(chapterEventIdOrder).map((id) => toTrimmedStringOrNull(id)).filter(Boolean);

const compareDeltasForAccumulate = (a, b, orderIndex = null) => {
  const chapterA = Number(a?.chapterIndex);
  const chapterB = Number(b?.chapterIndex);
  const hasA = Number.isFinite(chapterA);
  const hasB = Number.isFinite(chapterB);
  if (hasA && hasB && chapterA !== chapterB) return chapterA - chapterB;
  if (hasA !== hasB) return hasA ? -1 : 1;

  if (!orderIndex?.size) return 0;
  const ia = orderIndexOf(orderIndex, a?.eventId);
  const ib = orderIndexOf(orderIndex, b?.eventId);
  if (ia != null && ib != null) return ia - ib;
  if (ia != null) return -1;
  if (ib != null) return 1;
  // eventId 문자열 비교는 시간 순서와 어긋날 수 있어 사용하지 않음 (안정 정렬)
  return 0;
};

/** deltas를 챕터·manifest 이벤트 순으로 정렬 (export: discovery 공용) */
export const sortDeltasForAccumulate = (deltas, chapterEventIdOrder = null) => {
  const list = asArray(deltas).filter((d) => d && typeof d === 'object');
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const orderIndex = order.length > 0 ? new Map(order.map((id, i) => [id, i])) : null;
  return [...list].sort((a, b) => compareDeltasForAccumulate(a, b, orderIndex));
};

const createEmptyDeltaAccumulateState = () => ({
  relationMap: new Map(),
  weightMap: new Map(),
  characterIds: new Set(),
  lastDelta: null,
});

const applyNodeWeights = (state, weights) => {
  if (!weights || typeof weights !== 'object') return;
  for (const [rawId, meta] of Object.entries(weights)) {
    const idNum = Number(rawId);
    if (!Number.isFinite(idNum)) continue;
    state.characterIds.add(idNum);
    if (Number.isFinite(meta?.weight)) state.weightMap.set(idNum, meta.weight);
  }
};

const mergeRelationItem = (state, item, deltaEventId) => {
  if (!item || typeof item !== 'object') return;
  const id1 = Number(item.fromCharacterId);
  const id2 = Number(item.toCharacterId);
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) return;

  state.characterIds.add(id1);
  state.characterIds.add(id2);
  const key = directedEdgeElementId(id1, id2);
  const prev = state.relationMap.get(key);
  const labels = asArray(item.labels);
  const evidence = Number.isFinite(item.evidenceCount) ? item.evidenceCount : 1;
  const positivity = toNumberOrNull(item.positivity) ?? clampPositivity(prev?.positivity);

  state.relationMap.set(key, {
    id1,
    id2,
    positivity,
    count: (prev?.count ?? 0) + evidence,
    relation: uniqueStrings([...asArray(prev?.relation), ...labels], { caseInsensitive: true }),
    latestLabels: labels,
    labelHistory: appendRelationLabelHistory(prev?.labelHistory, labels, deltaEventId, positivity),
    latestReason: typeof item.reason === 'string' ? item.reason : prev?.latestReason ?? '',
    latestEventId: deltaEventId ?? prev?.latestEventId ?? null,
  });
};

const applyDeltasToAccumulateState = (state, deltas, start = 0, end = deltas?.length ?? 0) => {
  if (!state || !deltas?.length) return state;

  for (let i = start; i < end; i += 1) {
    const delta = deltas[i];
    if (!delta || typeof delta !== 'object') continue;
    state.lastDelta = delta;
    const deltaEventId = toTrimmedStringOrNull(delta.eventId);
    applyNodeWeights(state, delta.nodeWeights);
    for (const item of asArray(delta.items)) mergeRelationItem(state, item, deltaEventId);
  }
  return state;
};

const finalizeAccumulateStateToGraphResult = (
  bookId,
  state,
  { chapterIndex = null, eventId = null } = {}
) => {
  const last = state.lastDelta;
  const stampedId = toTrimmedStringOrNull(eventId);
  // through 스냅샷: chapterIndex 인자 우선 / 전체 누적: last delta 우선
  const resolvedChapter = stampedId
    ? toNumberOrNull(chapterIndex) ?? last?.chapterIndex ?? null
    : last?.chapterIndex ?? toNumberOrNull(chapterIndex);
  const resolvedEventId = stampedId ?? toTrimmedStringOrNull(last?.eventId) ?? null;

  const manifestChars = resolveManifestCharacterMeta(bookId);
  const characters = [...state.characterIds]
    .sort((a, b) => a - b)
    .map((id) => {
      const meta = manifestChars.get(id);
      const commonName = pickCharacterDisplayName(meta) || '';
      if (commonName) rememberCharacterDisplayName(bookId, id, commonName);
      return {
        id,
        weight: toPositiveNumberOrNull(state.weightMap.get(id)) ?? 1,
        count: 1,
        common_name: commonName,
        name: commonName,
        names: asArray(meta?.names),
        // 인물 소개는 personalityText (profileText는 이미지 프롬프트 등 별도 용도)
        personalityText: stringOrEmpty(meta?.personalityText),
        profileText: stringOrEmpty(meta?.profileText),
        description: stringOrEmpty(meta?.personalityText),
        profileImage: stringOrEmpty(meta?.profileImage),
        isMainCharacter: Boolean(meta?.isMainCharacter),
      };
    });

  return {
    bookId: Number(bookId) || bookId || null,
    chapterIndex: resolvedChapter,
    eventId: resolvedEventId,
    characters,
    relations: [...state.relationMap.values()],
    event: buildGraphEventMeta(resolvedEventId, resolvedChapter),
  };
};

/** throughEventId까지 포함한 end index (exclusive). 목록에 없으면 order로 근사. */
const resolveThroughEndExclusive = (
  sortedDeltas,
  throughEventId,
  { chapterIndex = null, chapterEventIdOrder = null, firstIndexByEventId = null } = {}
) => {
  const list = asArray(sortedDeltas);
  const through = toTrimmedStringOrNull(throughEventId);
  if (!through || list.length === 0) return 0;

  const cut = firstIndexByEventId
    ? firstIndexByEventId.get(through) ?? -1
    : list.findIndex((d) => toTrimmedStringOrNull(d.eventId) === through);
  if (cut >= 0) return cut + 1;

  const targetChapter = toNumberOrNull(chapterIndex);
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const throughPos = order.indexOf(through);
  if (targetChapter == null || throughPos < 0) return list.length;

  const allowedInChapter = new Set(order.slice(0, throughPos + 1));
  const orderSet = new Set(order);
  let end = 0;
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i];
    const ch = Number(d?.chapterIndex);
    const id = toTrimmedStringOrNull(d?.eventId);
    let include = false;
    if (Number.isFinite(ch) && ch < targetChapter) include = true;
    else if (Number.isFinite(ch) && ch > targetChapter) include = false;
    else if (Number.isFinite(ch) && ch === targetChapter) include = id ? allowedInChapter.has(id) : false;
    else include = id ? !orderSet.has(id) : false;
    if (include) end = i + 1;
  }
  return end;
};

/**
 * 정렬된 deltas를 이벤트 순으로 증분 누적.
 * discovery에서 phase1/phase2가 동일 walker를 재사용.
 * appliedEnd는 항상 원본 sortedDeltas 기준 exclusive index.
 */
export const createDeltaAccumulateWalker = (
  bookId,
  sortedDeltas,
  { chapterIndex = null, chapterEventIdOrder = null } = {}
) => {
  const state = createEmptyDeltaAccumulateState();
  let appliedEnd = 0;
  const deltas = asArray(sortedDeltas);
  // eventId → 첫 등장 index: 이벤트마다 deltas를 findIndex로 훑지 않음 (O(E·D) → O(D + E))
  const firstIndexByEventId = new Map();
  deltas.forEach((d, i) => {
    const id = toTrimmedStringOrNull(d?.eventId);
    if (id && !firstIndexByEventId.has(id)) firstIndexByEventId.set(id, i);
  });
  const cutOpts = {
    chapterIndex,
    chapterEventIdOrder: normalizeEventIdOrder(chapterEventIdOrder),
    firstIndexByEventId,
  };

  const applyUpTo = (endExclusive) => {
    const end = Math.max(0, Math.min(endExclusive, deltas.length));
    if (end <= appliedEnd) return;
    applyDeltasToAccumulateState(state, deltas, appliedEnd, end);
    appliedEnd = end;
  };

  const advanceThrough = (eventId) => {
    const id = toTrimmedStringOrNull(eventId);
    if (!id) return;
    applyUpTo(resolveThroughEndExclusive(deltas, id, cutOpts));
  };

  const snapshot = (eventId) =>
    finalizeAccumulateStateToGraphResult(bookId, state, { chapterIndex, eventId });

  // 양방향이 모두 생긴 쌍의 먼저 삽입된 방향. Map 키 순서는 삽입 후 불변이라 한 번만 판정
  const firstDirectionByPair = new Map();

  /** 현재 누적 상태에서 a–b 간선 (방향 무관, 먼저 생긴 쪽). finalize 없이 O(1) (양방향 첫 판정만 O(R)) */
  const relationBetween = (a, b) => {
    const n1 = toNumberOrNull(a);
    const n2 = toNumberOrNull(b);
    if (!Number.isFinite(n1) || !Number.isFinite(n2)) return null;
    const k12 = directedEdgeElementId(n1, n2);
    const k21 = directedEdgeElementId(n2, n1);
    const r12 = state.relationMap.get(k12);
    const r21 = state.relationMap.get(k21);
    if (!r12 || !r21 || k12 === k21) return r12 ?? r21 ?? null;
    let firstKey = firstDirectionByPair.get(k12);
    if (!firstKey) {
      for (const key of state.relationMap.keys()) {
        if (key === k12 || key === k21) {
          firstKey = key;
          break;
        }
      }
      firstDirectionByPair.set(k12, firstKey);
    }
    return firstKey === k12 ? r12 : r21;
  };

  return {
    advanceThrough,
    relationBetween,
    snapshotThrough(eventId) {
      const id = toTrimmedStringOrNull(eventId);
      advanceThrough(id);
      return snapshot(id);
    },
    snapshotAll() {
      applyUpTo(deltas.length);
      return snapshot(null);
    },
  };
};

/**
 * relationship-deltas → 기존 그래프 소비자용 characters/relations 누적.
 * @param {{ chapterIndex?: number|null, throughEventId?: string|null, chapterEventIdOrder?: string[]|null }} [options]
 */
export const accumulateDeltasToGraphResult = (
  bookId,
  deltas,
  { chapterIndex = null, throughEventId = null, chapterEventIdOrder = null } = {}
) => {
  const through = toTrimmedStringOrNull(throughEventId);
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const walker = createDeltaAccumulateWalker(
    bookId,
    sortDeltasForAccumulate(deltas, order),
    { chapterIndex, chapterEventIdOrder: order }
  );
  return through ? walker.snapshotThrough(through) : walker.snapshotAll();
};

/**
 * 챕터 이벤트를 오름차순으로 훑으며 a–b 간선만 조회하는 reader.
 * 이벤트마다 전체 재누적·finalize 하지 않음 (O(E·D log D) → O(D log D + E)).
 * @returns {(eventIdx: number) => object|null} eventIdx는 오름차순으로만 호출
 */
export const createChapterRelationPairReader = (bookId, chapterIndex, deltas, id1, id2) => {
  const order = resolveChapterEventIdOrder(bookId, chapterIndex);
  const walker = createDeltaAccumulateWalker(
    bookId,
    sortDeltasForAccumulate(deltas, order),
    { chapterIndex, chapterEventIdOrder: order }
  );
  const eventIdByIdx = new Map();
  for (const event of asArray(getChapterData(bookId, chapterIndex)?.events)) {
    const idx = eventUtils.resolveEventNum(event);
    const eventId = resolveManifestEventId(event);
    if (idx > 0 && eventId && !eventIdByIdx.has(idx)) eventIdByIdx.set(idx, eventId);
  }
  return (eventIdx) => {
    // eventId 없는 이벤트는 직전 누적 상태 유지
    const eventId = eventIdByIdx.get(eventIdx);
    if (eventId) walker.advanceThrough(eventId);
    return walker.relationBetween(id1, id2);
  };
};

export const resolveChapterEventIdOrder = (bookId, chapterIndex) => {
  if (toNumberOrNull(chapterIndex) == null) return [];
  return asArray(getChapterData(bookId, chapterIndex)?.events)
    .map(resolveManifestEventId)
    .filter(Boolean);
};

const bookDeltasCache = new Map();
const bookDeltasInflight = new Map();
/** clear 시 증가 — 진행 중이던 fetch가 지운 캐시를 다시 채우지 않도록 */
const bookDeltasGeneration = new Map();

/**
 * 책 deltas 메모리/inflight 캐시 클리어.
 * @param {string|number} bookId
 */
export const clearBookRelationshipDeltas = (bookId) => {
  const key = toPositiveNumberOrNull(bookId) ?? bookId;
  bookDeltasCache.delete(key);
  bookDeltasInflight.delete(key);
  bookDeltasGeneration.set(key, (bookDeltasGeneration.get(key) ?? 0) + 1);
};

const cacheCoversThrough = (cached, throughEventId, bookId) => {
  if (!cached || !Array.isArray(cached.deltas)) return false;
  const through = toTrimmedStringOrNull(throughEventId);
  if (!through) return true;
  const cachedTo = toTrimmedStringOrNull(cached.toEventId);
  if (!cachedTo) return false;
  if (cachedTo === through) return true;
  const order = listBookManifestEventIds(bookId);
  const iCached = order.indexOf(cachedTo);
  const iThrough = order.indexOf(through);
  if (iCached >= 0 && iThrough >= 0) return iCached >= iThrough;
  return cached.deltas.some((d) => toTrimmedStringOrNull(d?.eventId) === through);
};

const cacheCoversChapter = (cached, chapterIndex, bookId) => {
  const ch = toPositiveInt(chapterIndex);
  if (!cached || ch == null) return false;
  const covered = toPositiveInt(cached.coveredThroughChapter);
  if (covered != null && covered >= ch) return true;
  const lastId = resolveManifestEventId(getLastManifestEventInChapter(bookId, ch));
  return lastId ? cacheCoversThrough(cached, lastId, bookId) : false;
};

const mergeDeltasByEventId = (baseDeltas, nextDeltas) => {
  const merged = Array.isArray(baseDeltas) ? [...baseDeltas] : [];
  const seen = new Set(merged.map((d) => toTrimmedStringOrNull(d?.eventId)).filter(Boolean));
  for (const delta of asArray(nextDeltas)) {
    if (!delta || typeof delta !== 'object') continue;
    const id = toTrimmedStringOrNull(delta.eventId);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(delta);
  }
  return merged;
};

const buildCacheEntry = (
  bookId,
  deltas,
  { toEventId = null, coveredThroughChapter = null, response = null } = {}
) => {
  const list = asArray(deltas);
  return {
    bookId,
    deltas: list,
    toEventId: toTrimmedStringOrNull(toEventId),
    coveredThroughChapter: toPositiveInt(coveredThroughChapter),
    response,
    // 실패는 fetchAndStoreByChapter에서 throw — 캐시 항목은 항상 성공
    isSuccess: true,
  };
};

/** clearBookRelationshipDeltas 이후 끝난 요청이면 결과를 버림 */
const throwIfCleared = (key, generation) => {
  if ((bookDeltasGeneration.get(key) ?? 0) !== generation) {
    throw new DOMException('Aborted', 'AbortError');
  }
};

/** 챕터 단위 조회 실패 (hard/soft fail) → throw용 Error */
const deltasFetchError = (fetched) => {
  const err = new Error(fetched.response?.message || '관계 델타 조회에 실패했습니다.');
  err.code = fetched.response?.code || 'ERROR';
  err.response = fetched.response;
  return err;
};

/**
 * 여러 챕터를 manifest eventId 범위로 1회 요청 (챕터별 N요청은 BE 커넥션 풀에서 줄 섬).
 * 성공해 캐시에 반영하면 새 항목, 범위를 못 정했거나 빈 결과·실패면 null (챕터별 폴백).
 */
const fetchChapterRangeOnce = async (key, chapters, uptoChapter, current, generation) => {
  const fromId = chapters
    .map((ch) => resolveManifestEventId(getFirstManifestEventInChapter(key, ch)))
    .find(Boolean);
  const toId = resolveManifestEventId(getLastManifestEventInChapter(key, uptoChapter));
  if (!fromId || !toId) return null;

  try {
    const fetched = await fetchRelationshipDeltasList(key, { fromEventId: fromId, toEventId: toId });
    throwIfCleared(key, generation);
    // 빈 결과는 eventId 불일치(404→soft-empty)일 수 있어 챕터별 조회로 확인
    if (fetched.isSuccess === false || fetched.deltas.length === 0) return null;
    const entry = buildCacheEntry(
      fetched.bookId ?? key,
      mergeDeltasByEventId(current?.deltas, fetched.deltas),
      { toEventId: toId, coveredThroughChapter: uptoChapter, response: fetched.response }
    );
    bookDeltasCache.set(key, entry);
    return entry;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // 범위 조회 실패(400 등) → 챕터별 조회로 폴백
    return null;
  }
};

const fetchAndStoreByChapter = async (key, uptoChapter) => {
  const generation = bookDeltasGeneration.get(key) ?? 0;
  let current = bookDeltasCache.get(key);
  if (current && cacheCoversChapter(current, uptoChapter, key)) return current;

  const covered = toPositiveInt(current?.coveredThroughChapter) ?? 0;
  const chapters = [];
  for (let ch = Math.max(1, covered + 1); ch <= uptoChapter; ch += 1) {
    if (!(current && cacheCoversChapter(current, ch, key))) chapters.push(ch);
  }

  if (chapters.length > 1) {
    const ranged = await fetchChapterRangeOnce(key, chapters, uptoChapter, current, generation);
    if (ranged) return ranged;
  }

  // 챕터 요청은 병렬로 보내고, 병합은 챕터 순서대로 (순차 요청 시 N챕터 = N 왕복 대기)
  const results = await Promise.allSettled(
    chapters.map((ch) => fetchRelationshipDeltasList(key, { chapterIndex: ch }))
  );
  // 일부만 받은 deltas를 성공으로 넘기면 discover가 관계 빠진 챕터 캐시를 저장함
  throwIfCleared(key, generation);

  chapters.forEach((ch, i) => {
    if (results[i].status === 'rejected') throw results[i].reason;
    const fetched = results[i].value;
    // hard/soft fail을 빈 성공·커버리지로 캐시하지 않음 (재시도 가능, noRelation과 구분)
    if (fetched.isSuccess === false) throw deltasFetchError(fetched);

    const chapterLastId = resolveManifestEventId(getLastManifestEventInChapter(key, ch));
    current = buildCacheEntry(
      fetched.bookId ?? key,
      mergeDeltasByEventId(current?.deltas, fetched.deltas),
      {
        toEventId: chapterLastId || current?.toEventId || null,
        coveredThroughChapter: ch,
        response: fetched.response,
      }
    );
    bookDeltasCache.set(key, current);
  });

  return current ?? buildCacheEntry(key, []);
};

/**
 * 책 deltas 확보 — chapterIndex(1..N) 챕터 단위 조회. 메모리 캐시 기록.
 * @param {string|number} bookId
 * @param {{ chapterIndex?: number|null }} [options]
 * @returns {Promise<{ bookId: *, deltas: Array, toEventId: string|null, coveredThroughChapter: number|null, response: *, isSuccess: boolean }>}
 */
export async function ensureBookRelationshipDeltas(bookId, { chapterIndex = null } = {}) {
  requireBookId(bookId);

  const key = toPositiveNumberOrNull(bookId) ?? bookId;
  const ch = toPositiveInt(chapterIndex);
  if (ch == null) {
    const error = new Error('chapterIndex가 필요합니다.');
    error.status = 400;
    throw error;
  }

  for (;;) {
    const existing = bookDeltasCache.get(key);
    if (existing && cacheCoversChapter(existing, ch, key)) {
      return existing;
    }

    const waitInflight = bookDeltasInflight.get(key);
    if (waitInflight) {
      try {
        await waitInflight;
      } catch (error) {
        // clear로 취소된 책은 다시 받지 않음. 그 외 실패는 아래에서 재시도
        if (error?.name === 'AbortError') throw error;
      }
      continue;
    }

    return awaitTracked(bookDeltasInflight, key, fetchAndStoreByChapter(key, ch));
  }
}

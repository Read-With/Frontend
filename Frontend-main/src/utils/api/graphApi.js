/** relationship-deltas API · accumulate 헬퍼 */

import {
  getManifestFromCache,
  getChapterData,
  getLastManifestEventInChapter,
} from '../common/cache/manifestCache';
import { toNumberOrNull, toTrimmedStringOrNull, asArray } from '../common/valueUtils';
import {
  authenticatedRequest,
  SOFT_FAIL_403_404,
  requireBookId,
  pickResponseResult,
  toUnifiedApiResponse,
} from './authApi';
import {
  pickCharacterDisplayName,
  rememberCharacterDisplayName,
  resolveManifestEventId,
  uniqueStrings,
  appendRelationLabelHistory,
  directedEdgeElementId,
} from '../graph/graphCore';
import { finitePositivityOrZero } from '../styles/graphStyles';

/** API/캐시 로드 결과 계약 — UI 뷰 상태(no-data 등)와 분리 */
export const FETCH_STATUS = Object.freeze({
  OK: 'ok',
  /** 요청 성공·payload 없음 (관계 없음 등). UI 'no-data'와 다름 */
  EMPTY: 'empty',
  ERROR: 'error',
});

/** characters 또는 relations가 하나라도 있으면 true */
export const hasGraphPayload = (data) => {
  if (!data || typeof data !== 'object') return false;
  return asArray(data.characters).length > 0 || asArray(data.relations).length > 0;
};

const handleApiError = (error, context) => {
  const statusMessages = {
    400: '잘못된 요청입니다',
    401: '인증이 필요합니다',
    403: '접근 권한이 없습니다',
    404: '요청한 리소스를 찾을 수 없습니다',
    500: '서버 내부 오류가 발생했습니다',
    502: '게이트웨이 오류가 발생했습니다',
    503: '서비스를 일시적으로 사용할 수 없습니다',
  };
  const statusCode = error.status || 'unknown';
  const statusMessage = statusMessages[statusCode] || 'API 요청 중 오류가 발생했습니다';
  throw new Error(
    `${context}: ${statusMessage} (${statusCode}) - ${error.message || '알 수 없는 오류'}`
  );
};

const readFiniteNumber = (value, fallback = null) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const orderIndexOf = (orderIndex, eventId) => {
  const id = toTrimmedStringOrNull(eventId);
  if (id == null || !orderIndex?.has(id)) return null;
  return orderIndex.get(id);
};

// ─── relationship-deltas: accumulate ───────────────────────────────────────

const emptyAccumulatedGraphResult = (overrides = {}) => ({
  bookId: null,
  chapterIndex: null,
  eventId: null,
  characters: [],
  relations: [],
  event: null,
  ...overrides,
});

const buildGraphEventMeta = (eventId, chapterIndex) => {
  const id = toTrimmedStringOrNull(eventId);
  if (!id) return null;
  return { eventId: id, chapterIndex, chapterIdx: chapterIndex };
};

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

const createRelationshipDeltasResponse = (isSuccess, code, message, result, status = null) => {
  const normalized = normalizeAccumulatedGraphResult(result);
  const hasPayload =
    normalized.characters.length > 0 || normalized.relations.length > 0 || Boolean(normalized.eventId);
  let resolvedStatus = status;
  if (!resolvedStatus) {
    if (!isSuccess) resolvedStatus = FETCH_STATUS.ERROR;
    else if (!hasPayload) resolvedStatus = FETCH_STATUS.EMPTY;
    else resolvedStatus = FETCH_STATUS.OK;
  }
  return {
    isSuccess,
    code,
    message,
    status: resolvedStatus,
    result: normalized,
  };
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

const applyDeltasToAccumulateState = (state, deltas) => {
  if (!state || !deltas?.length) return state;

  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue;
    state.lastDelta = delta;
    const deltaEventId = toTrimmedStringOrNull(delta.eventId);

    const weights =
      delta.nodeWeights && typeof delta.nodeWeights === 'object' ? delta.nodeWeights : {};
    for (const [rawId, meta] of Object.entries(weights)) {
      const idNum = Number(rawId);
      if (!Number.isFinite(idNum)) continue;
      state.characterIds.add(idNum);
      if (
        meta &&
        typeof meta === 'object' &&
        typeof meta.weight === 'number' &&
        Number.isFinite(meta.weight)
      ) {
        state.weightMap.set(idNum, meta.weight);
      }
    }

    for (const item of asArray(delta.items)) {
      if (!item || typeof item !== 'object') continue;
      const id1 = Number(item.fromCharacterId);
      const id2 = Number(item.toCharacterId);
      if (!Number.isFinite(id1) || !Number.isFinite(id2)) continue;

      state.characterIds.add(id1);
      state.characterIds.add(id2);
      const key = directedEdgeElementId(id1, id2);
      const prev = state.relationMap.get(key);
      const labels = asArray(item.labels);
      const evidence =
        typeof item.evidenceCount === 'number' && Number.isFinite(item.evidenceCount)
          ? item.evidenceCount
          : 1;
      const positivity = readFiniteNumber(
        item.positivity,
        finitePositivityOrZero(prev?.positivity)
      );

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
    }
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
      const w = state.weightMap.get(id);
      return {
        id,
        weight: Number.isFinite(w) && w > 0 ? w : 1,
        count: 1,
        common_name: commonName,
        name: commonName,
        names: asArray(meta?.names),
        description: typeof meta?.profileText === 'string' ? meta.profileText : '',
        profileImage: typeof meta?.profileImage === 'string' ? meta.profileImage : '',
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
  { chapterIndex = null, chapterEventIdOrder = null } = {}
) => {
  const list = asArray(sortedDeltas);
  const through = toTrimmedStringOrNull(throughEventId);
  if (!through || list.length === 0) return 0;

  const cut = list.findIndex((d) => toTrimmedStringOrNull(d.eventId) === through);
  if (cut >= 0) return cut + 1;

  const targetChapter = toNumberOrNull(chapterIndex);
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const throughPos = order.indexOf(through);
  if (targetChapter == null || throughPos < 0) return list.length;

  const allowedInChapter = new Set(order.slice(0, throughPos + 1));
  let end = 0;
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i];
    const ch = Number(d?.chapterIndex);
    const id = toTrimmedStringOrNull(d?.eventId);
    let include = false;
    if (Number.isFinite(ch) && ch < targetChapter) include = true;
    else if (Number.isFinite(ch) && ch > targetChapter) include = false;
    else if (Number.isFinite(ch) && ch === targetChapter) include = id ? allowedInChapter.has(id) : false;
    else include = id ? !order.includes(id) : false;
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
  const cutOpts = {
    chapterIndex,
    chapterEventIdOrder: normalizeEventIdOrder(chapterEventIdOrder),
  };

  const applyUpTo = (endExclusive) => {
    const end = Math.max(0, Math.min(endExclusive, deltas.length));
    if (end <= appliedEnd) return;
    applyDeltasToAccumulateState(state, deltas.slice(appliedEnd, end));
    appliedEnd = end;
  };

  const advanceThrough = (eventId) => {
    const id = toTrimmedStringOrNull(eventId);
    if (!id) return;
    applyUpTo(resolveThroughEndExclusive(deltas, id, cutOpts));
  };

  const snapshot = (eventId) =>
    finalizeAccumulateStateToGraphResult(bookId, state, { chapterIndex, eventId });

  return {
    advanceThrough,
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

// ─── relationship-deltas: HTTP ─────────────────────────────────────────────

/** Query: chapterIndex | eventId | fromEventId | toEventId (각각 optional) */
const requestRelationshipDeltas = async (
  bookId,
  { chapterIndex = null, eventId = null, fromEventId = null, toEventId = null } = {}
) => {
  const queryParams = new URLSearchParams();
  const resolvedChapter = toNumberOrNull(chapterIndex);
  if (resolvedChapter != null) queryParams.append('chapterIndex', String(resolvedChapter));
  const resolvedEventId = toTrimmedStringOrNull(eventId);
  if (resolvedEventId) queryParams.append('eventId', resolvedEventId);
  const resolvedFrom = toTrimmedStringOrNull(fromEventId);
  if (resolvedFrom) queryParams.append('fromEventId', resolvedFrom);
  const resolvedTo = toTrimmedStringOrNull(toEventId);
  if (resolvedTo) queryParams.append('toEventId', resolvedTo);

  const qs = queryParams.toString();
  const response = await authenticatedRequest(
    `/v2/books/${bookId}/relationship-deltas${qs ? `?${qs}` : ''}`,
    { softFailStatuses: SOFT_FAIL_403_404 }
  );
  return { response, result: pickResponseResult(response) };
};

/** 챕터에 델타 없음(404) — 누적 실패가 아니라 빈 커버리지 */
const isDeltasSoftEmpty = (response) => response?.code === 'NOT_FOUND';

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
  return toUnifiedApiResponse(
    createRelationshipDeltasResponse(
      !failed,
      code,
      message,
      failed ? empty : resolved,
      failed ? FETCH_STATUS.ERROR : null
    )
  );
};

const relationshipDeltasInvalidParams = (empty, message = 'chapterIndex가 필요합니다.') =>
  toUnifiedApiResponse(
    createRelationshipDeltasResponse(false, 'INVALID_PARAMS', message, empty)
  );

export const resolveChapterEventIdOrder = (bookId, chapterIndex) => {
  if (toNumberOrNull(chapterIndex) == null) return [];
  return asArray(getChapterData(bookId, chapterIndex)?.events)
    .map(resolveManifestEventId)
    .filter(Boolean);
};

/**
 * delta 원본 목록 조회.
 * chapterIndex | eventId | fromEventId | toEventId — 전달된 것만 쿼리로 보냄.
 */
export const fetchRelationshipDeltasList = async (
  bookId,
  { chapterIndex = null, eventId = null, fromEventId = null, toEventId = null } = {}
) => {
  requireBookId(bookId);

  const { response, result } = await requestRelationshipDeltas(bookId, {
    chapterIndex,
    eventId,
    fromEventId,
    toEventId,
  });

  const softEmpty = isDeltasSoftEmpty(response);
  const deltas = asArray(result?.deltas);
  return {
    // 404를 success 응답으로 정규화해 하위 캐시/로더가 실패로 오인하지 않게 함
    response: softEmpty
      ? {
          isSuccess: true,
          code: 'SUCCESS',
          message: '관계 델타가 없습니다.',
          result: result ?? { deltas: [] },
        }
      : response,
    bookId: result?.bookId ?? bookId,
    deltas,
    isSuccess: response?.isSuccess !== false || softEmpty,
  };
};

/** 매크로 그래프: 해당 챕터까지(챕터 단위) 책 전체 누적 */
export const getBookScopeRelationshipGraph = async (bookId, uptoChapter = null) => {
  requireBookId(bookId);

  const chapterIndex = toNumberOrNull(uptoChapter);
  const bookIdNum = Number(bookId) || null;
  if (chapterIndex == null) {
    return relationshipDeltasInvalidParams(
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
    const { ensureBookRelationshipDeltas } = await import(
      '../graph/graphModel'
    );
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

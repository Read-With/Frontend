/** manifest · progress · relationship-deltas API */

import {
  setManifestData,
  getManifestFromCache,
  getChapterData,
  getLastManifestEventInChapter,
  withNormalizedProgressLocators,
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  ensureProgressRowLocator,
} from '../common/cache/manifestCache';
import { normalizeReadingProgressPercent } from '../viewer/viewerEventProgressUtils';
import { progressPayloadFromData, resolveProgressLocator, locatorsEqual, toNumberOrNull, toTrimmedStringOrNull } from '../common/valueUtils';
import { getApiBaseUrl } from '../common/urlUtils';
import { getStoredAccessToken } from '../security/authTokenStorage';
import {
  authenticatedRequest,
  makeSilentError,
  isForbiddenError,
  isNotFoundError,
} from './authApi';

// ─── shared ───────────────────────────────────────────────────────────────

const SOFT_FAIL_403_404 = [403, 404];

const asArray = (value) => (Array.isArray(value) ? value : []);

const requireBookId = (bookId) => {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');
};

const hasOwnKeys = (obj) =>
  !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;

const pickResponseResult = (response) => {
  if (!response || typeof response !== 'object') return null;

  const candidates = [response.result, response.data, response.payload];
  const rich = candidates.find((c) => hasOwnKeys(c));
  if (rich) return rich;

  const scalar = candidates.find((c) => c != null);
  if (scalar != null) return scalar;

  return Array.isArray(response.deltas) ? response : null;
};

const toUnifiedApiResponse = (
  response,
  { defaultCode = 'SUCCESS', defaultMessage = '', defaultResult = null } = {}
) => {
  const safe = response && typeof response === 'object' ? response : {};
  return {
    ...safe,
    isSuccess: typeof safe.isSuccess === 'boolean' ? safe.isSuccess : true,
    code: safe.code ?? defaultCode,
    message: safe.message ?? defaultMessage,
    result: safe.result ?? defaultResult,
  };
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

const resolveManifestEventId = (ev) => toTrimmedStringOrNull(ev?.eventId ?? ev?.id);

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

const createRelationshipDeltasResponse = (isSuccess, code, message, result) => ({
  isSuccess,
  code,
  message,
  result: normalizeAccumulatedGraphResult(result),
});

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

const mergeRelationLabels = (prevLabels, nextLabels) => {
  const merged = [];
  const seen = new Set();
  for (const label of [...asArray(prevLabels), ...asArray(nextLabels)]) {
    const key = String(label ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(label);
  }
  return merged;
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
      const key = `${id1}->${id2}`;
      const prev = state.relationMap.get(key);
      const labels = asArray(item.labels);
      const evidence =
        typeof item.evidenceCount === 'number' && Number.isFinite(item.evidenceCount)
          ? item.evidenceCount
          : 1;
      const positivity = readFiniteNumber(item.positivity, prev?.positivity || 0);

      state.relationMap.set(key, {
        id1,
        id2,
        positivity,
        count: (prev?.count ?? 0) + evidence,
        relation: mergeRelationLabels(prev?.relation, labels),
        latestLabels: labels,
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
      const commonName =
        (typeof meta?.name === 'string' && meta.name) ||
        (typeof meta?.common_name === 'string' && meta.common_name) ||
        '';
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

const toGraphApiResponse = ({ response, result, empty }) => {
  const failed = !response || response.isSuccess === false;
  const code = failed ? response?.code || 'ERROR' : 'SUCCESS';
  const message = failed
    ? code === 'NOT_FOUND'
      ? '관계 델타를 찾을 수 없습니다.'
      : response?.message || '관계 델타 조회에 실패했습니다.'
    : '관계 델타를 성공적으로 조회했습니다.';
  return toUnifiedApiResponse(
    createRelationshipDeltasResponse(!failed, code, message, failed ? empty : result || empty)
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

  return {
    response,
    bookId: result?.bookId ?? bookId,
    deltas: asArray(result?.deltas),
    isSuccess: response?.isSuccess !== false,
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
      '../common/cache/chapterEventCache'
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
    if (error.status === 404) {
      return toGraphApiResponse({
        response: { isSuccess: false, code: 'NOT_FOUND' },
        result: null,
        empty,
      });
    }
    handleApiError(error, '관계 델타 조회 실패');
  }
};

// ─── progress ──────────────────────────────────────────────────────────────

const PROGRESS_FORBIDDEN = makeSilentError('FORBIDDEN', '해당 책에 접근할 권한이 없습니다');
const PROGRESS_NOT_FOUND = makeSilentError('NOT_FOUND', '진도 정보를 찾을 수 없습니다');

const handleProgressApiError = (error, logContext) => {
  if (isForbiddenError(error)) return PROGRESS_FORBIDDEN;
  if (isNotFoundError(error)) return PROGRESS_NOT_FOUND;
  if (logContext) console.error(logContext, error);
  throw error;
};

/** softFail 응답의 FORBIDDEN/NOT_FOUND → silent error (해당 없으면 null) */
const mapProgressSoftFailCode = (response, { includeNotFound = true } = {}) => {
  if (response?.code === 'FORBIDDEN') return PROGRESS_FORBIDDEN;
  if (includeNotFound && response?.code === 'NOT_FOUND') return PROGRESS_NOT_FOUND;
  return null;
};

const buildProgressSavePayload = (progressData) =>
  progressPayloadFromData(withNormalizedProgressLocators(progressData));

const mergeReadingProgressPercent = (cacheRow, progressData, serverResult, bookId) => {
  const pctFromReq = normalizeReadingProgressPercent(progressData, { bookId });
  const pctFromRes = normalizeReadingProgressPercent(serverResult ?? {}, { bookId });
  if (pctFromReq != null || pctFromRes != null) {
    cacheRow.readingProgressPercent = pctFromReq ?? pctFromRes;
  }
  return cacheRow;
};

export const saveProgress = async (progressData) => {
  try {
    const payload = buildProgressSavePayload(progressData);
    if (!payload) {
      throw new Error('bookId와 읽기 위치(startLocator/locator)는 필수입니다.');
    }
    const response = await authenticatedRequest('/v2/progress', {
      method: 'POST',
      body: JSON.stringify(payload),
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response, { includeNotFound: false });
    if (softFail) return softFail;
    if (!response?.isSuccess) {
      const error = new Error(response?.message || '독서 진도 저장 실패');
      error.status = response?.status;
      throw error;
    }
    const serverResult =
      response?.result && typeof response.result === 'object' ? response.result : null;
    const cacheRow = serverResult
      ? { ...serverResult, bookId: progressData.bookId ?? serverResult.bookId }
      : { ...progressData, ...payload };
    const bookId = progressData.bookId ?? serverResult?.bookId;
    mergeReadingProgressPercent(cacheRow, progressData, serverResult, bookId);
    setProgressToCache(cacheRow);
    return toUnifiedApiResponse(
      { ...response, result: response?.result ?? cacheRow },
      { defaultMessage: '독서 진도를 저장했습니다.' }
    );
  } catch (error) {
    if (isForbiddenError(error)) return PROGRESS_FORBIDDEN;
    console.error('독서 진도 저장 실패:', error);
    throw error;
  }
};

export const saveProgressKeepalive = (progressData) => {
  try {
    const payload = buildProgressSavePayload(progressData);
    if (!payload) return false;
    const token = getStoredAccessToken();

    fetch(`${getApiBaseUrl()}/api/v2/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => void 0);

    return true;
  } catch {
    return false;
  }
};

export const getBookProgress = async (bookId, options = {}) => {
  if (!bookId) return makeSilentError('INVALID_INPUT', 'bookId는 필수 매개변수입니다.');

  if (options?.skipCache !== true) {
    const cachedProgress = getProgressFromCache(bookId);
    if (cachedProgress) {
      return toUnifiedApiResponse({
        isSuccess: true,
        code: 'CACHE_HIT',
        message: '진도 정보를 로컬 캐시에서 가져왔습니다',
        result: cachedProgress,
        fromCache: true,
      });
    }
  }

  try {
    const response = await authenticatedRequest(`/v2/progress/${bookId}`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response);
    if (softFail) return softFail;
    if (response?.isSuccess && response.result) {
      const base = { ...response.result };
      const prev = getProgressFromCache(bookId);
      const newLoc = resolveProgressLocator(ensureProgressRowLocator(String(bookId), base));
      const prevLoc = resolveProgressLocator(prev ?? {});
      const sameLoc = newLoc && prevLoc && locatorsEqual(newLoc, prevLoc);
      const pct =
        normalizeReadingProgressPercent(base, { bookId }) ??
        (sameLoc ? normalizeReadingProgressPercent(prev ?? {}, { bookId }) : null);
      const row = pct != null ? { ...base, readingProgressPercent: pct } : base;
      setProgressToCache(row);
      const hydrated = getProgressFromCache(bookId);
      return toUnifiedApiResponse(
        { ...response, result: hydrated ?? row },
        { defaultMessage: '진도 정보를 조회했습니다.' }
      );
    }
    return toUnifiedApiResponse(response, { defaultMessage: '진도 정보를 조회했습니다.' });
  } catch (error) {
    return handleProgressApiError(error);
  }
};

export const deleteBookProgress = async (bookId) => {
  try {
    requireBookId(bookId);
    const response = await authenticatedRequest(`/v2/progress/${bookId}`, {
      method: 'DELETE',
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response);
    if (softFail) return softFail;
    if (response?.isSuccess) removeProgressFromCache(bookId);
    return toUnifiedApiResponse(response, {
      defaultMessage: '독서 진도를 삭제했습니다.',
      defaultResult: null,
    });
  } catch (error) {
    return handleProgressApiError(error, '독서 진도 삭제 실패:');
  }
};

// ─── manifest ──────────────────────────────────────────────────────────────

export const getBookManifest = async (bookId, { forceRefresh = false } = {}) => {
  const numericBookId = Number(bookId);
  if (!Number.isFinite(numericBookId) || numericBookId < 1) {
    return makeSilentError('INVALID_INPUT', 'bookId는 1 이상의 정수여야 합니다.');
  }

  try {
    if (!forceRefresh) {
      const cached = getManifestFromCache(numericBookId);
      if (cached) {
        return toUnifiedApiResponse({
          isSuccess: true,
          code: 'CACHE_HIT',
          message: 'Manifest loaded from cache',
          result: cached,
          fromCache: true,
        });
      }
    }

    const response = await authenticatedRequest(`/v2/books/${numericBookId}/manifest`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    if (response?.code === 'NOT_FOUND') {
      return makeSilentError(
        'NOT_FOUND',
        '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.'
      );
    }
    if (response?.code === 'FORBIDDEN') {
      return makeSilentError('FORBIDDEN', '접근 권한이 없습니다');
    }

    const result = pickResponseResult(response);
    if (response?.isSuccess && result) {
      const normalized = setManifestData(numericBookId, result);
      return toUnifiedApiResponse(
        { ...response, result: normalized ?? result },
        { defaultMessage: 'Manifest loaded successfully' }
      );
    }
    return toUnifiedApiResponse(response, { defaultMessage: 'Manifest loaded successfully' });
  } catch (error) {
    if (error.status === 400 || String(error?.message ?? '').includes('400')) {
      return makeSilentError('BAD_REQUEST', '잘못된 요청입니다.');
    }
    if (isNotFoundError(error)) {
      return makeSilentError(
        'NOT_FOUND',
        '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.'
      );
    }
    console.error('Manifest 조회 실패:', error);
    throw error;
  }
};

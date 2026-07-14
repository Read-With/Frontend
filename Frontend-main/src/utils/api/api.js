/** manifest·progress·relationship-graph API */

import {
  setManifestData,
  getManifestFromCache,
  getChapterData,
  findManifestEventInChapter,
  locatorFromChapterLocalOffset,
  resolveFineGraphLocatorToEventParams,
  withNormalizedProgressLocators,
} from '../common/cache/manifestCache';
import {
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  ensureProgressRowLocator,
} from '../common/cache/progressCache';
import { normalizeReadingProgressPercent } from '../viewer/viewerEventProgressUtils';
import { progressPayloadFromData, resolveProgressLocator, toLocator, locatorsEqual } from '../common/locatorUtils';
import { resolveChapterIndex } from '../common/valueUtils';
import { getApiBaseUrl } from '../common/urlUtils';
import { getStoredAccessToken } from '../security/authTokenStorage';
import {
  authenticatedRequest,
  makeSilentError,
  isForbiddenError,
  isNotFoundError,
} from './authApi';

const SOFT_FAIL_403_404 = [403, 404];

const PROGRESS_FORBIDDEN = makeSilentError('FORBIDDEN', '해당 책에 접근할 권한이 없습니다');
const PROGRESS_NOT_FOUND = makeSilentError('NOT_FOUND', '진도 정보를 찾을 수 없습니다');

const handleProgressApiError = (error, logContext) => {
  if (isForbiddenError(error)) return PROGRESS_FORBIDDEN;
  if (isNotFoundError(error)) return PROGRESS_NOT_FOUND;
  if (logContext) console.error(logContext, error);
  throw error;
};

const createApiResponse = (isSuccess, code, message, result, type = 'default') => {
  const baseResponse = { isSuccess, code, message, result };

  if (type === 'graph-book-scope') {
    const safe = result ?? {};
    baseResponse.result = {
      ...safe,
      characters: Array.isArray(safe.characters) ? safe.characters : [],
      relations: Array.isArray(safe.relations) ? safe.relations : [],
    };
    if (safe.userCurrentChapter !== undefined) {
      baseResponse.result.userCurrentChapter = safe.userCurrentChapter;
    }
    return baseResponse;
  }

  if (type === 'graph-fine') {
    baseResponse.result = normalizeRelationshipGraphResult(result);
    return baseResponse;
  }

  return baseResponse;
};

const hasOwnKeys = (obj) =>
  !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;

const pickResponseResult = (response) => {
  if (!response || typeof response !== 'object') return null;

  const resultCandidates = [response.result, response.data, response.payload];

  const richResult = resultCandidates.find((candidate) => hasOwnKeys(candidate));
  if (richResult) return richResult;

  const scalarResult = resultCandidates.find((candidate) => candidate != null);
  if (scalarResult != null) return scalarResult;

  if (
    Array.isArray(response.characters) ||
    Array.isArray(response.relations) ||
    Array.isArray(response.deltas) ||
    response.userCurrentChapter !== undefined ||
    response.event !== undefined
  ) {
    return response;
  }

  return null;
};

const toUnifiedApiResponse = (response, { defaultCode = 'SUCCESS', defaultMessage = '', defaultResult = null } = {}) => {
  const safe = response && typeof response === 'object' ? response : {};
  const isSuccess = typeof safe.isSuccess === 'boolean' ? safe.isSuccess : true;
  const code = safe.code ?? defaultCode;
  const message = safe.message ?? defaultMessage;
  const result = safe.result ?? defaultResult;
  return { ...safe, isSuccess, code, message, result };
};

const appendRelationshipGraphLocatorParams = (queryParams, locator) => {
  if (!locator) return;
  queryParams.append('chapterIndex', String(locator.chapterIndex));
  if (locator.blockIndex != null) queryParams.append('blockIndex', String(locator.blockIndex));
  if (locator.offset != null) queryParams.append('offset', String(locator.offset));
};

const emptyRelationshipGraphResult = (overrides = {}) => ({
  bookId: null,
  chapterIndex: null,
  scope: 'book',
  eventId: null,
  characters: [],
  relations: [],
  ...overrides,
});

/** relationship-graph API result — 서버 필드 유지, 배열만 정규화 */
const normalizeRelationshipGraphResult = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return emptyRelationshipGraphResult();
  }
  return {
    ...payload,
    scope: payload.scope ?? 'book',
    eventId: payload.eventId ?? null,
    characters: Array.isArray(payload.characters) ? payload.characters : [],
    relations: Array.isArray(payload.relations) ? payload.relations : [],
  };
};

/** 서버 eventId가 null이면 manifest locator 매칭으로 보강 */
const applyManifestEventIdFallback = (bookId, chapterIdx, eventIdx, result) => {
  if (!result || typeof result !== 'object') return result;
  const current = result.eventId;
  if (current != null && String(current).trim() !== '') return result;

  const manifestEvent = findManifestEventInChapter(bookId, chapterIdx, { eventIdx });
  const manifestEventId = manifestEvent?.eventId ?? manifestEvent?.id;
  if (manifestEventId == null || String(manifestEventId).trim() === '') {
    return result;
  }

  return {
    ...result,
    bookId: result.bookId ?? Number(bookId),
    chapterIndex: resolveChapterIndex(result) ?? Number(chapterIdx),
    eventId: String(manifestEventId).trim(),
  };
};

const handleApiError = (error, context) => {
  const errorMessage = error.message || '알 수 없는 오류';
  const statusCode = error.status || 'unknown';
  const statusMessages = {
    400: '잘못된 요청입니다',
    401: '인증이 필요합니다',
    403: '접근 권한이 없습니다',
    404: '요청한 리소스를 찾을 수 없습니다',
    500: '서버 내부 오류가 발생했습니다',
    502: '게이트웨이 오류가 발생했습니다',
    503: '서비스를 일시적으로 사용할 수 없습니다',
  };
  const statusMessage = statusMessages[statusCode] || 'API 요청 중 오류가 발생했습니다';
  throw new Error(`${context}: ${statusMessage} (${statusCode}) - ${errorMessage}`);
};

/** relationship-graph 공통 요청 */
const requestRelationshipGraph = async (bookId, { locator = null, chapterIndex = null } = {}) => {
  const queryParams = new URLSearchParams();
  queryParams.append('scope', 'book');
  if (locator) {
    appendRelationshipGraphLocatorParams(queryParams, locator);
  } else if (chapterIndex !== null && chapterIndex !== undefined) {
    queryParams.append('chapterIndex', String(chapterIndex));
  }

  const response = await authenticatedRequest(
    `/v2/books/${bookId}/relationship-graph?${queryParams.toString()}`,
    { softFailStatuses: SOFT_FAIL_403_404 }
  );
  return { response, result: pickResponseResult(response) };
};

const toGraphApiResponse = ({
  response,
  result,
  empty,
  type,
  successMessage,
  notFoundMessage,
  errorMessage,
}) => {
  if (!response || response.isSuccess === false) {
    const code = response?.code || 'ERROR';
    const message =
      code === 'NOT_FOUND'
        ? notFoundMessage
        : response?.message || errorMessage;
    const body = createApiResponse(false, code, message, empty, type);
    return code === 'NOT_FOUND' ? toUnifiedApiResponse(body) : body;
  }
  return toUnifiedApiResponse(
    createApiResponse(true, 'SUCCESS', successMessage, result || empty, type)
  );
};

const withLocatorsNormalizedForProgressSave = (progressData) =>
  withNormalizedProgressLocators(progressData);

export const saveProgress = async (progressData) => {
  try {
    const payload = progressPayloadFromData(withLocatorsNormalizedForProgressSave(progressData));
    if (!payload) {
      throw new Error('bookId와 읽기 위치(startLocator/locator)는 필수입니다.');
    }
    const response = await authenticatedRequest('/v2/progress', {
      method: 'POST',
      body: JSON.stringify(payload),
      softFailStatuses: SOFT_FAIL_403_404,
    });
    if (response?.code === 'FORBIDDEN') return PROGRESS_FORBIDDEN;
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
    const pctFromReq = normalizeReadingProgressPercent(progressData, { bookId });
    const pctFromRes = normalizeReadingProgressPercent(serverResult ?? {}, { bookId });
    if (pctFromReq != null || pctFromRes != null) {
      cacheRow.readingProgressPercent = pctFromReq ?? pctFromRes;
    }
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
    const payload = progressPayloadFromData(withLocatorsNormalizedForProgressSave(progressData));
    if (!payload) return false;
    const token = getStoredAccessToken();
    const requestUrl = `${getApiBaseUrl()}/api/v2/progress`;

    fetch(requestUrl, {
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
  const skipCache = options?.skipCache === true;

  if (!bookId) return makeSilentError('INVALID_INPUT', 'bookId는 필수 매개변수입니다.');

  if (!skipCache) {
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
    if (response?.code === 'FORBIDDEN') return PROGRESS_FORBIDDEN;
    if (response?.code === 'NOT_FOUND') return PROGRESS_NOT_FOUND;
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
    if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');
    const response = await authenticatedRequest(`/v2/progress/${bookId}`, {
      method: 'DELETE',
      softFailStatuses: SOFT_FAIL_403_404,
    });
    if (response?.code === 'FORBIDDEN') return PROGRESS_FORBIDDEN;
    if (response?.code === 'NOT_FOUND') return PROGRESS_NOT_FOUND;
    if (response?.isSuccess) {
      removeProgressFromCache(bookId);
    }
    return toUnifiedApiResponse(response, {
      defaultMessage: '독서 진도를 삭제했습니다.',
      defaultResult: null,
    });
  } catch (error) {
    return handleProgressApiError(error, '독서 진도 삭제 실패:');
  }
};

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

export const getBookScopeRelationshipGraph = async (bookId, uptoChapter = null, uptoLocator = null) => {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');

  const locator = toLocator(uptoLocator);
  const emptyBookGraph = { characters: [], relations: [] };

  try {
    const { response, result } = await requestRelationshipGraph(bookId, {
      locator,
      chapterIndex: locator ? null : uptoChapter,
    });
    return toGraphApiResponse({
      response,
      result,
      empty: emptyBookGraph,
      type: 'graph-book-scope',
      successMessage: '책 범위 관계 그래프 데이터를 성공적으로 조회했습니다.',
      notFoundMessage: '책 범위 관계 그래프 데이터를 찾을 수 없습니다.',
      errorMessage: '책 범위 관계 그래프 조회에 실패했습니다.',
    });
  } catch (error) {
    if (error.status === 404) {
      return toUnifiedApiResponse(
        createApiResponse(
          false,
          'NOT_FOUND',
          '책 범위 관계 그래프 데이터를 찾을 수 없습니다.',
          emptyBookGraph,
          'graph-book-scope'
        )
      );
    }
    handleApiError(error, '책 범위 관계 그래프 조회 실패');
  }
};

export const getFineGraph = async (bookId, chapterIdx, eventIdx, atLocator = null) => {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');

  const fallbackEventIdx = Math.max(1, Number(eventIdx) || 1);
  let locator = toLocator(atLocator);
  let resolvedChapter = Number(chapterIdx);
  let resolvedEventIdx = fallbackEventIdx;

  if (!locator) {
    const chapterData = getChapterData(bookId, chapterIdx);
    const manifestEvent = findManifestEventInChapter(bookId, chapterIdx, { eventIdx: fallbackEventIdx });
    const eventStartOffset = Number(manifestEvent?.startTxtOffset);
    if (chapterData) {
      if (Number.isFinite(eventStartOffset) && eventStartOffset >= 0) {
        locator = locatorFromChapterLocalOffset(chapterData, eventStartOffset);
      }
      if (!locator) {
        locator = locatorFromChapterLocalOffset(chapterData, 0);
      }
    }
  }

  if (locator) {
    const resolution = resolveFineGraphLocatorToEventParams(bookId, locator, fallbackEventIdx);
    resolvedChapter = Number(resolution.chapterIdx ?? chapterIdx);
    resolvedEventIdx = Number(resolution.eventIdx ?? fallbackEventIdx);
    locator = toLocator(resolution.atLocator) ?? locator;
  }

  const emptyFine = emptyRelationshipGraphResult();

  if (!locator) {
    return createApiResponse(
      false,
      'INVALID_LOCATOR',
      'locator(chapterIndex, blockIndex, offset)가 필요합니다.',
      emptyFine,
      'graph-fine'
    );
  }

  try {
    const { response, result: rawResult } = await requestRelationshipGraph(bookId, { locator });
    const result = applyManifestEventIdFallback(
      bookId,
      resolvedChapter,
      resolvedEventIdx,
      normalizeRelationshipGraphResult(rawResult)
    );
    return toGraphApiResponse({
      response,
      result,
      empty: emptyFine,
      type: 'graph-fine',
      successMessage: '세밀 그래프 데이터를 성공적으로 조회했습니다.',
      notFoundMessage: '해당 이벤트에 대한 데이터를 찾을 수 없습니다.',
      errorMessage: '세밀 그래프 조회에 실패했습니다.',
    });
  } catch (error) {
    if (error.status === 404) {
      return toUnifiedApiResponse(
        createApiResponse(
          false,
          'NOT_FOUND',
          '해당 이벤트에 대한 데이터를 찾을 수 없습니다.',
          emptyFine,
          'graph-fine'
        )
      );
    }
    handleApiError(error, '세밀 그래프 조회 실패');
  }
};

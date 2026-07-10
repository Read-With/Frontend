/** manifest·progress·relationship-graph API */

import {
  setManifestData,
  getManifestFromCache,
  getManifestEventData,
  getChapterData,
  locatorFromChapterLocalOffset,
  resolveFineGraphLocatorToEventParams,
  normalizeLocatorForServerProgress,
} from '../common/cache/manifestCache';
import {
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  ensureProgressRowLocator,
} from '../common/cache/progressCache';
import { normalizeReadingProgressPercent } from '../viewer/viewerEventProgressUtils';
import { progressPayloadFromData, resolveProgressLocator, toLocator } from '../common/locatorUtils';
import { getApiBaseUrl, clearAuthData, getPostLoginHomeUrl } from '../common/authUtils';
import { getStoredAccessToken } from '../security/authTokenStorage';
import {
  isTokenValid,
  refreshToken,
  ensureSessionAccessToken,
  makeSilentError,
  isForbiddenError,
  isNotFoundError,
} from './authApi';

const API_BASE_URL = getApiBaseUrl();

const RELATIONSHIP_GRAPH_PATH = '/relationship-graph';

const isRelationshipGraphApiUrl = (url) => url.includes(RELATIONSHIP_GRAPH_PATH);

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
    const safe = normalizeRelationshipGraphResult(result);
    baseResponse.result = safe;
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

  const manifestEvent = getManifestEventData(bookId, chapterIdx, eventIdx);
  const manifestEventId = manifestEvent?.eventId ?? manifestEvent?.id;
  if (manifestEventId == null || String(manifestEventId).trim() === '') {
    return result;
  }

  return {
    ...result,
    bookId: result.bookId ?? Number(bookId),
    chapterIndex: result.chapterIndex ?? Number(chapterIdx),
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

const apiRequest = async (url, options = {}, retryCount = 0) => {
  await ensureSessionAccessToken();
  const token = getStoredAccessToken();

  if (isRelationshipGraphApiUrl(url)) {
    const tokenValid = isTokenValid(token);
    if (token && !tokenValid) {
      console.error('❌ 토큰이 유효하지 않습니다. 다시 로그인해주세요.');
      clearAuthData();
      window.location.href = getPostLoginHomeUrl();
      return;
    }
  }

  const isFormData = options.body instanceof FormData;

  const defaultHeaders = {
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  const config = {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
  };

  const requestUrl = `${API_BASE_URL}${url}`;

  const silentErrorEndpoints = [
    RELATIONSHIP_GRAPH_PATH,
    '/api/v2/progress',
    '/api/v2/books/',
    '/manifest',
  ];
  const isSilentError = silentErrorEndpoints.some((endpoint) => url.includes(endpoint));

  const response = await fetch(requestUrl, config);

  if (response.status === 401 && retryCount === 0) {
    const errorText = await response.clone().text();
    console.error('❌ 401 Unauthorized 에러 (토큰 갱신 시도):', {
      url: requestUrl,
      status: response.status,
      hasToken: !!token,
      tokenValid: token ? isTokenValid(token) : false,
      errorResponse: errorText,
    });
    try {
      await refreshToken();
      return apiRequest(url, options, retryCount + 1);
    } catch (_refreshError) {
      clearAuthData();
      const authError = new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      authError.status = 401;
      throw authError;
    }
  }

  if (response.status === 401 && retryCount > 0) {
    const errorText = await response.clone().text();
    console.error('❌ 401 Unauthorized 에러 (토큰 갱신 후 재시도 실패):', {
      url: requestUrl,
      status: response.status,
      errorResponse: errorText,
    });
    clearAuthData();
    const authError = new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    authError.status = 401;
    throw authError;
  }

  if (response.status === 404 && isSilentError) return makeSilentError('NOT_FOUND', '데이터를 찾을 수 없습니다');
  if (response.status === 403 && isSilentError) return makeSilentError('FORBIDDEN', '접근 권한이 없습니다');

  let data;
  try {
    data = await response.json();
  } catch (_jsonError) {
    if (response.status === 403 && isSilentError) return makeSilentError('FORBIDDEN', '접근 권한이 없습니다');
    const error = new Error('응답을 파싱할 수 없습니다');
    error.status = response.status;
    throw error;
  }

  if (!response.ok) {
    if (isRelationshipGraphApiUrl(url)) {
      if (response.status !== 404 && response.status !== 403) {
        console.error('❌ 관계 그래프 API 에러:', {
          status: response.status,
          statusText: response.statusText,
          url: requestUrl,
          response: data,
          hasToken: !!token,
        });
      }
    }
    const error = new Error(data.message || 'API 요청 실패');
    error.status = response.status;
    throw error;
  }

  return data;
};

const withLocatorsNormalizedForProgressSave = (progressData) => {
  if (!progressData?.bookId) return progressData;
  const bookId = String(progressData.bookId);
  const locator = resolveProgressLocator(progressData);
  if (!locator) return progressData;
  const normalizedStartLocator = normalizeLocatorForServerProgress(bookId, locator);
  if (!normalizedStartLocator) return progressData;
  let normalizedEndLocator = normalizedStartLocator;
  if (progressData.endLocator != null || progressData.end != null) {
    const endLocator = toLocator(progressData.endLocator ?? progressData.end);
    if (endLocator) {
      normalizedEndLocator = normalizeLocatorForServerProgress(bookId, endLocator) ?? normalizedStartLocator;
    }
  }
  return {
    ...progressData,
    startLocator: normalizedStartLocator,
    locator: normalizedStartLocator,
    endLocator: normalizedEndLocator,
  };
};

export const saveProgress = async (progressData) => {
  try {
    const payload = progressPayloadFromData(withLocatorsNormalizedForProgressSave(progressData));
    if (!payload) {
      throw new Error('bookId와 읽기 위치(startLocator/locator)는 필수입니다.');
    }
    const response = await apiRequest('/api/v2/progress', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
    const requestUrl = `${API_BASE_URL}/api/v2/progress`;

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
    const response = await apiRequest(`/api/v2/progress/${bookId}`);
    if (response?.isSuccess && response.result) {
      const base = { ...response.result };
      const prev = getProgressFromCache(bookId);
      const newLoc = resolveProgressLocator(ensureProgressRowLocator(String(bookId), base));
      const prevLoc = resolveProgressLocator(prev ?? {});
      const sameLoc =
        newLoc && prevLoc && JSON.stringify(newLoc) === JSON.stringify(prevLoc);
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
    const response = await apiRequest(`/api/v2/progress/${bookId}`, { method: 'DELETE' });
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
    const response = await apiRequest(`/api/v2/books/${numericBookId}/manifest`);
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
  const queryParams = new URLSearchParams();
  queryParams.append('scope', 'book');
  if (locator) {
    appendRelationshipGraphLocatorParams(queryParams, locator);
  } else if (uptoChapter !== null && uptoChapter !== undefined) {
    queryParams.append('chapterIndex', String(uptoChapter));
  }

  const emptyBookGraph = { characters: [], relations: [] };

  try {
    const response = await apiRequest(
      `/api/v2/books/${bookId}/relationship-graph?${queryParams.toString()}`
    );
    const result = pickResponseResult(response);
    if (!response || response.isSuccess === false) {
      return createApiResponse(
        false,
        response?.code || 'ERROR',
        response?.message || '책 범위 관계 그래프 조회에 실패했습니다.',
        emptyBookGraph,
        'graph-book-scope'
      );
    }
    return toUnifiedApiResponse(createApiResponse(
      true,
      'SUCCESS',
      '책 범위 관계 그래프 데이터를 성공적으로 조회했습니다.',
      result || emptyBookGraph,
      'graph-book-scope'
    ));
  } catch (error) {
    if (error.status === 404) {
      return toUnifiedApiResponse(
        createApiResponse(false, 'NOT_FOUND', '책 범위 관계 그래프 데이터를 찾을 수 없습니다.', emptyBookGraph, 'graph-book-scope')
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
    const manifestEvent = getManifestEventData(bookId, chapterIdx, fallbackEventIdx);
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

  const queryParams = new URLSearchParams();
  queryParams.append('scope', 'book');
  appendRelationshipGraphLocatorParams(queryParams, locator);

  try {
    const response = await apiRequest(
      `/api/v2/books/${bookId}/relationship-graph?${queryParams.toString()}`
    );
    const raw = normalizeRelationshipGraphResult(pickResponseResult(response));
    const result = applyManifestEventIdFallback(
      bookId,
      resolvedChapter,
      resolvedEventIdx,
      raw
    );
    if (!response || response.isSuccess === false) {
      return createApiResponse(
        false,
        response?.code || 'ERROR',
        response?.message || '세밀 그래프 조회에 실패했습니다.',
        emptyFine,
        'graph-fine'
      );
    }
    return toUnifiedApiResponse(createApiResponse(
      true,
      'SUCCESS',
      '세밀 그래프 데이터를 성공적으로 조회했습니다.',
      result || emptyFine,
      'graph-fine'
    ));
  } catch (error) {
    if (error.status === 404) {
      return toUnifiedApiResponse(
        createApiResponse(false, 'NOT_FOUND', '해당 이벤트에 대한 데이터를 찾을 수 없습니다.', emptyFine, 'graph-fine')
      );
    }
    handleApiError(error, '세밀 그래프 조회 실패');
  }
};

export const debugFineGraphEventRange = async (
  bookId,
  chapterIdx,
  startEventIdx = 1,
  endEventIdx = 5
) => {
  const start = Math.max(1, Number(startEventIdx) || 1);
  const end = Math.max(start, Number(endEventIdx) || 5);
  const rows = [];

  for (let idx = start; idx <= end; idx += 1) {
    const response = await getFineGraph(bookId, chapterIdx, idx);
    const result = response?.result ?? {};
    const relations = Array.isArray(result?.relations) ? result.relations : [];
    rows.push({
      eventIdx: idx,
      isSuccess: Boolean(response?.isSuccess),
      code: response?.code ?? '',
      relationCount: relations.length,
      eventId: result?.eventId ?? null,
      chapterIndex: result?.chapterIndex ?? null,
      scope: result?.scope ?? null,
    });
  }

  console.log('[FineGraph 1~5 Server Check]', {
    bookId,
    chapterIdx,
    range: `${start}-${end}`,
    rows,
  });

  return rows;
};

/** manifest·progress·relationship-graph API */

import {
  setManifestData,
  getManifestFromCache,
  getManifestEventData,
  resolveFineGraphLocatorToEventParams,
  normalizeLocatorForServerProgress,
} from '../common/cache/manifestCache';
import {
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  normalizeReadingProgressPercent,
  ensureProgressRowLocator,
} from '../common/cache/progressCache';
import { progressPayloadFromData, resolveProgressLocator, toLocator } from '../common/locatorUtils';
import { getApiBaseUrl, clearAuthData, getPostLoginHomeUrl } from '../common/authUtils';
import { getStoredAccessToken } from '../security/authTokenStorage';
import { isTokenValid, refreshToken, ensureSessionAccessToken } from './authApi';
import { makeSilentError, isForbiddenError, isNotFoundError } from './authApi';

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

  if (type === 'graph-macro') {
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
    const safe = result ?? {};
    baseResponse.result = {
      ...safe,
      characters: Array.isArray(safe.characters) ? safe.characters : [],
      relations: Array.isArray(safe.relations) ? safe.relations : [],
      event: safe.event ?? null,
    };
    return baseResponse;
  }

  return baseResponse;
};

const hasOwnKeys = (obj) =>
  !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;

const pickResponsePayload = (response) => {
  if (!response || typeof response !== 'object') return null;

  const resultPayload = response.result;
  const dataPayload = response.data;
  const payloadPayload = response.payload;

  if (hasOwnKeys(resultPayload)) return resultPayload;
  if (hasOwnKeys(dataPayload)) return dataPayload;
  if (hasOwnKeys(payloadPayload)) return payloadPayload;

  if (resultPayload != null) return resultPayload;
  if (dataPayload != null) return dataPayload;
  if (payloadPayload != null) return payloadPayload;

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

const appendRelationshipGraphLocatorParams = (queryParams, locator) => {
  if (!locator) return;
  queryParams.append('chapterIndex', String(locator.chapterIndex));
  if (locator.blockIndex != null) queryParams.append('blockIndex', String(locator.blockIndex));
  if (locator.offset != null) queryParams.append('offset', String(locator.offset));
};

const resolveManifestEventMeta = (bookId, chapterIdx, eventIdx) => {
  const ev = getManifestEventData(bookId, chapterIdx, eventIdx);
  if (!ev) return null;
  return {
    chapterIdx,
    eventIdx: ev.idx ?? eventIdx,
    eventNum: ev.eventNum ?? ev.idx ?? eventIdx,
    eventId: ev.eventId || String(eventIdx),
    startTxtOffset: ev.startTxtOffset ?? null,
    endTxtOffset: ev.endTxtOffset ?? null,
  };
};

const enrichFineGraphPayload = (bookId, chapterIdx, eventIdx, payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  const manifestEvent = chapterIdx != null && eventIdx != null
    ? resolveManifestEventMeta(bookId, chapterIdx, eventIdx)
    : null;
  const event =
    payload.event ??
    manifestEvent ??
    (chapterIdx != null && eventIdx != null
      ? {
          chapterIdx,
          eventIdx,
          eventNum: eventIdx,
          eventId: payload.eventId ?? String(eventIdx),
        }
      : null);
  return { ...payload, event };
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
    const resResult =
      response?.result && typeof response.result === 'object' ? response.result : null;
    const cacheRow = resResult
      ? { ...resResult, bookId: progressData.bookId ?? resResult.bookId }
      : { ...progressData, ...payload };
    const pctFromReq = normalizeReadingProgressPercent(progressData);
    const pctFromRes = normalizeReadingProgressPercent(resResult ?? {});
    if (pctFromReq != null || pctFromRes != null) {
      cacheRow.readingProgressPercent = pctFromReq ?? pctFromRes;
    }
    setProgressToCache(cacheRow);
    return response;
  } catch (error) {
    if (isForbiddenError(error)) return PROGRESS_FORBIDDEN;
    console.error('독서 진도 저장 실패:', error);
    throw error;
  }
};

export const getBookProgress = async (bookId, options = {}) => {
  const skipCache = options?.skipCache === true;

  if (!bookId) return makeSilentError('INVALID_INPUT', 'bookId는 필수 매개변수입니다.');

  if (!skipCache) {
    const cachedProgress = getProgressFromCache(bookId);
    if (cachedProgress) {
      return {
        isSuccess: true,
        code: 'CACHE_HIT',
        message: '진도 정보를 로컬 캐시에서 가져왔습니다',
        result: cachedProgress,
        fromCache: true,
      };
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
        normalizeReadingProgressPercent(base) ??
        (sameLoc ? normalizeReadingProgressPercent(prev ?? {}) : null);
      const row = pct != null ? { ...base, readingProgressPercent: pct } : base;
      setProgressToCache(row);
      const hydrated = getProgressFromCache(bookId);
      return { ...response, result: hydrated ?? row };
    }
    return response;
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
    return response;
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
        return {
          isSuccess: true,
          code: 'CACHE_HIT',
          message: 'Manifest loaded from cache',
          result: cached,
          fromCache: true,
        };
      }
    }
    const response = await apiRequest(`/api/v2/books/${numericBookId}/manifest`);
    const manifestPayload = pickResponsePayload(response);
    if (response?.isSuccess && manifestPayload) {
      const normalized = setManifestData(numericBookId, manifestPayload);
      return {
        ...response,
        result: normalized ?? manifestPayload,
      };
    }
    return response;
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

export const getMacroGraph = async (bookId, uptoChapter = null, uptoLocator = null) => {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');

  const locator = toLocator(uptoLocator);
  const queryParams = new URLSearchParams();
  queryParams.append('scope', 'book');
  if (locator) {
    appendRelationshipGraphLocatorParams(queryParams, locator);
  } else if (uptoChapter !== null && uptoChapter !== undefined) {
    queryParams.append('chapterIndex', String(uptoChapter));
  }

  const emptyMacro = { characters: [], relations: [] };

  try {
    const response = await apiRequest(
      `/api/v2/books/${bookId}/relationship-graph?${queryParams.toString()}`
    );
    const payload = pickResponsePayload(response);
    if (!response || response.isSuccess === false) {
      return createApiResponse(
        false,
        response?.code || 'ERROR',
        response?.message || '거시 그래프 조회에 실패했습니다.',
        emptyMacro,
        'graph-macro'
      );
    }
    return createApiResponse(
      true,
      'SUCCESS',
      '거시 그래프 데이터를 성공적으로 조회했습니다.',
      payload || emptyMacro,
      'graph-macro'
    );
  } catch (error) {
    if (error.status === 404) {
      return createApiResponse(false, 'NOT_FOUND', '거시 그래프 데이터를 찾을 수 없습니다.', emptyMacro, 'graph-macro');
    }
    handleApiError(error, '거시 그래프 조회 실패');
  }
};

export const getFineGraph = async (bookId, chapterIdx, eventIdx, atLocator = null, fineOpts = undefined) => {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');

  let locator = fineOpts?.useCallerEventIdxOnly ? null : toLocator(atLocator);
  let fineChapterIdx = chapterIdx;
  let fineEventIdx = eventIdx;

  if (locator) {
    const resolution = resolveFineGraphLocatorToEventParams(bookId, atLocator, eventIdx);
    fineChapterIdx = resolution.chapterIdx ?? chapterIdx;
    if (resolution.resolved) {
      locator = null;
      fineEventIdx = resolution.eventIdx;
    } else if (resolution.atLocator) {
      locator = toLocator(resolution.atLocator) ?? locator;
    }
  }

  const emptyFine = { characters: [], relations: [], event: null };

  if (!locator) {
    if (
      fineChapterIdx === undefined ||
      fineChapterIdx === null ||
      fineEventIdx === undefined ||
      fineEventIdx === null
    ) {
      throw new Error('chapterIdx·eventIdx 또는 locator(chapterIndex, blockIndex, offset)는 필수입니다.');
    }
    if (fineEventIdx < 1) {
      return createApiResponse(false, 'INVALID_EVENT', '이벤트 인덱스는 1 이상이어야 합니다.', emptyFine, 'graph-fine');
    }
  }

  const queryParams = new URLSearchParams();
  queryParams.append('scope', 'book');
  if (locator) {
    appendRelationshipGraphLocatorParams(queryParams, locator);
  } else {
    queryParams.append('chapterIndex', String(fineChapterIdx));
    const manifestEvent = getManifestEventData(bookId, fineChapterIdx, fineEventIdx);
    const eventId = manifestEvent?.eventId || String(fineEventIdx);
    queryParams.append('eventId', eventId);
  }

  try {
    const response = await apiRequest(
      `/api/v2/books/${bookId}/relationship-graph?${queryParams.toString()}`
    );
    const payload = enrichFineGraphPayload(
      bookId,
      fineChapterIdx,
      fineEventIdx,
      pickResponsePayload(response)
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
    return createApiResponse(
      true,
      'SUCCESS',
      '세밀 그래프 데이터를 성공적으로 조회했습니다.',
      payload || emptyFine,
      'graph-fine'
    );
  } catch (error) {
    if (error.status === 404) {
      return createApiResponse(false, 'NOT_FOUND', '해당 이벤트에 대한 데이터를 찾을 수 없습니다.', emptyFine, 'graph-fine');
    }
    handleApiError(error, '세밀 그래프 조회 실패');
  }
};

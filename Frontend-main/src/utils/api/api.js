import { setManifestData, getManifestFromCache } from '../common/cache/manifestCache';
import {
  setAllProgress,
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  getAllProgressFromCache,
  normalizeReadingProgressPercent,
} from '../common/cache/progressCache';
import { progressPayloadFromData, resolveProgressLocator, toLocator } from '../common/locatorUtils';
import { getApiBaseUrl, clearAuthData, getPostLoginHomeUrl } from '../common/authUtils';
import { getStoredAccessToken } from '../security/authTokenStorage';
import { isTokenValid, refreshToken, ensureSessionAccessToken } from './authApi';

const API_BASE_URL = getApiBaseUrl();

// 통합된 API 응답 타입 정의
const createApiResponse = (isSuccess, code, message, result, type = 'default') => {
  const baseResponse = {
    isSuccess,
    code,
    message,
    result
  };

  // GET /api/v2/graph/macro — userCurrentChapter + characters + relations
  if (type === 'graph-macro') {
    const safe = result ?? {};
    baseResponse.result = {
      ...safe,
      userCurrentChapter: safe.userCurrentChapter ?? 0,
      characters: Array.isArray(safe.characters) ? safe.characters : [],
      relations: Array.isArray(safe.relations) ? safe.relations : [],
    };
    return baseResponse;
  }

  // GET /api/v2/graph/fine — characters + relations + event (locator 등)
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

const hasOwnKeys = (obj) => !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;

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
    response.userCurrentChapter !== undefined ||
    response.event !== undefined
  ) {
    return response;
  }

  return null;
};

// 통합된 에러 처리 함수
const handleApiError = (error, context) => {
  const errorMessage = error.message || '알 수 없는 오류';
  const statusCode = error.status || 'unknown';
  
  // HTTP 상태 코드별 에러 메시지
  const statusMessages = {
    400: '잘못된 요청입니다',
    401: '인증이 필요합니다',
    403: '접근 권한이 없습니다',
    404: '요청한 리소스를 찾을 수 없습니다',
    500: '서버 내부 오류가 발생했습니다',
    502: '게이트웨이 오류가 발생했습니다',
    503: '서비스를 일시적으로 사용할 수 없습니다'
  };
  
  const statusMessage = statusMessages[statusCode] || 'API 요청 중 오류가 발생했습니다';
  
  throw new Error(`${context}: ${statusMessage} (${statusCode}) - ${errorMessage}`);
};

// HTTP 요청 헬퍼 함수 (api.js 전용 - 다른 파일은 authApi.js의 authenticatedRequest 사용)
const apiRequest = async (url, options = {}, retryCount = 0) => {
  await ensureSessionAccessToken();
  const token = getStoredAccessToken();
  
  if (url.includes('/api/v2/graph/')) {
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
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
  
  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  const requestUrl = `${API_BASE_URL}${url}`;
  
  const silentErrorEndpoints = [
    '/api/v2/graph/',
    '/api/v2/progress',
    '/api/books/',
    '/api/v2/books/',
    '/manifest'
  ];
  const isSilentError = silentErrorEndpoints.some(endpoint => url.includes(endpoint));

  const response = await fetch(requestUrl, config);
    
    if (response.status === 401 && retryCount === 0) {
      const errorText = await response.clone().text();
      console.error('❌ 401 Unauthorized 에러 (토큰 갱신 시도):', {
        url: requestUrl,
        status: response.status,
        hasToken: !!token,
        tokenValid: token ? isTokenValid(token) : false,
        errorResponse: errorText
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
        errorResponse: errorText
      });
      clearAuthData();
      const authError = new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      authError.status = 401;
      throw authError;
    }
    
    if (response.status === 404 && isSilentError) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '데이터를 찾을 수 없습니다',
        result: null
      };
    }
    if (response.status === 403 && isSilentError) {
      return {
        isSuccess: false,
        code: 'FORBIDDEN',
        message: '접근 권한이 없습니다',
        result: null
      };
    }
    
    let data;
    try {
      data = await response.json();
    } catch (_jsonError) {
      if (response.status === 403 && isSilentError) {
        return {
          isSuccess: false,
          code: 'FORBIDDEN',
          message: '접근 권한이 없습니다',
          result: null
        };
      }
      const error = new Error('응답을 파싱할 수 없습니다');
      error.status = response.status;
      throw error;
    }
    
    if (!response.ok) {
      if (url.includes('/api/v2/graph/')) {
        const graphKind = url.includes('/macro') ? '거시' : '세밀';
        if (response.status !== 404 && response.status !== 403) {
          console.error(`❌ ${graphKind} 그래프 API 에러:`, {
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

/** GET/POST /api/v2/books 응답 DTO → UI용 favorite 필드 */
export const normalizeV2Book = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    favorite: !!(book.isFavorite ?? book.favorite),
  };
};

// 도서 목록 조회 (GET /api/v2/books)
export const getBooks = async (params = {}) => {
  const queryParams = new URLSearchParams();

  if (params.q) queryParams.append('q', params.q);
  if (params.language) queryParams.append('language', params.language);
  if (params.sort) queryParams.append('sort', params.sort);
  if (params.favorite !== undefined) queryParams.append('favorite', String(params.favorite));

  const queryString = queryParams.toString();
  const url = `/api/v2/books${queryString ? `?${queryString}` : ''}`;

  const data = await apiRequest(url);
  if (data?.isSuccess && Array.isArray(data.result)) {
    data.result = data.result.map(normalizeV2Book);
  }
  return data;
};

export const uploadBook = async (formData) => {
  await ensureSessionAccessToken();
  const token = getStoredAccessToken();
  if (!token) {
    console.error('❌ 업로드 실패: 토큰이 없습니다.');
    throw new Error('인증이 필요합니다. 로그인해주세요.');
  }

  const tokenValid = isTokenValid(token);
  if (!tokenValid) {
    console.error('❌ 업로드 실패: 토큰이 만료되었습니다.');
    clearAuthData();
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }

  const data = await apiRequest('/api/v2/books', {
    method: 'POST',
    body: formData,
  });
  if (data?.isSuccess && data.result) {
    data.result = normalizeV2Book(data.result);
  }
  return data;
};

export const getBook = async (bookId) => {
  const data = await apiRequest(`/api/v2/books/${bookId}`);
  if (data?.isSuccess && data.result) {
    data.result = normalizeV2Book(data.result);
  }
  return data;
};

export const deleteBook = async (bookId) => {
  return apiRequest(`/api/books/${bookId}`, {
    method: 'DELETE',
  });
};

export const getFavorites = async () => {
  try {
    const response = await apiRequest('/api/v2/favorites');
    if (response?.isSuccess && Array.isArray(response.result)) {
      response.result = response.result.map(normalizeV2Book);
    }
    return response;
  } catch (error) {
    console.error('즐겨찾기 목록 조회 실패:', error);
    throw error;
  }
};

export const getAllProgress = async (options = {}) => {
  const skipCache = options?.skipCache === true;
  const cachedProgress = getAllProgressFromCache();

  if (!skipCache && cachedProgress && cachedProgress.length > 0) {
    return {
      isSuccess: true,
      code: 'CACHE_HIT',
      message: '진도 정보를 로컬 캐시에서 가져왔습니다',
      result: cachedProgress,
      fromCache: true
    };
  }

  try {
    const response = await apiRequest('/api/v2/progress');

    if (response?.isSuccess && Array.isArray(response.result)) {
      setAllProgress(response.result);
    }

    return response;
  } catch (_error) {
    return {
      isSuccess: true,
      code: 'CACHE_FALLBACK',
      message: '진도 조회 실패로 로컬 캐시를 반환합니다',
      result: cachedProgress || [],
      fromCache: true
    };
  }
};

export const saveProgress = async (progressData) => {
  try {
    const payload = progressPayloadFromData(progressData);
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
    const resResult = response?.result && typeof response.result === 'object' ? response.result : null;
    const cacheRow = resResult ? { ...resResult, bookId: progressData.bookId ?? resResult.bookId } : { ...progressData, ...payload };
    const pctFromReq = normalizeReadingProgressPercent(progressData);
    const pctFromRes = normalizeReadingProgressPercent(resResult ?? {});
    if (pctFromReq != null || pctFromRes != null) {
      cacheRow.readingProgressPercent = pctFromReq ?? pctFromRes;
    }
    setProgressToCache(cacheRow);
    return response;
  } catch (error) {
    if (error.status === 403 || error.message?.includes('403') || error.message?.includes('권한')) {
      return {
        isSuccess: false,
        code: 'FORBIDDEN',
        message: '해당 책에 접근할 권한이 없습니다',
        result: null
      };
    }
    console.error('독서 진도 저장 실패:', error);
    throw error;
  }
};

export const getBookProgress = async (bookId, options = {}) => {
  const skipCache = options?.skipCache === true;

  if (!bookId) {
    return {
      isSuccess: false,
      code: 'INVALID_INPUT',
      message: 'bookId는 필수 매개변수입니다.',
      result: null
    };
  }
  
  if (!skipCache) {
    const cachedProgress = getProgressFromCache(bookId);
    if (cachedProgress) {
      return {
        isSuccess: true,
        code: 'CACHE_HIT',
        message: '진도 정보를 로컬 캐시에서 가져왔습니다',
        result: cachedProgress,
        fromCache: true
      };
    }
  }

  try {
    const response = await apiRequest(`/api/v2/progress/${bookId}`);
    if (response?.isSuccess && response.result) {
      const prev = getProgressFromCache(bookId);
      const newLoc = resolveProgressLocator(response.result);
      const prevLoc = resolveProgressLocator(prev ?? {});
      const sameLoc =
        newLoc &&
        prevLoc &&
        JSON.stringify(newLoc) === JSON.stringify(prevLoc);
      const pct =
        normalizeReadingProgressPercent(response.result) ??
        (sameLoc ? normalizeReadingProgressPercent(prev ?? {}) : null);
      const row =
        pct != null
          ? { ...response.result, readingProgressPercent: pct }
          : response.result;
      setProgressToCache(row);
    }
    return response;
  } catch (error) {
    if (error.status === 403 || error.message?.includes('403') || error.message?.includes('권한')) {
      return {
        isSuccess: false,
        code: 'FORBIDDEN',
        message: '해당 책에 접근할 권한이 없습니다',
        result: null
      };
    }
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '진도 정보를 찾을 수 없습니다',
        result: null
      };
    }
    throw error;
  }
};

export const deleteBookProgress = async (bookId) => {
  try {
    if (!bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest(`/api/v2/progress/${bookId}`, {
      method: 'DELETE',
    });
    if (response?.isSuccess) {
      removeProgressFromCache(bookId);
    }
    return response;
  } catch (error) {
    if (error.status === 403 || error.message?.includes('403') || error.message?.includes('권한')) {
      return {
        isSuccess: false,
        code: 'FORBIDDEN',
        message: '해당 책에 접근할 권한이 없습니다',
        result: null
      };
    }
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '진도 정보를 찾을 수 없습니다',
        result: null
      };
    }
    console.error('독서 진도 삭제 실패:', error);
    throw error;
  }
};

export const getBookManifest = async (bookId, { forceRefresh = false } = {}) => {
  try {
    if (!forceRefresh) {
      const cached = getManifestFromCache(bookId);
      if (cached) {
        return {
          isSuccess: true,
          code: 'CACHE_HIT',
          message: 'Manifest loaded from cache',
          result: cached,
          fromCache: true
        };
      }
    }

    const response = await apiRequest(`/api/v2/books/${bookId}/manifest`);
    const manifestPayload = pickResponsePayload(response);

    if (response?.isSuccess && manifestPayload && bookId) {
      setManifestData(bookId, manifestPayload);
    }

    return response;
  } catch (error) {
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: 'Manifest를 찾을 수 없습니다',
        result: null
      };
    }
    console.error('Manifest 조회 실패:', error);
    throw error;
  }
};

/**
 * GET /api/v2/graph/macro
 * @param uptoChapter 누적 챕터 상한 (생략 시 전체 반환)
 * @param uptoLocator { chapterIndex, blockIndex?, offset? } — 있으면 chapter 대신 전송
 */
export const getMacroGraph = async (bookId, uptoChapter = null, uptoLocator = null) => {
  if (!bookId) {
    throw new Error('bookId는 필수 매개변수입니다.');
  }

  const loc = toLocator(uptoLocator);

  const queryParams = new URLSearchParams();
  queryParams.append('bookId', bookId);
  if (loc) {
    queryParams.append('chapterIndex', String(loc.chapterIndex));
    queryParams.append('blockIndex', String(loc.blockIndex));
    queryParams.append('offset', String(loc.offset));
  } else if (uptoChapter !== null && uptoChapter !== undefined) {
    queryParams.append('uptoChapter', String(uptoChapter));
  }

  try {
    const response = await apiRequest(`/api/v2/graph/macro?${queryParams.toString()}`);
    const payload = pickResponsePayload(response);

    if (!response || !response.isSuccess) {
      return createApiResponse(false, response?.code || 'ERROR', response?.message || '거시 그래프 조회에 실패했습니다.', {
        userCurrentChapter: 0,
        characters: [],
        relations: []
      }, 'graph-macro');
    }
    
    return createApiResponse(true, 'SUCCESS', '거시 그래프 데이터를 성공적으로 조회했습니다.', payload || {
      userCurrentChapter: 0,
      characters: [],
      relations: []
    }, 'graph-macro');
  } catch (error) {
    if (error.status === 404) {
      return createApiResponse(false, 'NOT_FOUND', '거시 그래프 데이터를 찾을 수 없습니다.', {
        userCurrentChapter: 0,
        characters: [],
        relations: []
      }, 'graph-macro');
    }
    handleApiError(error, '거시 그래프 조회 실패');
  }
};

/**
 * GET /api/v2/graph/fine
 * @param atLocator { chapterIndex, blockIndex?, offset? } — 있으면 chapterIdx/eventIdx 대신 전송
 */
export const getFineGraph = async (bookId, chapterIdx, eventIdx, atLocator = null) => {
  if (!bookId) {
    throw new Error('bookId는 필수 매개변수입니다.');
  }

  const loc = toLocator(atLocator);
  if (!loc) {
    if (chapterIdx === undefined || chapterIdx === null || eventIdx === undefined || eventIdx === null) {
      throw new Error('chapterIdx·eventIdx 또는 locator(chapterIndex, blockIndex, offset)는 필수입니다.');
    }
    if (eventIdx < 1) {
      return createApiResponse(false, 'INVALID_EVENT', '이벤트 인덱스는 1 이상이어야 합니다.', {
        characters: [],
        relations: [],
        event: null
      }, 'graph-fine');
    }
  }

  const queryParams = new URLSearchParams();
  queryParams.append('bookId', bookId);
  if (loc) {
    queryParams.append('chapterIndex', String(loc.chapterIndex));
    queryParams.append('blockIndex', String(loc.blockIndex));
    queryParams.append('offset', String(loc.offset));
  } else {
    queryParams.append('chapterIdx', String(chapterIdx));
    queryParams.append('eventIdx', String(eventIdx));
  }
  
  try {
    const response = await apiRequest(`/api/v2/graph/fine?${queryParams.toString()}`);
    const payload = pickResponsePayload(response);
    
    if (!response || !response.isSuccess) {
      return createApiResponse(false, response?.code || 'ERROR', response?.message || '세밀 그래프 조회에 실패했습니다.', {
        characters: [],
        relations: [],
        event: null
      }, 'graph-fine');
    }
    
    return createApiResponse(true, 'SUCCESS', '세밀 그래프 데이터를 성공적으로 조회했습니다.', payload || {
      characters: [],
      relations: [],
      event: null
    }, 'graph-fine');
  } catch (error) {
    if (error.status === 404) {
      return createApiResponse(false, 'NOT_FOUND', '해당 이벤트에 대한 데이터를 찾을 수 없습니다.', { 
        characters: [], 
        relations: [], 
        event: null
      }, 'graph-fine');
    }
    handleApiError(error, '세밀 그래프 조회 실패');
  }
};

export default {
  normalizeV2Book,
  getBooks,
  uploadBook,
  getBook,
  deleteBook,
  getFavorites,
  getAllProgress,
  saveProgress,
  getBookProgress,
  deleteBookProgress,
  getBookManifest,
  getMacroGraph,
  getFineGraph,
};

import { setManifestData, isValidEvent, getManifestFromCache } from '../common/cache/manifestCache';
import { setAllProgress, getProgressFromCache, getAllProgressFromCache } from '../common/cache/progressCache';
import { getApiBaseUrl, clearAuthData } from '../common/authUtils';
import { isTokenValid, refreshToken } from './authApi';

const API_BASE_URL = getApiBaseUrl();

// 통합된 API 응답 타입 정의
const createApiResponse = (isSuccess, code, message, result, type = 'default') => {
  const baseResponse = {
    isSuccess,
    code,
    message,
    result
  };

  // 그래프 API 전용 응답 처리 - 모든 필드 유지
  if (type === 'graph') {
    // result 객체 전체를 유지하되, 기본값만 보장
    baseResponse.result = {
      ...result,
      userCurrentChapter: result?.userCurrentChapter ?? 0,
      characters: result?.characters ?? [],
      relations: result?.relations ?? [],
      event: result?.event ?? null
    };
  }

  return baseResponse;
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
  const token = localStorage.getItem('accessToken');
  
  if (url.includes('/api/graph/')) {
    const tokenValid = isTokenValid(token);
    
    if (token && !tokenValid) {
      console.error('❌ 토큰이 유효하지 않습니다. 다시 로그인해주세요.');
      clearAuthData();
      window.location.href = '/';
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
  
  const silent404Endpoints = [
    '/api/graph/fine',
    '/api/graph/macro',
    '/api/progress/',
    '/api/books/',
    '/manifest'
  ];
  
  const isSilent404 = silent404Endpoints.some(endpoint => url.includes(endpoint));
  const isSilent403 = silent404Endpoints.some(endpoint => url.includes(endpoint));
  
  try {
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
      } catch (refreshError) {
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
    
    if (response.status === 401) {
      const errorText = await response.clone().text();
      console.error('❌ 401 Unauthorized 에러:', {
        url: requestUrl,
        status: response.status,
        hasToken: !!token,
        tokenValid: token ? isTokenValid(token) : false,
        errorResponse: errorText
      });
    }
    
    if (response.status === 404 && isSilent404) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '데이터를 찾을 수 없습니다',
        result: null
      };
    }
    
    if (response.status === 403 && isSilent403) {
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
    } catch (jsonError) {
      if (response.status === 403 && isSilent403) {
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
      if (url.includes('/api/graph/')) {
        const isMacroGraph = url.includes('/api/graph/macro');
        const isFineGraph = url.includes('/api/graph/fine');
        
        if (response.status !== 404 && response.status !== 403) {
          console.error(`❌ ${isMacroGraph ? '거시' : isFineGraph ? '세밀' : 'Graph'} API 에러:`, {
            status: response.status,
            statusText: response.statusText,
            url: requestUrl,
            response: data,
            hasToken: !!token,
            tokenPreview: token ? token.substring(0, 20) + '...' : 'null',
            requestHeaders: config.headers
          });
        }
      }
      
      const error = new Error(data.message || 'API 요청 실패');
      error.status = response.status;
      throw error;
    }
    
    return data;
  } catch (error) {
    if (error.name === 'TypeError' || error.message.includes('Failed to fetch')) {
      throw error;
    }
    throw error;
  }
};

// 도서 목록 조회
export const getBooks = async (params = {}) => {
  const queryParams = new URLSearchParams();
  
  if (params.q) queryParams.append('q', params.q);
  if (params.language) queryParams.append('language', params.language);
  if (params.sort) queryParams.append('sort', params.sort);
  if (params.favorite !== undefined) queryParams.append('favorite', params.favorite);
  
  const queryString = queryParams.toString();
  const url = `/api/books${queryString ? `?${queryString}` : ''}`;
  
  return apiRequest(url);
};

export const uploadBook = async (formData) => {
  const token = localStorage.getItem('accessToken');
  if (!token) {
    console.error('❌ 업로드 실패: 토큰이 없습니다.');
    throw new Error('인증이 필요합니다. 로그인해주세요.');
  }
  
  const tokenValid = isTokenValid(token);
  if (!tokenValid) {
    console.error('❌ 업로드 실패: 토큰이 만료되었습니다.');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('google_user');
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }
  
  return apiRequest('/api/books', {
    method: 'POST',
    body: formData,
  });
};

export const getBook = async (bookId) => {
  return apiRequest(`/api/books/${bookId}`);
};

export const deleteBook = async (bookId) => {
  return apiRequest(`/api/books/${bookId}`, {
    method: 'DELETE',
  });
};

export const getFavorites = async () => {
  try {
    const response = await apiRequest('/api/favorites');
    return response;
  } catch (error) {
    console.error('즐겨찾기 목록 조회 실패:', error);
    throw error;
  }
};

export const getAllProgress = async () => {
  const cachedProgress = getAllProgressFromCache();
  
  return {
    isSuccess: true,
    code: 'CACHE_HIT',
    message: '진도 정보를 로컬 캐시에서 가져왔습니다',
    result: cachedProgress,
    fromCache: true
  };
};

export const saveProgress = async (progressData) => {
  try {
    if (!progressData || !progressData.bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest('/api/progress', {
      method: 'POST',
      body: JSON.stringify(progressData),
    });
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

export const getBookProgress = async (bookId) => {
  if (!bookId) {
    return {
      isSuccess: false,
      code: 'INVALID_INPUT',
      message: 'bookId는 필수 매개변수입니다.',
      result: null
    };
  }
  
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
  
  return {
    isSuccess: false,
    code: 'NOT_FOUND',
    message: '진도 정보를 찾을 수 없습니다',
    result: null
  };
};

export const deleteBookProgress = async (bookId) => {
  try {
    if (!bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest(`/api/progress/${bookId}`, {
      method: 'DELETE',
    });
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

    const response = await apiRequest(`/api/books/${bookId}/manifest`);

    if (response?.isSuccess && response?.result && bookId) {
      setManifestData(bookId, response.result);
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

export const getMacroGraph = async (bookId, uptoChapter) => {
  if (!bookId || uptoChapter === undefined || uptoChapter === null) {
    throw new Error('bookId와 uptoChapter는 필수 매개변수입니다.');
  }

  const queryParams = new URLSearchParams();
  queryParams.append('bookId', bookId);
  queryParams.append('uptoChapter', uptoChapter);
  
  try {
    const response = await apiRequest(`/api/graph/macro?${queryParams.toString()}`);
    
    if (!response || !response.isSuccess) {
      return createApiResponse(false, response?.code || 'ERROR', response?.message || '거시 그래프 조회에 실패했습니다.', {
        userCurrentChapter: 0,
        characters: [],
        relations: []
      }, 'graph');
    }
    
    return createApiResponse(true, 'SUCCESS', '거시 그래프 데이터를 성공적으로 조회했습니다.', response.result || {
      userCurrentChapter: 0,
      characters: [],
      relations: []
    }, 'graph');
  } catch (error) {
    if (error.status === 404) {
      return createApiResponse(false, 'NOT_FOUND', '거시 그래프 데이터를 찾을 수 없습니다.', {
        userCurrentChapter: 0,
        characters: [],
        relations: []
      }, 'graph');
    }
    handleApiError(error, '거시 그래프 조회 실패');
  }
};

export const getFineGraph = async (bookId, chapterIdx, eventIdx) => {
  if (!bookId || chapterIdx === undefined || chapterIdx === null || eventIdx === undefined || eventIdx === null) {
    throw new Error('bookId, chapterIdx, eventIdx는 필수 매개변수입니다.');
  }

  if (eventIdx === 0 || eventIdx < 1) {
    return createApiResponse(false, 'INVALID_EVENT', '이벤트 인덱스는 1 이상이어야 합니다.', { 
      characters: [], 
      relations: [], 
      event: null,
      userCurrentChapter: 0
    }, 'graph');
  }

  if (typeof bookId === 'number') {
    const isValid = isValidEvent(bookId, chapterIdx, eventIdx);
    if (!isValid) {
      return createApiResponse(false, 'INVALID_EVENT', '해당 이벤트에 대한 데이터가 없습니다.', { 
        characters: [], 
        relations: [], 
        event: null,
        userCurrentChapter: 0
      }, 'graph');
    }
  }

  const queryParams = new URLSearchParams();
  queryParams.append('bookId', bookId);
  queryParams.append('chapterIdx', chapterIdx);
  queryParams.append('eventIdx', eventIdx);
  
  try {
    const response = await apiRequest(`/api/graph/fine?${queryParams.toString()}`);
    
    if (!response || !response.isSuccess) {
      return createApiResponse(false, response?.code || 'ERROR', response?.message || '세밀 그래프 조회에 실패했습니다.', {
        characters: [],
        relations: [],
        event: null,
        userCurrentChapter: 0
      }, 'graph');
    }
    
    return createApiResponse(true, 'SUCCESS', '세밀 그래프 데이터를 성공적으로 조회했습니다.', response.result || {
      characters: [],
      relations: [],
      event: null,
      userCurrentChapter: 0
    }, 'graph');
  } catch (error) {
    if (error.status === 404) {
      return createApiResponse(false, 'NOT_FOUND', '해당 이벤트에 대한 데이터를 찾을 수 없습니다.', { 
        characters: [], 
        relations: [], 
        event: null,
        userCurrentChapter: 0
      }, 'graph');
    }
    handleApiError(error, '세밀 그래프 조회 실패');
  }
};

export default {
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

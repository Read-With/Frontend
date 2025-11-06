// API 기본 설정 및 도서 관련 API 함수들 (배포 서버 고정 사용)
import { setManifestData, isValidEvent } from './manifestCache';

const getApiBaseUrl = () => {
  // 로컬 개발 환경: 프록시 사용 (배포 서버로 전달)
  if (import.meta.env.DEV) {
    return ''; // 프록시를 통해 배포 서버로 요청
  }
  // 프로덕션 환경: 커스텀 도메인 사용
  return 'https://dev.readwith.store';
};

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

// JWT 토큰 유효성 검사 함수
const isTokenValid = (token) => {
  if (!token) return false;
  
  try {
    // JWT 토큰의 payload 부분 디코딩
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Math.floor(Date.now() / 1000);
    
    // 토큰 만료 시간 확인
    if (payload.exp && payload.exp < currentTime) {
      console.warn('⚠️ 토큰이 만료되었습니다:', {
        exp: payload.exp,
        currentTime,
        expired: payload.exp < currentTime
      });
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn('⚠️ 토큰 파싱 실패:', error);
    return false;
  }
};

// HTTP 요청 헬퍼 함수
const apiRequest = async (url, options = {}) => {
  // JWT 토큰 가져오기
  const token = localStorage.getItem('accessToken');
  
  // 디버깅: 토큰 상태 확인
  if (url.includes('/api/graph/')) {
    const tokenValid = isTokenValid(token);
    const isMacroGraph = url.includes('/api/graph/macro');
    const isFineGraph = url.includes('/api/graph/fine');
    
    // 토큰이 유효하지 않으면 경고 및 로그아웃 처리
    if (token && !tokenValid) {
      console.error('❌ 토큰이 유효하지 않습니다. 다시 로그인해주세요.');
      // 토큰 정리
      localStorage.removeItem('accessToken');
      localStorage.removeItem('google_user');
      // 홈으로 리다이렉트
      window.location.href = '/';
      return;
    }
  }
  
  // FormData인 경우 Content-Type을 설정하지 않음 (브라우저가 자동 설정)
  const isFormData = options.body instanceof FormData;
  
  // 기본 헤더 설정
  const defaultHeaders = {
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
  
  // options를 먼저 spread하고, headers는 나중에 merge하여 덮어쓰기 방지
  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers, // options.headers가 있으면 덮어쓰기 (명시적 설정 우선)
    },
  };

  // 환경에 따른 URL 구성
  const requestUrl = import.meta.env.DEV ? `${API_BASE_URL}${url}` : `${API_BASE_URL}${url}`;
  
  // 업로드 요청인 경우 디버깅 정보 출력
  if (url.includes('/api/books') && options.method === 'POST') {
    console.log('📤 업로드 요청 정보:', {
      url: requestUrl,
      hasToken: !!token,
      tokenPreview: token ? token.substring(0, 20) + '...' : 'null',
      isFormData: isFormData,
      headers: {
        ...config.headers,
        Authorization: config.headers.Authorization ? config.headers.Authorization.substring(0, 30) + '...' : '없음'
      },
      allHeaders: Object.keys(config.headers)
    });
  }
  
  // 404 에러를 조용히 처리할 엔드포인트 목록
  const silent404Endpoints = [
    '/api/graph/fine',
    '/api/graph/macro',
    '/api/progress/',
    '/api/books/',
    '/manifest'
  ];
  
  const isSilent404 = silent404Endpoints.some(endpoint => url.includes(endpoint));
  
  try {
    const response = await fetch(requestUrl, config);
    
    // 401 에러인 경우 상세 정보 출력
    if (response.status === 401) {
      const errorText = await response.clone().text();
      console.error('❌ 401 Unauthorized 에러:', {
        url: requestUrl,
        fullUrl: requestUrl,
        status: response.status,
        hasToken: !!token,
        tokenValid: token ? isTokenValid(token) : false,
        authorizationHeader: config.headers.Authorization ? config.headers.Authorization.substring(0, 50) + '...' : '없음',
        allHeaders: Object.keys(config.headers),
        headers: {
          ...config.headers,
          Authorization: config.headers.Authorization ? config.headers.Authorization.substring(0, 30) + '...' : '없음'
        },
        responseHeaders: Object.fromEntries(response.headers.entries()),
        errorResponse: errorText
      });
    }
    
    // 404 에러이고 조용히 처리할 엔드포인트인 경우 조용히 처리
    if (response.status === 404 && isSilent404) {
      // 조용히 처리 - 빈 응답 반환 (에러 로그 출력 안 함)
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '데이터를 찾을 수 없습니다',
        result: null
      };
    }
    
    const data = await response.json();
    
    if (!response.ok) {
      
      // 디버깅: 에러 응답 상세 로깅
      if (url.includes('/api/graph/')) {
        const isMacroGraph = url.includes('/api/graph/macro');
        const isFineGraph = url.includes('/api/graph/fine');
        
        // 404는 데이터 없음으로 정상 상황일 수 있으므로 조용히 처리
        if (response.status === 404) {
          // eventIdx=0인 경우나 데이터가 없는 경우는 정상 상황이므로 로그 출력 안 함
          // 필요시 디버그 모드에서만 활성화
          // console.debug(`⚠️ ${isMacroGraph ? '거시' : isFineGraph ? '세밀' : 'Graph'} API 데이터 없음:`, {
          //   status: response.status,
          //   message: data.message || '해당 데이터를 찾을 수 없습니다',
          //   url: requestUrl
          // });
        } else {
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
      
      // 여기 도달했다면 404가 아니거나 조용히 처리하지 않는 엔드포인트
      const error = new Error(data.message || 'API 요청 실패');
      error.status = response.status;
      throw error;
    }
    
    return data;
  } catch (error) {
    // 네트워크 에러나 기타 에러는 그대로 throw
    if (error.name === 'TypeError' || error.message.includes('Failed to fetch')) {
      throw error;
    }
    // HTTP 에러는 status 정보와 함께 throw
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

// 도서 업로드
export const uploadBook = async (formData) => {
  // 토큰 확인
  const token = localStorage.getItem('accessToken');
  if (!token) {
    console.error('❌ 업로드 실패: 토큰이 없습니다.');
    throw new Error('인증이 필요합니다. 로그인해주세요.');
  }
  
  // 토큰 유효성 확인
  const tokenValid = isTokenValid(token);
  if (!tokenValid) {
    console.error('❌ 업로드 실패: 토큰이 만료되었습니다.');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('google_user');
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }
  
  console.log('✅ 토큰 검증 통과:', {
    tokenPreview: token.substring(0, 20) + '...',
    tokenValid: true
  });
  
  return apiRequest('/api/books', {
    method: 'POST',
    headers: {
      // multipart/form-data는 브라우저가 자동으로 설정
      // Authorization 헤더는 apiRequest에서 자동 추가됨
    },
    body: formData,
  });
};

// 단일 도서 조회
export const getBook = async (bookId) => {
  return apiRequest(`/api/books/${bookId}`);
};

// 도서 즐겨찾기 토글
export const toggleBookFavorite = async (bookId, favorite) => {
  try {
    if (!bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest(`/api/books/${bookId}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite }),
    });
    return response;
  } catch (error) {
    console.error('도서 즐겨찾기 토글 실패:', error);
    throw error;
  }
};

// 도서 삭제
export const deleteBook = async (bookId) => {
  return apiRequest(`/api/books/${bookId}`, {
    method: 'DELETE',
  });
};

// 즐겨찾기 추가
export const addToFavorites = async (bookId) => {
  try {
    if (!bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest(`/api/favorites/${bookId}`, {
      method: 'POST',
    });
    return response;
  } catch (error) {
    console.error('즐겨찾기 추가 실패:', error);
    throw error;
  }
};

// 즐겨찾기 삭제
export const removeFromFavorites = async (bookId) => {
  try {
    if (!bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest(`/api/favorites/${bookId}`, {
      method: 'DELETE',
    });
    return response;
  } catch (error) {
    console.error('즐겨찾기 삭제 실패:', error);
    throw error;
  }
};

// 즐겨찾기 목록 조회
export const getFavorites = async () => {
  try {
    const response = await apiRequest('/api/favorites');
    return response;
  } catch (error) {
    console.error('즐겨찾기 목록 조회 실패:', error);
    throw error;
  }
};

// 독서 진도 관련 API
// 사용자의 모든 독서 진도 조회
export const getAllProgress = async () => {
  try {
    const response = await apiRequest('/api/progress');
    return response;
  } catch (error) {
    console.error('전체 독서 진도 조회 실패:', error);
    throw error;
  }
};

// 독서 진도 저장/업데이트
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
    console.error('독서 진도 저장 실패:', error);
    throw error;
  }
};

// 특정 책의 독서 진도 조회
export const getBookProgress = async (bookId) => {
  try {
    if (!bookId) {
      throw new Error('bookId는 필수 매개변수입니다.');
    }
    
    const response = await apiRequest(`/api/progress/${bookId}`);
    
    // 404인 경우 조용히 처리 (진도가 없는 것은 정상)
    // IndexedDB로 관리되는 EPUB는 진도가 없을 수 있음
    if (!response.isSuccess && response.code === 'NOT_FOUND') {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '진도 정보를 찾을 수 없습니다',
        result: null
      };
    }
    
    return response;
  } catch (error) {
    // 404 에러는 조용히 처리 (진도가 없는 것은 정상)
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '진도 정보를 찾을 수 없습니다',
        result: null
      };
    }
    // 404가 아닌 에러만 콘솔에 출력
    console.error('특정 책 독서 진도 조회 실패:', error);
    throw error;
  }
};

// 특정 책의 독서 진도 삭제
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
    console.error('독서 진도 삭제 실패:', error);
    throw error;
  }
};

// 책 구조 패키지 조회 (manifest)
export const getBookManifest = async (bookId) => {
  try {
    const response = await apiRequest(`/api/books/${bookId}/manifest`);
    
    // 응답이 성공하고 result가 있으면 maxChapter 저장
    if (response?.isSuccess && response?.result && bookId) {
      setManifestData(bookId, response.result);
    }
    
    return response;
  } catch (error) {
    // 404 에러는 조용히 처리 (manifest가 아직 생성되지 않았을 수 있음)
    // IndexedDB로 관리되는 EPUB는 manifest가 없을 수 있음
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: 'Manifest를 찾을 수 없습니다',
        result: null
      };
    }
    // 404가 아닌 에러만 콘솔에 출력
    console.error('Manifest 조회 실패:', error);
    throw error;
  }
};

// 북마크 관련 API
// 북마크 목록 조회
export const getBookmarks = async (bookId) => {
  return apiRequest(`/api/bookmarks?bookId=${bookId}`);
};

// 북마크 생성
export const createBookmark = async (bookmarkData) => {
  return apiRequest('/api/bookmarks', {
    method: 'POST',
    body: JSON.stringify(bookmarkData),
  });
};

// 북마크 수정
export const updateBookmark = async (bookmarkId, updateData) => {
  return apiRequest(`/api/bookmarks/${bookmarkId}`, {
    method: 'PATCH',
    body: JSON.stringify(updateData),
  });
};

// 북마크 삭제
export const deleteBookmark = async (bookmarkId) => {
  return apiRequest(`/api/bookmarks/${bookmarkId}`, {
    method: 'DELETE',
  });
};

// 그래프 관련 API
// 거시(챕터 누적) 그래프 조회
export const getMacroGraph = async (bookId, uptoChapter) => {
  if (!bookId || uptoChapter === undefined || uptoChapter === null) {
    throw new Error('bookId와 uptoChapter는 필수 매개변수입니다.');
  }

  const queryParams = new URLSearchParams();
  queryParams.append('bookId', bookId);
  queryParams.append('uptoChapter', uptoChapter);
  
  try {
    const response = await apiRequest(`/api/graph/macro?${queryParams.toString()}`);
    return createApiResponse(true, 'SUCCESS', '거시 그래프 데이터를 성공적으로 조회했습니다.', response.result, 'graph');
  } catch (error) {
    handleApiError(error, '거시 그래프 조회 실패');
  }
};

// 세밀(이벤트) 그래프 조회
export const getFineGraph = async (bookId, chapterIdx, eventIdx) => {
  if (!bookId || chapterIdx === undefined || chapterIdx === null || eventIdx === undefined || eventIdx === null) {
    throw new Error('bookId, chapterIdx, eventIdx는 필수 매개변수입니다.');
  }

  // eventIdx=0은 404 에러가 발생하므로 조용히 빈 데이터 반환
  if (eventIdx === 0 || eventIdx < 1) {
    return createApiResponse(true, 'SUCCESS', '해당 이벤트에 대한 데이터가 없습니다.', { 
      characters: [], 
      relations: [], 
      event: null,
      userCurrentChapter: 0
    }, 'graph');
  }

  // manifest 캐시에서 이벤트 유효성 검사 (API 책인 경우)
  if (typeof bookId === 'number') {
    const isValid = isValidEvent(bookId, chapterIdx, eventIdx);
    if (!isValid) {
      // 유효하지 않은 이벤트는 API 호출 없이 빈 데이터 반환
      return createApiResponse(true, 'SUCCESS', '해당 이벤트에 대한 데이터가 없습니다.', { 
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
    return createApiResponse(true, 'SUCCESS', '세밀 그래프 데이터를 성공적으로 조회했습니다.', response.result, 'graph');
  } catch (error) {
    // 404 에러는 데이터 없음으로 정상 상황 (아직 생성되지 않은 이벤트)
    if (error.status === 404) {
      // 빈 데이터 반환 (에러로 처리하지 않음)
      return createApiResponse(true, 'SUCCESS', '해당 이벤트에 대한 데이터가 없습니다.', { 
        characters: [], 
        relations: [], 
        event: null,
        userCurrentChapter: 0
      }, 'graph');
    }
    handleApiError(error, '세밀 그래프 조회 실패');
  }
};

// 챕터별 인물 시점 요약 조회는 booksApi.js에서 처리

export default {
  getBooks,
  uploadBook,
  getBook,
  toggleBookFavorite,
  deleteBook,
  addToFavorites,
  removeFromFavorites,
  getFavorites,
  getAllProgress,
  saveProgress,
  getBookProgress,
  deleteBookProgress,
  getBookManifest,
  getBookmarks,
  createBookmark,
  updateBookmark,
  deleteBookmark,
  getMacroGraph,
  getFineGraph,
};

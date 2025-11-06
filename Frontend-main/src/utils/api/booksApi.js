/**
 * 도서 관련 API 호출 유틸리티
 */

import { refreshToken } from './authApi';

// API 기본 URL 설정 (배포 서버 고정 사용)
const getApiBaseUrl = () => {
  // 로컬 개발 환경: 프록시 사용 (배포 서버로 전달)
  if (import.meta.env.DEV) {
    return ''; // 프록시를 통해 배포 서버로 요청
  }
  // 프로덕션 환경: 커스텀 도메인 사용
  return 'https://dev.readwith.store';
};

const API_BASE_URL = getApiBaseUrl();

// 인증된 API 요청 헬퍼 함수 (토큰 갱신 자동 처리 포함)
const authenticatedRequest = async (endpoint, options = {}, retryCount = 0) => {
  const token = localStorage.getItem('accessToken');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // 토큰이 있으면 Authorization 헤더 추가
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  const fullUrl = `${API_BASE_URL}/api${endpoint}`;
  
  const response = await fetch(fullUrl, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    if (response.status === 401 && retryCount === 0) {
      // 토큰 만료 시 자동으로 토큰 갱신 시도
      try {
        await refreshToken();
        
        // 갱신된 토큰으로 재시도 (최대 1번만)
        return authenticatedRequest(endpoint, options, retryCount + 1);
      } catch (refreshError) {
        // 토큰 갱신 실패 시 로그아웃 처리
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('google_user');
        throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      }
    }
    
    // 401 에러이고 재시도 횟수가 초과했거나, 다른 에러인 경우
    if (response.status === 401) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('google_user');
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }
    
    // 404는 서버 기반 응답 (서버에 해당 리소스가 없음 - 정상적인 상황)
    // 브라우저 네트워크 탭에는 나타나지만, 코드에서는 조용히 처리
    if (response.status === 404) {
      let errorMessage = '서버에서 해당 리소스를 찾을 수 없습니다. (서버 기반 응답)';
      try {
        const errorData = await response.clone().json();
        if (errorData.message) {
          errorMessage = `서버 기반 응답: ${errorData.message}`;
        }
      } catch (e) {
        // JSON 파싱 실패 시 기본 메시지 사용
      }
      // 서버 기반 404 에러 (조용히 처리, 콘솔 로그 없음)
      const notFoundError = new Error(errorMessage);
      notFoundError.status = 404;
      notFoundError.isServerBased = true; // 서버 기반 에러 표시
      throw notFoundError;
    }
    
    // 500 에러 등 상세 정보 로깅 (404 제외)
    let errorMessage = `API 요청 실패: ${response.status}`;
    const clonedResponse = response.clone();
    try {
      const errorData = await clonedResponse.json();
      console.error('🔴 API 에러 상세 (JSON):', JSON.stringify(errorData, null, 2));
      if (errorData.message) {
        errorMessage = errorData.message;
      }
      console.error('API 에러 응답:', {
        status: response.status,
        endpoint,
        message: errorData.message,
        error: errorData
      });
    } catch (e) {
      const errorText = await response.text();
      console.error('🔴 API 에러 상세 (TEXT):', errorText);
      console.error('에러 응답 상세:', {
        status: response.status,
        statusText: response.statusText,
        endpoint,
        responseText: errorText
      });
    }
    
    throw new Error(errorMessage);
  }
  
  return response.json();
};

/**
 * 도서 목록 조회
 * @param {Object} params - 검색/필터/정렬 파라미터
 * @param {string} params.q - 검색어
 * @param {string} params.language - 언어
 * @param {string} params.sort - 정렬 기준 (기본값: updatedAt)
 * @param {boolean} params.favorite - 즐겨찾기 여부
 * @returns {Promise<Object>} 도서 목록 응답
 */
export const getBooks = async (params = {}) => {
  try {
    const queryParams = new URLSearchParams();
    
    if (params.q) queryParams.append('q', params.q);
    if (params.language) queryParams.append('language', params.language);
    queryParams.append('sort', params.sort || 'updatedAt');
    if (params.favorite !== undefined) queryParams.append('favorite', params.favorite);
    
    const queryString = queryParams.toString();
    const endpoint = `/books?${queryString}`;
    
    const data = await authenticatedRequest(endpoint);
    
    const resultLength = Array.isArray(data.result) ? data.result.length : 0;
    const bookIds = Array.isArray(data.result) ? data.result.map(b => ({ 
      id: b.id, 
      title: b.title, 
      isDefault: b.default, 
      summary: b.summary,
      uploadedBy: b.uploadedBy?.id || null
    })) : [];
    
    return data;
  } catch (error) {
    console.error('도서 목록 조회 실패:', error);
    throw error;
  }
};

/**
 * 도서 업로드
 * @param {Object} bookData - 도서 데이터
 * @param {File} bookData.file - EPUB 파일
 * @param {string} bookData.title - 도서 제목
 * @param {string} bookData.author - 저자
 * @param {string} bookData.language - 언어
 * @returns {Promise<Object>} 업로드된 도서 정보
 */
export const uploadBook = async (bookData) => {
  try {
    const formData = new FormData();
    formData.append('file', bookData.file);
    formData.append('title', bookData.title);
    formData.append('author', bookData.author);
    formData.append('language', bookData.language);
    
    const token = localStorage.getItem('accessToken');
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/books`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('google_user');
        throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      }
      
      let errorMessage = `도서 업로드 실패: ${response.status}`;
      const clonedResponse = response.clone();
      try {
        const errorData = await clonedResponse.json();
        if (errorData.message) {
          errorMessage = errorData.message;
        }
        console.error('🔴 업로드 에러 상세 (JSON):', JSON.stringify(errorData, null, 2));
      } catch (e) {
        const errorText = await response.text();
        console.error('🔴 업로드 에러 상세 (TEXT):', errorText);
      }
      
      throw new Error(errorMessage);
    }
    
    return await response.json();
  } catch (error) {
    console.error('도서 업로드 실패:', error);
    throw error;
  }
};

/**
 * 단일 도서 조회
 * @param {number} bookId - 도서 ID
 * @returns {Promise<Object>} 도서 정보
 */
export const getBook = async (bookId) => {
  try {
    const data = await authenticatedRequest(`/books/${bookId}`);
    return data;
  } catch (error) {
    // 404는 서버 기반 응답 (서버에 해당 책이 없음 - 정상적인 상황)
    // 브라우저 네트워크 탭의 404는 서버 기반 응답이므로 조용히 처리
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
      // 서버 기반 응답: 서버에서 해당 책을 찾을 수 없음
      // 콘솔 로그 없이 조용히 NOT_FOUND 응답 반환
      return {
        isSuccess: false,
        code: 'NOT_FOUND',
        message: '서버에서 해당 책을 찾을 수 없습니다. (서버 기반 응답)',
        result: null,
        isServerBased: true // 서버 기반 응답 표시
      };
    }
    // 404가 아닌 에러만 로그 출력 (서버 기반 에러가 아닌 경우)
    console.error('도서 조회 실패 (서버 기반 에러 아님):', error);
    throw error;
  }
};

/**
 * 도서 즐겨찾기 토글
 * @param {number} bookId - 도서 ID
 * @param {boolean} favorite - 즐겨찾기 여부
 * @returns {Promise<Object>} 업데이트된 도서 정보
 */
export const toggleBookFavorite = async (bookId, favorite) => {
  try {
    const method = favorite ? 'POST' : 'DELETE';
    const data = await authenticatedRequest(`/favorites/${bookId}`, {
      method,
    });
    return data;
  } catch (error) {
    console.error('도서 즐겨찾기 토글 실패:', error);
    throw error;
  }
};

/**
 * 즐겨찾기 목록 조회
 * @returns {Promise<Object>} 즐겨찾기 도서 목록
 */
export const getFavorites = async () => {
  try {
    const data = await authenticatedRequest('/favorites');
    return data;
  } catch (error) {
    console.error('즐겨찾기 목록 조회 실패:', error);
    throw error;
  }
};

/**
 * 도서 삭제
 * @param {number} bookId - 도서 ID
 * @returns {Promise<Object>} 삭제 결과
 */
export const deleteBook = async (bookId) => {
  try {
    const data = await authenticatedRequest(`/books/${bookId}`, {
      method: 'DELETE',
    });
    return data;
  } catch (error) {
    console.error('도서 삭제 실패:', error);
    throw error;
  }
};

/**
 * 챕터별 인물 시점 요약 조회
 * @param {number} bookId - 도서 ID
 * @param {number} chapterIdx - 챕터 인덱스 (1-based)
 * @returns {Promise<Object>} 챕터 시점 요약 정보
 */
export const getChapterPovSummaries = async (bookId, chapterIdx) => {
  try {
    if (!bookId || !chapterIdx) {
      throw new Error('bookId와 chapterIdx는 필수 매개변수입니다.');
    }
    
    const data = await authenticatedRequest(`/books/${bookId}/chapters/${chapterIdx}/pov-summaries`);
    return data;
  } catch (error) {
    console.error('챕터 시점 요약 조회 실패:', error);
    throw error;
  }
};



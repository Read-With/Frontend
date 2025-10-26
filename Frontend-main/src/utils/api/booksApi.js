/**
 * 도서 관련 API 호출 유틸리티
 */

// API 기본 URL 설정
const getApiBaseUrl = () => {
  return 'http://localhost:8080';
};

const API_BASE_URL = getApiBaseUrl();

// 인증된 API 요청 헬퍼 함수
const authenticatedRequest = async (endpoint, options = {}) => {
  const token = localStorage.getItem('accessToken');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // 토큰이 있으면 Authorization 헤더 추가
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE_URL}/api${endpoint}`, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      // 토큰 만료 시 로그아웃 처리
      localStorage.removeItem('accessToken');
      localStorage.removeItem('google_user');
      // 즉시 리다이렉트하지 않고 에러를 throw하여 상위에서 처리하도록 함
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }
    throw new Error(`API 요청 실패: ${response.status}`);
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
    if (params.sort) queryParams.append('sort', params.sort);
    if (params.favorite !== undefined) queryParams.append('favorite', params.favorite);
    
    const queryString = queryParams.toString();
    const endpoint = queryString ? `/books?${queryString}` : '/books';
    
    const data = await authenticatedRequest(endpoint);
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
    
    const response = await fetch(`${API_BASE_URL}/api/books`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
      body: formData,
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('google_user');
        // 즉시 리다이렉트하지 않고 에러를 throw하여 상위에서 처리하도록 함
        throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      }
      throw new Error(`도서 업로드 실패: ${response.status}`);
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
    console.error('도서 조회 실패:', error);
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

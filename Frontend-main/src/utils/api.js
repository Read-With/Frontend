// API 기본 설정 및 도서 관련 API 함수들
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : 'https://dev.readwith.store');

// API 응답 타입 정의
const createApiResponse = (isSuccess, code, message, result) => ({
  isSuccess,
  code,
  message,
  result
});

// HTTP 요청 헬퍼 함수
const apiRequest = async (url, options = {}) => {
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  // 개발 환경에서는 프록시를 통해 요청
  const requestUrl = import.meta.env.DEV ? url : `${API_BASE_URL}${url}`;
  
  try {
    const response = await fetch(requestUrl, config);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'API 요청 실패');
    }
    
    return data;
  } catch (error) {
    console.error('API 요청 오류:', error);
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
  return apiRequest('/api/books', {
    method: 'POST',
    headers: {
      // multipart/form-data는 브라우저가 자동으로 설정
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
  return apiRequest(`/api/books/${bookId}/favorite`, {
    method: 'PATCH',
    body: JSON.stringify({ favorite }),
  });
};

// 도서 삭제
export const deleteBook = async (bookId) => {
  return apiRequest(`/api/books/${bookId}`, {
    method: 'DELETE',
  });
};

// 즐겨찾기 추가
export const addToFavorites = async (bookId) => {
  return apiRequest(`/api/favorites/${bookId}`, {
    method: 'POST',
  });
};

// 즐겨찾기 삭제
export const removeFromFavorites = async (bookId) => {
  return apiRequest(`/api/favorites/${bookId}`, {
    method: 'DELETE',
  });
};

// 즐겨찾기 목록 조회
export const getFavorites = async () => {
  return apiRequest('/api/favorites');
};

export default {
  getBooks,
  uploadBook,
  getBook,
  toggleBookFavorite,
  deleteBook,
  addToFavorites,
  removeFromFavorites,
  getFavorites,
};

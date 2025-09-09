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
  
  // 디버깅을 위한 로그 추가
  console.log('🌐 API 요청:', {
    url: requestUrl,
    method: config.method || 'GET',
    body: config.body,
    headers: config.headers
  });
  
  try {
    const response = await fetch(requestUrl, config);
    console.log('📡 API 응답 상태:', response.status, response.statusText);
    
    const data = await response.json();
    console.log('📄 API 응답 데이터:', data);
    
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

// 독서 진도 관련 API
// 사용자의 모든 독서 진도 조회
export const getAllProgress = async () => {
  return apiRequest('/api/progress');
};

// 독서 진도 저장/업데이트
export const saveProgress = async (progressData) => {
  return apiRequest('/api/progress', {
    method: 'POST',
    body: JSON.stringify(progressData),
  });
};

// 특정 책의 독서 진도 조회
export const getBookProgress = async (bookId) => {
  return apiRequest(`/api/progress/${bookId}`);
};

// 특정 책의 독서 진도 삭제
export const deleteBookProgress = async (bookId) => {
  return apiRequest(`/api/progress/${bookId}`, {
    method: 'DELETE',
  });
};

// 책 구조 패키지 조회 (manifest)
export const getBookManifest = async (bookId) => {
  return apiRequest(`/api/books/${bookId}/manifest`);
};

// 북마크 관련 API
// 북마크 목록 조회
export const getBookmarks = async (bookId, sort = 'time_desc') => {
  return apiRequest(`/api/bookmarks?bookId=${bookId}&sort=${sort}`);
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
};

/**
 * 북마크 관련 API 호출 유틸리티
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
  
  const response = await fetch(`${API_BASE_URL}/api${endpoint}`, {
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
    
    throw new Error(`API 요청 실패: ${response.status}`);
  }
  
  return response.json();
};

/**
 * 북마크 목록 조회
 * @param {number} bookId - 책 ID
 * @param {string} sort - 정렬 방식 (time_desc: 최신순, time_asc: 오래된순)
 * @returns {Promise<Object>} 북마크 목록 응답
 */
export const getBookmarks = async (bookId, sort = 'time_desc') => {
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('bookId', bookId);
    if (sort) {
      queryParams.append('sort', sort);
    }
    
    const data = await authenticatedRequest(`/bookmarks?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('북마크 목록 조회 실패:', error);
    throw error;
  }
};

/**
 * 북마크 생성
 * @param {Object} bookmarkData - 북마크 데이터
 * @param {number} bookmarkData.bookId - 책 ID
 * @param {string} bookmarkData.startCfi - 시작 CFI
 * @param {string} bookmarkData.endCfi - 종료 CFI (선택사항)
 * @param {string} bookmarkData.color - 색상 (기본값: #28B532)
 * @param {string} bookmarkData.memo - 메모 (선택사항)
 * @returns {Promise<Object>} 생성된 북마크 정보
 */
export const createBookmark = async (bookmarkData) => {
  try {
    // 기본 색상 설정
    const dataToSend = {
      ...bookmarkData,
      color: bookmarkData.color || '#28B532'
    };
    
    const data = await authenticatedRequest('/bookmarks', {
      method: 'POST',
      body: JSON.stringify(dataToSend),
    });
    return data;
  } catch (error) {
    console.error('북마크 생성 실패:', error);
    throw error;
  }
};

/**
 * 북마크 수정
 * @param {number} bookmarkId - 북마크 ID
 * @param {Object} updateData - 수정할 데이터
 * @param {string} updateData.color - 색상 (예: #4F1E90)
 * @param {string} updateData.memo - 메모
 * @returns {Promise<Object>} 수정된 북마크 정보
 */
export const updateBookmark = async (bookmarkId, updateData) => {
  try {
    const data = await authenticatedRequest(`/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    });
    return data;
  } catch (error) {
    console.error('북마크 수정 실패:', error);
    throw error;
  }
};

/**
 * 북마크 삭제
 * @param {number} bookmarkId - 북마크 ID
 * @returns {Promise<Object>} 삭제 결과
 */
export const deleteBookmark = async (bookmarkId) => {
  try {
    const data = await authenticatedRequest(`/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    });
    return data;
  } catch (error) {
    console.error('북마크 삭제 실패:', error);
    throw error;
  }
};

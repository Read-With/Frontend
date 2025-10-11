/**
 * 인증 관련 API 호출 유틸리티
 */

// API 기본 URL 설정
const getApiBaseUrl = () => {
  // 개발 환경에서는 로컬 백엔드 서버 사용
  return 'http://localhost:8080';
};

const API_BASE_URL = getApiBaseUrl();

// 인증된 API 요청 헬퍼 함수
export const authenticatedRequest = async (endpoint, options = {}) => {
  const token = localStorage.getItem('access_token');
  
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
      localStorage.removeItem('access_token');
      localStorage.removeItem('google_user');
      window.location.href = '/';
    }
    throw new Error(`API 요청 실패: ${response.status}`);
  }
  
  return response.json();
};

// 사용자 인증 상태 확인
export const checkAuthStatus = async () => {
  try {
    const data = await authenticatedRequest('/auth/status');
    return data;
  } catch (error) {
    console.error('인증 상태 확인 실패:', error);
    return null;
  }
};

// 로그아웃
export const logout = async () => {
  try {
    await authenticatedRequest('/auth/logout', {
      method: 'POST',
    });
  } catch (error) {
    console.error('로그아웃 API 호출 실패:', error);
  } finally {
    // API 호출 성공 여부와 관계없이 로컬 데이터 정리
    localStorage.removeItem('access_token');
    localStorage.removeItem('google_user');
  }
};

// 즐겨찾기 목록 조회
export const getFavorites = async () => {
  try {
    const data = await authenticatedRequest('/favorites');
    return data;
  } catch (error) {
    console.error('즐겨찾기 조회 실패:', error);
    return null;
  }
};

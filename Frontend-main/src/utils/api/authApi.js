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

// 구글 로그인 URL 생성
export const getGoogleAuthUrl = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/google/url`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    console.error('구글 인증 URL 생성 실패:', error);
    return null;
  }
};

// 구글 로그인 (인증 코드 전송)
export const googleLogin = async (code) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    
    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    console.error('구글 로그인 실패:', error);
    throw error;
  }
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
    localStorage.removeItem('accessToken');
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

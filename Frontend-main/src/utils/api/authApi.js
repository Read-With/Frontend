/**
 * 인증 관련 API 호출 유틸리티
 */

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
export const authenticatedRequest = async (endpoint, options = {}, retryCount = 0) => {
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

// 토큰 갱신 (다른 API 파일에서도 사용 가능)
export const refreshToken = async () => {
  try {
    const refreshTokenValue = localStorage.getItem('refreshToken');
    
    if (!refreshTokenValue) {
      throw new Error('Refresh Token이 없습니다.');
    }
    
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Refresh-Token': refreshTokenValue,
      },
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        // Refresh Token도 만료된 경우
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('google_user');
        throw new Error('Refresh Token이 만료되었습니다. 다시 로그인해주세요.');
      }
      throw new Error(`토큰 갱신 실패: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Swagger 문서에 따르면 isSuccess 사용
    if (data.isSuccess && data.result) {
      // 새 토큰 저장
      if (data.result.accessToken) {
        localStorage.setItem('accessToken', data.result.accessToken);
      }
      if (data.result.refreshToken) {
        localStorage.setItem('refreshToken', data.result.refreshToken);
      }
      
      // 사용자 정보 업데이트
      if (data.result.user) {
        const userData = {
          id: data.result.user.id.toString(),
          name: data.result.user.nickname || data.result.user.email || '사용자',
          email: data.result.user.email,
          imageUrl: data.result.user.profileImgUrl || '',
          provider: data.result.user.provider || 'GOOGLE',
        };
        localStorage.setItem('google_user', JSON.stringify(userData));
      }
      
      return data.result;
    }
    
    throw new Error(data.message || '토큰 갱신 실패');
  } catch (error) {
    console.error('토큰 갱신 실패:', error);
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

// 사용자 정보 조회
export const getCurrentUser = async () => {
  try {
    const data = await authenticatedRequest('/auth/me');
    return data;
  } catch (error) {
    console.error('사용자 정보 조회 실패:', error);
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

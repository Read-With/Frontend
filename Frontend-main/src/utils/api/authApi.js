import { getApiBaseUrl, clearAuthData } from '../common/authUtils';

const API_BASE_URL = getApiBaseUrl();

export const isTokenValid = (token) => {
  if (!token) return false;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Math.floor(Date.now() / 1000);
    
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

// 토큰 만료까지 남은 시간 확인 (초 단위)
export const getTokenExpirationTime = (token) => {
  if (!token) return null;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp) {
      const currentTime = Math.floor(Date.now() / 1000);
      return payload.exp - currentTime;
    }
    return null;
  } catch (error) {
    return null;
  }
};

// 토큰이 곧 만료될 예정인지 확인 (기본 5분 전)
export const isTokenExpiringSoon = (token, bufferSeconds = 5 * 60) => {
  const remainingTime = getTokenExpirationTime(token);
  if (remainingTime === null) return false;
  return remainingTime < bufferSeconds;
};

export const authenticatedRequest = async (endpoint, options = {}, retryCount = 0) => {
  let token = localStorage.getItem('accessToken');
  
  // 토큰이 곧 만료될 예정이면 미리 갱신 (15분 전)
  if (token && isTokenExpiringSoon(token, 15 * 60)) {
    try {
      await refreshToken();
      token = localStorage.getItem('accessToken');
    } catch (error) {
      console.warn('토큰 자동 갱신 실패:', error);
    }
  }
  
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
      try {
        await refreshToken();
        return authenticatedRequest(endpoint, options, retryCount + 1);
      } catch (refreshError) {
        clearAuthData();
        const error = new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
        error.status = 401;
        throw error;
      }
    }
    
    if (response.status === 401) {
      clearAuthData();
      const error = new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      error.status = 401;
      throw error;
    }
    
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      const error = new Error('응답을 파싱할 수 없습니다');
      error.status = response.status;
      throw error;
    }
    
    const error = new Error(data.message || `API 요청 실패: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  
  return response.json();
};

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
        clearAuthData();
        throw new Error('Refresh Token이 만료되었습니다. 다시 로그인해주세요.');
      }
      throw new Error(`토큰 갱신 실패: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.isSuccess && data.result) {
      if (data.result.accessToken) {
        localStorage.setItem('accessToken', data.result.accessToken);
      }
      if (data.result.refreshToken) {
        localStorage.setItem('refreshToken', data.result.refreshToken);
      }
      
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

export const checkAuthStatus = async () => {
  try {
    const data = await authenticatedRequest('/auth/status');
    return data;
  } catch (error) {
    console.error('인증 상태 확인 실패:', error);
    return null;
  }
};

export const getCurrentUser = async () => {
  try {
    const data = await authenticatedRequest('/auth/me');
    return data;
  } catch (error) {
    console.error('사용자 정보 조회 실패:', error);
    return null;
  }
};

export const logout = async () => {
  try {
    await authenticatedRequest('/auth/logout', {
      method: 'POST',
    });
  } catch (error) {
    console.error('로그아웃 API 호출 실패:', error);
  } finally {
    clearAuthData();
  }
};

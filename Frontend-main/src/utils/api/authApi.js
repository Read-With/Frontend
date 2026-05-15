import { getApiBaseUrl, clearAuthData } from '../common/authUtils';
import {
  getStoredAccessToken,
  setStoredAccessToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
  setStoredGoogleUserJson,
} from '../security/authTokenStorage';

const API_BASE_URL = getApiBaseUrl();

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(pad);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export const isTokenValid = (token) => {
  if (!token) return false;

  const payload = decodeJwtPayload(token);
  if (!payload) {
    console.warn('⚠️ 토큰 파싱 실패');
    return false;
  }

  const currentTime = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < currentTime) {
    console.warn('⚠️ 토큰이 만료되었습니다:', {
      exp: payload.exp,
      currentTime,
      expired: payload.exp < currentTime,
    });
    return false;
  }

  return true;
};

export const getTokenExpirationTime = (token) => {
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (payload?.exp) {
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp - currentTime;
  }
  return null;
};

// 토큰이 곧 만료될 예정인지 확인 (기본 5분 전)
export const isTokenExpiringSoon = (token, bufferSeconds = 5 * 60) => {
  const remainingTime = getTokenExpirationTime(token);
  if (remainingTime === null) return false;
  return remainingTime < bufferSeconds;
};

const MAX_REFRESH_BUFFER_SEC = 15 * 60;
const MIN_REFRESH_BUFFER_SEC = 60;

/** 액세스 JWT TTL에 맞춘 사전 갱신 여유(초). 짧은 TTL에서 주기적 폴링이 빗나가지 않게 최소 60초는 둔다. */
export function getProactiveRefreshBufferSeconds(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return MAX_REFRESH_BUFFER_SEC;
  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;
  if (remaining <= 0) return MIN_REFRESH_BUFFER_SEC;
  const issued = typeof payload.iat === 'number' ? payload.iat : null;
  const ttlForBuffer =
    issued != null ? Math.max(1, payload.exp - issued) : Math.max(remaining, 1);
  const fromTtl = Math.floor(ttlForBuffer * 0.22);
  return Math.min(MAX_REFRESH_BUFFER_SEC, Math.max(MIN_REFRESH_BUFFER_SEC, fromTtl));
}

export const authenticatedRequest = async (endpoint, options = {}, retryCount = 0) => {
  await ensureSessionAccessToken();
  let token = getStoredAccessToken();
  
  if (token && isTokenExpiringSoon(token, getProactiveRefreshBufferSeconds(token))) {
    try {
      await refreshToken();
      token = getStoredAccessToken();
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
      } catch (_refreshError) {
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
    } catch (_jsonError) {
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
    const refreshTokenValue = getStoredRefreshToken();
    
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
      credentials: 'include',
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
        setStoredAccessToken(data.result.accessToken);
      }
      if (data.result.refreshToken) {
        setStoredRefreshToken(data.result.refreshToken);
      }
      
      if (data.result.user) {
        const userData = {
          id: data.result.user.id.toString(),
          name: data.result.user.nickname || data.result.user.email || '사용자',
          email: data.result.user.email,
          imageUrl: data.result.user.profileImgUrl || '',
          provider: data.result.user.provider || 'GOOGLE',
        };
        setStoredGoogleUserJson(JSON.stringify(userData));
      }
      
      return data.result;
    }
    
    throw new Error(data.message || '토큰 갱신 실패');
  } catch (error) {
    console.error('토큰 갱신 실패:', error);
    throw error;
  }
};

let sessionBootstrapPromise = null;

/** 페이지 로드 직후 메모리에 액세스 토큰이 없을 때, 리프레시 토큰으로 한 번 채운다. */
export async function ensureSessionAccessToken() {
  const existing = getStoredAccessToken();
  if (existing && isTokenValid(existing)) return;
  if (existing && !isTokenValid(existing)) {
    setStoredAccessToken(null);
  }
  if (!getStoredRefreshToken()) return;
  if (!sessionBootstrapPromise) {
    sessionBootstrapPromise = (async () => {
      try {
        await refreshToken();
      } catch {
        /* refreshToken이 실패 시 clearAuth 등 처리 */
      }
    })().finally(() => {
      sessionBootstrapPromise = null;
    });
  }
  await sessionBootstrapPromise;
}

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

/** 인증: 토큰 저장소·JWT 검사·토큰 갱신·세션 부트스트랩. HTTP 클라이언트는 ./client */

import { getApiBaseUrl } from '../common/urlUtils';
import { errorUtils } from '../common/valueUtils';
import { readRaw, writeRaw, removeKeys } from '../common/cache/cacheManager';

/* ─── 토큰 저장소 ─── */

/**
 * 액세스 토큰: 메모리 + sessionStorage (같은 탭에서 새로고침 시 복원). localStorage에는 두지 않음.
 * 리프레시 토큰: localStorage (멀티 탭·재방문). 완전한 XSS 방어는 httpOnly·Secure 쿠키 세션이 필요하다.
 */

export const AUTH_CLEARED_EVENT = 'readwith:auth-cleared';

const KEY_ACCESS = 'accessToken';
const KEY_SESSION_ACCESS = 'readwith_session_access';
const KEY_REFRESH = 'refreshToken';
const KEY_GOOGLE_USER = 'google_user';

let memoryAccessToken = null;

export function getStoredAccessToken() {
  if (memoryAccessToken) return memoryAccessToken;
  const fromSs = readRaw(KEY_SESSION_ACCESS, 'sessionStorage');
  if (fromSs) {
    memoryAccessToken = fromSs;
    return fromSs;
  }
  return null;
}

export function setStoredAccessToken(token) {
  if (token == null || token === '') {
    memoryAccessToken = null;
    removeKeys('localStorage', KEY_ACCESS);
    removeKeys('sessionStorage', KEY_SESSION_ACCESS);
    return;
  }
  memoryAccessToken = token;
  removeKeys('localStorage', KEY_ACCESS);
  writeRaw(KEY_SESSION_ACCESS, token, 'sessionStorage');
}

export function getStoredRefreshToken() {
  return readRaw(KEY_REFRESH);
}

export function setStoredRefreshToken(token) {
  writeRaw(KEY_REFRESH, token);
}

export function getStoredGoogleUserJson() {
  return readRaw(KEY_GOOGLE_USER);
}

export function setStoredGoogleUserJson(jsonString) {
  writeRaw(KEY_GOOGLE_USER, jsonString);
}

export function removeStoredGoogleUser() {
  removeKeys('localStorage', KEY_GOOGLE_USER);
}

/** 로그아웃/세션 초기화: 토큰·사용자 삭제 후 AUTH_CLEARED_EVENT 발행 (사용자별 캐시는 이 이벤트를 구독해 정리) */
export function clearAuthData() {
  memoryAccessToken = null;
  const lsCleared = removeKeys('localStorage', KEY_ACCESS, KEY_REFRESH, KEY_GOOGLE_USER);
  const ssCleared = removeKeys('sessionStorage', KEY_SESSION_ACCESS);
  if (!lsCleared || !ssCleared) {
    errorUtils.logWarning('authApi', '스토리지 접근 실패 — 토큰 삭제 불완전', { lsCleared, ssCleared });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
  }
}

const JSON_ACCEPT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

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
    errorUtils.logInfo('isTokenValid', '토큰 파싱 실패');
    return false;
  }

  const currentTime = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < currentTime) {
    errorUtils.logInfo('isTokenValid', '토큰이 만료되었습니다', {
      exp: payload.exp,
      currentTime,
    });
    return false;
  }

  return true;
};

const getTokenExpirationTime = (token) => {
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (payload?.exp) {
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp - currentTime;
  }
  return null;
};

/** 만료 bufferSeconds 전이면 true (기본 5분) */
export const isTokenExpiringSoon = (token, bufferSeconds = 5 * 60) => {
  const remainingTime = getTokenExpirationTime(token);
  if (remainingTime === null) return false;
  return remainingTime < bufferSeconds;
};

const MAX_REFRESH_BUFFER_SEC = 15 * 60;
const MIN_REFRESH_BUFFER_SEC = 60;

/** 액세스 JWT TTL 기반 사전 갱신 여유(초, 최소 60) */
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

const requestTokenRefresh = async ({ silent = false } = {}) => {
  try {
    const refreshTokenValue = getStoredRefreshToken();

    if (!refreshTokenValue) {
      throw new Error('Refresh Token이 없습니다.');
    }

    const response = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        ...JSON_ACCEPT_HEADERS,
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
    if (!silent) {
      errorUtils.logError('refreshToken', error);
    }
    throw error;
  }
};

let refreshInflight = null;

/**
 * 동시 호출은 진행 중인 갱신 하나를 공유 (refresh token rotation 시 두 번째 요청이 옛 토큰으로 401 → 로그아웃 되는 것 방지).
 * 이미 진행 중이면 먼저 호출한 쪽의 silent 옵션을 따른다
 */
export const refreshToken = (options = {}) => {
  refreshInflight ??= requestTokenRefresh(options).finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
};

/** 액세스 토큰 없을 때 리프레시로 세션 부트스트랩 (동시 호출은 refreshToken이 하나로 합침) */
export async function ensureSessionAccessToken() {
  const existing = getStoredAccessToken();
  if (existing && isTokenValid(existing)) return;
  if (existing) setStoredAccessToken(null);
  if (!getStoredRefreshToken()) return;
  try {
    await refreshToken({ silent: true });
  } catch {
    /* refresh 실패 시 refreshToken 내부에서 clearAuth 처리 */
  }
}

// AdminPage가 authApi에서 import — AdminPage는 수정하지 않으므로 re-export 유지 (client ↔ authApi 순환은 함수 참조뿐이라 런타임 안전)
export { authenticatedRequest } from './client';

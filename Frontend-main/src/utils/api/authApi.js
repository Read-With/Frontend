/** 인증·토큰 갱신·authenticatedFetch */

import { getApiBaseUrl } from '../common/urlUtils';
import {
  getStoredAccessToken,
  setStoredAccessToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
  setStoredGoogleUserJson,
  clearAuthData,
} from '../security/authTokenStorage';

export const makeSilentError = (code, message) => ({
  isSuccess: false,
  code,
  message,
  result: null,
});

export const isForbiddenError = (error) =>
  error?.status === 403 ||
  String(error?.message ?? '').includes('403') ||
  String(error?.message ?? '').includes('권한');

export const isNotFoundError = (error) =>
  error?.status === 404 ||
  String(error?.message ?? '').includes('404') ||
  String(error?.message ?? '').includes('찾을 수 없습니다');

export const SOFT_FAIL_403_404 = [403, 404];

export const requireBookId = (bookId) => {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');
};

const hasOwnKeys = (obj) =>
  !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;

export const pickResponseResult = (response) => {
  if (!response || typeof response !== 'object') return null;

  const candidates = [response.result, response.data, response.payload];
  const rich = candidates.find((c) => hasOwnKeys(c));
  if (rich) return rich;

  const scalar = candidates.find((c) => c != null);
  if (scalar != null) return scalar;

  return Array.isArray(response.deltas) ? response : null;
};

export const toUnifiedApiResponse = (
  response,
  { defaultCode = 'SUCCESS', defaultMessage = '', defaultResult = null } = {}
) => {
  const safe = response && typeof response === 'object' ? response : {};
  return {
    ...safe,
    isSuccess: typeof safe.isSuccess === 'boolean' ? safe.isSuccess : true,
    code: safe.code ?? defaultCode,
    message: safe.message ?? defaultMessage,
    result: safe.result ?? defaultResult,
  };
};

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

const createAuthExpiredError = () => {
  const error = new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  error.status = 401;
  return error;
};

async function refreshAccessTokenIfExpiringSoon() {
  let token = getStoredAccessToken();
  if (!token || !isTokenExpiringSoon(token, getProactiveRefreshBufferSeconds(token))) {
    return token;
  }
  try {
    await refreshToken();
    token = getStoredAccessToken();
  } catch (error) {
    console.warn('토큰 자동 갱신 실패:', error);
  }
  return token;
}

async function authorizedFetch(url, options = {}, retryCount = 0) {
  await ensureSessionAccessToken();
  const token = await refreshAccessTokenIfExpiringSoon();

  const isFormData = options.body instanceof FormData;
  const headers = {
    Accept: options.acceptHeader ?? 'application/json',
    ...(!isFormData && options.skipJsonContentType !== true && { 'Content-Type': 'application/json' }),
    ...options.headers,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { acceptHeader: _a, skipJsonContentType: _s, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...fetchOptions.headers,
    },
  });

  if (response.status === 401 && retryCount === 0) {
    try {
      await refreshToken();
      return authorizedFetch(url, options, retryCount + 1);
    } catch {
      clearAuthData();
      throw createAuthExpiredError();
    }
  }

  return response;
}

const API_REQUEST_MAX_ATTEMPTS = 3;
const API_REQUEST_RETRY_BASE_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkFetchError = (error) => {
  if (!error || error.status === 401) return false;
  if (error.name === 'TypeError') return true;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(
    String(error.message || '')
  );
};

/** 일시적 API 실패 — 403/404는 softFail, 401은 토큰 갱신 경로로 둔다 */
const isRetryableApiStatus = (status, method = 'GET') => {
  if (status === 408 || status === 429) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  const m = String(method || 'GET').toUpperCase();
  // 500은 GET만 (쓰기 중복 방지)
  if (status === 500 && (m === 'GET' || m === 'HEAD')) return true;
  return false;
};

const toHttpError = async (response) => {
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error('응답을 파싱할 수 없습니다');
    error.status = response.status;
    return error;
  }
  const error = new Error(data.message || `API 요청 실패: ${response.status}`);
  error.status = response.status;
  return error;
};

const softFailFromStatus = (status) => {
  if (status === 404) return makeSilentError('NOT_FOUND', '데이터를 찾을 수 없습니다');
  if (status === 403) return makeSilentError('FORBIDDEN', '접근 권한이 없습니다');
  return makeSilentError('ERROR', `API 요청 실패: ${status}`);
};

/**
 * @param {string} endpoint `/v2/...` 형태 (`/api` prefix는 내부에서 붙임)
 * @param {object} [options]
 * @param {number[]} [options.softFailStatuses] throw 대신 makeSilentError를 반환할 HTTP 상태
 * @param {number} [options.maxAttempts] 일시 실패 재시도 횟수 (기본 3)
 * @param {boolean} [options.retry] false면 재시도 안 함
 */
export const authenticatedRequest = async (endpoint, options = {}) => {
  const {
    softFailStatuses = [],
    maxAttempts = API_REQUEST_MAX_ATTEMPTS,
    retry = true,
    ...requestOptions
  } = options;
  const isFormData = requestOptions.body instanceof FormData;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const attempts = retry === false ? 1 : Math.max(1, Number(maxAttempts) || API_REQUEST_MAX_ATTEMPTS);
  const url = `${getApiBaseUrl()}/api${endpoint}`;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await authorizedFetch(url, {
        ...requestOptions,
        skipJsonContentType: isFormData,
        acceptHeader: 'application/json',
      });
    } catch (error) {
      if (error?.status === 401) throw error;
      lastError = error;
      if (!isNetworkFetchError(error) || attempt >= attempts) throw error;
      await sleep(API_REQUEST_RETRY_BASE_MS * attempt);
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    if (response.status === 401) {
      clearAuthData();
      throw createAuthExpiredError();
    }

    if (softFailStatuses.includes(response.status)) {
      return softFailFromStatus(response.status);
    }

    if (isRetryableApiStatus(response.status, method) && attempt < attempts) {
      await sleep(API_REQUEST_RETRY_BASE_MS * attempt);
      continue;
    }

    throw await toHttpError(response);
  }

  throw lastError || new Error('API 요청 실패');
};

export const refreshToken = async (options = {}) => {
  const { silent = false } = options;
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
      console.error('토큰 갱신 실패:', error);
    }
    throw error;
  }
};

/** JWT를 붙여 임의 URL(/public 자산 등) fetch */
export async function authenticatedFetch(url, options = {}) {
  return authorizedFetch(url, {
    ...options,
    skipJsonContentType: true,
    acceptHeader: 'application/json, text/html, application/xhtml+xml, */*',
  });
}

let sessionBootstrapPromise = null;

/** 액세스 토큰 없을 때 리프레시로 세션 부트스트랩 */
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
        await refreshToken({ silent: true });
      } catch {
        /* refresh 실패 시 refreshToken 내부에서 clearAuth 처리 */
      }
    })().finally(() => {
      sessionBootstrapPromise = null;
    });
  }
  await sessionBootstrapPromise;
}

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

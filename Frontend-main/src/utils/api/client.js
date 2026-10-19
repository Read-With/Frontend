/** HTTP 클라이언트: 인증 헤더·401 재시도·일시 실패 재시도(authenticatedRequest/Fetch)·logout + 공통 응답 헬퍼 */

import { getApiBaseUrl } from '../common/urlUtils';
import { errorUtils, sleep } from '../common/valueUtils';
import {
  clearAuthData,
  ensureSessionAccessToken,
  getProactiveRefreshBufferSeconds,
  getStoredAccessToken,
  isTokenExpiringSoon,
  refreshToken,
} from './authApi';

/* ─── 응답 헬퍼 ─── */

export const makeSilentError = (code, message) => ({
  isSuccess: false,
  code,
  message,
  result: null,
});

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

/**
 * softFailStatuses 응답(FORBIDDEN/NOT_FOUND) 정규화.
 * @param {'empty'|'error'} [options.mode]
 *   - empty: 목록·조회 미생성 → isSuccess true + emptyResult (softEmpty)
 *   - error: silent fail (isSuccess false)
 * @returns {object|null} 해당 코드가 아니면 null
 */
export const mapSoftFailResponse = (
  response,
  {
    mode = 'error',
    emptyResult = null,
    includeNotFound = true,
    forbiddenMessage = '접근 권한이 없습니다',
    notFoundMessage = '데이터를 찾을 수 없습니다',
  } = {}
) => {
  const code = response?.code;
  if (code !== 'FORBIDDEN' && !(includeNotFound && code === 'NOT_FOUND')) {
    return null;
  }
  const message = code === 'FORBIDDEN' ? forbiddenMessage : notFoundMessage;
  if (mode === 'empty') {
    return toUnifiedApiResponse({
      isSuccess: true,
      code,
      message,
      result: emptyResult,
      softEmpty: true,
    });
  }
  return makeSilentError(code, message);
};

/* ─── 요청 ─── */

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
    errorUtils.logWarning('ensureValidAccessToken', '토큰 자동 갱신 실패', {
      message: error?.message,
    });
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
 * @param {boolean} [options.retry] false면 재시도 안 함
 * @param {boolean} [options.silent] true면 hard-fail 시 authenticatedRequest 자체 로그 생략
 */
export const authenticatedRequest = async (endpoint, options = {}) => {
  const {
    softFailStatuses = [],
    retry = true,
    silent = false,
    ...requestOptions
  } = options;
  const isFormData = requestOptions.body instanceof FormData;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const attempts = retry === false ? 1 : API_REQUEST_MAX_ATTEMPTS;
  const url = `${getApiBaseUrl()}/api${endpoint}`;

  const logHardFail = (error, extra = {}) => {
    if (silent) return;
    if (error?.status === 401 || error?.statusCode === 401) return;
    errorUtils.logError('authenticatedRequest', error, {
      endpoint,
      method,
      ...extra,
    });
  };

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
      if (!errorUtils.isNetworkError(error) || attempt >= attempts) {
        logHardFail(error, { attempt, kind: 'network' });
        throw error;
      }
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

    const httpError = await toHttpError(response);
    logHardFail(httpError, { attempt, status: response.status, kind: 'http' });
    throw httpError;
  }

  const exhausted = new Error('API 요청 실패');
  logHardFail(exhausted, { kind: 'exhausted' });
  throw exhausted;
};

/** JWT를 붙여 임의 URL(/public 자산 등) fetch */
export async function authenticatedFetch(url, options = {}) {
  return authorizedFetch(url, {
    ...options,
    skipJsonContentType: true,
    acceptHeader: 'application/json, text/html, application/xhtml+xml, */*',
  });
}

export const logout = async () => {
  try {
    await authenticatedRequest('/auth/logout', {
      method: 'POST',
    });
  } catch (error) {
    errorUtils.logWarning('logout', '로그아웃 API 호출 실패', {
      message: error?.message,
    });
  } finally {
    clearAuthData();
  }
};

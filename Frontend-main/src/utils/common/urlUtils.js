/** 환경 URL·OAuth·공개 자산 URL 정규화·fetch */

import { clearAuthData } from '../security/authTokenStorage';
import { createAndStoreGoogleOAuthState, secureLog } from '../security/oauthSecurity';
import { trimTrailingSlash } from './valueUtils';

export const DEFAULT_API_BASE_URL = 'https://readwith-be.onrender.com';
export const DEFAULT_CDN_BASE_URL = 'https://cdn.readwith.cloud';
const DEFAULT_APP_ORIGIN = 'https://readwith-frontend.vercel.app';
export const DEFAULT_DEV_PROXY_TARGET =
  'http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com';

const CDN_PUBLIC_HOST = (() => {
  try {
    return new URL(DEFAULT_CDN_BASE_URL).host;
  } catch {
    return 'cdn.readwith.cloud';
  }
})();

const envString = (key) => {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

export const getApiBaseUrl = () => {
  if (import.meta.env.DEV) {
    return '';
  }
  const fromEnv = envString('VITE_API_BASE_URL');
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }
  return DEFAULT_API_BASE_URL;
};

export const getGoogleOAuthRedirectUri = () => {
  const basePath = import.meta.env.BASE_URL || '/';
  const buildCallbackUri = (origin) => {
    const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
    const path = `${prefix}auth/callback`.replace(/\/{2,}/g, '/');
    return `${trimTrailingSlash(origin)}${path}`;
  };

  if (typeof window !== 'undefined' && window.location?.origin) {
    return buildCallbackUri(window.location.origin);
  }

  const explicit = envString('VITE_GOOGLE_REDIRECT_URI');
  if (explicit) {
    return explicit;
  }

  const appOrigin = envString('VITE_APP_ORIGIN');
  if (appOrigin) {
    return buildCallbackUri(appOrigin);
  }

  return buildCallbackUri(DEFAULT_APP_ORIGIN);
};

export const getPostLoginHomeUrl = () => {
  const raw = envString('VITE_POST_LOGIN_HOME_URL');
  if (raw) {
    return raw.endsWith('/') ? raw : `${raw}/`;
  }
  const app = envString('VITE_APP_ORIGIN');
  if (app) {
    return `${trimTrailingSlash(app)}/`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/`;
  }
  return '/';
};

export const getDevBackendHintUrl = () => {
  const u = envString('VITE_DEV_PROXY_TARGET');
  if (u) {
    try {
      return new URL(u).origin;
    } catch {
      /* fall through */
    }
  }
  try {
    return new URL(DEFAULT_DEV_PROXY_TARGET).origin;
  } catch {
    return DEFAULT_DEV_PROXY_TARGET;
  }
};

export { clearAuthData };

export const isOAuthCallbackRoute = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path.endsWith('/auth/callback');
};

const INVALID_GOOGLE_CLIENT_IDS = new Set([
  'CLIENT_ID',
  'your_google_client_id_here',
  'your-google-client-id',
]);

function isGoogleClientIdConfigured() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return Boolean(clientId && !INVALID_GOOGLE_CLIENT_IDS.has(clientId));
}

export function buildGoogleOAuthAuthUrl() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const redirectUri = getGoogleOAuthRedirectUri();
  const oauthState = createAndStoreGoogleOAuthState();

  // 백엔드가 token 교환에 code_verifier를 넘기기 전까지 PKCE 미사용
  return (
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=email profile&` +
    `access_type=offline&` +
    `prompt=select_account&` +
    `state=${encodeURIComponent(oauthState)}`
  );
}

export function startGoogleOAuthLogin() {
  if (!isGoogleClientIdConfigured()) {
    return {
      ok: false,
      error:
        'Google OAuth 설정이 올바르지 않습니다. .env 파일에 VITE_GOOGLE_CLIENT_ID를 설정해주세요.',
    };
  }

  secureLog('Google OAuth 로그인 시작', {
    clientId: `${import.meta.env.VITE_GOOGLE_CLIENT_ID.substring(0, 10)}...`,
    redirectUri: getGoogleOAuthRedirectUri(),
  });

  try {
    window.location.href = buildGoogleOAuthAuthUrl();
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Google OAuth를 시작할 수 없습니다.',
    };
  }
  return { ok: true };
}

export function buildGoogleRedirectUriMismatchMessage(isLocalDev = import.meta.env.DEV) {
  const actualRedirectUri = getGoogleOAuthRedirectUri();

  if (isLocalDev) {
    return `리다이렉트 URI 불일치 오류 (로컬 개발 환경)

프론트엔드 redirectUri: ${actualRedirectUri}

1. Google Cloud Console의 승인된 리디렉션 URI에 위 주소를 등록하세요.
2. 백엔드가 POST /api/auth/google 요청 본문의 redirectUri를 사용하는지 확인하세요.
3. 백엔드 GOOGLE_REDIRECT_URI가 프론트엔드와 동일한지 확인하세요.`;
  }

  return `리다이렉트 URI 불일치 오류 (redirect_uri_mismatch)

프론트엔드 redirectUri: ${actualRedirectUri}

1. Google Cloud Console의 승인된 리디렉션 URI에 위 주소를 등록하세요.
2. 배포 서버 GOOGLE_REDIRECT_URI 환경 변수가 위 주소와 정확히 일치하는지 확인하세요.
3. URL 끝 슬래시, http/https, 포트 번호까지 일치해야 합니다.`;
}

function stripWrongApiPublicPrefix(url) {
  if (url == null) return '';
  return String(url).replace(/\/api\/public\//g, '/public/');
}

export function isProtectedPublicAsset(url) {
  if (url == null) return false;
  const s = String(url).trim();
  if (!s) return false;
  if (s.startsWith('/public/')) return true;
  return /readwith\.cloud\/public\//i.test(s);
}

function extractBookIdFromPublicAssetUrl(url) {
  const s = sanitizeAssetUrl(url);
  if (!s) return null;
  const match = s.match(/\/books\/(\d+)\//);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isPublicCoverAssetPath(url) {
  const s = sanitizeAssetUrl(url);
  return !!s && /\/covers\//.test(s);
}

function rewriteLegacyAssetUrl(url) {
  if (url == null) return '';
  const s = stripWrongApiPublicPrefix(String(url).trim());
  if (!s) return '';
  try {
    const parsed = new URL(s.startsWith('//') ? `https:${s}` : s);
    return s.startsWith('//') ? parsed.href : s;
  } catch {
    return s;
  }
}

function getPublicAssetOrigin() {
  const fromEnv = import.meta.env.VITE_CDN_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return trimTrailingSlash(fromEnv.trim());
  }
  const apiBase = trimTrailingSlash(getApiBaseUrl());
  if (apiBase) return apiBase;
  return DEFAULT_CDN_BASE_URL;
}

export function sanitizeAssetUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  if (!s) return '';
  return rewriteLegacyAssetUrl(s);
}

function preferDevPublicProxyPath(url) {
  if (!import.meta.env.DEV || url == null) return url;
  const s = String(url).trim();
  if (!s) return s;
  if (s.startsWith('/public/')) return s;
  try {
    const parsed = new URL(s.startsWith('//') ? `https:${s}` : s);
    if (!parsed.pathname.startsWith('/public/')) return s;
    const assetOrigin = new URL(getPublicAssetOrigin()).origin;
    if (parsed.origin === assetOrigin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    /* URL 파싱 불가 */
  }
  return s;
}

function routeProtectedPublicAssetForSameOriginProxy(url) {
  if (import.meta.env.DEV || url == null) return url;
  const s = String(url).trim();
  if (!s || !isProtectedPublicAsset(s)) return url;

  try {
    const parsed = new URL(s.startsWith('/') ? `https://${CDN_PUBLIC_HOST}${s}` : s);
    const resource = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!resource.startsWith('/public/')) return url;
    if (s.startsWith('/public/')) return resource;
    if (parsed.hostname.toLowerCase() === CDN_PUBLIC_HOST) return resource;
  } catch {
    return url;
  }
  return url;
}

export function resolveAssetFetchUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  if (!s) return '';
  return routeProtectedPublicAssetForSameOriginProxy(preferDevPublicProxyPath(sanitizeAssetUrl(s)));
}

export function resolveApiArtifactUrl(path) {
  if (path == null) return '';
  const s = String(path).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('//')) {
    return resolveAssetFetchUrl(s);
  }
  const base = trimTrailingSlash(getApiBaseUrl());
  if (s.startsWith('/')) {
    if (s.startsWith('/public/')) {
      return resolveAssetFetchUrl(s);
    }
    if (base) return resolveAssetFetchUrl(`${base}${s}`);
    return resolveAssetFetchUrl(s);
  }
  if (base) {
    return resolveAssetFetchUrl(`${base}/${s}`);
  }
  return resolveAssetFetchUrl(`/${s}`);
}

const blobUrlCache = new Map();
const inFlightRequests = new Map();
const failedFetchUrls = new Map();
const FAILED_FETCH_TTL_MS = 60_000;

const isFailedRecently = (fetchUrl) => {
  const failedAt = failedFetchUrls.get(fetchUrl);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILED_FETCH_TTL_MS) {
    failedFetchUrls.delete(fetchUrl);
    return false;
  }
  return true;
};

const markFetchFailed = (fetchUrl) => {
  failedFetchUrls.set(fetchUrl, Date.now());
};

const clearFetchFailed = (fetchUrl) => {
  if (fetchUrl) failedFetchUrls.delete(fetchUrl);
};

const buildCoverRefreshSource = (sanitized) => {
  if (!isPublicCoverAssetPath(sanitized)) return null;
  const bookId = extractBookIdFromPublicAssetUrl(sanitized);
  if (!bookId) return null;
  return async () => {
    const { getBook } = await import('../api/booksApi');
    const res = await getBook(bookId);
    return res?.isSuccess ? res.result?.coverImgUrl : null;
  };
};

const fetchProtectedBlobUrl = async (sourceUrl) => {
  const sanitized = sanitizeAssetUrl(sourceUrl);
  if (!sanitized) return null;

  if (!isProtectedPublicAsset(sanitized)) {
    return sanitized;
  }

  const fetchUrl = resolveApiArtifactUrl(sanitized);
  if (!fetchUrl) return null;

  if (blobUrlCache.has(fetchUrl)) {
    return blobUrlCache.get(fetchUrl);
  }

  if (isFailedRecently(fetchUrl)) {
    return null;
  }

  if (inFlightRequests.has(fetchUrl)) {
    return inFlightRequests.get(fetchUrl);
  }

  const request = (async () => {
    try {
      const { authenticatedFetch } = await import('../api/authApi');
      const res = await authenticatedFetch(fetchUrl);
      if (!res.ok) {
        if (res.status === 404) {
          markFetchFailed(fetchUrl);
        }
        return null;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(fetchUrl, blobUrl);
      clearFetchFailed(fetchUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      inFlightRequests.delete(fetchUrl);
    }
  })();

  inFlightRequests.set(fetchUrl, request);
  return request;
};

export async function fetchAuthenticatedAssetBlobUrl(sourceUrl, options = {}) {
  const sanitized = sanitizeAssetUrl(sourceUrl);
  if (!sanitized) return null;

  const result = await fetchProtectedBlobUrl(sourceUrl);
  if (result) return result;

  const refreshSource = options.refreshSource ?? buildCoverRefreshSource(sanitized);
  if (typeof refreshSource !== 'function') {
    return null;
  }

  try {
    const refreshed = await refreshSource();
    if (typeof refreshed !== 'string' || !refreshed.trim()) {
      return null;
    }

    const prevFetchUrl = resolveApiArtifactUrl(sanitized);
    const nextSanitized = sanitizeAssetUrl(refreshed);
    const nextFetchUrl = resolveApiArtifactUrl(nextSanitized);
    clearFetchFailed(prevFetchUrl);
    if (nextFetchUrl !== prevFetchUrl) {
      clearFetchFailed(nextFetchUrl);
    }

    if (nextSanitized === sanitized) {
      return fetchProtectedBlobUrl(sourceUrl);
    }
    return fetchProtectedBlobUrl(refreshed);
  } catch {
    return null;
  }
}

export async function resolveGraphElementsProfileImages(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return elements;

  return Promise.all(
    elements.map(async (el) => {
      const image = el?.data?.image;
      if (!image || !isProtectedPublicAsset(image)) return el;
      const blobUrl = await fetchAuthenticatedAssetBlobUrl(image);
      if (!blobUrl) return el;
      return { ...el, data: { ...el.data, image: blobUrl } };
    })
  );
}

const OAUTH_AUTH_ERROR_MESSAGES = {
  AUTH4002: 'Google OAuth2 인증 실패입니다. 인증 코드가 유효하지 않습니다.',
  AUTH4003: 'JWT 토큰 생성 실패입니다. 백엔드 JWT 설정을 확인해주세요.',
  AUTH4004: '리다이렉트 URI 불일치입니다. Google Console에서 리다이렉트 URI를 확인해주세요.',
  AUTH4005: '사용자 정보 처리 실패입니다. Google 사용자 정보를 가져올 수 없습니다.',
};

const buildOAuthCommon401Message = (payload, { tokenExchange = false } = {}) => {
  const code = payload?.code ?? 'COMMON401';
  const message = payload?.message ?? '';
  const causes = tokenExchange
    ? `1. 백엔드가 Google OAuth 토큰 교환에 실패했습니다
2. OAuth 인증 코드가 유효하지 않거나 만료되었습니다
3. 백엔드의 GOOGLE_REDIRECT_URI 환경 변수가 일치하지 않습니다`
    : `1. OAuth 로그인이 아직 완료되지 않았습니다
2. 인증 토큰이 유효하지 않거나 만료되었습니다
3. 백엔드에서 인증을 확인하지 못했습니다`;

  const fixes = tokenExchange
    ? `- 백엔드 개발자에게 다음 확인 요청:
  1. 서버 로그에서 Google OAuth 토큰 교환 오류 확인
  2. GOOGLE_REDIRECT_URI 환경 변수 확인 (${getGoogleOAuthRedirectUri()})
  3. Google Client ID/Secret 확인
  4. Spring Security에서 /api/auth/google 경로 허용 확인`
    : `- OAuth 로그인을 다시 시도해주세요
- 브라우저 콘솔에서 OAuth 응답 로그를 확인하세요`;

  return `인증이 필요합니다 (COMMON401).

백엔드 응답:
- 코드: ${code}
- 메시지: ${message}

가능한 원인:
${causes}

해결 방법:
${fixes}`;
};

const resolveOAuthDuplicateEntryMessage = (message) => {
  if (!message?.includes('Duplicate entry')) return null;
  if (message.includes('provider_uid') || message.includes('UK423ot3bb0fm0mhtmh1t59my3o')) {
    return '이미 등록된 Google 계정입니다. 다른 계정으로 로그인하거나 관리자에게 문의하세요.';
  }
  return '이미 다른 소셜 로그인으로 가입된 이메일입니다.';
};

export function resolveOAuthUrlError(oauthErrorParam) {
  if (oauthErrorParam === 'access_denied') {
    return '사용자가 로그인을 취소했습니다.';
  }
  if (oauthErrorParam === 'redirect_uri_mismatch') {
    return buildGoogleRedirectUriMismatchMessage();
  }
  return `OAuth 오류: ${oauthErrorParam}`;
}

export function resolveOAuthApiBodyError(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
  }

  if (data.isSuccess === true || data.success === true) {
    return null;
  }

  if (data.code === 'COMMON401') {
    throw new Error(buildOAuthCommon401Message(data));
  }

  const message = data.message ?? '';
  if (message.includes('redirect_uri_mismatch')) {
    throw new Error(buildGoogleRedirectUriMismatchMessage());
  }

  const duplicateEntry = resolveOAuthDuplicateEntryMessage(message);
  if (duplicateEntry) {
    throw new Error(duplicateEntry);
  }

  if (data.code === 'AUTH4001') {
    if (message.includes('Client ID') || message.includes('Client Secret') || message.includes('invalid_client')) {
      throw new Error('Google OAuth2 설정 오류입니다. 백엔드의 Google Client ID와 Secret 설정을 확인해주세요.');
    }
    throw new Error(`Google 로그인 실패: ${message || '백엔드 설정을 확인해주세요.'}`);
  }

  if (OAUTH_AUTH_ERROR_MESSAGES[data.code]) {
    throw new Error(OAUTH_AUTH_ERROR_MESSAGES[data.code]);
  }

  if (message.includes('invalid_grant')) {
    throw new Error('인증 코드가 만료되었습니다. 다시 로그인해주세요.');
  }

  throw new Error(message || '인증 실패');
}

export async function resolveOAuthHttpError(response) {
  const errorText = await response.text();

  if (response.status === 401) {
    let errorData = null;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      /* ignore parse error */
    }

    if (errorData?.code === 'COMMON401') {
      throw new Error(buildOAuthCommon401Message(errorData, { tokenExchange: true }));
    }

    throw new Error('Google OAuth2 인증 실패. 인증 코드가 유효하지 않거나 만료되었습니다.');
  }

  if (response.status === 404) {
    const actualRequestUrl = response.url || `${getApiBaseUrl()}/api/auth/google`;
    const backendUrl = import.meta.env.DEV ? getDevBackendHintUrl() : getApiBaseUrl();

    throw new Error(`백엔드 서버에서 OAuth API를 찾을 수 없습니다 (404).

🔍 요청 정보:
- 요청 경로: POST ${actualRequestUrl}
- 프록시 사용: ${import.meta.env.DEV ? '예 (개발 환경)' : '아니오 (프로덕션)'}
- 예상 백엔드 URL: ${backendUrl}/api/auth/google

📋 확인 방법:
1. 개발 서버 터미널 확인:
   - "🔄 [프록시 요청]" 로그: 프록시가 백엔드로 전달한 실제 URL
   - "🔴 [404 에러]" 로그: 백엔드 응답 상세 정보
   
2. 백엔드 개발자에게 확인 요청:
   ✅ POST /api/auth/google 엔드포인트가 구현되어 있는지
   ✅ OAuth API가 배포 서버에 포함되어 있는지  
   ✅ 다른 경로를 사용하는지 (예: /auth/google, /oauth/google)
   ✅ Spring Security 설정에서 해당 경로가 차단되지 않았는지
   ✅ 서버 로그에서 요청이 도달했는지 확인
   
💡 참고:
- Swagger 문서에는 OAuth API가 표시되지 않습니다
- 보안상 이유로 숨겨져 있을 수 있지만, 실제로는 존재하지 않을 수도 있습니다
- 가이드에는 POST /api/auth/google이 있다고 명시되어 있으므로, 배포가 누락되었을 가능성이 높습니다`);
  }

  if (response.status === 500) {
    throw new Error('서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }

  throw new Error(`서버 응답 오류: ${response.status} - ${errorText}`);
}

export function normalizeOAuthFetchError(err) {
  const message = err?.message ?? '';
  const isCorsError =
    message.includes('CORS') ||
    message.includes('Access-Control-Allow-Origin') ||
    message.includes('blocked by CORS policy') ||
    message.includes('Failed to fetch') ||
    (err?.name === 'TypeError' && message.includes('fetch'));

  if (isCorsError) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '프론트 주소';
    return `CORS 에러: 백엔드에서 ${origin}을(를) 허용하도록 CORS 설정이 필요할 수 있습니다. 백엔드 개발자에게 문의하세요.`;
  }

  return `로그인 실패: ${message || '알 수 없는 오류'}`;
}

export function getOAuthErrorTip(error) {
  if (!error) return null;
  if (error.includes('CORS')) {
    return `백엔드에서 ${typeof window !== 'undefined' ? window.location.origin : '현재 프론트 주소'}을(를) CORS에 허용해 주세요.`;
  }
  if (error.includes('이미 등록된 Google 계정')) {
    return '다른 Google 계정으로 시도하거나, 기존 계정으로 로그인해 보세요.';
  }
  if (
    error.includes('State 파라미터') ||
    error.includes('OAuth state') ||
    error.includes('이미 처리된 로그인') ||
    error.includes('유효한 로그인 정보') ||
    error.includes('invalid_grant') ||
    error.includes('code verifier')
  ) {
    return '홈에서 Google 로그인을 다시 시도해 주세요.';
  }
  return '네트워크 연결과 Google OAuth 설정을 확인한 뒤 다시 시도해 주세요.';
}

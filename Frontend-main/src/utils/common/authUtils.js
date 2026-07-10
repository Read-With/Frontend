/** 환경 URL·OAuth·인증 정리 (VITE_* 로 덮어쓰기) */

import { clearAuthTokenStorage } from '../security/authTokenStorage';
import { createAndStoreGoogleOAuthState, secureLog } from '../security/oauthSecurity';
import { trimTrailingSlash } from './stringUtils';

export const DEFAULT_API_BASE_URL = 'https://readwith-be.onrender.com';
export const DEFAULT_CDN_BASE_URL = 'https://cdn.readwith.cloud';
export const DEFAULT_APP_ORIGIN = 'https://readwith-frontend.vercel.app';
export const DEFAULT_DEV_PROXY_TARGET =
  'http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com';

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

/**
 * Google OAuth 승인 후 돌아올 프론트 콜백 URL (Google 콘솔·백엔드와 일치)
 * 우선순위: 브라우저 origin + /auth/callback → VITE_GOOGLE_REDIRECT_URI → VITE_APP_ORIGIN → 기본
 */
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

/** 만료·로그아웃 후 이동할 앱 루트 */
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

/** 개발 시 오류 안내용 백엔드 베이스 (프록시 타겟) */
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

export const clearAuthData = () => {
  clearAuthTokenStorage();
};

/** Google OAuth 코드 교환 중인 콜백 페이지인지 */
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

  return (
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=email profile&` +
    `access_type=offline&` +
    `prompt=consent&` +
    `state=${encodeURIComponent(oauthState)}`
  );
}

/** Google OAuth 로그인 페이지로 이동. 실패 시 { ok: false, error } 반환 */
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

/** Google OAuth redirect_uri_mismatch 안내 메시지 */
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

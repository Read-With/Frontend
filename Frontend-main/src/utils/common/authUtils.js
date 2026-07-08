/** 환경 URL·OAuth·인증 정리 (VITE_* 로 덮어쓰기) */

import { clearAuthTokenStorage } from '../security/authTokenStorage';
import { trimTrailingSlash } from './stringUtils';

export const DEFAULT_API_BASE_URL = 'https://readwith-be.onrender.com';
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

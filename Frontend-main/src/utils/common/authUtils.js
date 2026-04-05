import {
  DEFAULT_API_BASE_URL,
  DEFAULT_APP_ORIGIN,
  DEFAULT_DEV_PROXY_TARGET,
} from './appEnvDefaults';
import { clearAuthTokenStorage } from '../security/authTokenStorage';

export const getApiBaseUrl = () => {
  if (import.meta.env.DEV) {
    return '';
  }
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/$/, '');
  }
  return DEFAULT_API_BASE_URL;
};

/**
 * Google OAuth 승인 후 돌아올 프론트 콜백 URL (Google 콘솔·백엔드와 일치)
 * 우선순위: VITE_GOOGLE_REDIRECT_URI → (개발: 현재 origin + BASE_URL) → VITE_APP_ORIGIN/auth/callback → 기본
 */
export const getGoogleOAuthRedirectUri = () => {
  const explicit = import.meta.env.VITE_GOOGLE_REDIRECT_URI;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim();
  }
  const basePath = import.meta.env.BASE_URL || '/';
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const origin = window.location.origin;
    const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
    const path = `${prefix}auth/callback`.replace(/\/{2,}/g, '/');
    return `${origin}${path}`;
  }
  const appOrigin = import.meta.env.VITE_APP_ORIGIN;
  if (typeof appOrigin === 'string' && appOrigin.trim()) {
    return `${appOrigin.trim().replace(/\/$/, '')}/auth/callback`;
  }
  return `${DEFAULT_APP_ORIGIN}/auth/callback`;
};

/** 만료·로그아웃 후 이동할 앱 루트 */
export const getPostLoginHomeUrl = () => {
  const raw = import.meta.env.VITE_POST_LOGIN_HOME_URL;
  if (typeof raw === 'string' && raw.trim()) {
    const h = raw.trim();
    return h.endsWith('/') ? h : `${h}/`;
  }
  const app = import.meta.env.VITE_APP_ORIGIN;
  if (typeof app === 'string' && app.trim()) {
    return `${app.trim().replace(/\/$/, '')}/`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/`;
  }
  return '/';
};

/** 개발 시 오류 안내용 백엔드 베이스 (프록시 타겟) */
export const getDevBackendHintUrl = () => {
  const u = import.meta.env.VITE_DEV_PROXY_TARGET;
  if (typeof u === 'string' && u.trim()) {
    try {
      return new URL(u.trim()).origin;
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

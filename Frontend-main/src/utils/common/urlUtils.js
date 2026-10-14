/** 환경 URL·OAuth 리다이렉트/복귀 경로·공개 자산·뷰어/그래프 경로 */

import { trimTrailingSlash, toOneBasedChapterIndexOrNull } from './valueUtils';
import { readRaw, writeRaw, removeKeys } from './cache/cacheManager';

export const DEFAULT_API_BASE_URL = 'https://readwith-be.onrender.com';
const DEFAULT_CDN_BASE_URL = 'https://cdn.readwith.cloud';
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
  const value = import.meta.env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

const toUrlOrigin = (candidate) => {
  if (!candidate) return null;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
};

const TRUSTED_PUBLIC_ASSET_ORIGINS = new Set([
  DEFAULT_API_BASE_URL,
  DEFAULT_CDN_BASE_URL,
  DEFAULT_DEV_PROXY_TARGET,
  envString('VITE_API_BASE_URL'),
  envString('VITE_CDN_BASE_URL'),
  envString('VITE_DEV_PROXY_TARGET'),
].map(toUrlOrigin).filter(Boolean));

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

  const explicit = envString('VITE_GOOGLE_REDIRECT_URI');
  if (explicit) {
    return explicit;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return buildCallbackUri(window.location.origin);
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

export const isOAuthCallbackRoute = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path.endsWith('/auth/callback');
};

const POST_LOGIN_PATH_KEY = 'post_login_path';

/** 로그인 필요 페이지에서 튕겨나갈 때 경로를 기억 — OAuth 왕복 후 같은 탭에서 복귀 */
export function rememberPostLoginPath() {
  writeRaw(POST_LOGIN_PATH_KEY, `${window.location.pathname}${window.location.search}`, 'sessionStorage');
}

/** 기억한 경로를 꺼내고 지운다. 같은 출처 내부 경로만 허용(오픈 리다이렉트 방지) */
export function takePostLoginPath() {
  const path = readRaw(POST_LOGIN_PATH_KEY, 'sessionStorage');
  removeKeys('sessionStorage', POST_LOGIN_PATH_KEY);
  if (path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')) {
    return path;
  }
  return null;
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

  try {
    const parsed = new URL(s.startsWith('//') ? `https:${s}` : s);
    if (!parsed.pathname.startsWith('/public/')) return false;

    return TRUSTED_PUBLIC_ASSET_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
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

function resolveAssetFetchUrl(url) {
  const s = sanitizeAssetUrl(url);
  return s ? routeProtectedPublicAssetForSameOriginProxy(preferDevPublicProxyPath(s)) : '';
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

/** 뷰어·그래프 경로: 쿼리 없음. 읽기 위치는 `/user/viewer/:id/c/:chapter/p/:page` */

export const USER_VIEWER_PREFIX = '/user/viewer';
export const USER_GRAPH_PREFIX = '/user/graph';

const DEFAULT_VIEWER_READING_POSITION = Object.freeze({ chapter: 1, page: 1 });
const READER_SPLAT_RE = /^c\/(\d+)\/p\/(\d+)$/;

function sanitizeViewerBookId(bookId) {
  return bookId != null ? String(bookId).replace(/^\/+/, '').trim() : '';
}

function prefixedBookPath(prefix, bookId) {
  const id = sanitizeViewerBookId(bookId);
  return id ? `${prefix}/${id}` : prefix;
}

export function parseViewerReaderSplat(splat) {
  if (splat == null || splat === '') return null;
  const normalizedSplat = String(splat).replace(/^\/+|\/+$/g, '');
  if (!normalizedSplat) return null;
  const match = normalizedSplat.match(READER_SPLAT_RE);
  if (!match) return null;
  const chapter = toOneBasedChapterIndexOrNull(match[1]);
  const page = toOneBasedChapterIndexOrNull(match[2]);
  if (!chapter || !page) return null;
  return { chapter, page };
}

/** splat 파싱 결과 → 챕터/페이지. 없거나 불완전하면 기본 위치 */
export function resolveViewerReadingPosition(parsedPath) {
  return {
    chapter: parsedPath?.chapter ?? DEFAULT_VIEWER_READING_POSITION.chapter,
    page: parsedPath?.page ?? DEFAULT_VIEWER_READING_POSITION.page,
  };
}

export function userViewerPath(bookId) {
  return prefixedBookPath(USER_VIEWER_PREFIX, bookId);
}

export function userViewerReadingPath(bookId, chapter, page) {
  const base = userViewerPath(bookId);
  const normalizedChapter = toOneBasedChapterIndexOrNull(chapter);
  const normalizedPage = toOneBasedChapterIndexOrNull(page);
  if (!normalizedChapter || !normalizedPage) return base;
  return `${base}/c/${normalizedChapter}/p/${normalizedPage}`;
}

/** 숫자 bookId일 때만 유효 경로. 아니면 null (잘못된 /user/viewer/bookmarks 방지) */
export function userViewerBookmarksPath(bookId) {
  const id = sanitizeViewerBookId(bookId);
  if (!id) return null;
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `${USER_VIEWER_PREFIX}/${Math.trunc(numeric)}/bookmarks`;
}

export function userGraphPath(bookId) {
  return prefixedBookPath(USER_GRAPH_PREFIX, bookId);
}

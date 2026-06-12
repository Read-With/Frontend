import { getApiBaseUrl } from './authUtils';
import { DEFAULT_API_BASE_URL } from './appEnvDefaults';

const trimTrailingSlash = (value) => String(value ?? '').replace(/\/$/, '');

const LEGACY_ASSET_HOSTS = new Set([
  'cdn.readwith.store',
  'cdn.readwith.cloud',
]);

function getPublicAssetOrigin() {
  const fromEnv = import.meta.env.VITE_CDN_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return trimTrailingSlash(fromEnv.trim());
  }
  const apiBase = trimTrailingSlash(getApiBaseUrl());
  if (apiBase) return apiBase;
  return DEFAULT_API_BASE_URL;
}

/** 잘못 저장된 /api/public/ 경로 보정 */
export function stripWrongApiPublicPrefix(url) {
  if (url == null) return '';
  return String(url).replace(/\/api\/public\//g, '/public/');
}

export function isProtectedPublicAsset(url) {
  if (url == null) return false;
  const s = String(url).trim();
  if (!s) return false;
  if (s.startsWith('/public/')) return true;
  return /readwith\.(cloud|store)\/public\//i.test(s);
}

export function rewriteLegacyAssetUrl(url) {
  if (url == null) return '';
  let s = stripWrongApiPublicPrefix(String(url).trim());
  if (!s) return '';
  try {
    const parsed = new URL(s.startsWith('//') ? `https:${s}` : s);
    if (LEGACY_ASSET_HOSTS.has(parsed.hostname.toLowerCase())) {
      const origin = getPublicAssetOrigin();
      return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return s.startsWith('//') ? parsed.href : s;
  } catch {
    return s;
  }
}

/**
 * 저장·표시용 canonical URL (dev 프록시 경로 없음, 레거시 호스트만 치환)
 */
export function sanitizeAssetUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  if (!s) return '';
  return rewriteLegacyAssetUrl(s);
}

/**
 * dev: /public/* 상대 경로 → Vite 프록시 + CSP 'self'
 * prod: sanitizeAssetUrl 결과 그대로
 */
export function preferDevPublicProxyPath(url) {
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
    /* relative or invalid */
  }
  return s;
}

/** fetch(combined.xhtml 등)용 URL */
export function resolveAssetFetchUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  if (!s) return '';
  return preferDevPublicProxyPath(sanitizeAssetUrl(s));
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
    if (base) return resolveAssetFetchUrl(`${base}${s}`);
    return resolveAssetFetchUrl(s);
  }
  if (base) {
    return resolveAssetFetchUrl(`${base}/${s}`);
  }
  return resolveAssetFetchUrl(`/${s}`);
}

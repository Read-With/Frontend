/** 공개 자산 URL 정규화·fetch·인증 blob 로드 */

import { authenticatedFetch } from '../api/authApi';
import { getBook } from '../api/booksApi';
import { getApiBaseUrl, DEFAULT_API_BASE_URL } from './authUtils';
import { trimTrailingSlash } from './stringUtils';

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

/** /api/public/ → /public/ 보정 */
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

/** /public/books/{id}/... 경로에서 bookId 추출 */
export function extractBookIdFromPublicAssetUrl(url) {
  const s = sanitizeAssetUrl(url);
  if (!s) return null;
  const match = s.match(/\/books\/(\d+)\//);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function isPublicCoverAssetPath(url) {
  const s = sanitizeAssetUrl(url);
  return !!s && /\/covers\//.test(s);
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

/** 저장·표시용 URL (레거시 CDN 호스트 치환) */
export function sanitizeAssetUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  if (!s) return '';
  return rewriteLegacyAssetUrl(s);
}

/** dev에서 /public/* 경로를 Vite 프록시 상대 경로로 변환 */
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
    /* URL 파싱 불가 */
  }
  return s;
}

/** authenticatedFetch용 URL */
export function resolveAssetFetchUrl(url) {
  if (url == null) return '';
  const s = String(url).trim();
  if (!s) return '';
  return preferDevPublicProxyPath(sanitizeAssetUrl(s));
}

/** manifest·API 아티팩트 경로 → fetch URL */
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

/** 보호된 /public/ 자산을 blob URL로 로드 (실패 시 refreshSource로 재시도) */
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

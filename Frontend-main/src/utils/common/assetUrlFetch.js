/** 인증이 필요한 공개 자산 blob URL 조회 (urlUtils와 API 순환 의존성 분리) */

import { authenticatedFetch } from '../api/authApi';
import { getBook } from '../api/booksApi';
import {
  isProtectedPublicAsset,
  resolveApiArtifactUrl,
  sanitizeAssetUrl,
} from './urlUtils';

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

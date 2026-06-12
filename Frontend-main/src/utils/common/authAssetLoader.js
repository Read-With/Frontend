import { authenticatedFetch } from '../api/authApi';
import {
  isProtectedPublicAsset,
  resolveAssetFetchUrl,
  sanitizeAssetUrl,
} from './artifactUrlUtils';

const blobUrlCache = new Map();

export async function fetchAuthenticatedAssetBlobUrl(sourceUrl) {
  const sanitized = sanitizeAssetUrl(sourceUrl);
  if (!sanitized) return null;

  if (!isProtectedPublicAsset(sanitized)) {
    return sanitized;
  }

  const fetchUrl = resolveAssetFetchUrl(sanitized);
  if (blobUrlCache.has(fetchUrl)) {
    return blobUrlCache.get(fetchUrl);
  }

  try {
    const res = await authenticatedFetch(fetchUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(fetchUrl, blobUrl);
    return blobUrl;
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

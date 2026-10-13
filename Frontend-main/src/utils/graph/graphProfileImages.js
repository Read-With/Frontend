/** 그래프 프로필 이미지: URL 정규화 · 보호 자산 → blob · 직접 URL 로드 프로브 */

import { sanitizeAssetUrl, resolveApiArtifactUrl, isProtectedPublicAsset } from '../common/urlUtils';
import { errorUtils } from '../common/valueUtils';
import { fetchAuthenticatedAssetBlobUrl } from '../api/booksApi';

export function validateAndNormalizeProfileImageUrl(profileImage) {
  if (!profileImage || typeof profileImage !== 'string') {
    return null;
  }

  const trimmed = sanitizeAssetUrl(profileImage.trim());
  if (trimmed === '') {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      if (import.meta.env.DEV) {
        errorUtils.logDebug('graphProfileImages', '유효하지 않은 절대 URL');
      }
      return null;
    }
  }

  if (trimmed.startsWith('//')) {
    try {
      const resolved = new URL(trimmed, 'https://placeholder.local');
      return resolved.origin + resolved.pathname + resolved.search + resolved.hash;
    } catch {
      if (import.meta.env.DEV) {
        errorUtils.logDebug('graphProfileImages', '유효하지 않은 프로토콜 상대 URL');
      }
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    return resolveApiArtifactUrl(trimmed) || trimmed;
  }

  if (import.meta.env.DEV) {
    errorUtils.logDebug('graphProfileImages', '유효하지 않은 이미지 URL 형식');
  }
  return null;
}

export const GRAPH_IMAGE_DEFERRED_RETRY_MS = 1_500;

const stillNeedsProtectedImageResolve = (image) =>
  !!image && isProtectedPublicAsset(image) && !String(image).startsWith('blob:');

/**
 * /public/ 밖의 직접 URL(CDN 등)은 인증 없이 그대로 <img>/캔버스에 쓰인다 — CORS 차단이나
 * 파일 부재 시 브라우저가 조용히 로드를 실패시켜, 그래프 노드에 이미지도 배경색도 없이
 * 빈 원만 남는다. 실제 로드 가능 여부를 한 번 프로브해 실패분은 image 필드를 제거,
 * 스타일시트의 기본 배경색(node 셀렉터)으로 폴백시킨다.
 */
const directImageLoadableCache = new Map();
const DIRECT_IMAGE_PROBE_TIMEOUT_MS = 4_000;

const needsDirectImageVerification = (image) =>
  !!image && !isProtectedPublicAsset(image) && !String(image).startsWith('blob:');

function probeImageLoadable(url) {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const img = new Image();
    // Cytoscape는 background-image를 기본 crossOrigin='anonymous'로 로드한다(캔버스 오염 방지).
    // 여기서도 동일하게 설정해야, CORS 헤더가 없는 origin의 이미지를 "로드 가능"으로 오판하지 않는다
    // (crossOrigin 없는 <img> 프로브는 통과하지만 실제 캔버스 렌더링은 CORS로 차단되는 불일치 방지).
    img.crossOrigin = 'anonymous';
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    // 응답이 느릴 뿐 실패는 아닐 수 있으므로, 타임아웃은 실패로 단정하지 않고 통과시킨다.
    setTimeout(() => finish(true), DIRECT_IMAGE_PROBE_TIMEOUT_MS);
    img.src = url;
  });
}

async function isDirectImageLoadable(url) {
  if (directImageLoadableCache.has(url)) return directImageLoadableCache.get(url);
  const ok = await probeImageLoadable(url);
  directImageLoadableCache.set(url, ok);
  return ok;
}

async function resolveOneGraphProfileImage(el, { force = false } = {}) {
  const image = el?.data?.image;
  if (!image) return el;

  if (stillNeedsProtectedImageResolve(image)) {
    const blobUrl = await fetchAuthenticatedAssetBlobUrl(image, { force });
    if (!blobUrl || blobUrl === image) return el;
    return { ...el, data: { ...el.data, image: blobUrl } };
  }

  if (needsDirectImageVerification(image)) {
    const loadable = await isDirectImageLoadable(image);
    if (loadable) return el;
    const { image: _unused, ...restData } = el.data;
    return { ...el, data: restData };
  }

  return el;
}

export function graphElementsHaveUnresolvedProfileImages(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return false;
  return elements.some((el) => stillNeedsProtectedImageResolve(el?.data?.image));
}

export async function resolveGraphElementsProfileImages(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) return elements;
  const { force = false } = options;
  return Promise.all(elements.map((el) => resolveOneGraphProfileImage(el, { force })));
}

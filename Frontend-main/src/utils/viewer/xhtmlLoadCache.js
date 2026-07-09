import { LRUCache } from 'lru-cache';

export const XHTML_LOAD_CACHE_VERSION = 'v4';
export const XHTML_CACHE_INVALIDATED_EVENT = 'readwith:xhtml-cache-invalidated';
const MAX_CACHED_BOOKS = 5;

const cache = new LRUCache({ max: MAX_CACHED_BOOKS });

function getXhtmlLoadCacheKey(bid) {
  const id = String(bid ?? '').trim();
  return id ? `${XHTML_LOAD_CACHE_VERSION}::${id}` : '';
}

/** bookId에 해당하는 XHTML 로드 캐시를 제거하고, 갱신 이벤트를 broadcast한다. */
export function invalidateCachedXhtml(bid, { silent = false } = {}) {
  const cacheKey = getXhtmlLoadCacheKey(bid);
  if (!cacheKey) return false;
  const existed = cache.has(cacheKey);
  cache.delete(cacheKey);
  if (!silent && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(XHTML_CACHE_INVALIDATED_EVENT, { detail: { bookId: String(bid).trim() } })
    );
  }
  return existed;
}

/**
 * XHTML 본문 로드·파싱 결과를 LRU 캐시하고, 동시 요청은 하나의 Promise로 합칩니다.
 * 실패 시 캐시 항목을 제거해 재시도할 수 있게 합니다.
 */
export function loadCachedXhtmlContent(bid, loader, parse) {
  const cacheKey = getXhtmlLoadCacheKey(bid);
  if (!cacheKey) {
    return Promise.reject(new Error('책 ID가 없습니다.'));
  }

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const loadPromise = Promise.resolve()
    .then(() => loader(bid))
    .then((raw) => parse(raw))
    .catch((err) => {
      cache.delete(cacheKey);
      throw err;
    });

  cache.set(cacheKey, loadPromise);
  return loadPromise;
}

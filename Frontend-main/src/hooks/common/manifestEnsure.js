/** manifest 캐시 miss 시 API fetch + 로드 게이트 훅 — viewer·graph 공통 */

import { useState, useEffect } from 'react';
import { getBookManifest } from '../../utils/api/api';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { errorUtils } from '../../utils/common/errorUtils';

/**
 * @param {number|string|null|undefined} bookId
 * @returns {Promise<{
 *   manifest: object|null,
 *   ok: boolean,
 *   skipped?: boolean,
 *   fromCache?: boolean,
 *   response?: object|null,
 *   error?: Error,
 * }>}
 */
export async function ensureBookManifest(bookId) {
  const numericBookId = Number(bookId);
  if (!Number.isFinite(numericBookId) || numericBookId < 1) {
    return { manifest: null, ok: true, skipped: true };
  }

  const cached = getManifestFromCache(numericBookId);
  if (cached) {
    return { manifest: cached, ok: true, fromCache: true, response: null };
  }

  try {
    const response = await getBookManifest(numericBookId);
    const manifest =
      response?.fromCache === true
        ? response.result
        : (getManifestFromCache(numericBookId) ?? response?.result ?? null);
    const ok = response?.isSuccess !== false && Boolean(manifest);
    return { manifest, ok, fromCache: false, response };
  } catch (error) {
    return {
      manifest: getManifestFromCache(numericBookId),
      ok: false,
      fromCache: false,
      error,
    };
  }
}

/**
 * 뷰어/그래프용 manifest 준비 게이트.
 * fail-open: 로드 실패해도 true로 두어 이후 metrics·fine graph가 막히지 않게 함.
 */
export function useManifestLoaded(bookId) {
  const [manifestLoaded, setManifestLoaded] = useState(
    () => !bookId || Boolean(getManifestFromCache(bookId))
  );

  useEffect(() => {
    if (!bookId) {
      setManifestLoaded(true);
      return undefined;
    }

    if (getManifestFromCache(bookId)) {
      setManifestLoaded(true);
      return undefined;
    }

    let cancelled = false;
    setManifestLoaded(false);

    void ensureBookManifest(bookId).then((outcome) => {
      if (cancelled) return;
      if (!outcome.ok && !outcome.skipped) {
        errorUtils.logWarning(
          '[useManifestLoaded] manifest 로드 실패',
          outcome.error?.message ?? outcome.response?.message ?? '알 수 없는 오류'
        );
      }
      setManifestLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return manifestLoaded;
}

/** manifest 캐시 miss 시 API fetch — viewer·graph 훅 공통 */

import { getBookManifest } from '../../utils/api/api';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';

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

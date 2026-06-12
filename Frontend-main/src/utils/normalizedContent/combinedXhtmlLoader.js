/**
 * combined.xhtml 로더
 *
 * manifest 캐시의 readerArtifacts.combinedXhtmlPath를 API 베이스 URL과 결합해 fetch합니다.
 */

import { errorUtils } from '../common/errorUtils';
import { getManifestFromCache } from '../common/cache/manifestCache';
import { resolveApiArtifactUrl } from '../common/artifactUrlUtils';
import { authenticatedFetch } from '../api/authApi';

export async function loadCombinedXhtml(bookId) {
  if (bookId == null || String(bookId).trim() === '') {
    const message = '책 ID가 없습니다.';
    errorUtils.logError('loadCombinedXhtml', new Error(message), { bookId });
    throw new Error(message);
  }

  const path = getManifestFromCache(bookId)?.readerArtifacts?.combinedXhtmlPath;
  const url = path ? resolveApiArtifactUrl(path) : '';
  if (typeof url === 'string' && url.trim()) {
    try {
      const res = await authenticatedFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.text()).trim();
    } catch (e) {
      errorUtils.logError('loadCombinedXhtml', e, { url, bookId });
      throw e;
    }
  }

  const message = 'combined.xhtml URL을 찾을 수 없습니다. 서버 아티팩트 경로를 확인해주세요.';
  errorUtils.logError('loadCombinedXhtml', new Error(message), { bookId });
  throw new Error(message);
}

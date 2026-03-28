/**
 * combined.xhtml 로더
 *
 * 우선순위:
 * 1. book.combinedXhtmlContent (직접 전달)
 * 2. book.combinedXhtmlUrl (URL fetch)
 * 3. manifest 캐시의 readerArtifacts.combinedXhtmlPath (getBookManifest 후)
 * 4. {BASE_URL}books/{bookId}/combined.xhtml (public 정적 파일)
 */

import { errorUtils } from '../common/errorUtils';
import { getManifestFromCache } from '../common/cache/manifestCache';
import { resolveApiArtifactUrl } from '../common/artifactUrlUtils';

export async function loadCombinedXhtml(bookId, book = {}) {
  const content = book.combinedXhtmlContent;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  let url = book.combinedXhtmlUrl;
  if (!url?.trim?.() && bookId != null && String(bookId).trim() !== '') {
    const path = getManifestFromCache(bookId)?.readerArtifacts?.combinedXhtmlPath;
    if (path) url = resolveApiArtifactUrl(path);
  }
  if (typeof url === 'string' && url.trim()) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.text()).trim();
    } catch (e) {
      errorUtils.logError('loadCombinedXhtml', e, { url, bookId });
      throw e;
    }
  }

  const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
  const fallbackUrl = `${base}books/${encodeURIComponent(String(bookId || ''))}/combined.xhtml`;
  try {
    const res = await fetch(fallbackUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.text()).trim();
  } catch (e) {
    errorUtils.logError('loadCombinedXhtml', e, { fallbackUrl, bookId });
    throw new Error(`combined.xhtml을 불러올 수 없습니다: ${e.message}`);
  }
}

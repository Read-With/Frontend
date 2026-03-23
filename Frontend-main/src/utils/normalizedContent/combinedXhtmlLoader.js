/**
 * combined.xhtml 로더
 * Phase 1: 현재 직접 제공 → 이후 서버 fetch
 *
 * 우선순위:
 * 1. book.combinedXhtmlContent (직접 전달)
 * 2. book.combinedXhtmlUrl (URL fetch)
 * 3. /books/{bookId}/combined.xhtml (public 폴더, 개발용)
 */

import { errorUtils } from '../common/errorUtils';

export async function loadCombinedXhtml(bookId, book = {}) {
  const content = book.combinedXhtmlContent;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  const url = book.combinedXhtmlUrl;
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

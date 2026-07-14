/** manifest combinedXhtmlPath → API/CDN 경유 fetch로 본문 로드 */
import { errorUtils } from '../common/errorUtils';
import { getManifestFromCache } from '../common/cache/manifestCache';
import { resolveApiArtifactUrl } from '../common/urlUtils';
import { authenticatedFetch } from '../api/authApi';
import { getBookManifest } from '../api/api';

const XHTML_NOT_FOUND_MESSAGE =
  '정규화 본문을 찾을 수 없습니다. 잠시 후 다시 시도하거나 재정규화가 필요할 수 있습니다.';

const getCombinedXhtmlFetchUrl = (bookId) => {
  const path = getManifestFromCache(bookId)?.readerArtifacts?.combinedXhtmlPath;
  return path ? resolveApiArtifactUrl(path) : '';
};

const fetchCombinedXhtmlText = async (url) => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const err = new Error(
      res.status === 404 ? XHTML_NOT_FOUND_MESSAGE : `HTTP ${res.status}`
    );
    err.status = res.status;
    throw err;
  }
  return (await res.text()).trim();
};

export async function loadCombinedXhtml(bookId) {
  if (bookId == null || String(bookId).trim() === '') {
    const message = '책 ID가 없습니다.';
    errorUtils.logError('loadCombinedXhtml', new Error(message), { bookId });
    throw new Error(message);
  }

  const url = getCombinedXhtmlFetchUrl(bookId);
  if (typeof url === 'string' && url.trim()) {
    try {
      return await fetchCombinedXhtmlText(url);
    } catch (e) {
      if (e?.status !== 404) {
        errorUtils.logError('loadCombinedXhtml', e, { url, bookId });
        throw e;
      }
      try {
        await getBookManifest(bookId, { forceRefresh: true });
        const retryUrl = getCombinedXhtmlFetchUrl(bookId);
        if (!retryUrl.trim()) throw e;
        return await fetchCombinedXhtmlText(retryUrl);
      } catch (retryErr) {
        if (retryErr?.status !== 404) {
          errorUtils.logError('loadCombinedXhtml', retryErr, { url, bookId, retried: true });
        }
        throw retryErr;
      }
    }
  }

  const message = 'combined.xhtml URL을 찾을 수 없습니다. 서버 아티팩트 경로를 확인해주세요.';
  errorUtils.logError('loadCombinedXhtml', new Error(message), { bookId });
  throw new Error(message);
}

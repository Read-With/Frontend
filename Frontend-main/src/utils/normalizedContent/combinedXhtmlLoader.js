/** manifest combinedXhtmlPath → authenticatedFetch로 본문 로드 */
import { errorUtils } from '../common/errorUtils';
import { getManifestFromCache } from '../common/cache/manifestCache';
import { resolveApiArtifactUrl } from '../common/artifactUrlUtils';
import { authenticatedFetch } from '../api/authApi';
import { getBookManifest } from '../api/api';

const XHTML_NOT_FOUND_MESSAGE =
  '정규화 본문을 찾을 수 없습니다. 잠시 후 다시 시도하거나 재정규화가 필요할 수 있습니다.';

const debugLog = (label, payload) => {
  if (!import.meta.env.DEV) return;
  console.debug(`[loadCombinedXhtml] ${label}`, payload);
};

const logManifestSnapshot = (bookId, label) => {
  const manifest = getManifestFromCache(bookId);
  debugLog(label, {
    bookId,
    readerArtifacts: manifest?.readerArtifacts ?? null,
    book: manifest?.book ?? null,
  });
};

const readResponseBodyForDebug = async (res) => {
  try {
    const text = await res.clone().text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text.length > 500 ? `${text.slice(0, 500)}…` : text;
    }
  } catch {
    return '(response body read failed)';
  }
};

const getCombinedXhtmlFetchUrl = (bookId) => {
  const path = getManifestFromCache(bookId)?.readerArtifacts?.combinedXhtmlPath;
  return path ? resolveApiArtifactUrl(path) : '';
};

const fetchCombinedXhtmlText = async (url, bookId) => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const body = await readResponseBodyForDebug(res);
    debugLog('combined.xhtml fetch failed', { bookId, url, status: res.status, body });
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

  logManifestSnapshot(bookId, 'manifest (before fetch)');
  const url = getCombinedXhtmlFetchUrl(bookId);
  debugLog('fetch url', { bookId, url });
  if (typeof url === 'string' && url.trim()) {
    try {
      return await fetchCombinedXhtmlText(url, bookId);
    } catch (e) {
      if (e?.status !== 404) {
        errorUtils.logError('loadCombinedXhtml', e, { url, bookId });
        throw e;
      }
      try {
        const manifestRes = await getBookManifest(bookId, { forceRefresh: true });
        debugLog('manifest refresh response', manifestRes);
        logManifestSnapshot(bookId, 'manifest (after refresh)');
        const retryUrl = getCombinedXhtmlFetchUrl(bookId);
        debugLog('retry fetch url', { bookId, url: retryUrl });
        if (!retryUrl.trim()) throw e;
        return await fetchCombinedXhtmlText(retryUrl, bookId);
      } catch (retryErr) {
        if (retryErr?.status !== 404) {
          errorUtils.logError('loadCombinedXhtml', retryErr, { url, bookId, retried: true });
        }
        throw retryErr;
      }
    }
  }

  logManifestSnapshot(bookId, 'manifest (no combinedXhtmlPath)');
  const message = 'combined.xhtml URL을 찾을 수 없습니다. 서버 아티팩트 경로를 확인해주세요.';
  errorUtils.logError('loadCombinedXhtml', new Error(message), { bookId });
  throw new Error(message);
}

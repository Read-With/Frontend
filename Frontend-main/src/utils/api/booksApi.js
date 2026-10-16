/** v2 books·북마크·manifest·progress API */

import {
  authenticatedRequest,
  makeSilentError,
  isTokenValid,
  mapSoftFailResponse,
  SOFT_FAIL_403_404,
  requireBookId,
  pickResponseResult,
  toUnifiedApiResponse,
  authenticatedFetch,
  getStoredAccessToken,
  AUTH_CLEARED_EVENT,
} from './authApi';
import {
  asArray,
  toOneBasedChapterIndexOrNull,
  toPositiveNumberOrNull,
  errorUtils,
  sleep,
  stringOrEmpty,
} from '../common/valueUtils';
import { progressPayloadFromData, resolveProgressLocator, locatorsEqual } from '../common/locator';
import {
  getApiBaseUrl,
  sanitizeAssetUrl,
  isProtectedPublicAsset,
  resolveApiArtifactUrl,
} from '../common/urlUtils';
import {
  normalizeStartEndLocatorsForServer,
  withNormalizedProgressLocators,
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  ensureProgressRowLocator,
  normalizeReadingProgressPercent,
} from '../common/cache/progressCache';
import { setManifestData, getManifestFromCache } from '../common/cache/manifestCache';
import { withInflight } from '../common/cache/cacheManager';
import { normalizeV2Book } from '../common/bookNormalize';

/** PATCH /v2/bookmarks 로 수정 가능한 필드 */
const BOOKMARK_UPDATABLE_FIELDS = Object.freeze(['color', 'memo']);

const BOOK_LIST_SORT_VALUES = new Set(['updatedAt', 'title']);

/** 성공 응답의 단건 result를 정규화 (data를 그대로 반환) */
const withNormalizedResult = (data, normalize) => {
  if (data?.isSuccess && data.result) data.result = normalize(data.result);
  return data;
};

/** 성공 응답의 목록 result를 항목별 정규화 (data를 그대로 반환) */
const withNormalizedList = (data, normalize) => {
  if (data?.isSuccess && Array.isArray(data.result)) data.result = data.result.map(normalize);
  return data;
};

const buildBooksQueryString = (params = {}) => {
  const queryParams = new URLSearchParams();
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  if (q) queryParams.append('q', q);
  if (params.language) queryParams.append('language', String(params.language));
  if (params.sort && BOOK_LIST_SORT_VALUES.has(params.sort)) {
    queryParams.append('sort', params.sort);
  }
  if (params.favorite === true || params.favorite === false) {
    queryParams.append('favorite', String(params.favorite));
  }
  return queryParams.toString();
};

export const getBooks = async (params = {}) => {
  const queryString = buildBooksQueryString(params);
  let data;
  try {
    data = await authenticatedRequest(`/v2/books${queryString ? `?${queryString}` : ''}`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
  } catch (error) {
    errorUtils.logError('getBooks', error, { query: queryString || null });
    throw error;
  }
  const softEmpty = mapSoftFailResponse(data, {
    mode: 'empty',
    emptyResult: [],
    forbiddenMessage: '책 목록에 접근할 권한이 없습니다.',
    notFoundMessage: '책 목록을 찾을 수 없습니다.',
  });
  if (softEmpty) {
    errorUtils.logWarning('getBooks', softEmpty.message || '책 목록 soft-fail', {
      code: softEmpty.code,
    });
    return softEmpty;
  }
  return withNormalizedList(data, normalizeV2Book);
};

/** getBooks 응답에서 책 배열만 추출 (실패 시 빈 배열) */
export const getBooksArray = async (params = {}) => {
  const res = await getBooks(params);
  return res?.isSuccess && asArray(res.result);
};

const BOOK_SOFT_FAIL_MESSAGES = {
  forbiddenMessage: '접근 권한이 없습니다',
  notFoundMessage: '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.',
};

export const getBook = async (bookId) => {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  if (!normalizedBookId) {
    return makeSilentError('INVALID_INPUT', 'bookId는 1 이상의 정수여야 합니다.');
  }

  const data = await authenticatedRequest(`/v2/books/${normalizedBookId}`, {
    softFailStatuses: SOFT_FAIL_403_404,
  });
  const softFail = mapSoftFailResponse(data, {
    mode: 'error',
    ...BOOK_SOFT_FAIL_MESSAGES,
  });
  if (softFail) return softFail;
  return withNormalizedResult(data, normalizeV2Book);
};

export const uploadBook = async (file, metadata = {}) => {
  const formData = new FormData();
  formData.append('file', file);
  if (metadata.title) formData.append('title', metadata.title);
  if (metadata.author) formData.append('author', metadata.author);
  if (metadata.language) formData.append('language', metadata.language);

  const data = await authenticatedRequest('/v2/books', {
    method: 'POST',
    body: formData,
  });
  if (!data?.isSuccess || !data.result) {
    const error = new Error(data?.message || 'EPUB 업로드 실패');
    error.code = data?.code ?? null;
    error.status = data?.status ?? null;
    throw error;
  }
  data.result = normalizeV2Book(data.result);
  return data;
};

export const toggleBookFavorite = async (bookId, favorite) => {
  try {
    const method = favorite ? 'POST' : 'DELETE';
    return await authenticatedRequest(`/v2/favorites/${bookId}`, { method });
  } catch (error) {
    errorUtils.logError('toggleBookFavorite', error, { bookId, favorite });
    throw error;
  }
};

export function normalizeChapterPovSummariesResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      bookId: null,
      chapterIdx: null,
      chapterTitle: '',
      povSummaries: [],
    };
  }
  const rows = asArray(raw.povSummaries);
  const povSummaries = rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const characterId = Number(row.characterId);
      if (!Number.isFinite(characterId)) return null;
      return {
        characterId,
        characterName: stringOrEmpty(row.characterName),
        summaryText: stringOrEmpty(row.summaryText),
        isMainCharacter: Boolean(row.isMainCharacter),
      };
    })
    .filter(Boolean);
  const bookIdNum = Number(raw.bookId);
  const chapterIdxNum = Number(raw.chapterIdx);
  return {
    bookId: Number.isFinite(bookIdNum) && bookIdNum >= 1 ? bookIdNum : null,
    chapterIdx: Number.isFinite(chapterIdxNum) && chapterIdxNum >= 1 ? chapterIdxNum : null,
    chapterTitle: stringOrEmpty(raw.chapterTitle),
    povSummaries,
  };
}

export const getChapterPovSummaries = async (bookId, chapterIdx) => {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  const normalizedChapterIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (!normalizedBookId) {
    throw new Error('bookId는 1 이상의 정수여야 합니다.');
  }
  if (!normalizedChapterIdx) {
    throw new Error('chapterIdx는 1 이상의 정수여야 합니다.');
  }

  // 중복 요청 방지는 호출부(useChapterPovSummaries)의 react-query가 담당
  return authenticatedRequest(
    `/v2/books/${normalizedBookId}/chapters/${normalizedChapterIdx}/pov-summaries`,
    { softFailStatuses: SOFT_FAIL_403_404 }
  ).catch((error) => {
    errorUtils.logError('getChapterPovSummaries', error);
    throw error;
  });
};

const normalizeBookmarkDto = (b) => {
  if (!b || typeof b !== 'object') return b;
  return {
    ...b,
    rangeBookmark: !!(b.isRangeBookmark ?? b.rangeBookmark),
  };
};

const BOOKMARK_SORT = new Set(['time_desc', 'time_asc']);

const getBookmarks = async (bookId, sort = 'time_desc') => {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  if (normalizedBookId == null) {
    throw new Error('유효한 bookId는 필수입니다.');
  }
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('bookId', String(normalizedBookId));
    const sortParam = BOOKMARK_SORT.has(sort) ? sort : 'time_desc';
    queryParams.append('sort', sortParam);
    const data = await authenticatedRequest(`/v2/bookmarks?${queryParams.toString()}`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softEmpty = mapSoftFailResponse(data, {
      mode: 'empty',
      emptyResult: [],
      forbiddenMessage: '북마크에 접근할 권한이 없습니다.',
      notFoundMessage: '북마크를 찾을 수 없습니다.',
    });
    if (softEmpty) {
      errorUtils.logWarning('getBookmarks', softEmpty.message || '북마크 목록 soft-fail', {
        bookId: normalizedBookId,
        code: softEmpty.code,
      });
      return softEmpty;
    }
    return withNormalizedList(data, normalizeBookmarkDto);
  } catch (error) {
    errorUtils.logError('getBookmarks', error);
    throw error;
  }
};

export const loadBookmarks = async (bookId, sort = 'time_desc') => {
  const response = await getBookmarks(bookId, sort);
  if (response?.isSuccess) {
    return asArray(response.result);
  }
  throw new Error(response?.message || '북마크 목록을 불러오지 못했습니다.');
};

const buildPatchBody = (updateData) => {
  const body = {};
  if (!updateData || typeof updateData !== 'object') return body;
  for (const key of BOOKMARK_UPDATABLE_FIELDS) {
    if (updateData[key] !== undefined) body[key] = updateData[key];
  }
  return body;
};

export const createBookmark = async (bookmarkData) => {
  if (!bookmarkData || typeof bookmarkData !== 'object') {
    throw new Error('bookmarkData는 필수입니다.');
  }
  const normalizedBookId = toPositiveNumberOrNull(bookmarkData.bookId);
  if (normalizedBookId == null) {
    throw new Error('유효한 bookId는 필수입니다.');
  }
  const { startLocator, endLocator } = normalizeStartEndLocatorsForServer(
    normalizedBookId,
    bookmarkData.startLocator,
    bookmarkData.endLocator
  );
  if (!startLocator) {
    throw new Error('startLocator는 필수입니다.');
  }
  try {
    const dataToSend = {
      bookId: normalizedBookId,
      startLocator,
      color: bookmarkData.color, // 기본 색은 createBookmarkData가 채움
      memo: bookmarkData.memo ?? '',
    };
    if (endLocator) {
      dataToSend.endLocator = endLocator;
    }
    const data = await authenticatedRequest('/v2/bookmarks', {
      method: 'POST',
      body: JSON.stringify(dataToSend),
    });
    return withNormalizedResult(data, normalizeBookmarkDto);
  } catch (error) {
    errorUtils.logError('createBookmark', error);
    throw error;
  }
};

export const updateBookmark = async (bookmarkId, updateData) => {
  if (bookmarkId == null || bookmarkId === '') {
    throw new Error('bookmarkId는 필수입니다.');
  }
  const body = buildPatchBody(updateData);
  if (Object.keys(body).length === 0) {
    throw new Error(`수정할 ${BOOKMARK_UPDATABLE_FIELDS.join(' 또는 ')}가 필요합니다.`);
  }
  try {
    const data = await authenticatedRequest(`/v2/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return withNormalizedResult(data, normalizeBookmarkDto);
  } catch (error) {
    errorUtils.logError('updateBookmark', error);
    throw error;
  }
};

export const deleteBookmark = async (bookmarkId) => {
  if (bookmarkId == null || bookmarkId === '') {
    throw new Error('bookmarkId는 필수입니다.');
  }
  try {
    return await authenticatedRequest(`/v2/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    });
  } catch (error) {
    errorUtils.logError('deleteBookmark', error);
    throw error;
  }
};

// ─── progress ──────────────────────────────────────────────────────────────

const PROGRESS_FORBIDDEN_MESSAGE = '해당 책에 접근할 권한이 없습니다';
const PROGRESS_NOT_FOUND_MESSAGE = '진도 정보를 찾을 수 없습니다';

/** softFail 응답 → progress silent error (해당 없으면 null) */
const mapProgressSoftFailCode = (response, { includeNotFound = true } = {}) =>
  mapSoftFailResponse(response, {
    mode: 'error',
    includeNotFound,
    forbiddenMessage: PROGRESS_FORBIDDEN_MESSAGE,
    notFoundMessage: PROGRESS_NOT_FOUND_MESSAGE,
  });

const buildProgressSavePayload = (progressData) =>
  progressPayloadFromData(withNormalizedProgressLocators(progressData));

const mergeReadingProgressPercent = (cacheRow, progressData, serverResult, bookId) => {
  const pctFromReq = normalizeReadingProgressPercent(progressData, { bookId });
  const pctFromRes = normalizeReadingProgressPercent(serverResult ?? {}, { bookId });
  if (pctFromReq != null || pctFromRes != null) {
    cacheRow.readingProgressPercent = pctFromReq ?? pctFromRes;
  }
  return cacheRow;
};

export const saveProgress = async (progressData) => {
  try {
    const payload = buildProgressSavePayload(progressData);
    if (!payload) {
      throw new Error('bookId와 읽기 위치(startLocator/locator)는 필수입니다.');
    }
    const response = await authenticatedRequest('/v2/progress', {
      method: 'POST',
      body: JSON.stringify(payload),
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response, { includeNotFound: false });
    if (softFail) return softFail;
    if (!response?.isSuccess) {
      const error = new Error(response?.message || '독서 진도 저장 실패');
      if (response?.code === 'NOT_FOUND') error.status = 404;
      throw error;
    }
    const serverResult =
      response?.result && typeof response.result === 'object' ? response.result : null;
    const cacheRow = serverResult
      ? { ...serverResult, bookId: progressData.bookId ?? serverResult.bookId }
      : { ...progressData, ...payload };
    const bookId = progressData.bookId ?? serverResult?.bookId;
    mergeReadingProgressPercent(cacheRow, progressData, serverResult, bookId);
    setProgressToCache(cacheRow);
    return toUnifiedApiResponse(
      { ...response, result: response?.result ?? cacheRow },
      { defaultMessage: '독서 진도를 저장했습니다.' }
    );
  } catch (error) {
    errorUtils.logError('saveProgress', error);
    throw error;
  }
};

export const saveProgressKeepalive = (progressData) => {
  try {
    const payload = buildProgressSavePayload(progressData);
    if (!payload) return false;
    const token = getStoredAccessToken();
    // pagehide에서는 refresh를 await할 수 없음 — 유효 토큰일 때만 전송
    if (!token || !isTokenValid(token)) return false;

    fetch(`${getApiBaseUrl()}/api/v2/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => void 0);

    return true;
  } catch {
    return false;
  }
};

/**
 * 진도 조회. 기본은 서버 우선. API 레이어에서 네트워크 실패 시 로컬 캐시로 폴백.
 * @param {{ skipCache?: boolean }} [options]
 * - skipCache: true면 이 함수 안의 캐시 폴백을 쓰지 않음.
 *   (호출 훅이 별도로 캐시 복구할 수는 있음)
 */
export const getBookProgress = async (bookId, options = {}) => {
  if (!bookId) return makeSilentError('INVALID_INPUT', 'bookId는 필수 매개변수입니다.');

  const skipCache = options?.skipCache === true;

  try {
    const response = await authenticatedRequest(`/v2/progress/${bookId}`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response);
    if (softFail) return softFail;
    if (response?.isSuccess && response.result) {
      const base = { ...response.result };
      const prev = getProgressFromCache(bookId);
      // setProgressToCache는 locator로 진도를 다시 계산하므로 행의 readingProgressPercent는 쓰지 않음
      setProgressToCache(base);
      const hydrated = getProgressFromCache(bookId);
      if (hydrated) {
        return toUnifiedApiResponse(
          { ...response, result: hydrated },
          { defaultMessage: '진도 정보를 조회했습니다.' }
        );
      }
      // 캐시에 못 넣은 행: 진도를 여기서 채워 반환 (같은 위치면 이전 캐시 진도 유지)
      const newLoc = resolveProgressLocator(ensureProgressRowLocator(String(bookId), base));
      const prevLoc = resolveProgressLocator(prev ?? {});
      const sameLoc = newLoc && prevLoc && locatorsEqual(newLoc, prevLoc);
      const pct =
        normalizeReadingProgressPercent(base, { bookId }) ??
        (sameLoc ? normalizeReadingProgressPercent(prev ?? {}, { bookId }) : null);
      const row = pct != null ? { ...base, readingProgressPercent: pct } : base;
      return toUnifiedApiResponse(
        { ...response, result: row },
        { defaultMessage: '진도 정보를 조회했습니다.' }
      );
    }
    return toUnifiedApiResponse(response, { defaultMessage: '진도 정보를 조회했습니다.' });
  } catch (error) {
    if (!skipCache) {
      const cachedProgress = getProgressFromCache(bookId);
      if (cachedProgress) {
        return toUnifiedApiResponse({
          isSuccess: true,
          code: 'CACHE_FALLBACK',
          message: '서버 진도 조회 실패로 로컬 캐시를 사용합니다',
          result: cachedProgress,
          fromCache: true,
        });
      }
    }
    throw error;
  }
};

export const deleteBookProgress = async (bookId) => {
  try {
    requireBookId(bookId);
    const response = await authenticatedRequest(`/v2/progress/${bookId}`, {
      method: 'DELETE',
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response);
    if (softFail) return softFail;
    if (response?.isSuccess) removeProgressFromCache(bookId);
    return toUnifiedApiResponse(response, {
      defaultMessage: '독서 진도를 삭제했습니다.',
      defaultResult: null,
    });
  } catch (error) {
    errorUtils.logError('독서 진도 삭제 실패:', error);
    throw error;
  }
};

// ─── manifest ──────────────────────────────────────────────────────────────

const manifestInflight = new Map();

/** 캐시 히트 → 즉시 반환, 아니면 같은 bookId 동시 요청을 하나로 합침. forceRefresh는 항상 새 요청 */
export const getBookManifest = async (bookId, { forceRefresh = false } = {}) => {
  const numericBookId = Number(bookId);
  if (!Number.isFinite(numericBookId) || numericBookId < 1) {
    return makeSilentError('INVALID_INPUT', 'bookId는 1 이상의 정수여야 합니다.');
  }

  if (!forceRefresh) {
    const cached = getManifestFromCache(numericBookId);
    if (cached) {
      return toUnifiedApiResponse({
        isSuccess: true,
        code: 'CACHE_HIT',
        message: 'Manifest loaded from cache',
        result: cached,
        fromCache: true,
      });
    }
    return withInflight(manifestInflight, numericBookId, () => requestBookManifest(numericBookId));
  }
  return requestBookManifest(numericBookId);
};

const requestBookManifest = async (numericBookId) => {
  try {
    const response = await authenticatedRequest(`/v2/books/${numericBookId}/manifest`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapSoftFailResponse(response, {
      mode: 'error',
      ...BOOK_SOFT_FAIL_MESSAGES,
    });
    if (softFail) return softFail;

    const result = pickResponseResult(response);
    if (response?.isSuccess && result) {
      const normalized = setManifestData(numericBookId, result);
      return toUnifiedApiResponse(
        { ...response, result: normalized ?? result },
        { defaultMessage: 'Manifest loaded successfully' }
      );
    }
    return toUnifiedApiResponse(response, { defaultMessage: 'Manifest loaded successfully' });
  } catch (error) {
    if (Number(error?.status) === 400) {
      return makeSilentError('BAD_REQUEST', '잘못된 요청입니다.');
    }
    errorUtils.logError('getBookManifest', error);
    throw error;
  }
};

/* ─── 인증 필요 공개 자산 blob URL ─── */

const blobUrlCache = new Map();
const inFlightRequests = new Map();
const failedFetchUrls = new Map();
let blobCacheGeneration = 0;
/** 최종 실패 후 짧은 쿨다운만 (데이터는 존재한다고 가정 — 일시적 fetch 실패 대비) */
const FAILED_FETCH_TTL_MS = 5_000;
const ASSET_FETCH_MAX_ATTEMPTS = 3;
const ASSET_FETCH_RETRY_BASE_MS = 400;

function clearAuthenticatedAssetBlobCache() {
  blobCacheGeneration += 1;
  for (const blobUrl of blobUrlCache.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrlCache.clear();
  failedFetchUrls.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_CLEARED_EVENT, clearAuthenticatedAssetBlobCache);
}

const isFailedRecently = (fetchUrl) => {
  const failedAt = failedFetchUrls.get(fetchUrl);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILED_FETCH_TTL_MS) {
    failedFetchUrls.delete(fetchUrl);
    return false;
  }
  return true;
};

const markFetchFailed = (fetchUrl) => {
  failedFetchUrls.set(fetchUrl, Date.now());
};

const clearFetchFailed = (fetchUrl) => {
  if (fetchUrl) failedFetchUrls.delete(fetchUrl);
};

const isRetryableAssetStatus = (status) =>
  status === 404 || status === 408 || status === 429 || status >= 500;

function extractBookIdFromPublicAssetUrl(url) {
  const s = sanitizeAssetUrl(url);
  if (!s) return null;
  const match = s.match(/\/books\/(\d+)\//);
  if (!match) return null;
  return toPositiveNumberOrNull(match[1]);
}

function isPublicCoverAssetPath(url) {
  const s = sanitizeAssetUrl(url);
  return !!s && /\/covers\//.test(s);
}

const buildCoverRefreshSource = (sanitized) => {
  if (!isPublicCoverAssetPath(sanitized)) return null;
  const bookId = extractBookIdFromPublicAssetUrl(sanitized);
  if (!bookId) return null;
  return async () => {
    const res = await getBook(bookId);
    return res?.isSuccess ? res.result?.coverImgUrl : null;
  };
};

const fetchProtectedBlobUrl = async (sourceUrl, { force = false } = {}) => {
  const sanitized = sanitizeAssetUrl(sourceUrl);
  if (!sanitized) return null;

  if (!isProtectedPublicAsset(sanitized)) {
    return sanitized;
  }

  const fetchUrl = resolveApiArtifactUrl(sanitized);
  if (!fetchUrl) return null;

  if (blobUrlCache.has(fetchUrl)) {
    return blobUrlCache.get(fetchUrl);
  }

  if (!force && isFailedRecently(fetchUrl)) {
    return null;
  }
  if (force) clearFetchFailed(fetchUrl);

  return withInflight(inFlightRequests, fetchUrl, async () => {
    const requestGeneration = blobCacheGeneration;

    for (let attempt = 1; attempt <= ASSET_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await authenticatedFetch(fetchUrl);
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          if (requestGeneration !== blobCacheGeneration) {
            URL.revokeObjectURL(blobUrl);
            return null;
          }
          blobUrlCache.set(fetchUrl, blobUrl);
          clearFetchFailed(fetchUrl);
          return blobUrl;
        }

        if (!isRetryableAssetStatus(res.status) || attempt === ASSET_FETCH_MAX_ATTEMPTS) {
          break;
        }
      } catch {
        if (attempt === ASSET_FETCH_MAX_ATTEMPTS) break;
      }

      await sleep(ASSET_FETCH_RETRY_BASE_MS * attempt);
    }

    markFetchFailed(fetchUrl);
    return null;
  });
};

export async function fetchAuthenticatedAssetBlobUrl(sourceUrl, options = {}) {
  const sanitized = sanitizeAssetUrl(sourceUrl);
  if (!sanitized) return null;

  const { force = false, refreshSource } = options;
  const result = await fetchProtectedBlobUrl(sourceUrl, { force });
  if (result) return result;

  const refresh = refreshSource ?? buildCoverRefreshSource(sanitized);
  if (typeof refresh !== 'function') {
    return null;
  }

  try {
    const refreshed = await refresh();
    if (typeof refreshed !== 'string' || !refreshed.trim()) {
      return null;
    }

    const prevFetchUrl = resolveApiArtifactUrl(sanitized);
    const nextSanitized = sanitizeAssetUrl(refreshed);
    const nextFetchUrl = resolveApiArtifactUrl(nextSanitized);
    clearFetchFailed(prevFetchUrl);
    if (nextFetchUrl !== prevFetchUrl) {
      clearFetchFailed(nextFetchUrl);
    }

    if (nextSanitized === sanitized) {
      return fetchProtectedBlobUrl(sourceUrl, { force: true });
    }
    return fetchProtectedBlobUrl(refreshed, { force: true });
  } catch {
    return null;
  }
}

/** v2 books·북마크·manifest·progress API */

import {
  authenticatedRequest,
  makeSilentError,
  isForbiddenError,
  isNotFoundError,
  SOFT_FAIL_403_404,
  requireBookId,
  pickResponseResult,
  toUnifiedApiResponse,
} from './authApi';
import {
  toOneBasedChapterIndexOrNull,
  toPositiveNumberOrNull,
  progressPayloadFromData,
  resolveProgressLocator,
  locatorsEqual,
} from '../common/valueUtils';
import { sanitizeAssetUrl, getApiBaseUrl } from '../common/urlUtils';
import {
  normalizeStartEndLocatorsForServer,
  withNormalizedProgressLocators,
  setProgressToCache,
  removeProgressFromCache,
  getProgressFromCache,
  ensureProgressRowLocator,
} from '../common/cache/progressCache';
import { setManifestData, getManifestFromCache } from '../common/cache/manifestCache';
import { normalizeReadingProgressPercent } from '../viewer/viewerSession';
import { getStoredAccessToken } from '../security/authTokenStorage';

const DEFAULT_BOOKMARK_COLOR = '#f4f7ff';

const BOOK_LIST_SORT_VALUES = new Set(['updatedAt', 'title']);

const normalizeBookCore = (book) => {
  const coverImgUrl =
    typeof book.coverImgUrl === 'string' ? sanitizeAssetUrl(book.coverImgUrl) : '';
  return {
    id: book.id,
    title: typeof book.title === 'string' ? book.title : '',
    author: typeof book.author === 'string' ? book.author : '',
    language: book.language != null ? String(book.language) : undefined,
    coverImgUrl,
    epubPath: book.epubPath != null ? String(book.epubPath) : undefined,
    normalizationStatus: book.normalizationStatus ?? null,
    analysisStatus: book.analysisStatus ?? null,
    ruleVersion: book.ruleVersion ?? null,
    locatorVersion: book.locatorVersion ?? null,
    normalizationRunId: book.normalizationRunId ?? null,
    normalizationVersionStatus: book.normalizationVersionStatus ?? null,
    needsRenormalization: !!book.needsRenormalization,
    normalizedArtifactPath: book.normalizedArtifactPath ?? null,
    summary: book.summary === true,
    isDefault: !!book.isDefault,
  };
};

/** v2 books 응답 정규화 (목록·상세) */
const normalizeV2Book = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    ...normalizeBookCore(book),
    updatedAt: book.updatedAt ?? null,
    isFavorite: !!book.isFavorite,
  };
};

/** manifest result.book 정규화 */
export const normalizeManifestBook = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    ...normalizeBookCore(book),
    summaryUrl:
      book.summaryUrl != null ? sanitizeAssetUrl(String(book.summaryUrl)) : undefined,
  };
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
  const data = await authenticatedRequest(`/v2/books${queryString ? `?${queryString}` : ''}`);
  if (data?.isSuccess && Array.isArray(data.result)) {
    data.result = data.result.map(normalizeV2Book);
  }
  return data;
};

export const getBook = async (bookId) => {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  if (!normalizedBookId) {
    return makeSilentError('INVALID_INPUT', 'bookId는 1 이상의 정수여야 합니다.');
  }

  try {
    const data = await authenticatedRequest(`/v2/books/${normalizedBookId}`);
    if (data?.isSuccess && data.result) {
      data.result = normalizeV2Book(data.result);
    }
    return data;
  } catch (error) {
    if (isNotFoundError(error)) {
      return makeSilentError('NOT_FOUND', '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.');
    }
    if (isForbiddenError(error)) return makeSilentError('FORBIDDEN', '접근 권한이 없습니다');
    throw error;
  }
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
  if (data?.isSuccess && data.result) {
    data.result = normalizeV2Book(data.result);
  }
  return data;
};

export const toggleBookFavorite = async (bookId, favorite) => {
  try {
    const method = favorite ? 'POST' : 'DELETE';
    return await authenticatedRequest(`/v2/favorites/${bookId}`, { method });
  } catch (error) {
    console.error('도서 즐겨찾기 토글 실패:', error);
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
  const rows = Array.isArray(raw.povSummaries) ? raw.povSummaries : [];
  const povSummaries = rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const characterId = Number(row.characterId);
      if (!Number.isFinite(characterId)) return null;
      return {
        characterId,
        characterName: typeof row.characterName === 'string' ? row.characterName : '',
        summaryText: typeof row.summaryText === 'string' ? row.summaryText : '',
        isMainCharacter: Boolean(row.isMainCharacter),
      };
    })
    .filter(Boolean);
  const bookIdNum = Number(raw.bookId);
  const chapterIdxNum = Number(raw.chapterIdx);
  return {
    bookId: Number.isFinite(bookIdNum) && bookIdNum >= 1 ? bookIdNum : null,
    chapterIdx: Number.isFinite(chapterIdxNum) && chapterIdxNum >= 1 ? chapterIdxNum : null,
    chapterTitle: typeof raw.chapterTitle === 'string' ? raw.chapterTitle : '',
    povSummaries,
  };
}

const chapterPovSummariesInflight = new Map();

export const getChapterPovSummaries = async (bookId, chapterIdx) => {
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  const normalizedChapterIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (!normalizedBookId) {
    throw new Error('bookId는 1 이상의 정수여야 합니다.');
  }
  if (!normalizedChapterIdx) {
    throw new Error('chapterIdx는 1 이상의 정수여야 합니다.');
  }

  const key = `${normalizedBookId}:${normalizedChapterIdx}`;
  const existing = chapterPovSummariesInflight.get(key);
  if (existing) return existing;

  const pending = authenticatedRequest(
    `/v2/books/${normalizedBookId}/chapters/${normalizedChapterIdx}/pov-summaries`
  ).catch((error) => {
    console.error('챕터 시점 요약 조회 실패:', error);
    throw error;
  });

  chapterPovSummariesInflight.set(key, pending);
  pending.finally(() => {
    if (chapterPovSummariesInflight.get(key) === pending) {
      chapterPovSummariesInflight.delete(key);
    }
  });
  return pending;
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
    const data = await authenticatedRequest(`/v2/bookmarks?${queryParams.toString()}`);
    if (data?.isSuccess && Array.isArray(data.result)) {
      data.result = data.result.map(normalizeBookmarkDto);
    }
    return data;
  } catch (error) {
    console.error('북마크 목록 조회 실패:', error);
    throw error;
  }
};

export const loadBookmarks = async (bookId, sort = 'time_desc') => {
  const response = await getBookmarks(bookId, sort);
  if (response?.isSuccess) {
    return Array.isArray(response.result) ? response.result : [];
  }
  throw new Error(response?.message || '북마크 목록을 불러오지 못했습니다.');
};

const buildPatchBody = (updateData) => {
  const body = {};
  if (updateData?.color !== undefined) body.color = updateData.color;
  if (updateData?.memo !== undefined) body.memo = updateData.memo;
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
      color: bookmarkData.color ?? DEFAULT_BOOKMARK_COLOR,
      memo: bookmarkData.memo ?? '',
    };
    if (endLocator) {
      dataToSend.endLocator = endLocator;
    }
    const data = await authenticatedRequest('/v2/bookmarks', {
      method: 'POST',
      body: JSON.stringify(dataToSend),
    });
    if (data?.isSuccess && data.result) {
      data.result = normalizeBookmarkDto(data.result);
    }
    return data;
  } catch (error) {
    console.error('북마크 생성 실패:', error);
    throw error;
  }
};

export const updateBookmark = async (bookmarkId, updateData) => {
  if (bookmarkId == null || bookmarkId === '') {
    throw new Error('bookmarkId는 필수입니다.');
  }
  const body = buildPatchBody(updateData);
  if (Object.keys(body).length === 0) {
    throw new Error('수정할 color 또는 memo가 필요합니다.');
  }
  try {
    const data = await authenticatedRequest(`/v2/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (data?.isSuccess && data.result) {
      data.result = normalizeBookmarkDto(data.result);
    }
    return data;
  } catch (error) {
    console.error('북마크 수정 실패:', error);
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
    console.error('북마크 삭제 실패:', error);
    throw error;
  }
};

// ─── progress ──────────────────────────────────────────────────────────────

const PROGRESS_FORBIDDEN = makeSilentError('FORBIDDEN', '해당 책에 접근할 권한이 없습니다');
const PROGRESS_NOT_FOUND = makeSilentError('NOT_FOUND', '진도 정보를 찾을 수 없습니다');

const handleProgressApiError = (error, logContext) => {
  if (isForbiddenError(error)) return PROGRESS_FORBIDDEN;
  if (isNotFoundError(error)) return PROGRESS_NOT_FOUND;
  if (logContext) console.error(logContext, error);
  throw error;
};

/** softFail 응답의 FORBIDDEN/NOT_FOUND → silent error (해당 없으면 null) */
const mapProgressSoftFailCode = (response, { includeNotFound = true } = {}) => {
  if (response?.code === 'FORBIDDEN') return PROGRESS_FORBIDDEN;
  if (includeNotFound && response?.code === 'NOT_FOUND') return PROGRESS_NOT_FOUND;
  return null;
};

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
      error.status = response?.status;
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
    if (isForbiddenError(error)) return PROGRESS_FORBIDDEN;
    console.error('독서 진도 저장 실패:', error);
    throw error;
  }
};

export const saveProgressKeepalive = (progressData) => {
  try {
    const payload = buildProgressSavePayload(progressData);
    if (!payload) return false;
    const token = getStoredAccessToken();

    fetch(`${getApiBaseUrl()}/api/v2/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => void 0);

    return true;
  } catch {
    return false;
  }
};

export const getBookProgress = async (bookId, options = {}) => {
  if (!bookId) return makeSilentError('INVALID_INPUT', 'bookId는 필수 매개변수입니다.');

  if (options?.skipCache !== true) {
    const cachedProgress = getProgressFromCache(bookId);
    if (cachedProgress) {
      return toUnifiedApiResponse({
        isSuccess: true,
        code: 'CACHE_HIT',
        message: '진도 정보를 로컬 캐시에서 가져왔습니다',
        result: cachedProgress,
        fromCache: true,
      });
    }
  }

  try {
    const response = await authenticatedRequest(`/v2/progress/${bookId}`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    const softFail = mapProgressSoftFailCode(response);
    if (softFail) return softFail;
    if (response?.isSuccess && response.result) {
      const base = { ...response.result };
      const prev = getProgressFromCache(bookId);
      const newLoc = resolveProgressLocator(ensureProgressRowLocator(String(bookId), base));
      const prevLoc = resolveProgressLocator(prev ?? {});
      const sameLoc = newLoc && prevLoc && locatorsEqual(newLoc, prevLoc);
      const pct =
        normalizeReadingProgressPercent(base, { bookId }) ??
        (sameLoc ? normalizeReadingProgressPercent(prev ?? {}, { bookId }) : null);
      const row = pct != null ? { ...base, readingProgressPercent: pct } : base;
      setProgressToCache(row);
      const hydrated = getProgressFromCache(bookId);
      return toUnifiedApiResponse(
        { ...response, result: hydrated ?? row },
        { defaultMessage: '진도 정보를 조회했습니다.' }
      );
    }
    return toUnifiedApiResponse(response, { defaultMessage: '진도 정보를 조회했습니다.' });
  } catch (error) {
    return handleProgressApiError(error);
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
    return handleProgressApiError(error, '독서 진도 삭제 실패:');
  }
};

// ─── manifest ──────────────────────────────────────────────────────────────

export const getBookManifest = async (bookId, { forceRefresh = false } = {}) => {
  const numericBookId = Number(bookId);
  if (!Number.isFinite(numericBookId) || numericBookId < 1) {
    return makeSilentError('INVALID_INPUT', 'bookId는 1 이상의 정수여야 합니다.');
  }

  try {
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
    }

    const response = await authenticatedRequest(`/v2/books/${numericBookId}/manifest`, {
      softFailStatuses: SOFT_FAIL_403_404,
    });
    if (response?.code === 'NOT_FOUND') {
      return makeSilentError(
        'NOT_FOUND',
        '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.'
      );
    }
    if (response?.code === 'FORBIDDEN') {
      return makeSilentError('FORBIDDEN', '접근 권한이 없습니다');
    }

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
    if (error.status === 400 || String(error?.message ?? '').includes('400')) {
      return makeSilentError('BAD_REQUEST', '잘못된 요청입니다.');
    }
    if (isNotFoundError(error)) {
      return makeSilentError(
        'NOT_FOUND',
        '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.'
      );
    }
    console.error('Manifest 조회 실패:', error);
    throw error;
  }
};

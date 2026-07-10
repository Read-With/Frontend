/** v2 books·북마크 API */

import { authenticatedRequest, makeSilentError, isForbiddenError, isNotFoundError } from './authApi';
import { toLocator, locatorsEqual } from '../common/locatorUtils';
import { toOneBasedChapterIndexOrNull, toPositiveNumberOrNull } from '../common/valueUtils';
import { sanitizeAssetUrl } from '../common/urlUtils';

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
export const normalizeV2Book = (book) => {
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

export const getChapterPovSummaries = async (bookId, chapterIdx) => {
  try {
    const normalizedBookId = toPositiveNumberOrNull(bookId);
    const normalizedChapterIdx = toOneBasedChapterIndexOrNull(chapterIdx);
    if (!normalizedBookId) {
      throw new Error('bookId는 1 이상의 정수여야 합니다.');
    }
    if (!normalizedChapterIdx) {
      throw new Error('chapterIdx는 1 이상의 정수여야 합니다.');
    }
    return await authenticatedRequest(
      `/v2/books/${normalizedBookId}/chapters/${normalizedChapterIdx}/pov-summaries`
    );
  } catch (error) {
    console.error('챕터 시점 요약 조회 실패:', error);
    throw error;
  }
};

const normalizeBookmarkDto = (b) => {
  if (!b || typeof b !== 'object') return b;
  return {
    ...b,
    rangeBookmark: !!(b.isRangeBookmark ?? b.rangeBookmark),
  };
};

const BOOKMARK_SORT = new Set(['time_desc', 'time_asc']);

export const getBookmarks = async (bookId, sort = 'time_desc') => {
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
  const startLocator = toLocator(bookmarkData.startLocator);
  if (!startLocator) {
    throw new Error('startLocator는 필수입니다.');
  }
  try {
    const endLocator = toLocator(bookmarkData.endLocator);
    const dataToSend = {
      bookId: normalizedBookId,
      startLocator,
      color: bookmarkData.color ?? '#28B532',
      memo: bookmarkData.memo ?? '',
    };
    if (endLocator && !locatorsEqual(startLocator, endLocator)) {
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

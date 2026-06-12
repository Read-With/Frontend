import { authenticatedRequest } from './authApi';
import { toOneBasedChapterIndexOrNull } from '../common/numberUtils';
import { sanitizeAssetUrl } from '../common/artifactUrlUtils';

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

/** GET /api/v2/books, /api/v2/books/{bookId} — 목록·상세 도서 메타 */
export const normalizeV2Book = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    ...normalizeBookCore(book),
    updatedAt: book.updatedAt ?? null,
    isFavorite: !!book.isFavorite,
  };
};

/** GET /api/v2/books/{bookId}/manifest — result.book */
export const normalizeManifestBook = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    ...normalizeBookCore(book),
    summaryUrl:
      book.summaryUrl != null ? sanitizeAssetUrl(String(book.summaryUrl)) : undefined,
  };
};

const toSilentError = (code, message) => ({ isSuccess: false, code, message, result: null });

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

/** GET /api/v2/books — 정규화 완료(노출 가능) 도서 목록 */
export const getBooks = async (params = {}) => {
  const queryString = buildBooksQueryString(params);
  const data = await authenticatedRequest(`/v2/books${queryString ? `?${queryString}` : ''}`);
  if (data?.isSuccess && Array.isArray(data.result)) {
    data.result = data.result.map(normalizeV2Book);
  }
  return data;
};

/** GET /api/v2/books/{bookId} — 정규화 완료(노출 가능) 도서 상세 */
export const getBook = async (bookId) => {
  const normalizedBookId = toOneBasedChapterIndexOrNull(bookId);
  if (!normalizedBookId) {
    return toSilentError('INVALID_INPUT', 'bookId는 1 이상의 정수여야 합니다.');
  }

  try {
    const data = await authenticatedRequest(`/v2/books/${normalizedBookId}`);
    if (data?.isSuccess && data.result) {
      data.result = normalizeV2Book(data.result);
    }
    return data;
  } catch (error) {
    if (error.status === 404) {
      return toSilentError('NOT_FOUND', '도서를 찾을 수 없거나 아직 노출 가능한 상태가 아닙니다.');
    }
    if (error.status === 403) return toSilentError('FORBIDDEN', '접근 권한이 없습니다');
    throw error;
  }
};

/** POST /api/v2/books — EPUB 업로드 */
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
    const data = await authenticatedRequest(`/v2/favorites/${bookId}`, { method });
    return data;
  } catch (error) {
    console.error('도서 즐겨찾기 토글 실패:', error);
    throw error;
  }
};

export const getChapterPovSummaries = async (bookId, chapterIdx) => {
  try {
    const normalizedBookId = toOneBasedChapterIndexOrNull(bookId);
    const normalizedChapterIdx = toOneBasedChapterIndexOrNull(chapterIdx);
    if (!normalizedBookId) {
      throw new Error('bookId는 1 이상의 정수여야 합니다.');
    }
    if (!normalizedChapterIdx) {
      throw new Error('chapterIdx는 1 이상의 정수여야 합니다.');
    }
    const data = await authenticatedRequest(
      `/v2/books/${normalizedBookId}/chapters/${normalizedChapterIdx}/pov-summaries`
    );
    return data;
  } catch (error) {
    console.error('챕터 시점 요약 조회 실패:', error);
    throw error;
  }
};

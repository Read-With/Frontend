import { authenticatedRequest } from './authApi';

export const normalizeV2Book = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    favorite: !!(book.isFavorite ?? book.favorite),
  };
};

const toSilentError = (code, message) => ({ isSuccess: false, code, message, result: null });

export const getBooks = async (params = {}) => {
  const queryParams = new URLSearchParams();
  if (params.q) queryParams.append('q', params.q);
  if (params.language) queryParams.append('language', params.language);
  if (params.sort) queryParams.append('sort', params.sort);
  if (params.favorite !== undefined) queryParams.append('favorite', String(params.favorite));
  const queryString = queryParams.toString();
  const data = await authenticatedRequest(`/v2/books${queryString ? `?${queryString}` : ''}`);
  if (data?.isSuccess && Array.isArray(data.result)) {
    data.result = data.result.map(normalizeV2Book);
  }
  return data;
};

export const getBook = async (bookId) => {
  try {
    const data = await authenticatedRequest(`/v2/books/${bookId}`);
    if (data?.isSuccess && data.result) {
      data.result = normalizeV2Book(data.result);
    }
    return data;
  } catch (error) {
    if (error.status === 404) return toSilentError('NOT_FOUND', '데이터를 찾을 수 없습니다');
    if (error.status === 403) return toSilentError('FORBIDDEN', '접근 권한이 없습니다');
    throw error;
  }
};

export const deleteBook = async (bookId) => {
  try {
    return await authenticatedRequest(`/books/${bookId}`, { method: 'DELETE' });
  } catch (error) {
    if (error.status === 404) return toSilentError('NOT_FOUND', '데이터를 찾을 수 없습니다');
    if (error.status === 403) return toSilentError('FORBIDDEN', '접근 권한이 없습니다');
    throw error;
  }
};

export const getFavorites = async () => {
  try {
    const response = await authenticatedRequest('/v2/favorites');
    if (response?.isSuccess && Array.isArray(response.result)) {
      response.result = response.result.map(normalizeV2Book);
    }
    return response;
  } catch (error) {
    console.error('즐겨찾기 목록 조회 실패:', error);
    throw error;
  }
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
    const bid = Number(bookId);
    const ch = Number(chapterIdx);
    if (!Number.isFinite(bid) || bid < 1) {
      throw new Error('bookId는 1 이상의 정수여야 합니다.');
    }
    if (!Number.isFinite(ch) || ch < 1) {
      throw new Error('chapterIdx는 1 이상의 정수여야 합니다.');
    }
    const data = await authenticatedRequest(
      `/v2/books/${Math.floor(bid)}/chapters/${Math.floor(ch)}/pov-summaries`
    );
    return data;
  } catch (error) {
    console.error('챕터 시점 요약 조회 실패:', error);
    throw error;
  }
};

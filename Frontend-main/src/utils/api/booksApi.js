export { 
  getBooks, 
  uploadBook, 
  getBook, 
  deleteBook,
  getFavorites 
} from './api';

import { authenticatedRequest } from './authApi';

export const toggleBookFavorite = async (bookId, favorite) => {
  try {
    const method = favorite ? 'POST' : 'DELETE';
    const data = await authenticatedRequest(`/v2/favorites/${bookId}`, {
      method,
    });
    return data;
  } catch (error) {
    console.error('도서 즐겨찾기 토글 실패:', error);
    throw error;
  }
};

/**
 * GET /api/v2/books/{bookId}/chapters/{chapterIdx}/pov-summaries
 * chapterIdx: 1-based (path에 정수만 사용)
 */
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

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
    const data = await authenticatedRequest(`/favorites/${bookId}`, {
      method,
    });
    return data;
  } catch (error) {
    console.error('도서 즐겨찾기 토글 실패:', error);
    throw error;
  }
};

export const getChapterPovSummaries = async (bookId, chapterIdx) => {
  try {
    if (!bookId || !chapterIdx) {
      throw new Error('bookId와 chapterIdx는 필수 매개변수입니다.');
    }
    
    const data = await authenticatedRequest(`/books/${bookId}/chapters/${chapterIdx}/pov-summaries`);
    return data;
  } catch (error) {
    console.error('챕터 시점 요약 조회 실패:', error);
    throw error;
  }
};

import { getBookmarks, createBookmark, updateBookmark, deleteBookmark } from '../../../utils/api';

// 북마크 데이터 구조 개선
const createBookmarkData = (bookId, startCfi, endCfi = null, color = '#0Ccd5B', memo = '') => ({
  bookId,
  startCfi,
  endCfi,
  color,
  memo
});

// 북마크 목록 조회 (서버에서)
export const loadBookmarks = async (bookId) => {
  try {
    const response = await getBookmarks(bookId);
    if (response.isSuccess) {
      return response.result || [];
    }
    return [];
  } catch (error) {
    return [];
  }
};

// 북마크 추가 (서버에 저장)
export const addBookmark = async (bookId, startCfi, endCfi = null, color = '#0Ccd5B', memo = '') => {
  try {
    const bookmarkData = createBookmarkData(bookId, startCfi, endCfi, color, memo);
    const response = await createBookmark(bookmarkData);
    
    if (response.isSuccess) {
      return { success: true, bookmark: response.result };
    } else {
      return { success: false, message: response.message || '북마크 생성에 실패했습니다.' };
    }
  } catch (error) {
    return { success: false, message: '북마크 추가에 실패했습니다.' };
  }
};

// 북마크 수정
export const modifyBookmark = async (bookmarkId, color, memo) => {
  try {
    const response = await updateBookmark(bookmarkId, { color, memo });
    
    if (response.isSuccess) {
      return { success: true, bookmark: response.result };
    } else {
      return { success: false, message: response.message || '북마크 수정에 실패했습니다.' };
    }
  } catch (error) {
    return { success: false, message: '북마크 수정에 실패했습니다.' };
  }
};

// 북마크 삭제
export const removeBookmark = async (bookmarkId) => {
  try {
    const response = await deleteBookmark(bookmarkId);
    
    if (response.isSuccess) {
      return { success: true };
    } else {
      return { success: false, message: response.message || '북마크 삭제에 실패했습니다.' };
    }
  } catch (error) {
    return { success: false, message: '북마크 삭제에 실패했습니다.' };
  }
};

// 로컬 스토리지 백업 함수들 (오프라인 지원용)
export const saveBookmarksToLocal = (bookId, bookmarks) => {
  try {
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(bookmarks));
    return true;
  } catch (error) {
    return false;
  }
};

export const loadBookmarksFromLocal = (bookId) => {
  try {
    const stored = localStorage.getItem(`bookmarks_${bookId}`);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
};
  
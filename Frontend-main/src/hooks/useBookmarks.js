import { useState, useEffect, useCallback } from 'react';
import { getBookmarks, createBookmark, updateBookmark, deleteBookmark } from '../utils/api/bookmarksApi';

/**
 * 북마크 관리를 위한 커스텀 훅
 * @param {number} bookId - 책 ID
 * @param {string} sort - 정렬 방식 (time_desc, time_asc)
 */
export const useBookmarks = (bookId, sort = 'time_desc') => {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 북마크 목록 조회
  const fetchBookmarks = useCallback(async () => {
    if (!bookId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await getBookmarks(bookId, sort);
      if (response.isSuccess) {
        setBookmarks(response.result || []);
      } else {
        setError(response.message || '북마크 조회에 실패했습니다.');
      }
    } catch (err) {
      setError(err.message || '북마크 조회 중 오류가 발생했습니다.');
      console.error('북마크 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [bookId, sort]);

  // 북마크 생성
  const addBookmark = useCallback(async (bookmarkData) => {
    try {
      const response = await createBookmark(bookmarkData);
      if (response.isSuccess) {
        setBookmarks(prev => [response.result, ...prev]);
        return { success: true, bookmark: response.result };
      } else {
        return { success: false, message: response.message || '북마크 생성에 실패했습니다.' };
      }
    } catch (err) {
      const errorMessage = err.message || '북마크 생성 중 오류가 발생했습니다.';
      console.error('북마크 생성 실패:', err);
      return { success: false, message: errorMessage };
    }
  }, []);

  // 북마크 수정
  const modifyBookmark = useCallback(async (bookmarkId, updateData) => {
    try {
      const response = await updateBookmark(bookmarkId, updateData);
      if (response.isSuccess) {
        setBookmarks(prev => prev.map(bookmark => 
          bookmark.id === bookmarkId ? { ...bookmark, ...response.result } : bookmark
        ));
        return { success: true, bookmark: response.result };
      } else {
        return { success: false, message: response.message || '북마크 수정에 실패했습니다.' };
      }
    } catch (err) {
      const errorMessage = err.message || '북마크 수정 중 오류가 발생했습니다.';
      console.error('북마크 수정 실패:', err);
      return { success: false, message: errorMessage };
    }
  }, []);

  // 북마크 삭제
  const removeBookmark = useCallback(async (bookmarkId) => {
    try {
      const response = await deleteBookmark(bookmarkId);
      if (response.isSuccess) {
        setBookmarks(prev => prev.filter(bookmark => bookmark.id !== bookmarkId));
        return { success: true };
      } else {
        return { success: false, message: response.message || '북마크 삭제에 실패했습니다.' };
      }
    } catch (err) {
      const errorMessage = err.message || '북마크 삭제 중 오류가 발생했습니다.';
      console.error('북마크 삭제 실패:', err);
      return { success: false, message: errorMessage };
    }
  }, []);

  // 북마크 색상 변경
  const changeBookmarkColor = useCallback(async (bookmarkId, color) => {
    return await modifyBookmark(bookmarkId, { color });
  }, [modifyBookmark]);

  // 북마크 메모 변경
  const changeBookmarkMemo = useCallback(async (bookmarkId, memo) => {
    return await modifyBookmark(bookmarkId, { memo });
  }, [modifyBookmark]);

  // 북마크 정렬
  const sortBookmarks = useCallback((sortOrder) => {
    const sorted = [...bookmarks].sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      
      switch (sortOrder) {
        case 'time_asc':
          return dateA - dateB;
        case 'time_desc':
        default:
          return dateB - dateA;
      }
    });
    
    setBookmarks(sorted);
  }, [bookmarks]);

  // 초기 로드
  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  return {
    bookmarks,
    loading,
    error,
    fetchBookmarks,
    addBookmark,
    modifyBookmark,
    removeBookmark,
    changeBookmarkColor,
    changeBookmarkMemo,
    sortBookmarks,
  };
};

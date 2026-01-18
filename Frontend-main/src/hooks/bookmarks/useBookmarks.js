import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { createBookmark, updateBookmark, deleteBookmark } from '../../utils/api/bookmarksApi';
import { 
  loadBookmarks as loadBookmarksFromManager, 
  addBookmark as addBookmarkFromManager,
  loadBookmarksFromLocal,
  saveBookmarksToLocal
} from '../../components/viewer/bookmark/BookmarkManager';
import { cfiUtils } from '../../utils/common/cfiUtils';
import { createBookmarkTitle } from '../../utils/bookmarkUtils';

export const useBookmarks = (bookId, options = {}) => {
  const { 
    sort = 'time_desc',
    isLocalBook = false,
    viewerRef = null,
    setFailCount = null,
    autoFetch = true
  } = typeof options === 'string' ? { sort: options } : options;
  
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showBookmarkList, setShowBookmarkList] = useState(false);

  const fetchBookmarks = useCallback(async () => {
    if (!bookId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      if (isLocalBook) {
        const localBookmarks = loadBookmarksFromLocal(bookId);
        setBookmarks(localBookmarks || []);
      } else {
        let bookmarksData = await loadBookmarksFromManager(bookId);
        if (sort && sort !== 'time_desc') {
          const sorted = [...(bookmarksData || [])];
          const factor = sort === 'time_asc' ? 1 : -1;
          bookmarksData = sorted.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.created_at || 0).getTime();
            const dateB = new Date(b.createdAt || b.created_at || 0).getTime();
            return (dateA - dateB) * factor;
          });
        }
        setBookmarks(bookmarksData || []);
      }
    } catch (err) {
      setError(err.message || '북마크 조회 중 오류가 발생했습니다.');
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, [bookId, sort, isLocalBook]);

  const addBookmark = useCallback(async (bookmarkData) => {
    if (isLocalBook && typeof bookmarkData === 'object' && bookmarkData.startCfi) {
      const newBookmark = {
        id: Date.now().toString(),
        ...bookmarkData,
        createdAt: bookmarkData.createdAt || new Date().toISOString()
      };
      setBookmarks(prev => {
        const updatedBookmarks = [...prev, newBookmark];
        saveBookmarksToLocal(bookId, updatedBookmarks);
        return updatedBookmarks;
      });
      toast.success("📖 북마크가 추가되었습니다");
      return { success: true, bookmark: newBookmark };
    }
    
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
      return { success: false, message: errorMessage };
    }
  }, [bookId, isLocalBook]);

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
      return { success: false, message: errorMessage };
    }
  }, []);

  const removeBookmark = useCallback(async (bookmarkId) => {
    try {
      if (isLocalBook) {
        setBookmarks(prev => {
          const next = prev.filter(b => b.id !== bookmarkId);
          saveBookmarksToLocal(bookId, next);
          return next;
        });
        toast.success("북마크가 삭제되었습니다");
        return { success: true };
      }
      
      const response = await deleteBookmark(bookmarkId);
      if (response.isSuccess) {
        setBookmarks(prev => prev.filter(bookmark => bookmark.id !== bookmarkId));
        return { success: true };
      } else {
        return { success: false, message: response.message || '북마크 삭제에 실패했습니다.' };
      }
    } catch (err) {
      const errorMessage = err.message || '북마크 삭제 중 오류가 발생했습니다.';
      return { success: false, message: errorMessage };
    }
  }, [bookId, isLocalBook]);

  const changeBookmarkColor = useCallback(async (bookmarkId, color) => {
    return await modifyBookmark(bookmarkId, { color });
  }, [modifyBookmark]);

  const changeBookmarkMemo = useCallback(async (bookmarkId, memo) => {
    return await modifyBookmark(bookmarkId, { memo });
  }, [modifyBookmark]);


  // 북마크 추가 (뷰어 특화: CFI 자동 추출)
  const handleAddBookmark = useCallback(async () => {
    if (!viewerRef?.current) {
      toast.error("❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...");
      if (setFailCount) setFailCount((cnt) => cnt + 1);
      return;
    }
    
    let cfi = null;
    let pageNum = null;
    let chapterNum = null;
    
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
      
      if (cfi) {
        chapterNum = cfiUtils.extractChapterNumber(cfi);
        
        try {
          const bookInstance = viewerRef.current?.bookRef?.current;
          if (bookInstance?.locations) {
            const locIdx = bookInstance.locations.locationFromCfi?.(cfi);
            if (Number.isFinite(locIdx) && locIdx >= 0) {
              const totalLocations = bookInstance.locations.length?.() || 1;
              pageNum = Math.max(1, Math.min(locIdx + 1, totalLocations));
            }
          }
        } catch (e) {
          pageNum = cfiUtils.extractPageNumber(cfi);
        }
      }
    } catch (e) {
      // getCurrentCfi 에러 처리
    }
    
    if (!cfi) {
      toast.error("❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...");
      if (setFailCount) setFailCount((cnt) => cnt + 1);
      return;
    }

    if (setFailCount) setFailCount(0);

    const bookmarkTitle = createBookmarkTitle(pageNum, chapterNum, cfi, bookmarks.length + 1);
    
    // 기존 북마크가 있는지 확인
    const existingBookmark = bookmarks.find(b => b.startCfi === cfi);
    
    if (existingBookmark) {
      await removeBookmark(existingBookmark.id);
      return;
    }
    
    // 새 북마크 추가
    if (isLocalBook) {
      await addBookmark({
        startCfi: cfi,
        title: bookmarkTitle,
        pageNum: pageNum,
        chapterNum: chapterNum
      });
    } else {
      const result = await addBookmarkFromManager(bookId, cfi, null, '#28B532', '', bookmarkTitle);
      if (result.success) {
        const bookmarkWithTitle = {
          ...result.bookmark,
          title: bookmarkTitle,
          pageNum: pageNum,
          chapterNum: chapterNum
        };
        setBookmarks(prev => [...prev, bookmarkWithTitle]);
        toast.success("📖 북마크가 추가되었습니다");
      } else {
        toast.error(result.message || "북마크 추가에 실패했습니다");
      }
    }
  }, [bookId, bookmarks, isLocalBook, viewerRef, setFailCount, addBookmark, removeBookmark]);

  // 북마크 선택 (CFI로 이동)
  const handleBookmarkSelect = useCallback((cfi) => {
    viewerRef?.current?.displayAt(cfi);
    setShowBookmarkList(false);
  }, [viewerRef]);

  // 호환성을 위해 handleRemoveBookmark, handleDeleteBookmark 노출
  const handleRemoveBookmark = removeBookmark;
  const handleDeleteBookmark = removeBookmark;

  useEffect(() => {
    if (autoFetch) {
      fetchBookmarks();
    }
  }, [fetchBookmarks, autoFetch]);

  const returnValue = {
    bookmarks,
    setBookmarks,
    loading,
    error,
    fetchBookmarks,
    addBookmark,
    modifyBookmark,
    removeBookmark,
    changeBookmarkColor,
    changeBookmarkMemo,
  };

  // 뷰어 특화 기능이 있으면 추가로 노출
  if (viewerRef) {
    returnValue.handleAddBookmark = handleAddBookmark;
    returnValue.handleRemoveBookmark = handleRemoveBookmark;
    returnValue.handleDeleteBookmark = handleDeleteBookmark;
    returnValue.handleBookmarkSelect = handleBookmarkSelect;
    returnValue.showBookmarkList = showBookmarkList;
    returnValue.setShowBookmarkList = setShowBookmarkList;
    returnValue.bookmarksLoading = loading; // 호환성을 위해
  }

  return returnValue;
};

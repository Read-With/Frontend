import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import { createBookmark, updateBookmark, deleteBookmark } from '../../utils/api/bookmarksApi';
import { 
  loadBookmarks as loadBookmarksFromManager, 
  addBookmark as addBookmarkFromManager,
  loadBookmarksFromLocal,
  saveBookmarksToLocal
} from '../../components/viewer/bookmark/BookmarkManager';
import { cfiUtils } from '../../utils/common/cfiUtils';
import { createBookmarkTitle, isValidLocator, isSameBookmarkPosition } from '../../utils/bookmarkUtils';

const getErrorMessage = (err, fallback) =>
  err?.message ?? (typeof err === 'string' ? err : fallback);

const getBookmarkFriendlyMessage = (err, fallback) => {
  if (!err) return fallback;
  const status = err.status || err.statusCode;
  if (status === 404)
    return '북마크 기능이 아직 준비되지 않았거나 연결 경로를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.';
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('networkerror'))
    return '연결을 확인한 뒤 다시 시도해 주세요.';
  return getErrorMessage(err, fallback);
};

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
  const bookmarksRef = useRef(bookmarks);
  useEffect(() => { bookmarksRef.current = bookmarks; }, [bookmarks]);

  const fetchBookmarks = useCallback(async () => {
    if (!bookId) {
      setBookmarks([]);
      setError(null);
      return;
    }
    
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
      setError(getBookmarkFriendlyMessage(err, '북마크 조회 중 오류가 발생했습니다.'));
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, [bookId, sort, isLocalBook]);

  const addBookmark = useCallback(async (bookmarkData) => {
    const hasLocator = isValidLocator(bookmarkData?.startLocator);
    const hasCfi = !!bookmarkData?.startCfi;
    if (isLocalBook && typeof bookmarkData === 'object' && (hasLocator || hasCfi)) {
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
        toast.success('📖 북마크가 추가되었습니다');
        return { success: true, bookmark: response.result };
      }
      const msg = response.message || '북마크 생성에 실패했습니다.';
      toast.error(msg);
      return { success: false, message: msg };
    } catch (err) {
      const msg = getBookmarkFriendlyMessage(err, '북마크 생성 중 오류가 발생했습니다.');
      toast.error(msg);
      return { success: false, message: msg };
    }
  }, [bookId, isLocalBook]);

  const modifyBookmark = useCallback(async (bookmarkId, updateData) => {
    try {
      const response = await updateBookmark(bookmarkId, updateData);
      if (response.isSuccess) {
        const idStr = String(bookmarkId);
        setBookmarks(prev => prev.map(bookmark =>
          String(bookmark.id) === idStr ? { ...bookmark, ...response.result } : bookmark
        ));
        toast.success('변경사항이 저장되었습니다');
        return { success: true, bookmark: response.result };
      }
      const msg = response.message || '북마크 수정에 실패했습니다.';
      toast.error(msg);
      return { success: false, message: msg };
    } catch (err) {
      const msg = getBookmarkFriendlyMessage(err, '북마크 수정 중 오류가 발생했습니다.');
      toast.error(msg);
      return { success: false, message: msg };
    }
  }, []);

  const removeBookmark = useCallback(async (bookmarkId) => {
    const idStr = String(bookmarkId);
    try {
      if (isLocalBook) {
        setBookmarks(prev => {
          const next = prev.filter(b => String(b.id) !== idStr);
          saveBookmarksToLocal(bookId, next);
          return next;
        });
        toast.success("북마크가 삭제되었습니다");
        return { success: true };
      }
      
      const response = await deleteBookmark(bookmarkId);
      if (response.isSuccess) {
        setBookmarks(prev => prev.filter(bookmark => String(bookmark.id) !== idStr));
        toast.success('북마크가 삭제되었습니다');
        return { success: true };
      }
      const msg = response.message || '북마크 삭제에 실패했습니다.';
      toast.error(msg);
      return { success: false, message: msg };
    } catch (err) {
      const msg = getBookmarkFriendlyMessage(err, '북마크 삭제 중 오류가 발생했습니다.');
      toast.error(msg);
      return { success: false, message: msg };
    }
  }, [bookId, isLocalBook]);

  const changeBookmarkColor = useCallback(async (bookmarkId, color) => {
    return await modifyBookmark(bookmarkId, { color });
  }, [modifyBookmark]);

  const changeBookmarkMemo = useCallback(async (bookmarkId, memo) => {
    return await modifyBookmark(bookmarkId, { memo });
  }, [modifyBookmark]);


  // 북마크 추가 (뷰어: getCurrentLocator 우선, locator만 저장)
  const handleAddBookmark = useCallback(async () => {
    if (!viewerRef?.current) {
      toast.error("❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...");
      if (setFailCount) setFailCount((cnt) => cnt + 1);
      return;
    }

    let startLocator = null;
    let endLocator = null;
    let cfi = null;
    let pageNum = null;
    let chapterNum = null;

    try {
      const anchor = await viewerRef.current.getCurrentLocator?.();
      if (anchor?.start) {
        startLocator = anchor.start;
        endLocator = anchor.end ?? anchor.start;
        chapterNum = startLocator.chapterIndex;
        if (Number.isFinite(startLocator.offset)) pageNum = startLocator.offset + 1;
      }
      if (!startLocator) {
        cfi = await viewerRef.current.getCurrentCfi?.();
        if (cfi) {
          try {
            const parsed = typeof cfi === 'string' ? JSON.parse(cfi) : cfi;
            if (parsed?.start && Number.isFinite(parsed.start.chapterIndex)) {
              startLocator = parsed.start;
              endLocator = parsed.end ?? parsed.start;
              chapterNum = startLocator.chapterIndex;
            }
          } catch (_) {}
          if (chapterNum == null) chapterNum = cfiUtils.extractChapterNumber(cfi);
          if (pageNum == null) {
            try {
              const bookInstance = viewerRef.current?.getBookInstance?.() ?? viewerRef.current?.bookRef?.current;
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
        }
      }
    } catch (e) {}

    if (!startLocator && !cfi) {
      toast.error("❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...");
      if (setFailCount) setFailCount((cnt) => cnt + 1);
      return;
    }

    if (setFailCount) setFailCount(0);

    const currentList = bookmarksRef.current;
    const bookmarkTitle = createBookmarkTitle(pageNum, chapterNum, startLocator ? null : cfi, currentList.length + 1);
    const existingBookmark = currentList.find((b) =>
      isSameBookmarkPosition(b, { startLocator, endLocator, startCfi: cfi, endCfi: null })
    );

    if (existingBookmark) {
      await removeBookmark(existingBookmark.id);
      return;
    }

    if (isLocalBook) {
      await addBookmark({
        startLocator: startLocator ?? undefined,
        endLocator: endLocator ?? undefined,
        startCfi: cfi ?? undefined,
        endCfi: null,
        title: bookmarkTitle,
        pageNum,
        chapterNum,
      });
    } else {
      const result = await addBookmarkFromManager(
        bookId,
        cfi ?? null,
        null,
        '#28B532',
        '',
        bookmarkTitle,
        startLocator,
        endLocator
      );
      if (result.success) {
        const bookmarkWithTitle = {
          ...result.bookmark,
          title: bookmarkTitle,
          pageNum,
          chapterNum,
        };
        setBookmarks(prev => [...prev, bookmarkWithTitle]);
        toast.success('📖 북마크가 추가되었습니다');
      } else {
        toast.error(result.message || '북마크 추가에 실패했습니다.');
      }
    }
  }, [bookId, isLocalBook, viewerRef, setFailCount, addBookmark, removeBookmark]);

  // 북마크 선택 (CFI 문자열 또는 locator 객체로 이동)
  const handleBookmarkSelect = useCallback((target) => {
    viewerRef?.current?.displayAt(target);
    setShowBookmarkList(false);
  }, [viewerRef]);

  // 호환성을 위해 handleRemoveBookmark, handleDeleteBookmark 노출
  const handleRemoveBookmark = removeBookmark;
  const handleDeleteBookmark = removeBookmark;

  useEffect(() => {
    if (!bookId) {
      setBookmarks([]);
      setError(null);
      return;
    }
    if (autoFetch) fetchBookmarks();
  }, [bookId, autoFetch, fetchBookmarks]);

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

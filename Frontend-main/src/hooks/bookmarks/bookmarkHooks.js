/** 북마크 CRUD·뷰어 추가·정렬 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'react-toastify';
import { createBookmark, updateBookmark, deleteBookmark } from '../../utils/api/booksApi';
import {
  createBookmarkTitle,
  createBookmarkData,
  isSameBookmarkPosition,
  getBookmarkPositionSortKey,
  loadBookmarks as loadBookmarksFromApi,
} from '../../utils/bookmarks/bookmarkUtils';

const DEFAULT_VIEWER_BOOKMARK_COLOR = '#28B532';

const hasBookId = (id) => id != null && id !== '';

const getErrorMessage = (err, fallback) =>
  err?.message ?? (typeof err === 'string' ? err : fallback);

const getBookmarkFriendlyMessage = (err, fallback) => {
  if (!err) return fallback;
  const status = err.status || err.statusCode;
  if (status === 404) {
    return '북마크 기능이 아직 준비되지 않았거나 연결 경로를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.';
  }
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('networkerror')) {
    return '연결을 확인한 뒤 다시 시도해 주세요.';
  }
  return getErrorMessage(err, fallback);
};

export const useBookmarkSort = (bookmarks, sortOrder) => {
  return useMemo(() => {
    if (!bookmarks || bookmarks.length === 0) return [];
    const sorted = [...bookmarks];
    if (sortOrder === 'position') {
      return sorted.sort((a, b) => {
        const keyA = getBookmarkPositionSortKey(a) || '';
        const keyB = getBookmarkPositionSortKey(b) || '';
        return keyA.localeCompare(keyB);
      });
    }
    const factor = sortOrder === 'oldest' ? 1 : -1;
    return sorted.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || 0).getTime();
      const dateB = new Date(b.createdAt || b.created_at || 0).getTime();
      return (dateA - dateB) * factor;
    });
  }, [bookmarks, sortOrder]);
};

export const useBookmarks = (bookId, options = {}) => {
  const {
    sort = 'time_desc',
    viewerRef = null,
    setFailCount = null,
    autoFetch = true,
  } = typeof options === 'string' ? { sort: options } : options;

  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  const bookmarksRef = useRef(bookmarks);
  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  const fetchBookmarks = useCallback(async () => {
    if (!bookId) {
      setBookmarks([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const bookmarksData = await loadBookmarksFromApi(bookId, sort);
      setBookmarks(bookmarksData || []);
    } catch (err) {
      setError(getBookmarkFriendlyMessage(err, '북마크 조회 중 오류가 발생했습니다.'));
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, [bookId, sort]);

  const addBookmark = useCallback(async (bookmarkData, mergeIntoBookmark = null) => {
    try {
      const response = await createBookmark(bookmarkData);
      if (response.isSuccess) {
        const bookmark =
          mergeIntoBookmark && typeof mergeIntoBookmark === 'object'
            ? { ...response.result, ...mergeIntoBookmark }
            : response.result;
        setBookmarks((prev) => [bookmark, ...prev]);
        toast.success('📖 북마크가 추가되었습니다');
        return { success: true, bookmark };
      }
      const msg = response.message || '북마크 생성에 실패했습니다.';
      toast.error(msg);
      return { success: false, message: msg };
    } catch (err) {
      const msg = getBookmarkFriendlyMessage(err, '북마크 생성 중 오류가 발생했습니다.');
      toast.error(msg);
      return { success: false, message: msg };
    }
  }, []);

  const modifyBookmark = useCallback(async (bookmarkId, updateData) => {
    try {
      const response = await updateBookmark(bookmarkId, updateData);
      if (response.isSuccess) {
        const idStr = String(bookmarkId);
        setBookmarks((prev) =>
          prev.map((bookmark) =>
            String(bookmark.id) === idStr ? { ...bookmark, ...response.result } : bookmark
          )
        );
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
      const response = await deleteBookmark(bookmarkId);
      if (response.isSuccess) {
        setBookmarks((prev) => prev.filter((bookmark) => String(bookmark.id) !== idStr));
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
  }, []);

  const changeBookmarkColor = useCallback(
    async (bookmarkId, color) => modifyBookmark(bookmarkId, { color }),
    [modifyBookmark]
  );

  const changeBookmarkMemo = useCallback(
    async (bookmarkId, memo) => modifyBookmark(bookmarkId, { memo }),
    [modifyBookmark]
  );

  const handleAddBookmark = useCallback(async () => {
    if (!viewerRef?.current) {
      toast.error('❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...');
      if (setFailCount) setFailCount((cnt) => cnt + 1);
      return;
    }

    let startLocator = null;
    let endLocator = null;
    let pageNum = null;
    let chapterNum = null;

    try {
      const loc = await viewerRef.current.getCurrentLocator?.();
      if (loc?.startLocator ?? loc?.start) {
        startLocator = loc.startLocator ?? loc.start;
        endLocator = loc.endLocator ?? loc.end ?? startLocator;
        chapterNum = startLocator.chapterIndex;
        if (Number.isFinite(startLocator.offset)) pageNum = startLocator.offset + 1;
      }
    } catch {
      /* ignore */
    }

    if (!startLocator) {
      toast.error('❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...');
      if (setFailCount) setFailCount((cnt) => cnt + 1);
      return;
    }

    if (setFailCount) setFailCount(0);

    if (!hasBookId(bookId)) {
      toast.error('책 정보가 없어 북마크를 추가할 수 없습니다.');
      return;
    }

    const currentList = bookmarksRef.current;
    const bookmarkTitle = createBookmarkTitle(pageNum, chapterNum, currentList.length + 1);
    const existingBookmark = currentList.find((b) =>
      isSameBookmarkPosition(b, { startLocator, endLocator })
    );

    if (existingBookmark) {
      await removeBookmark(existingBookmark.id);
      return;
    }

    await addBookmark(
      createBookmarkData(bookId, DEFAULT_VIEWER_BOOKMARK_COLOR, '', startLocator, endLocator),
      { title: bookmarkTitle, pageNum, chapterNum }
    );
  }, [bookId, viewerRef, setFailCount, addBookmark, removeBookmark]);

  const handleBookmarkSelect = useCallback(
    (target) => {
      viewerRef?.current?.displayAt(target);
      setShowBookmarkList(false);
    },
    [viewerRef]
  );

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

  if (viewerRef) {
    returnValue.handleAddBookmark = handleAddBookmark;
    returnValue.handleRemoveBookmark = handleRemoveBookmark;
    returnValue.handleDeleteBookmark = handleDeleteBookmark;
    returnValue.handleBookmarkSelect = handleBookmarkSelect;
    returnValue.showBookmarkList = showBookmarkList;
    returnValue.setShowBookmarkList = setShowBookmarkList;
    returnValue.bookmarksLoading = loading;
  }

  return returnValue;
};

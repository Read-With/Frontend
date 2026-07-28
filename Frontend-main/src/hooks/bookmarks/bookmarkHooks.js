/** 북마크 CRUD·뷰어 추가·정렬 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'react-toastify';
import { createBookmark, updateBookmark, deleteBookmark, loadBookmarks as loadBookmarksFromApi } from '../../utils/api/booksApi';
import {
  createBookmarkData,
  isSameBookmarkPosition,
  waitForBookmarkAxisReady,
  clientSortToApiSort,
} from '../../utils/bookmarks/bookmarkUtils';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import { resolveReadingLocators } from '../../utils/viewer/viewerSession';

const friendlyError = (err, fallback) => {
  if (!err) return fallback;
  if (err.status === 404 || err.statusCode === 404) {
    return '북마크 기능이 아직 준비되지 않았거나 연결 경로를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.';
  }
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return '연결을 확인한 뒤 다시 시도해 주세요.';
  }
  return err.message || fallback;
};

export const useBookmarks = (bookId, options = {}) => {
  const { viewerRef = null, setFailCount = null, sortOrder = 'recent' } = options;
  const apiBookId = useMemo(() => toPositiveNumberOrNull(bookId), [bookId]);
  const apiSort = clientSortToApiSort(sortOrder);

  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isMutating, setIsMutating] = useState(false);
  const bookmarksRef = useRef(bookmarks);
  const mutatingRef = useRef(false);

  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  const runMutation = useCallback(async (request, onSuccess, messages) => {
    if (mutatingRef.current) {
      toast.info('이전 요청을 처리 중입니다.');
      return { success: false };
    }
    mutatingRef.current = true;
    setIsMutating(true);
    try {
      const response = await request();
      if (!response.isSuccess) {
        const msg = response.message || messages.fail;
        toast.error(msg);
        return { success: false, message: msg };
      }
      const result = onSuccess(response);
      toast.success(messages.success);
      return result;
    } catch (err) {
      const msg = friendlyError(err, messages.error);
      toast.error(msg);
      return { success: false, message: msg };
    } finally {
      mutatingRef.current = false;
      setIsMutating(false);
    }
  }, []);

  const fetchBookmarks = useCallback(async () => {
    if (apiBookId == null) {
      setBookmarks([]);
      setLoadError(bookId ? '유효한 책 ID가 없어 북마크를 불러올 수 없습니다.' : null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setBookmarks(await loadBookmarksFromApi(apiBookId, apiSort));
    } catch (err) {
      setBookmarks([]);
      setLoadError(friendlyError(err, '북마크 목록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [apiBookId, apiSort, bookId]);

  const addBookmark = useCallback(
    (bookmarkData) =>
      runMutation(
        () => createBookmark(bookmarkData),
        (response) => {
          setBookmarks((prev) =>
            apiSort === 'time_asc' ? [...prev, response.result] : [response.result, ...prev]
          );
          return { success: true, bookmark: response.result };
        },
        {
          success: '북마크가 추가되었습니다',
          fail: '북마크 생성에 실패했습니다.',
          error: '북마크 생성 중 오류가 발생했습니다.',
        }
      ),
    [runMutation, apiSort]
  );

  const patchBookmark = useCallback(
    (bookmarkId, updateData) =>
      runMutation(
        () => updateBookmark(bookmarkId, updateData),
        (response) => {
          const idStr = String(bookmarkId);
          setBookmarks((prev) =>
            prev.map((b) => (String(b.id) === idStr ? { ...b, ...response.result } : b))
          );
          return { success: true, bookmark: response.result };
        },
        {
          success: '변경사항이 저장되었습니다',
          fail: '북마크 수정에 실패했습니다.',
          error: '북마크 수정 중 오류가 발생했습니다.',
        }
      ),
    [runMutation]
  );

  const removeBookmark = useCallback(
    (bookmarkId) =>
      runMutation(
        () => deleteBookmark(bookmarkId),
        () => {
          const idStr = String(bookmarkId);
          setBookmarks((prev) => prev.filter((b) => String(b.id) !== idStr));
          return { success: true };
        },
        {
          success: '북마크가 삭제되었습니다',
          fail: '북마크 삭제에 실패했습니다.',
          error: '북마크 삭제 중 오류가 발생했습니다.',
        }
      ),
    [runMutation]
  );

  const handleAddBookmark = useCallback(async () => {
    if (mutatingRef.current) {
      toast.info('이전 요청을 처리 중입니다.');
      return { success: false };
    }

    const bumpFail = () => setFailCount?.((cnt) => cnt + 1);

    if (!viewerRef?.current) {
      toast.error('페이지가 아직 준비되지 않았어요. 다시 불러옵니다...');
      bumpFail();
      return { success: false };
    }

    if (apiBookId == null) {
      toast.error('책 정보가 없어 북마크를 추가할 수 없습니다.');
      return { success: false };
    }

    let rawStart = null;
    let rawEnd = null;
    try {
      const pair = resolveReadingLocators(
        () => viewerRef.current?.getCurrentLocator?.(),
        null
      );
      rawStart = pair.startLocator;
      rawEnd = pair.endLocator ?? pair.startLocator;
    } catch {
      /* ignore */
    }

    if (!rawStart) {
      toast.error('페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...');
      bumpFail();
      return { success: false };
    }

    const axisReady = await waitForBookmarkAxisReady(apiBookId, rawStart);
    if (!axisReady) {
      toast.error('책 위치 정보가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
      return { success: false };
    }

    setFailCount?.(0);

    const bookmarkData = createBookmarkData(apiBookId, rawStart, rawEnd);
    if (!bookmarkData.startLocator) {
      toast.error('페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...');
      bumpFail();
      return { success: false };
    }

    const existing = bookmarksRef.current.find((b) =>
      isSameBookmarkPosition(b, {
        startLocator: bookmarkData.startLocator,
        endLocator: bookmarkData.endLocator ?? bookmarkData.startLocator,
      })
    );
    if (existing) {
      return { success: true, needsConfirm: true, bookmarkId: existing.id };
    }

    return addBookmark(bookmarkData);
  }, [apiBookId, viewerRef, setFailCount, addBookmark]);

  useEffect(() => {
    if (apiBookId == null) {
      setBookmarks([]);
      setLoadError(bookId ? '유효한 책 ID가 없어 북마크를 불러올 수 없습니다.' : null);
      return;
    }
    fetchBookmarks();
  }, [apiBookId, bookId, fetchBookmarks]);

  // 목록↔뷰어 전환·bfcache·탭 복귀 시 재동기화 (마운트 시 pageshow는 제외)
  useEffect(() => {
    if (apiBookId == null) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchBookmarks();
    };
    const onPageShow = (event) => {
      if (event.persisted) fetchBookmarks();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [apiBookId, fetchBookmarks]);

  return {
    bookmarks,
    loading,
    loadError,
    isMutating,
    apiBookId,
    fetchBookmarks,
    removeBookmark,
    patchBookmark,
    handleAddBookmark: viewerRef ? handleAddBookmark : undefined,
  };
};

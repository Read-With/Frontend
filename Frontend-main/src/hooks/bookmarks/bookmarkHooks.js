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
import { errorUtils } from '../../utils/common/urlUtils';
import { resolveReadingLocators } from '../../utils/viewer/viewerSession';

const LOG = 'bookmarkHooks';

const bookmarkListSignature = (items) =>
  JSON.stringify((items || []).map((bookmark) => [
    bookmark?.id,
    bookmark?.updatedAt ?? bookmark?.updated_at,
    bookmark?.createdAt ?? bookmark?.created_at,
    bookmark?.color,
    bookmark?.memo,
    bookmark?.highlightText,
    bookmark?.textSnippet,
    bookmark?.chapterTitle,
    bookmark?.startLocator,
    bookmark?.endLocator,
  ]));

const reuseUnchangedBookmarkList = (previous, next) =>
  bookmarkListSignature(previous) === bookmarkListSignature(next) ? previous : next;

const friendlyError = (err, fallback) => {
  if (!err) return fallback;
  const status = Number(err.status ?? err.statusCode);
  if (status === 404) {
    return '북마크 기능이 아직 준비되지 않았거나 연결 경로를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (status === 403) {
    return '북마크에 접근할 권한이 없습니다.';
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
  const fetchRequestRef = useRef({ generation: 0, bookId: null, active: false });
  const loadedBookIdRef = useRef(null);

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
        errorUtils.logWarning(LOG, msg, {
          action: messages.action,
          bookId: apiBookId,
          softFail: true,
        });
        toast.error(msg);
        return { success: false, message: msg };
      }
      const result = onSuccess(response);
      toast.success(messages.success, {
        autoClose: messages.autoClose ?? 2800,
        className: messages.toastClassName,
      });
      return result;
    } catch (err) {
      // API 레이어가 이미 logError한 경우 많음 → UI는 컨텍스트 warn만
      errorUtils.logWarning(LOG, friendlyError(err, messages.error), {
        action: messages.action,
        bookId: apiBookId,
        message: err?.message,
        status: err?.status ?? err?.statusCode,
      });
      const msg = friendlyError(err, messages.error);
      toast.error(msg);
      return { success: false, message: msg };
    } finally {
      mutatingRef.current = false;
      setIsMutating(false);
    }
  }, [apiBookId]);

  const fetchBookmarks = useCallback(async ({ silent = false } = {}) => {
    if (apiBookId == null) {
      fetchRequestRef.current = {
        generation: fetchRequestRef.current.generation + 1,
        bookId: null,
        active: false,
      };
      loadedBookIdRef.current = null;
      setBookmarks([]);
      setLoadError(bookId ? '유효한 책 ID가 없어 북마크를 불러올 수 없습니다.' : null);
      return;
    }
    if (
      fetchRequestRef.current.active &&
      fetchRequestRef.current.bookId === apiBookId
    ) {
      return;
    }
    const generation = fetchRequestRef.current.generation + 1;
    fetchRequestRef.current = { generation, bookId: apiBookId, active: true };
    const isSameLoadedBook = loadedBookIdRef.current === apiBookId;
    const hasExistingBookmarks = isSameLoadedBook && bookmarksRef.current.length > 0;
    const showBlockingLoading = !silent && !hasExistingBookmarks;
    if (!isSameLoadedBook) {
      bookmarksRef.current = [];
      setBookmarks([]);
    }
    if (showBlockingLoading) setLoading(true);
    if (!silent) setLoadError(null);
    try {
      const next = await loadBookmarksFromApi(apiBookId, apiSort);
      if (fetchRequestRef.current.generation !== generation) return;
      loadedBookIdRef.current = apiBookId;
      setBookmarks((previous) => reuseUnchangedBookmarkList(previous, next));
      setLoadError(null);
    } catch (err) {
      const msg = friendlyError(err, '북마크 목록을 불러오지 못했습니다.');
      errorUtils.logWarning(LOG, msg, {
        action: 'fetch',
        bookId: apiBookId,
        sort: apiSort,
        message: err?.message,
        status: err?.status ?? err?.statusCode,
      });
      if (fetchRequestRef.current.generation === generation && !hasExistingBookmarks) {
        setBookmarks([]);
        setLoadError(msg);
      }
    } finally {
      if (fetchRequestRef.current.generation === generation) {
        fetchRequestRef.current = { generation, bookId: apiBookId, active: false };
        if (showBlockingLoading) setLoading(false);
      }
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
          action: 'create',
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
          action: 'update',
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
          action: 'delete',
          success: '북마크가 삭제되었습니다',
          fail: '북마크 삭제에 실패했습니다.',
          error: '북마크 삭제 중 오류가 발생했습니다.',
          autoClose: 3200,
          toastClassName: 'bm-toast-delete',
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
      errorUtils.logWarning(LOG, '뷰어 미준비로 북마크 추가 불가', {
        action: 'addFromViewer',
        bookId: apiBookId,
        reason: 'viewer_not_ready',
      });
      toast.error('페이지가 아직 준비되지 않았어요. 다시 불러옵니다...');
      bumpFail();
      return { success: false };
    }

    if (apiBookId == null) {
      errorUtils.logWarning(LOG, 'bookId 없음으로 북마크 추가 불가', {
        action: 'addFromViewer',
        reason: 'missing_book_id',
      });
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
    } catch (err) {
      errorUtils.logWarning(LOG, 'locator 해석 실패', {
        action: 'addFromViewer',
        bookId: apiBookId,
        message: err?.message,
      });
    }

    if (!rawStart) {
      errorUtils.logWarning(LOG, '현재 위치 locator 없음', {
        action: 'addFromViewer',
        bookId: apiBookId,
        reason: 'missing_locator',
      });
      toast.error('페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...');
      bumpFail();
      return { success: false };
    }

    const axisReady = await waitForBookmarkAxisReady(apiBookId, rawStart);
    if (!axisReady) {
      errorUtils.logWarning(LOG, '북마크 axis 미준비', {
        action: 'addFromViewer',
        bookId: apiBookId,
        reason: 'axis_not_ready',
      });
      toast.error('책 위치 정보가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
      return { success: false };
    }

    setFailCount?.(0);

    const bookmarkData = createBookmarkData(apiBookId, rawStart, rawEnd);
    if (!bookmarkData.startLocator) {
      errorUtils.logWarning(LOG, '북마크 데이터 locator 생성 실패', {
        action: 'addFromViewer',
        bookId: apiBookId,
        reason: 'create_data_failed',
      });
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
      if (document.visibilityState === 'visible') fetchBookmarks({ silent: true });
    };
    const onPageShow = (event) => {
      if (event.persisted) fetchBookmarks({ silent: true });
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

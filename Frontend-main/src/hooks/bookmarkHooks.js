/** 북마크 CRUD·뷰어 추가·정렬 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { createBookmark, updateBookmark, deleteBookmark, loadBookmarks as loadBookmarksFromApi } from '../utils/api/booksApi';
import {
  createBookmarkData,
  isSameBookmarkPosition,
  waitForBookmarkAxisReady,
} from '../utils/bookmarkUtils';
import { toPositiveNumberOrNull, errorUtils } from '../utils/common/valueUtils';
import { resolveReadingLocators } from '../utils/viewer/viewerSession';

const LOG = 'bookmarkHooks';
/** 서버 정렬은 최신순 고정 — 목록 화면은 클라이언트에서 다시 정렬 */
const API_SORT = 'time_desc';

const PAGE_UNREADABLE = '페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...';

/** 뷰어에서 북마크 추가 실패 사유. bump: 실패 카운트를 올려 뷰어 재로드 유도 */
const ADD_FAILURES = {
  viewer_not_ready: {
    log: '뷰어 미준비로 북마크 추가 불가',
    toast: '페이지가 아직 준비되지 않았어요. 다시 불러옵니다...',
    bump: true,
  },
  missing_book_id: {
    log: 'bookId 없음으로 북마크 추가 불가',
    toast: '책 정보가 없어 북마크를 추가할 수 없습니다.',
  },
  missing_locator: {
    log: '현재 위치 locator 없음',
    toast: PAGE_UNREADABLE,
    bump: true,
  },
  axis_not_ready: {
    log: '북마크 axis 미준비',
    toast: '책 위치 정보가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.',
  },
  create_data_failed: {
    log: '북마크 데이터 locator 생성 실패',
    toast: PAGE_UNREADABLE,
    bump: true,
  },
};

const friendlyError = (err, fallback) => {
  if (!err) return fallback;
  const status = Number(err.status ?? err.statusCode);
  if (status === 404) {
    return '북마크 기능이 아직 준비되지 않았거나 연결 경로를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (status === 403) {
    return '북마크에 접근할 권한이 없습니다.';
  }
  if (errorUtils.isNetworkError(err)) {
    return '연결을 확인한 뒤 다시 시도해 주세요.';
  }
  return err.message || fallback;
};

export const useBookmarks = (bookId, options = {}) => {
  const { viewerRef = null, setFailCount = null } = options;
  const serverBookId = useMemo(() => toPositiveNumberOrNull(bookId), [bookId]);

  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['bookmarks', serverBookId, API_SORT], [serverBookId]);
  const query = useQuery({
    queryKey,
    enabled: serverBookId != null,
    queryFn: async () => {
      try {
        return await loadBookmarksFromApi(serverBookId, API_SORT);
      } catch (err) {
        errorUtils.logWarning(LOG, friendlyError(err, '북마크 목록을 불러오지 못했습니다.'), {
          action: 'fetch',
          bookId: serverBookId,
          sort: API_SORT,
          message: err?.message,
          status: err?.status ?? err?.statusCode,
        });
        throw err;
      }
    },
    // 목록↔뷰어 전환·탭 복귀 시 재동기화 (전역 기본값보다 우선)
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const { refetch } = query;
  const bookmarks = useMemo(() => (serverBookId == null ? [] : query.data ?? []), [serverBookId, query.data]);
  // 이미 목록이 있으면 백그라운드 재조회 실패는 숨김
  const loadError =
    query.error && !query.data ? friendlyError(query.error, '북마크 목록을 불러오지 못했습니다.') : null;

  const setBookmarks = useCallback(
    (updater) => {
      // 첫 로딩 전(또는 취소로 비어 있음)이면 일부만 채우지 말고 서버 목록을 다시 받음
      if (queryClient.getQueryData(queryKey) === undefined) {
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
      queryClient.setQueryData(queryKey, updater);
    },
    [queryClient, queryKey]
  );

  const [isMutating, setIsMutating] = useState(false);
  const mutatingRef = useRef(false);

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
          bookId: serverBookId,
          softFail: true,
        });
        toast.error(msg);
        return { success: false, message: msg };
      }
      // 진행 중인 재조회가 늦게 도착해 이번 변경을 덮어쓰지 않도록 취소
      await queryClient.cancelQueries({ queryKey });
      const result = onSuccess(response);
      toast.success(messages.success, {
        autoClose: messages.autoClose ?? 2800,
        className: messages.toastClassName,
      });
      return result;
    } catch (err) {
      const msg = friendlyError(err, messages.error);
      // API 레이어가 이미 logError한 경우 많음 → UI는 컨텍스트 warn만
      errorUtils.logWarning(LOG, msg, {
        action: messages.action,
        bookId: serverBookId,
        message: err?.message,
        status: err?.status ?? err?.statusCode,
      });
      toast.error(msg);
      return { success: false, message: msg };
    } finally {
      mutatingRef.current = false;
      setIsMutating(false);
    }
  }, [serverBookId, queryClient, queryKey]);

  const addBookmark = useCallback(
    (bookmarkData) =>
      runMutation(
        () => createBookmark(bookmarkData),
        (response) => {
          setBookmarks((prev) => [response.result, ...prev]);
          return { success: true, bookmark: response.result };
        },
        {
          action: 'create',
          success: '북마크가 추가되었습니다',
          fail: '북마크 생성에 실패했습니다.',
          error: '북마크 생성 중 오류가 발생했습니다.',
        }
      ),
    [runMutation, setBookmarks]
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
    [runMutation, setBookmarks]
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
    [runMutation, setBookmarks]
  );

  const handleAddBookmark = useCallback(async () => {
    if (mutatingRef.current) {
      toast.info('이전 요청을 처리 중입니다.');
      return { success: false };
    }

    const fail = (reason) => {
      const { log, toast: message, bump } = ADD_FAILURES[reason];
      errorUtils.logWarning(LOG, log, { action: 'addFromViewer', bookId: serverBookId, reason });
      toast.error(message);
      if (bump) setFailCount?.((cnt) => cnt + 1);
      return { success: false };
    };

    if (!viewerRef?.current) {
      return fail('viewer_not_ready');
    }

    if (serverBookId == null) {
      return fail('missing_book_id');
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
        bookId: serverBookId,
        message: err?.message,
      });
    }

    if (!rawStart) {
      return fail('missing_locator');
    }

    const axisReady = await waitForBookmarkAxisReady(serverBookId, rawStart);
    if (!axisReady) {
      return fail('axis_not_ready');
    }

    setFailCount?.(0);

    const bookmarkData = createBookmarkData(serverBookId, rawStart, rawEnd);
    if (!bookmarkData.startLocator) {
      return fail('create_data_failed');
    }

    // 목록 로딩 전이면 받아온 뒤 중복 확인 (빈 목록 기준 확인으로 중복 생성 방지)
    let current = queryClient.getQueryData(queryKey);
    if (current === undefined) current = (await refetch()).data ?? [];
    const existing = current.find((b) =>
      isSameBookmarkPosition(b, {
        startLocator: bookmarkData.startLocator,
        endLocator: bookmarkData.endLocator ?? bookmarkData.startLocator,
      })
    );
    if (existing) {
      return { success: true, needsConfirm: true, bookmarkId: existing.id };
    }

    return addBookmark(bookmarkData);
  }, [serverBookId, viewerRef, setFailCount, addBookmark, queryClient, queryKey, refetch]);

  // bfcache 복원 시 재동기화 (visibilitychange는 refetchOnWindowFocus가 처리)
  useEffect(() => {
    if (serverBookId == null) return undefined;
    const onPageShow = (event) => {
      if (event.persisted) refetch();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [serverBookId, refetch]);

  return {
    bookmarks,
    loading: query.isLoading,
    loadError,
    isMutating,
    fetchBookmarks: refetch,
    removeBookmark,
    patchBookmark,
    handleAddBookmark: viewerRef ? handleAddBookmark : undefined,
  };
};

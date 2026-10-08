/** 북마크 CRUD·뷰어 추가·정렬 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { createBookmark, updateBookmark, deleteBookmark, loadBookmarks as loadBookmarksFromApi } from '../../utils/api/booksApi';
import {
  createBookmarkData,
  isSameBookmarkPosition,
  waitForBookmarkAxisReady,
  clientSortToApiSort,
} from '../../utils/bookmarks/bookmarkUtils';
import { toPositiveNumberOrNull, errorUtils } from '../../utils/common/valueUtils';
import { resolveReadingLocators } from '../../utils/viewer/viewerSession';

const LOG = 'bookmarkHooks';

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

  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['bookmarks', apiBookId, apiSort], [apiBookId, apiSort]);
  const query = useQuery({
    queryKey,
    enabled: apiBookId != null,
    queryFn: async () => {
      try {
        return await loadBookmarksFromApi(apiBookId, apiSort);
      } catch (err) {
        errorUtils.logWarning(LOG, friendlyError(err, '북마크 목록을 불러오지 못했습니다.'), {
          action: 'fetch',
          bookId: apiBookId,
          sort: apiSort,
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
  const bookmarks = useMemo(() => (apiBookId == null ? [] : query.data ?? []), [apiBookId, query.data]);
  // 이미 목록이 있으면 백그라운드 재조회 실패는 숨김
  const loadError =
    apiBookId == null
      ? (bookId ? '유효한 책 ID가 없어 북마크를 불러올 수 없습니다.' : null)
      : query.error && !query.data
        ? friendlyError(query.error, '북마크 목록을 불러오지 못했습니다.')
        : null;

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
          bookId: apiBookId,
          softFail: true,
        });
        toast.error(msg);
        return { success: false, message: msg };
      }
      // 진행 중인 재조회가 늦게 도착해 이번 변경을 덮어쓰지 않도록 취소
      await queryClient.cancelQueries({ queryKey });
      const result = onSuccess(response);
      // 다른 정렬 키 캐시는 이번 변경이 빠져 있으므로 제거 (재진입 시 삭제된 북마크 노출·중복 판정 오류 방지)
      queryClient.removeQueries({
        queryKey: ['bookmarks', apiBookId],
        predicate: (q) => q.queryKey[2] !== apiSort,
      });
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
  }, [apiBookId, apiSort, queryClient, queryKey]);

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
    [runMutation, apiSort, setBookmarks]
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
  }, [apiBookId, viewerRef, setFailCount, addBookmark, queryClient, queryKey, refetch]);

  // bfcache 복원 시 재동기화 (visibilitychange는 refetchOnWindowFocus가 처리)
  useEffect(() => {
    if (apiBookId == null) return undefined;
    const onPageShow = (event) => {
      if (event.persisted) refetch();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [apiBookId, refetch]);

  return {
    bookmarks,
    loading: query.isLoading,
    loadError,
    isMutating,
    apiBookId,
    fetchBookmarks: refetch,
    removeBookmark,
    patchBookmark,
    handleAddBookmark: viewerRef ? handleAddBookmark : undefined,
  };
};

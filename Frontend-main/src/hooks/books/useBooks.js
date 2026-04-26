import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBook, toggleBookFavorite } from '../../utils/api/booksApi';
import { normalizeTitle } from '../../utils/common/stringUtils';
import { useBooksServerQuery } from './useBooksServerQuery';
import { PROGRESS_CACHE_UPDATED_EVENT } from '../../utils/common/cache/progressCache';
import { resolveLibraryReadingProgressPercent } from '../../utils/library/libraryBookDisplay';

const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';
const normalizeAuthor = (author) => (author || '').toLowerCase().trim().replace(/\s+/g, ' ');

export const useBooks = () => {
  const queryClient = useQueryClient();
  const [progressCacheEpoch, bumpProgressCacheEpoch] = useReducer((n) => n + 1, 0);
  const [hiddenServerBookIds, setHiddenServerBookIds] = useState(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_SERVER_BOOK_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) return new Set(parsed.map((id) => `${id}`));
    } catch (_e) {}
    return new Set();
  });
  const hiddenServerBookIdsRef = useRef(new Set(hiddenServerBookIds));

  useEffect(() => {
    hiddenServerBookIdsRef.current = new Set(hiddenServerBookIds);
  }, [hiddenServerBookIds]);

  useEffect(() => {
    const onProgressCacheUpdated = () => bumpProgressCacheEpoch();
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, onProgressCacheUpdated);
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, onProgressCacheUpdated);
  }, []);

  // 서버 책 조회 - React Query 사용
  const {
    data: serverBooksData,
    isLoading: isServerLoading,
    error: serverError,
    refetch: refetchServer,
  } = useBooksServerQuery();

  // 서버 책 중복 제거 및 정규화 (제목+저자 동일하면 최소 bookId 유지)
  const reconcileBooks = useCallback((fetchedBooks) => {
    if (!Array.isArray(fetchedBooks)) return [];

    const deduped = new Map();

    fetchedBooks.forEach((book) => {
      const numericId = Number(book?.id);
      if (!Number.isFinite(numericId) || numericId <= 0) return;
      const titleKey = normalizeTitle(book?.title || '');
      const authorKey = normalizeAuthor(book?.author || '');
      const dedupeKey = `${titleKey}::${authorKey}`;
      if (!titleKey || !authorKey) return;

      const normalized = {
        ...book,
        favorite: !!(book.isFavorite ?? book.favorite),
      };
      const existing = deduped.get(dedupeKey);
      if (!existing || numericId < Number(existing.id)) {
        deduped.set(dedupeKey, normalized);
      }
    });

    return Array.from(deduped.values());
  }, []);

  // 서버 책 중복 제거 및 정규화된 목록
  const reconciledBooks = useMemo(() => {
    const serverBooks = serverBooksData?.books || [];
    return reconcileBooks(serverBooks);
  }, [serverBooksData, reconcileBooks]);

  const books = useMemo(() => {
    const hiddenServer = hiddenServerBookIdsRef.current;
    return reconciledBooks
      .filter((book) => {
        const idKey = book?.id != null ? `${book.id}` : null;
        return idKey && !hiddenServer.has(idKey);
      })
      .map((book) => ({
        ...book,
        progress: resolveLibraryReadingProgressPercent(book),
      }));
  }, [reconciledBooks, progressCacheEpoch]);

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ bookId, favorite }) => toggleBookFavorite(bookId, favorite),
    onMutate: async ({ bookId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: ['books', 'server'] });
      const previousServerBooks = queryClient.getQueryData(['books', 'server']);
      queryClient.setQueryData(['books', 'server'], (old) => {
        if (!old) return old;
        const idStr = String(bookId);
        return {
          ...old,
          books: (old.books || []).map((book) =>
            String(book?.id) === idStr ? { ...book, favorite } : book
          ),
        };
      });
      return { previousServerBooks };
    },
    onError: (err, variables, context) => {
      // 롤백
      if (context?.previousServerBooks) {
        queryClient.setQueryData(['books', 'server'], context.previousServerBooks);
      }
    },
    onSettled: () => {
      // 성공/실패 상관없이 서버 데이터 갱신 (refetchQueries 사용하여 stale 경고 방지)
      queryClient.refetchQueries({ 
        queryKey: ['books', 'server'],
        type: 'active'
      });
    },
  });

  const removeBookMutation = useMutation({
    mutationFn: async (bookId) => {
      const targetBookId = String(bookId);
      const hiddenIds = new Set(hiddenServerBookIdsRef.current);
      hiddenIds.add(targetBookId);
      localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify([...hiddenIds]));
      return targetBookId;
    },
    onMutate: async (_bookId) => {
      // 서버 목록은 변경하지 않음 (클라이언트에서만 숨김)
      await queryClient.cancelQueries({ queryKey: ['books', 'server'] });
      return {};
    },
    onSuccess: (deletedBookId) => {
      if (!isNaN(Number(deletedBookId))) {
        setHiddenServerBookIds((prev) => {
          const next = new Set(prev);
          next.add(deletedBookId);
          return next;
        });
      }
    },
    onError: () => {},
    onSettled: () => {},
  });

  const addBook = useCallback(
    async (newBook) => {
      try {
        const newBookId = newBook?.id ?? newBook?._bookId;
        const newBookIdStr = newBookId != null ? String(newBookId) : null;
        if (!newBookIdStr) return;

        // 과거에 삭제로 숨김 처리된 bookId라면 업로드 후 다시 표시
        setHiddenServerBookIds((prev) => {
          if (!prev.has(newBookIdStr)) return prev;
          const next = new Set(prev);
          next.delete(newBookIdStr);
          localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify([...next]));
          return next;
        });
        queryClient.refetchQueries({
          queryKey: ['books', 'server'],
          type: 'active',
        });
      } catch (e) {
        console.warn('addBook 실패:', e);
      }
    },
    [queryClient],
  );

  const fetchBook = useCallback(async (bookId) => {
    const response = await getBook(bookId);
    if (response?.isSuccess) {
      return response.result;
    }
    throw new Error(response?.message || '도서 정보를 불러올 수 없습니다.');
  }, []);

  // 기존 API 호환성 유지
  const loading = isServerLoading;
  const error = serverError?.message || (serverBooksData?.needsAuth ? '인증이 필요합니다. 로그인해주세요.' : null);
  
  const retryFetch = useCallback(() => {
    refetchServer();
  }, [refetchServer]);

  const toggleFavorite = useCallback(
    async (bookId, favorite) => {
      await toggleFavoriteMutation.mutateAsync({ bookId, favorite });
    },
    [toggleFavoriteMutation],
  );

  const removeBook = useCallback(
    async (bookId) => {
      await removeBookMutation.mutateAsync(bookId);
    },
    [removeBookMutation],
  );

  return {
    books,
    loading,
    error,
    retryFetch,
    removeBook,
    toggleFavorite,
    fetchBook,
    addBook,
    allServerBooks: serverBooksData?.books || [],
  };
};

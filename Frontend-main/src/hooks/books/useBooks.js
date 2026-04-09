import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBook, toggleBookFavorite } from '../../utils/api/booksApi';
import { normalizeTitle } from '../../utils/common/stringUtils';
import {
  deleteLocalBookBuffer,
  deleteLocalBookMetadata,
  loadLocalBookBuffer,
  getAllLocalBookIds,
} from '../../utils/library/localBookStorage';
import { useBooksServerQuery } from './useBooksServerQuery';

const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';
const normalizeAuthor = (author) => (author || '').toLowerCase().trim().replace(/\s+/g, ' ');

const getLocalProgress = (bookId) => {
  try {
    const raw = localStorage.getItem(`progress_${bookId}`);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  } catch {
    return null;
  }
};

export const useBooks = () => {
  const queryClient = useQueryClient();
  const [hiddenServerBookIds, setHiddenServerBookIds] = useState(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_SERVER_BOOK_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) return new Set(parsed.map((id) => `${id}`));
    } catch (_e) {}
    return new Set();
  });
  const hiddenServerBookIdsRef = useRef(new Set(hiddenServerBookIds));
  const [indexedDbBookIds, setIndexedDbBookIds] = useState(new Set());
  const indexedDbBookIdsRef = useRef(new Set());

  useEffect(() => {
    hiddenServerBookIdsRef.current = new Set(hiddenServerBookIds);
  }, [hiddenServerBookIds]);
  useEffect(() => {
    indexedDbBookIdsRef.current = new Set(indexedDbBookIds);
  }, [indexedDbBookIds]);

  const refreshIndexedDbBookIds = useCallback(async () => {
    try {
      const allBookIds = await getAllLocalBookIds();
      const bookIdsWithBuffer = new Set();
      const checkPromises = (allBookIds || []).map(async (bookId) => {
        try {
          const buffer = await loadLocalBookBuffer(bookId);
          return buffer && buffer.byteLength > 0 ? bookId : null;
        } catch {
          return null;
        }
      });
      const results = await Promise.all(checkPromises);
      results.forEach((id) => id && bookIdsWithBuffer.add(id));
      setIndexedDbBookIds(bookIdsWithBuffer);
    } catch (e) {
      console.warn('IndexedDB 책 ID 로드 실패:', e);
      setIndexedDbBookIds(new Set());
    }
  }, []);

  useEffect(() => {
    refreshIndexedDbBookIds();
  }, [refreshIndexedDbBookIds]);

  useEffect(() => {
    const INTERVAL_MS = 15000;
    const id = setInterval(refreshIndexedDbBookIds, INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshIndexedDbBookIds]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIndexedDbBookIds();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshIndexedDbBookIds]);

  // 서버 책 조회 - React Query 사용
  // 서버는 메타데이터만, 로컬 원본 버퍼는 IndexedDB; 뷰어는 combined XHTML
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

  useEffect(() => {
    if (!serverBooksData?.books) return;
    const t = setTimeout(refreshIndexedDbBookIds, 500);
    return () => clearTimeout(t);
  }, [serverBooksData, refreshIndexedDbBookIds]);

  const books = useMemo(() => {
    const hiddenServer = hiddenServerBookIdsRef.current;
    const indexedDbIds = indexedDbBookIds;

    const serverBooksMap = new Map();
    reconciledBooks.forEach((book) => {
      const idKey = book?.id != null ? `${book.id}` : null;
      if (idKey) serverBooksMap.set(idKey, book);
    });

    const result = [];
    indexedDbIds.forEach((bookId) => {
      if (hiddenServer.has(bookId)) return;
      const serverBook = serverBooksMap.get(bookId);
      if (!serverBook) return;
      const localProgress = getLocalProgress(bookId);
      const progress = serverBook.progress ?? localProgress ?? 0;
      result.push({ ...serverBook, progress });
    });
    return result;
  }, [reconciledBooks, indexedDbBookIds]);

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
      await Promise.all([
        deleteLocalBookBuffer(targetBookId),
        deleteLocalBookMetadata(targetBookId),
      ]);
      const hiddenIds = new Set(hiddenServerBookIdsRef.current);
      hiddenIds.add(targetBookId);
      localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify([...hiddenIds]));
      return targetBookId;
    },
    onMutate: async (_bookId) => {
      // 서버 목록은 변경하지 않음 (로컬 삭제만 처리)
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

        // 과거에 삭제로 숨김 처리된 bookId라면 업로드(로컬 저장) 시 다시 표시
        setHiddenServerBookIds((prev) => {
          if (!prev.has(newBookIdStr)) return prev;
          const next = new Set(prev);
          next.delete(newBookIdStr);
          localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify([...next]));
          return next;
        });
        setIndexedDbBookIds((prev) => {
          const next = new Set(prev);
          next.add(newBookIdStr);
          return next;
        });

        refreshIndexedDbBookIds();
      } catch (e) {
        console.warn('addBook 실패:', e);
      }
    },
    [queryClient, refreshIndexedDbBookIds],
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

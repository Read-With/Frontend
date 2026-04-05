import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBooks, getBook, toggleBookFavorite } from '../../utils/api/booksApi';
import {
  deleteLocalBookBuffer,
  deleteLocalBookMetadata,
  loadLocalBookBuffer,
  getAllLocalBookIds,
} from '../../utils/library/localBookStorage';
import { prefetchManifest } from '../../utils/common/cache/manifestCache';
import { getBookManifest } from '../../utils/api/api';
import { loadPublicBooks } from '../../utils/normalizedContent';
import { getStoredAccessToken } from '../../utils/security/authTokenStorage';
import { ensureSessionAccessToken } from '../../utils/api/authApi';

const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';
const PUBLIC_BOOK_FAVORITES_KEY = 'readwith_public_book_favorites';

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
  const location = useLocation();
  const [hiddenServerBookIds, setHiddenServerBookIds] = useState(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_SERVER_BOOK_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) return new Set(parsed.map((id) => `${id}`));
    } catch (_e) {}
    return new Set();
  });
  const [publicBookFavorites, setPublicBookFavorites] = useState(() => {
    try {
      const raw = localStorage.getItem(PUBLIC_BOOK_FAVORITES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) return new Set(parsed.map((id) => `${id}`));
    } catch (_e) {}
    return new Set();
  });
  
  const hiddenServerBookIdsRef = useRef(new Set(hiddenServerBookIds));
  const publicBookFavoritesRef = useRef(new Set(publicBookFavorites));
  const [indexedDbBookIds, setIndexedDbBookIds] = useState(new Set());
  const indexedDbBookIdsRef = useRef(new Set());

  useEffect(() => {
    hiddenServerBookIdsRef.current = new Set(hiddenServerBookIds);
  }, [hiddenServerBookIds]);
  useEffect(() => {
    publicBookFavoritesRef.current = new Set(publicBookFavorites);
  }, [publicBookFavorites]);

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
  } = useQuery({
    queryKey: ['books', 'server'],
    queryFn: async () => {
      await ensureSessionAccessToken();
      const token = getStoredAccessToken();
      if (!token) {
        return { books: [], needsAuth: true };
      }

      const response = await getBooks({});
      if (!response?.isSuccess) {
        throw new Error(response?.message || '책 정보를 불러올 수 없습니다.');
      }

      const fetched = response.result || [];
      
      // Manifest 프리페치
      fetched.forEach((book) => {
        if (book?.id && Number.isFinite(Number(book.id))) {
          const numericId = Number(book.id);
          if (numericId > 0) {
            prefetchManifest(numericId, (id) => getBookManifest(id, { forceRefresh: false }))
              .catch(() => {});
          }
        }
      });

      return { books: fetched, needsAuth: false };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const { data: publicBooksData } = useQuery({
    queryKey: ['books', 'public'],
    queryFn: loadPublicBooks,
    staleTime: 5 * 60 * 1000,
  });

  // 서버 책 중복 제거 및 정규화
  const reconcileBooks = useCallback((fetchedBooks) => {
    if (!Array.isArray(fetchedBooks)) return [];

    const deduped = new Map();

    fetchedBooks.forEach((book) => {
      const bookId = book?.id !== undefined && book?.id !== null ? `${book.id}` : null;
      if (!bookId) return;

      const existing = deduped.get(bookId);
      if (!existing) {
        deduped.set(bookId, {
          ...book,
          favorite: !!book.favorite,
        });
      } else {
        // 중복된 경우 더 작은 ID를 가진 책을 유지
        const existingId = Number(existing.id);
        const incomingId = Number(book.id);
        if (incomingId < existingId) {
          deduped.set(bookId, {
            ...book,
            favorite: !!book.favorite,
          });
        }
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

  // 서버 책 + public/books/ 정규화 책
  const books = useMemo(() => {
    const hiddenServer = hiddenServerBookIdsRef.current;
    const favorites = publicBookFavoritesRef.current;
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

    const publicBooks = publicBooksData || [];
    publicBooks.forEach((b) => {
      const id = b?.id ? String(b.id) : null;
      if (!id) return;
      let progress = 0;
      try {
        const raw = localStorage.getItem(`progress_${id}`);
        if (raw) {
          const n = Number(raw);
          if (Number.isFinite(n)) progress = Math.min(100, Math.max(0, n));
        }
      } catch (_e) {}
      result.push({
        id,
        title: b.title ?? id,
        author: b.author ?? '',
        favorite: favorites.has(id),
        progress,
        updatedAt: new Date().toISOString(),
        _isPublic: true,
      });
    });
    return result;
  }, [reconciledBooks, indexedDbBookIds, publicBooksData, publicBookFavorites, location.pathname]);

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ bookId, favorite }) => {
      const idStr = String(bookId);
      if (isNaN(Number(bookId))) {
        const raw = localStorage.getItem(PUBLIC_BOOK_FAVORITES_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const set = new Set(list);
        if (favorite) set.add(idStr);
        else set.delete(idStr);
        localStorage.setItem(PUBLIC_BOOK_FAVORITES_KEY, JSON.stringify([...set]));
        return { bookId, favorite };
      }
      return toggleBookFavorite(bookId, favorite);
    },
    onMutate: async ({ bookId, favorite }) => {
      if (isNaN(Number(bookId))) {
        setPublicBookFavorites((prev) => {
          const next = new Set(prev);
          if (favorite) next.add(String(bookId));
          else next.delete(String(bookId));
          return next;
        });
        return {};
      }
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
      if (isNaN(Number(bookId))) {
        return targetBookId;
      }
      await Promise.all([
        deleteLocalBookBuffer(targetBookId),
        deleteLocalBookMetadata(targetBookId),
      ]);
      const hiddenIds = new Set(hiddenServerBookIdsRef.current);
      hiddenIds.add(targetBookId);
      localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify([...hiddenIds]));
      return targetBookId;
    },
    onMutate: async (bookId) => {
      const targetBookId = String(bookId);
      if (isNaN(Number(bookId))) {
        return {};
      }
      await queryClient.cancelQueries({ queryKey: ['books', 'server'] });
      const previousServerBooks = queryClient.getQueryData(['books', 'server']);
      queryClient.setQueryData(['books', 'server'], (old) => {
        if (!old) return old;
        return {
          ...old,
          books: (old.books || []).filter((book) => `${book.id}` !== targetBookId),
        };
      });
      return { previousServerBooks };
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
    onError: (err, variables, context) => {
      if (context?.previousServerBooks) {
        queryClient.setQueryData(['books', 'server'], context.previousServerBooks);
      }
    },
    onSettled: () => {
      // 서버 데이터 갱신 (refetchQueries 사용하여 stale 경고 방지)
      queryClient.refetchQueries({ 
        queryKey: ['books', 'server'],
        type: 'active'
      });
    },
  });

  const addBook = useCallback(
    async (newBook) => {
      try {
        const newBookId = newBook?.id ?? newBook?._bookId;
        const newBookIdStr = newBookId != null ? String(newBookId) : null;
        if (!newBookIdStr) return;

        const serverShape = {
          id: newBook.id ?? newBook._bookId,
          title: newBook.title ?? '',
          author: newBook.author ?? 'Unknown',
          favorite: !!newBook.favorite,
          coverImgUrl: newBook.coverImgUrl ?? newBook.coverImage ?? newBook.coverUrl ?? '',
          coverImage: newBook.coverImgUrl ?? newBook.coverImage ?? newBook.coverUrl ?? '',
          description: newBook.description ?? '',
          language: newBook.language ?? 'ko',
          updatedAt: newBook.updatedAt ?? new Date().toISOString(),
        };

        queryClient.setQueryData(['books', 'server'], (old) => {
          if (!old) return { books: [serverShape], needsAuth: false };
          const list = Array.isArray(old.books) ? old.books : [];
          const exists = list.some((b) => b && `${b.id}` === newBookIdStr);
          if (exists) return old;
          return { ...old, books: [...list, serverShape] };
        });
        setIndexedDbBookIds((prev) => {
          const next = new Set(prev);
          next.add(newBookIdStr);
          return next;
        });

        queryClient.refetchQueries({ queryKey: ['books', 'server'], type: 'active' }).catch(() => {});
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

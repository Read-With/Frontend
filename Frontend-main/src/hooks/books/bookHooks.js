/** 책: 서버 목록 쿼리·라이브러리·뷰어 URL canonical 매칭 */

import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBook, getBooks, toggleBookFavorite } from '../../utils/api/booksApi';
import { getBookManifest } from '../../utils/api/api';
import { normalizeTitle } from '../../utils/common/valueUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import { prefetchManifest } from '../../utils/common/cache/manifestCache';
import { PROGRESS_CACHE_UPDATED_EVENT } from '../../utils/common/cache/progressCache';
import { resolveLibraryReadingProgressPercent } from '../../utils/library/libraryUtils';
import { getStoredAccessToken } from '../../utils/security/authTokenStorage';
import { ensureSessionAccessToken } from '../../utils/api/authApi';

const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';
const normalizeAuthor = (author) => (author || '').toLowerCase().trim().replace(/\s+/g, ' ');
const serverBookFetchState = new Map();

export function useBooksServerQuery() {
  return useQuery({
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

      fetched.forEach((book) => {
        if (book?.id && Number.isFinite(Number(book.id))) {
          const numericId = Number(book.id);
          if (numericId > 0) {
            prefetchManifest(numericId, (id) => getBookManifest(id, { forceRefresh: false })).catch(
              () => {}
            );
          }
        }
      });

      return { books: fetched, needsAuth: false };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}

/** 동일 제목+저자면 최소 bookId로 뷰어 URL 정규화 */
export function useServerBookMatching(bookId, options = {}) {
  const { skipBookIdRedirectRef } = options;
  const location = useLocation();
  const navigate = useNavigate();

  const [serverBook, setServerBook] = useState(null);
  const [loadingServerBook, setLoadingServerBook] = useState(false);
  const [matchedServerBook, setMatchedServerBook] = useState(null);

  const matchedServerBookRef = useRef(null);

  useEffect(() => {
    matchedServerBookRef.current = matchedServerBook;
  }, [matchedServerBook]);

  useEffect(() => {
    const fetchServerBook = async () => {
      const numericBookId = parseInt(bookId, 10);
      if (isNaN(numericBookId)) {
        return;
      }
      if (serverBook?.id === numericBookId) {
        return;
      }
      if (serverBookFetchState.get(numericBookId) === 'inflight') {
        return;
      }

      setLoadingServerBook(true);
      serverBookFetchState.set(numericBookId, 'inflight');
      try {
        const response = await getBook(numericBookId);

        if (response && response.isSuccess && response.result) {
          const bookData = response.result;
          setServerBook(bookData);
          serverBookFetchState.set(numericBookId, 'done');
        } else {
          serverBookFetchState.delete(numericBookId);
        }
      } catch (error) {
        serverBookFetchState.delete(numericBookId);
        errorUtils.logError('fetchServerBook', error, { bookId, numericBookId });
      } finally {
        setLoadingServerBook(false);
      }
    };

    fetchServerBook();
  }, [bookId, location.state?.book]);

  useEffect(() => {
    if (location.state?.fromLibrary === true) {
      setMatchedServerBook(null);
      return;
    }

    const sourceBook = location.state?.book || serverBook;
    if (!sourceBook?.title || !sourceBook?.author) {
      setMatchedServerBook(null);
      return;
    }

    const titleKey = normalizeTitle(sourceBook.title);
    const authorKey = normalizeAuthor(sourceBook.author);
    if (!titleKey || !authorKey) {
      setMatchedServerBook(null);
      return;
    }

    let cancelled = false;
    const resolveCanonical = async () => {
      try {
        const res = await getBooks({});
        if (cancelled || !res?.isSuccess || !Array.isArray(res.result)) return;

        const candidates = res.result
          .filter((item) => {
            const id = Number(item?.id);
            return (
              Number.isFinite(id) &&
              id > 0 &&
              normalizeTitle(item?.title || '') === titleKey &&
              normalizeAuthor(item?.author || '') === authorKey
            );
          })
          .sort((a, b) => Number(a.id) - Number(b.id));

        if (candidates.length > 0) {
          setMatchedServerBook(candidates[0]);
        } else {
          setMatchedServerBook(null);
        }
      } catch {
        if (!cancelled) setMatchedServerBook(null);
      }
    };

    resolveCanonical();
    return () => {
      cancelled = true;
    };
  }, [bookId, location.state?.book, location.state?.fromLibrary, serverBook]);

  useEffect(() => {
    if (skipBookIdRedirectRef?.current) return;
    if (!location.pathname.includes('/viewer/')) return;
    if (!matchedServerBook || typeof matchedServerBook.id !== 'number') return;

    const canonicalId = String(matchedServerBook.id);
    if (String(bookId) === canonicalId) return;

    navigate(`/user/viewer/${canonicalId}`, {
      replace: true,
      state: {
        ...location.state,
        book: {
          ...matchedServerBook,
          filename: canonicalId,
          _bookId: matchedServerBook.id,
          _needsLoad: true,
          xhtmlPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined,
        },
      },
    });
  }, [matchedServerBook, bookId, location.pathname, location.state, navigate, skipBookIdRedirectRef]);

  return {
    serverBook,
    loadingServerBook,
    matchedServerBook,
  };
}

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

  const {
    data: serverBooksData,
    isLoading: isServerLoading,
    error: serverError,
    refetch: refetchServer,
  } = useBooksServerQuery();

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

      const normalized = { ...book, isFavorite: !!book.isFavorite };
      const existing = deduped.get(dedupeKey);
      if (!existing || numericId < Number(existing.id)) {
        deduped.set(dedupeKey, normalized);
      }
    });

    return Array.from(deduped.values());
  }, []);

  const reconciledBooks = useMemo(() => {
    const serverBooks = serverBooksData?.books || [];
    return reconcileBooks(serverBooks);
  }, [serverBooksData, reconcileBooks]);

  const books = useMemo(() => {
    return reconciledBooks
      .filter((book) => {
        const idKey = book?.id != null ? `${book.id}` : null;
        return idKey && !hiddenServerBookIds.has(idKey);
      })
      .map((book) => ({
        ...book,
        progress: resolveLibraryReadingProgressPercent(book),
      }));
  }, [reconciledBooks, progressCacheEpoch, hiddenServerBookIds]);

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
            String(book?.id) === idStr ? { ...book, isFavorite: favorite } : book
          ),
        };
      });
      return { previousServerBooks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousServerBooks) {
        queryClient.setQueryData(['books', 'server'], context.previousServerBooks);
      }
    },
    onSettled: () => {
      queryClient.refetchQueries({
        queryKey: ['books', 'server'],
        type: 'active',
      });
    },
  });

  const removeBookMutation = useMutation({
    mutationFn: async (bookId) => String(bookId),
    onMutate: async (bookId) => {
      await queryClient.cancelQueries({ queryKey: ['books', 'server'] });
      const targetBookId = String(bookId);
      setHiddenServerBookIds((prev) => {
        const next = new Set(prev);
        next.add(targetBookId);
        hiddenServerBookIdsRef.current = next;
        localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify([...next]));
        return next;
      });
      return {};
    },
  });

  const addBook = useCallback(
    async (newBook) => {
      try {
        const newBookId = newBook?.id ?? newBook?._bookId;
        const newBookIdStr = newBookId != null ? String(newBookId) : null;
        if (!newBookIdStr) return;

        setHiddenServerBookIds((prev) => {
          if (!prev.has(newBookIdStr)) return prev;
          const next = new Set(prev);
          next.delete(newBookIdStr);
          hiddenServerBookIdsRef.current = next;
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
    [queryClient]
  );

  const fetchBook = useCallback(async (bookId) => {
    const response = await getBook(bookId);
    if (response?.isSuccess) {
      return response.result;
    }
    throw new Error(response?.message || '도서 정보를 불러올 수 없습니다.');
  }, []);

  const loading = isServerLoading;
  const error =
    serverError?.message || (serverBooksData?.needsAuth ? '인증이 필요합니다. 로그인해주세요.' : null);

  const retryFetch = useCallback(() => {
    refetchServer();
  }, [refetchServer]);

  const toggleFavorite = useCallback(
    async (bookId, favorite) => {
      await toggleFavoriteMutation.mutateAsync({ bookId, favorite });
    },
    [toggleFavoriteMutation]
  );

  const removeBook = useCallback(
    async (bookId) => {
      await removeBookMutation.mutateAsync(bookId);
    },
    [removeBookMutation]
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

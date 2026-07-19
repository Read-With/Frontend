/** 책: 서버 목록 쿼리·라이브러리·뷰어 URL canonical 매칭 */

import { useState, useEffect, useCallback, useMemo, useReducer } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBook, getBooks, toggleBookFavorite } from '../../utils/api/booksApi';
import { getBookManifest } from '../../utils/api/api';
import { normalizeTitle, normalizeAuthor } from '../../utils/common/valueUtils';
import { errorUtils } from '../../utils/common/errorUtils';
import { prefetchManifest, PROGRESS_CACHE_UPDATED_EVENT } from '../../utils/common/cache/manifestCache';
import { readBooksCache, writeBooksCache } from '../../utils/common/cache/cacheManager';
import { resolveLibraryReadingProgressPercent } from '../../utils/library/libraryUtils';
import { getStoredAccessToken } from '../../utils/security/authTokenStorage';
import { ensureSessionAccessToken } from '../../utils/api/authApi';
import { userViewerPath } from '../../utils/common/urlUtils';

export const BOOKS_QUERY_KEY = ['books', 'server'];

const HIDDEN_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';
const BOOKS_QUERY_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  retry: 1,
};

const bookFetchState = new Map();

function readHiddenBookIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_BOOK_IDS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map((id) => `${id}`) : []);
  } catch {
    return new Set();
  }
}

function writeHiddenBookIds(ids) {
  localStorage.setItem(HIDDEN_BOOK_IDS_KEY, JSON.stringify([...ids]));
}

function reconcileBooks(fetchedBooks) {
  if (!Array.isArray(fetchedBooks)) return [];

  const deduped = new Map();
  for (const book of fetchedBooks) {
    const numericId = Number(book?.id);
    if (!Number.isFinite(numericId) || numericId <= 0) continue;

    const titleKey = normalizeTitle(book?.title || '');
    const authorKey = normalizeAuthor(book?.author || '');
    if (!titleKey || !authorKey) continue;

    const dedupeKey = `${titleKey}::${authorKey}`;
    const normalized = { ...book, isFavorite: !!book.isFavorite };
    const existing = deduped.get(dedupeKey);
    if (!existing || numericId < Number(existing.id)) {
      deduped.set(dedupeKey, normalized);
    }
  }
  return Array.from(deduped.values());
}

export function findCanonicalBook(books, titleKey, authorKey) {
  return books
    .filter((item) => {
      const id = Number(item?.id);
      return (
        Number.isFinite(id) &&
        id > 0 &&
        normalizeTitle(item?.title || '') === titleKey &&
        normalizeAuthor(item?.author || '') === authorKey
      );
    })
    .sort((a, b) => Number(a.id) - Number(b.id))[0] ?? null;
}

function prefetchBookManifests(books) {
  for (const book of books) {
    const id = Number(book?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    prefetchManifest(id, (bookId) => getBookManifest(bookId, { forceRefresh: false })).catch(
      () => {}
    );
  }
}

async function fetchBooksQuery() {
  await ensureSessionAccessToken();
  if (!getStoredAccessToken()) {
    return { books: [], needsAuth: true };
  }

  const response = await getBooks({});
  if (!response?.isSuccess) {
    throw new Error(response?.message || '책 정보를 불러올 수 없습니다.');
  }

  const books = response.result || [];
  writeBooksCache(books);
  prefetchBookManifests(books);
  return { books, needsAuth: false };
}

function getBooksQueryInitialData() {
  const cached = readBooksCache();
  if (!cached) return null;
  return {
    initialData: { books: cached.books, needsAuth: false },
    initialDataUpdatedAt: cached.updatedAt,
  };
}

function invalidateBooksQuery(queryClient) {
  return queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
}

export function prefetchBooks(queryClient) {
  if (!queryClient) return Promise.resolve();
  return queryClient.prefetchQuery({
    queryKey: BOOKS_QUERY_KEY,
    queryFn: fetchBooksQuery,
    ...BOOKS_QUERY_OPTIONS,
  });
}

function useBooksQuery() {
  const [initial] = useState(getBooksQueryInitialData);

  return useQuery({
    queryKey: BOOKS_QUERY_KEY,
    queryFn: fetchBooksQuery,
    ...BOOKS_QUERY_OPTIONS,
    ...(initial || {}),
  });
}

/** 동일 제목+저자면 최소 bookId로 뷰어 URL 정규화 */
export function useServerBookMatching(bookId, options = {}) {
  const { skipBookIdRedirectRef } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [serverBook, setServerBook] = useState(null);
  const [loadingServerBook, setLoadingServerBook] = useState(false);
  const [matchedServerBook, setMatchedServerBook] = useState(null);

  useEffect(() => {
    const numericBookId = parseInt(bookId, 10);
    if (isNaN(numericBookId) || serverBook?.id === numericBookId) return;
    if (bookFetchState.get(numericBookId) === 'inflight') return;

    let cancelled = false;
    setLoadingServerBook(true);
    bookFetchState.set(numericBookId, 'inflight');

    getBook(numericBookId)
      .then((response) => {
        if (cancelled) return;
        if (response?.isSuccess && response.result) {
          setServerBook(response.result);
          bookFetchState.set(numericBookId, 'done');
        } else {
          bookFetchState.delete(numericBookId);
        }
      })
      .catch((error) => {
        bookFetchState.delete(numericBookId);
        errorUtils.logError('fetchServerBook', error, { bookId, numericBookId });
      })
      .finally(() => {
        if (!cancelled) setLoadingServerBook(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, location.state?.book, serverBook?.id]);

  useEffect(() => {
    if (location.state?.fromLibrary === true) {
      setMatchedServerBook(null);
      return;
    }

    const sourceBook = location.state?.book || serverBook;
    const titleKey = normalizeTitle(sourceBook?.title || '');
    const authorKey = normalizeAuthor(sourceBook?.author || '');
    if (!titleKey || !authorKey) {
      setMatchedServerBook(null);
      return;
    }

    let cancelled = false;
    const resolveCanonical = async () => {
      try {
        let books = queryClient.getQueryData(BOOKS_QUERY_KEY)?.books;
        if (!Array.isArray(books)) {
          const res = await getBooks({});
          books = res?.isSuccess && Array.isArray(res.result) ? res.result : null;
        }
        if (cancelled || !books) return;
        setMatchedServerBook(findCanonicalBook(books, titleKey, authorKey));
      } catch {
        if (!cancelled) setMatchedServerBook(null);
      }
    };

    resolveCanonical();
    return () => {
      cancelled = true;
    };
  }, [bookId, location.state?.book, location.state?.fromLibrary, serverBook, queryClient]);

  useEffect(() => {
    if (skipBookIdRedirectRef?.current) return;
    if (!location.pathname.includes('/viewer/')) return;
    if (!matchedServerBook || typeof matchedServerBook.id !== 'number') return;

    const canonicalId = String(matchedServerBook.id);
    if (String(bookId) === canonicalId) return;

    navigate(userViewerPath(canonicalId), {
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
  const [hiddenBookIds, setHiddenBookIds] = useState(readHiddenBookIds);

  useEffect(() => {
    const onProgressCacheUpdated = () => bumpProgressCacheEpoch();
    window.addEventListener(PROGRESS_CACHE_UPDATED_EVENT, onProgressCacheUpdated);
    return () => window.removeEventListener(PROGRESS_CACHE_UPDATED_EVENT, onProgressCacheUpdated);
  }, []);

  const { data, isLoading, error: queryError, refetch } = useBooksQuery();

  const books = useMemo(() => {
    return reconcileBooks(data?.books)
      .filter((book) => book?.id != null && !hiddenBookIds.has(`${book.id}`))
      .map((book) => ({
        ...book,
        progress: resolveLibraryReadingProgressPercent(book),
      }));
  }, [data, progressCacheEpoch, hiddenBookIds]);

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ bookId, favorite }) => toggleBookFavorite(bookId, favorite),
    onMutate: async ({ bookId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: BOOKS_QUERY_KEY });
      const previous = queryClient.getQueryData(BOOKS_QUERY_KEY);
      queryClient.setQueryData(BOOKS_QUERY_KEY, (old) => {
        if (!old) return old;
        const idStr = String(bookId);
        return {
          ...old,
          books: (old.books || []).map((book) =>
            String(book?.id) === idStr ? { ...book, isFavorite: favorite } : book
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(BOOKS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void invalidateBooksQuery(queryClient);
    },
  });

  const removeBook = useCallback((bookId) => {
    setHiddenBookIds((prev) => {
      const next = new Set(prev);
      next.add(String(bookId));
      writeHiddenBookIds(next);
      return next;
    });
  }, []);

  const addBook = useCallback(
    async (newBook) => {
      const newBookId = newBook?.id ?? newBook?._bookId;
      const idStr = newBookId != null ? String(newBookId) : null;
      if (!idStr) return;

      const bookToAdd = {
        ...newBook,
        id: Number.isFinite(Number(newBookId)) ? Number(newBookId) : newBookId,
        isFavorite: !!newBook.isFavorite,
      };

      setHiddenBookIds((prev) => {
        if (!prev.has(idStr)) return prev;
        const next = new Set(prev);
        next.delete(idStr);
        writeHiddenBookIds(next);
        return next;
      });

      const merge = (old) => {
        if (!old) return { books: [bookToAdd], needsAuth: false };
        const list = old.books || [];
        const idx = list.findIndex((b) => String(b?.id) === idStr);
        if (idx >= 0) {
          const next = list.slice();
          next[idx] = { ...list[idx], ...bookToAdd };
          return { ...old, books: next };
        }
        return { ...old, books: [...list, bookToAdd] };
      };

      try {
        queryClient.setQueryData(BOOKS_QUERY_KEY, merge);
        await invalidateBooksQuery(queryClient);

        // 서버 목록에 아직 없으면(분석 전 미노출 등) 업로드 결과 유지
        queryClient.setQueryData(BOOKS_QUERY_KEY, (old) => {
          if ((old?.books || []).some((b) => String(b?.id) === idStr)) return old;
          const next = merge(old);
          writeBooksCache(next.books);
          return next;
        });
      } catch (e) {
        console.warn('addBook 실패:', e);
      }
    },
    [queryClient]
  );

  const toggleFavorite = useCallback(
    (bookId, favorite) => toggleFavoriteMutation.mutateAsync({ bookId, favorite }),
    [toggleFavoriteMutation]
  );

  return {
    books,
    loading: isLoading,
    error:
      queryError?.message || (data?.needsAuth ? '인증이 필요합니다. 로그인해주세요.' : null),
    refetch,
    removeBook,
    toggleFavorite,
    addBook,
  };
};

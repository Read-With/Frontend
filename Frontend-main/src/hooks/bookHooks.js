/** 책: 서버 목록 쿼리·라이브러리·뷰어 URL canonical 매칭 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBook, getBooks, getBooksArray, toggleBookFavorite, getBookManifest } from '../utils/api/booksApi';
import { errorUtils, toPositiveNumberOrNull } from '../utils/common/valueUtils';
import { normalizeTitle, normalizeAuthor } from '../utils/common/bookNormalize';
import { userViewerPath } from '../utils/common/urlUtils';
import { loadFromStorage, saveToStorage, removeFromStorage, loadTtlStorage, saveTtlStorage } from '../utils/common/cache/cacheManager';
import { resolveLibraryReadingProgressPercent } from '../utils/libraryUtils';
import { getStoredAccessToken, ensureSessionAccessToken, AUTH_CLEARED_EVENT } from '../utils/api/authApi';
import { useProgressCacheUpdates } from './common/hooksShared';

export const BOOKS_QUERY_KEY = ['books', 'server'];

/** 마이페이지 책 목록 persist (react-query initialData용) */
const BOOKS_CACHE_KEY = 'readwith_books_server_cache';
const BOOKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readBooksCache() {
  const stored = loadTtlStorage(BOOKS_CACHE_KEY, BOOKS_CACHE_TTL_MS);
  if (!stored || !Array.isArray(stored.books)) return null;
  return {
    books: stored.books,
    updatedAt: Number(stored.timestamp) || Date.now(),
  };
}

function writeBooksCache(books) {
  if (!Array.isArray(books)) return;
  saveTtlStorage(BOOKS_CACHE_KEY, { books });
}

// 로그아웃 시 이전 사용자 책 목록 제거. App.jsx가 이 모듈을 eager import하므로 앱 시작 시 등록됨
if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_CLEARED_EVENT, () => removeFromStorage(BOOKS_CACHE_KEY));
}

const HIDDEN_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';
const BOOKS_QUERY_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  retry: 1,
};

function readHiddenBookIds() {
  const parsed = loadFromStorage(HIDDEN_BOOK_IDS_KEY);
  return new Set(Array.isArray(parsed) ? parsed.map((id) => `${id}`) : []);
}

function writeHiddenBookIds(ids) {
  saveToStorage(HIDDEN_BOOK_IDS_KEY, [...ids]);
}

/** 유효한 서버 책이면 { id, key: 제목::저자 }, 아니면 null */
function bookIdentity(book) {
  const id = toPositiveNumberOrNull(book?.id);
  if (id == null) return null;
  const titleKey = normalizeTitle(book?.title || '');
  const authorKey = normalizeAuthor(book?.author || '');
  return { id, titleKey, authorKey, key: `${titleKey}::${authorKey}` };
}

/** 같은 제목+저자는 최소 id 한 권만 */
function reconcileBooks(fetchedBooks) {
  if (!Array.isArray(fetchedBooks)) return [];

  const deduped = new Map();
  for (const book of fetchedBooks) {
    const identity = bookIdentity(book);
    if (!identity?.titleKey || !identity.authorKey) continue;
    const existing = deduped.get(identity.key);
    if (!existing || identity.id < Number(existing.id)) {
      deduped.set(identity.key, { ...book, isFavorite: !!book.isFavorite });
    }
  }
  return Array.from(deduped.values());
}

export function findCanonicalBook(books, titleKey, authorKey) {
  return books
    .filter((item) => {
      const identity = bookIdentity(item);
      return identity?.titleKey === titleKey && identity.authorKey === authorKey;
    })
    .sort((a, b) => Number(a.id) - Number(b.id))[0] ?? null;
}

function prefetchBookManifests(books) {
  for (const book of books) {
    const id = toPositiveNumberOrNull(book?.id);
    if (id != null) getBookManifest(id).catch(() => {});
  }
}

async function fetchBooksQuery() {
  await ensureSessionAccessToken();
  if (!getStoredAccessToken()) {
    return { books: [], needsAuth: true };
  }

  const response = await getBooks({});
  if (response?.softEmpty) {
    return {
      books: [],
      needsAuth: response.code === 'FORBIDDEN',
    };
  }
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

  const numericBookId = parseInt(bookId, 10);
  const serverBookQuery = useQuery({
    queryKey: ['book', numericBookId],
    queryFn: async () => {
      try {
        const response = await getBook(numericBookId);
        return response?.isSuccess && response.result ? response.result : null;
      } catch (error) {
        errorUtils.logError('fetchServerBook', error, { bookId, numericBookId });
        throw error;
      }
    },
    enabled: !isNaN(numericBookId),
    retry: false,
  });
  const serverBook = serverBookQuery.data ?? null;

  const sourceBook = location.state?.book || serverBook;
  const titleKey = normalizeTitle(sourceBook?.title || '');
  const authorKey = normalizeAuthor(sourceBook?.author || '');
  const canMatch = location.state?.fromLibrary !== true && Boolean(titleKey && authorKey);

  const matchQuery = useQuery({
    queryKey: ['canonicalBook', titleKey, authorKey],
    // 실패는 throw → null로 캐시하지 않고 다음 마운트 때 다시 시도.
    // 즉시 재시도·재연결 시 재요청은 안 함: 늦게 성공하면 읽는 중에 리다이렉트되어 위치가 초기화됨
    queryFn: async () => {
      let books = queryClient.getQueryData(BOOKS_QUERY_KEY)?.books;
      if (!Array.isArray(books)) books = await getBooksArray();
      if (!Array.isArray(books)) throw new Error('도서 목록을 불러오지 못했습니다');
      return findCanonicalBook(books, titleKey, authorKey);
    },
    enabled: canMatch,
    retry: false,
    refetchOnReconnect: false,
  });
  const matchedServerBook = canMatch ? matchQuery.data ?? null : null;

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
    loadingServerBook: serverBookQuery.isLoading,
    matchedServerBook,
  };
}

export const useBooks = () => {
  const queryClient = useQueryClient();
  const [hiddenBookIds, setHiddenBookIds] = useState(readHiddenBookIds);
  // 진도 캐시가 바뀌면 progress를 다시 계산
  const progressCacheVersion = useProgressCacheUpdates();

  const { data, isLoading, error: queryError, refetch } = useBooksQuery();

  const visibleBooks = useMemo(
    () => reconcileBooks(data?.books).filter((book) => !hiddenBookIds.has(`${book.id}`)),
    [data, hiddenBookIds],
  );
  const books = useMemo(
    () => visibleBooks.map((book) => ({ ...book, progress: resolveLibraryReadingProgressPercent(book) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progressCacheVersion: 캐시 갱신 시 재계산
    [visibleBooks, progressCacheVersion],
  );

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

  // storage를 기준으로 갱신 — 마이페이지를 벗어난 뒤 '되돌리기'를 눌러도 반영됨
  const setBookHidden = useCallback((bookId, hidden) => {
    const idStr = String(bookId);
    const next = readHiddenBookIds();
    if (next.has(idStr) === hidden) return;
    if (hidden) next.add(idStr);
    else next.delete(idStr);
    writeHiddenBookIds(next);
    setHiddenBookIds(next);
  }, []);

  const removeBook = useCallback((bookId) => setBookHidden(bookId, true), [setBookHidden]);
  const restoreBook = useCallback((bookId) => setBookHidden(bookId, false), [setBookHidden]);

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

      setBookHidden(idStr, false);

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
        errorUtils.logWarning('addBook', e?.message || '실패');
      }
    },
    [queryClient, setBookHidden]
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
    needsAuth: Boolean(data?.needsAuth) || queryError?.status === 401,
    refetch,
    removeBook,
    restoreBook,
    toggleFavorite,
    addBook,
  };
};

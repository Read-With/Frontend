import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getBooks, getBook, deleteBook, toggleBookFavorite } from '../utils/api/booksApi';
import { getAllLocalBookIds, deleteLocalBookBuffer } from '../utils/localBookStorage';

const normalizeTitle = (title) => {
  if (!title) return '';
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s/g, '');
};

const isDefaultBook = (book) => book?.default === true || book?.isDefault === true;

export const useBooks = () => {
  const [serverBooks, setServerBooks] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [localBookKeys, setLocalBookKeys] = useState(new Set());
  const lastFetchParamsRef = useRef({});

  const reconcileBooks = useCallback((fetchedBooks, localKeys) => {
    if (!Array.isArray(fetchedBooks)) return [];

    const deduped = new Map();

    fetchedBooks.forEach((book) => {
      const normalizedTitle = normalizeTitle(book?.title);
      const titleKey = normalizedTitle || `__id_${book?.id}`;
      const shouldShow = isDefaultBook(book) || (normalizedTitle && localKeys.has(normalizedTitle));

      if (!shouldShow) {
        return;
      }

      const existing = deduped.get(titleKey);
      if (!existing || (book?.id && existing.id && Number(book.id) > Number(existing.id))) {
        deduped.set(titleKey, {
          ...book,
          favorite: !!book.favorite,
        });
      }
    });

    return Array.from(deduped.values());
  }, []);

  const fetchLocalKeys = useCallback(async () => {
    const ids = await getAllLocalBookIds();
    const normalizedKeys = new Set(
      (ids || [])
        .map((id) => (typeof id === 'string' ? id : id?.toString?.() || ''))
        .filter(Boolean)
        .map((id) => normalizeTitle(id)),
    );
    setLocalBookKeys(normalizedKeys);
    return normalizedKeys;
  }, []);

  const fetchBooks = useCallback(
    async (params = {}) => {
      const token = localStorage.getItem('accessToken');

      if (!token) {
        setServerBooks([]);
        setBooks([]);
        setLoading(false);
        setError('인증이 필요합니다. 로그인해주세요.');
        return;
      }

      lastFetchParamsRef.current = params;

      try {
        setLoading(true);
        setError(null);

        const [response, localKeys] = await Promise.all([
          getBooks(params),
          fetchLocalKeys(),
        ]);

        if (!response?.isSuccess) {
          throw new Error(response?.message || '책 정보를 불러올 수 없습니다.');
        }

        const fetched = response.result || [];
        setServerBooks(fetched);

        const reconciled = reconcileBooks(fetched, localKeys);
        setBooks(reconciled);
      } catch (err) {
        setServerBooks([]);
        setBooks([]);

        if (err.message?.includes('인증이 만료되었습니다') || err.message?.includes('401')) {
          setError('인증이 만료되었습니다. 다시 로그인해주세요.');
        } else {
          setError(err.message || '책 정보를 불러올 수 없습니다.');
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchLocalKeys, reconcileBooks],
  );

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const retryFetch = useCallback(() => {
    fetchBooks(lastFetchParamsRef.current || {});
  }, [fetchBooks]);

  const removeBook = useCallback(
    async (bookId) => {
      try {
        const target = books.find((book) => `${book.id}` === `${bookId}`);

        if (!target) {
          throw new Error('삭제할 책을 찾을 수 없습니다.');
        }

        const response = await deleteBook(bookId);

        if (!response?.isSuccess) {
          throw new Error(response?.message || '책 삭제에 실패했습니다.');
        }

        setBooks((prev) => prev.filter((book) => `${book.id}` !== `${bookId}`));
        setServerBooks((prev) => prev.filter((book) => `${book.id}` !== `${bookId}`));

        const normalizedTitle = normalizeTitle(target.title);
        if (normalizedTitle) {
          await deleteLocalBookBuffer(normalizedTitle);
          setLocalBookKeys((prev) => {
            const next = new Set(prev);
            next.delete(normalizedTitle);
            return next;
          });
        }

        await fetchBooks(lastFetchParamsRef.current || {});
      } catch (err) {
        setError(err.message || '책 삭제에 실패했습니다.');
        throw err;
      }
    },
    [books, fetchBooks],
  );

  const toggleFavorite = useCallback(
    async (bookId, favorite) => {
      setBooks((prev) =>
        prev.map((book) =>
          book.id === bookId ? { ...book, favorite } : book,
        ),
      );

      try {
        const response = await toggleBookFavorite(bookId, favorite);

        if (!response?.isSuccess) {
          throw new Error(response?.message || '즐겨찾기 설정에 실패했습니다.');
        }

        await fetchBooks(lastFetchParamsRef.current || {});
      } catch (err) {
        setBooks((prev) =>
          prev.map((book) =>
            book.id === bookId ? { ...book, favorite: !favorite } : book,
          ),
        );
        setError(err.message || '즐겨찾기 설정에 실패했습니다.');
        throw err;
      }
    },
    [fetchBooks],
  );

  const fetchBook = useCallback(async (bookId) => {
    const response = await getBook(bookId);
    if (response?.isSuccess) {
      return response.result;
    }
    throw new Error(response?.message || '도서 정보를 불러올 수 없습니다.');
  }, []);

  const addBook = useCallback(async () => {
    await fetchBooks(lastFetchParamsRef.current || {});
  }, [fetchBooks]);

  const matchedBooks = useMemo(() => books, [books]);

  return {
    books: matchedBooks,
    loading,
    error,
    retryFetch,
    removeBook,
    toggleFavorite,
    fetchBook,
    addBook,
    allServerBooks: serverBooks,
  };
};

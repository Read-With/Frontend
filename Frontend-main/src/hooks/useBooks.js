import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getBooks, getBook, deleteBook, toggleBookFavorite } from '../utils/api/booksApi';
import {
  getAllLocalBookIds,
  deleteLocalBookBuffer,
  getAllLocalBookMetadata,
  deleteLocalBookMetadata,
} from '../utils/localBookStorage';

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

const getBookKey = (book) => {
  if (!book) return '';
  const normalizedTitle = normalizeTitle(book?.title);
  if (normalizedTitle) {
    return normalizedTitle;
  }
  if (book.id !== undefined && book.id !== null) {
    return `${book.id}`;
  }
  if (typeof book.filename === 'string') {
    return normalizeTitle(book.filename);
  }
  if (typeof book._localKey === 'string') {
    return normalizeTitle(book._localKey);
  }
  return '';
};

export const useBooks = () => {
  const [serverBooks, setServerBooks] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [localBookKeys, setLocalBookKeys] = useState(new Set());
  const [localOnlyBooks, setLocalOnlyBooks] = useState([]);
  const lastFetchParamsRef = useRef({});
  const localOnlyBooksRef = useRef([]);

  useEffect(() => {
    localOnlyBooksRef.current = localOnlyBooks;
  }, [localOnlyBooks]);

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

  const fetchLocalData = useCallback(async () => {
    const [ids, metadataEntries] = await Promise.all([
      getAllLocalBookIds(),
      getAllLocalBookMetadata(),
    ]);
    const normalizedKeys = new Set(
      (ids || [])
        .map((id) => (typeof id === 'string' ? id : id?.toString?.() || ''))
        .filter(Boolean)
        .map((id) => normalizeTitle(id)),
    );
    const metadataDeduped = new Map();
    (metadataEntries || []).forEach(({ key, value }) => {
      if (!key || !value) return;
      const normalizedKey = normalizeTitle(key);
      const dedupeKey = normalizedKey || key;
      const baseId = value.id || value._bookId || value.bookId || dedupeKey;
      const coverImgUrl =
        value.coverImgUrl ||
        value.coverImage ||
        value.coverUrl ||
        '';

      const merged = {
        ...value,
        id: baseId,
        title: value.title || value.name || baseId || '제목 없음',
        author: value.author || value.writer || '저자 미상',
        language: value.language || 'ko',
        coverImgUrl,
        coverImage: coverImgUrl,
        favorite: !!value.favorite,
        updatedAt: value.updatedAt || value.uploadedAt || new Date().toISOString(),
        isLocalOnly: value.isLocalOnly ?? !value.id,
        _localKey: dedupeKey,
      };

      metadataDeduped.set(dedupeKey, merged);
    });
    const metadataBooks = Array.from(metadataDeduped.values());

    const metadataKeySet = new Set(metadataBooks.map((book) => book._localKey).filter(Boolean));

    const fallbackBooks = Array.from(normalizedKeys)
      .filter((key) => key && !metadataKeySet.has(key))
      .map((key) => ({
        id: key,
        title: key,
        author: '로컬 도서',
        language: 'ko',
        coverImgUrl: '',
        coverImage: '',
        description: '',
        favorite: false,
        updatedAt: new Date().toISOString(),
        isLocalOnly: true,
        _localKey: key,
      }));

    setLocalBookKeys(new Set(normalizedKeys));
    return {
      keys: normalizedKeys,
      metadataBooks: [...metadataBooks, ...fallbackBooks],
    };
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

        const [response, localData] = await Promise.all([
          getBooks(params),
          fetchLocalData(),
        ]);

        if (!response?.isSuccess) {
          throw new Error(response?.message || '책 정보를 불러올 수 없습니다.');
        }

        const fetched = response.result || [];
        setServerBooks(fetched);

        const localKeys = localData?.keys || new Set();
        const metadataBooks = localData?.metadataBooks || [];

        const reconciled = reconcileBooks(fetched, localKeys);
        const serverKeys = new Set(
          reconciled.map((book) => getBookKey(book)).filter(Boolean),
        );

        const metadataMap = new Map();
        metadataBooks.forEach((book) => {
          const key = getBookKey(book) || book._localKey;
          if (key && !serverKeys.has(key)) {
            metadataMap.set(key, { ...book });
          }
        });

        const sessionLocalMap = new Map();
        localOnlyBooksRef.current.forEach((book) => {
          const key = getBookKey(book) || book._localKey;
          if (key && !serverKeys.has(key)) {
            sessionLocalMap.set(key, { ...metadataMap.get(key), ...book });
          }
        });

        const mergedLocalMap = new Map();
        metadataMap.forEach((value, key) => {
          mergedLocalMap.set(key, { ...value });
        });
        sessionLocalMap.forEach((value, key) => {
          if (mergedLocalMap.has(key)) {
            mergedLocalMap.set(key, { ...mergedLocalMap.get(key), ...value });
          } else {
            mergedLocalMap.set(key, value);
          }
        });
        const mergedLocal = Array.from(mergedLocalMap.values());

        setLocalOnlyBooks(mergedLocal);

        const combinedMap = new Map();
        mergedLocal.forEach((book) => {
          const key = getBookKey(book) || book._localKey;
          if (key) {
            combinedMap.set(key, book);
          }
        });
        reconciled.forEach((book) => {
          const key = getBookKey(book);
          if (key) {
            combinedMap.set(key, book);
          }
        });
        setBooks(Array.from(combinedMap.values()));
      } catch (err) {
        setServerBooks([]);
        let fallbackLocal = localOnlyBooksRef.current;
        if (!fallbackLocal || fallbackLocal.length === 0) {
          try {
            const localData = await fetchLocalData();
            fallbackLocal = localData?.metadataBooks || [];
            setLocalOnlyBooks(fallbackLocal);
          } catch {
            fallbackLocal = [];
          }
        } else {
          setLocalOnlyBooks(fallbackLocal);
        }
        setBooks(fallbackLocal);

        if (err.message?.includes('인증이 만료되었습니다') || err.message?.includes('401')) {
          setError('인증이 만료되었습니다. 다시 로그인해주세요.');
        } else {
          setError(err.message || '책 정보를 불러올 수 없습니다.');
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchLocalData, reconcileBooks],
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

        let deleteFromServer = true;
        if (target.isLocalOnly || !target.id || Number.isNaN(Number(target.id))) {
          deleteFromServer = false;
        }

        if (deleteFromServer) {
          const response = await deleteBook(bookId);

          if (!response?.isSuccess) {
            throw new Error(response?.message || '책 삭제에 실패했습니다.');
          }
        }

        setBooks((prev) => prev.filter((book) => `${book.id}` !== `${bookId}`));
        setServerBooks((prev) => prev.filter((book) => `${book.id}` !== `${bookId}`));

        const normalizedTitle = normalizeTitle(target.title);
        if (normalizedTitle) {
          await Promise.all([
            deleteLocalBookBuffer(normalizedTitle),
            deleteLocalBookMetadata(normalizedTitle),
          ]);
          setLocalBookKeys((prev) => {
            const next = new Set(prev);
            next.delete(normalizedTitle);
            return next;
          });
          setLocalOnlyBooks((prev) =>
            prev.filter((book) => {
              const key = getBookKey(book) || book._localKey;
              return key !== normalizedTitle;
            }),
          );
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

  const addBook = useCallback(
    async (newBook) => {
      if (newBook) {
        const normalizedTitle = normalizeTitle(newBook.title);
        if (normalizedTitle) {
          setLocalBookKeys((prev) => {
            const next = new Set(prev);
            next.add(normalizedTitle);
            return next;
          });
        }

        setLocalOnlyBooks((prev) => {
          const key = getBookKey(newBook) || normalizedTitle || newBook._localKey;
          const assignedId = newBook.id || normalizedTitle || newBook._localKey || key;
          const nextBook = normalizedTitle
            ? { ...newBook, _localKey: normalizedTitle, id: assignedId }
            : { ...newBook, id: assignedId };
          if (!key) {
            return [nextBook, ...prev];
          }
          let replaced = false;
          const updated = prev.map((book) => {
            const bookKey = getBookKey(book) || book._localKey;
            if (bookKey === key) {
              replaced = true;
              return { ...book, ...nextBook };
            }
            return book;
          });
          if (!replaced) {
            return [nextBook, ...updated];
          }
          return updated;
        });

        setBooks((prev) => {
          const key = getBookKey(newBook) || normalizedTitle || newBook._localKey;
          const assignedId = newBook.id || normalizedTitle || newBook._localKey || key;
          const nextBook = normalizedTitle
            ? { ...newBook, _localKey: normalizedTitle, id: assignedId }
            : { ...newBook, id: assignedId };
          if (!key) {
            return [nextBook, ...prev];
          }
          let replaced = false;
          const updated = prev.map((book) => {
            const bookKey = getBookKey(book) || book._localKey;
            if (bookKey === key) {
              replaced = true;
              return { ...book, ...nextBook };
            }
            return book;
          });
          if (!replaced) {
            return [nextBook, ...updated];
          }
          return updated;
        });
        return;
      }
      await fetchBooks(lastFetchParamsRef.current || {});
    },
    [fetchBooks],
  );

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

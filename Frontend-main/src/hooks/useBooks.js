import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getBooks, getBook, toggleBookFavorite } from '../utils/api/booksApi';
import {
  getAllLocalBookIds,
  deleteLocalBookBuffer,
  getAllLocalBookMetadata,
  deleteLocalBookMetadata,
} from '../utils/localBookStorage';
import { prefetchManifest } from '../utils/common/manifestCache';
import { getBookManifest } from '../utils/common/api';

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
  // 로컬 bookID는 사용하지 않음 - 서버 bookId만 사용
  if (book.id !== undefined && book.id !== null) {
    return `${book.id}`;
  }
  if (book._bookId !== undefined && book._bookId !== null) {
    return `${book._bookId}`;
  }
  // bookId가 없으면 filename 사용 (fallback)
  if (typeof book.filename === 'string') {
    return book.filename;
  }
  return '';
};

const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';

export const useBooks = () => {
  const [serverBooks, setServerBooks] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [localBookKeys, setLocalBookKeys] = useState(new Set());
  const [localOnlyBooks, setLocalOnlyBooks] = useState([]);
  const [hiddenServerBookIds, setHiddenServerBookIds] = useState(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_SERVER_BOOK_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        return new Set(parsed.map((id) => `${id}`));
      }
    } catch {
    }
    return new Set();
  });
  const lastFetchParamsRef = useRef({});
  const localOnlyBooksRef = useRef([]);
  const hiddenServerBookIdsRef = useRef(new Set(hiddenServerBookIds));
  const booksRef = useRef([]);
  const localBookKeysRef = useRef(new Set());

  useEffect(() => {
    localOnlyBooksRef.current = localOnlyBooks;
  }, [localOnlyBooks]);

  useEffect(() => {
    hiddenServerBookIdsRef.current = new Set(hiddenServerBookIds);
  }, [hiddenServerBookIds]);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    localBookKeysRef.current = localBookKeys;
  }, [localBookKeys]);


  const reconcileBooks = useCallback((fetchedBooks, localKeys) => {
    if (!Array.isArray(fetchedBooks)) return [];

    const deduped = new Map();

    fetchedBooks.forEach((book) => {
      // 로컬 bookID는 사용하지 않음 - bookId를 키로 사용
      const bookId = book?.id !== undefined && book?.id !== null ? `${book.id}` : null;
      const bookKey = bookId || `__temp_${book?.title || ''}`;
      
      // 로컬에 해당 bookId가 있는지 확인
      const shouldShow = isDefaultBook(book) || (bookId && localKeys.has(bookId));

      if (!shouldShow) {
        return;
      }

      const existing = deduped.get(bookKey);
      if (!existing) {
        deduped.set(bookKey, {
          ...book,
          favorite: !!book.favorite,
        });
        return;
      }

      const existingId = existing?.id !== undefined && existing?.id !== null ? Number(existing.id) : null;
      const incomingId = book?.id !== undefined && book?.id !== null ? Number(book.id) : null;

      const shouldReplace =
        incomingId !== null &&
        (existingId === null || incomingId < existingId);

      if (shouldReplace) {
        deduped.set(bookKey, {
          ...existing,
          ...book,
          favorite: !!book.favorite,
        });
      }
    });

    return Array.from(deduped.values());
  }, []);

  const applyMergedBooks = useCallback(
    (serverList, localData) => {
      const localKeys = localData?.keys instanceof Set ? localData.keys : new Set(localData?.keys || []);
      const metadataBooks = Array.isArray(localData?.metadataBooks) ? localData.metadataBooks : [];

      // 기존 localBookKeys와 병합 (addBook에서 추가한 책이 사라지지 않도록)
      setLocalBookKeys((prev) => {
        const merged = new Set(prev);
        localKeys.forEach((key) => merged.add(key));
        return merged;
      });

      // reconcileBooks에 병합된 localKeys 전달 (addBook에서 추가한 책 포함)
      const mergedLocalKeys = new Set(localKeys);
      // ref에서 최신 localBookKeys 가져오기
      localBookKeysRef.current.forEach((key) => mergedLocalKeys.add(key));
      const reconciled = reconcileBooks(serverList, mergedLocalKeys);
      const serverKeys = new Set(reconciled.map((book) => getBookKey(book)).filter(Boolean));

      // 로컬 메타데이터를 먼저 맵에 추가 (모든 로컬 책 포함, IndexedDB에 저장된 모든 책)
      // 로컬 bookID는 사용하지 않음 - bookId를 키로 사용
      const metadataMap = new Map();
      metadataBooks.forEach((book) => {
        // _bookIdKey가 있으면 우선 사용 (IndexedDB 원본 키)
        const key = book._bookIdKey || getBookKey(book);
        if (key) {
          metadataMap.set(key, { ...book });
        }
      });

      // 세션 로컬 책도 추가
      const sessionLocalMap = new Map();
      localOnlyBooksRef.current.forEach((book) => {
        const key = getBookKey(book);
        if (key) {
          const existing = metadataMap.get(key) || {};
          sessionLocalMap.set(key, { ...existing, ...book });
        }
      });

      // 메타데이터와 세션 로컬 책 병합
      const mergedLocalMap = new Map(metadataMap);
      sessionLocalMap.forEach((value, key) => {
        if (mergedLocalMap.has(key)) {
          mergedLocalMap.set(key, { ...mergedLocalMap.get(key), ...value });
        } else {
          mergedLocalMap.set(key, value);
        }
      });
      const mergedLocal = Array.from(mergedLocalMap.values());
      setLocalOnlyBooks(mergedLocal);

      // 최종 병합: 로컬 책을 먼저 추가
      const combinedMap = new Map();
      mergedLocal.forEach((book) => {
        const key = getBookKey(book);
        if (key) {
          combinedMap.set(key, { ...book });
        }
      });

      // 서버 책을 로컬 책 위에 병합 (서버 데이터 우선)
      reconciled.forEach((book) => {
        const key = getBookKey(book);
        if (!key) {
          return;
        }
        const localInfo = mergedLocalMap.get(key);
        if (localInfo) {
          // 로컬 정보가 있으면 병합
          combinedMap.set(key, {
            ...localInfo,
            ...book,
            id: book.id,
            _bookId: book.id,
            isLocalOnly: false,
            coverImgUrl: book.coverImgUrl || localInfo.coverImgUrl || '',
            coverImage: book.coverImgUrl || localInfo.coverImgUrl || '',
          });
        } else {
          // 로컬 정보가 없어도 서버 책은 추가 (로컬 키가 있는 경우)
          if (localKeys.has(key)) {
            combinedMap.set(key, {
              ...book,
              _bookId: book.id,
            });
          }
        }
      });

      const hiddenIds = hiddenServerBookIdsRef.current;
      const nextBooks = Array.from(combinedMap.values()).filter((book) => {
        const idKey = book?.id !== undefined && book?.id !== null ? `${book.id}` : null;
        if (idKey && hiddenIds.has(idKey)) {
          return false;
        }
        return true;
      });

      // 이전 책 목록이 있고 새 목록이 비어있지 않을 때만 업데이트
      // 이렇게 하면 일시적으로 빈 배열로 설정되는 것을 방지
      const currentBooks = booksRef.current;
      if (nextBooks.length > 0 || currentBooks.length === 0) {
        booksRef.current = nextBooks;
        setBooks(nextBooks);
      }
    },
    [reconcileBooks],
  );

  const fetchLocalData = useCallback(async () => {
    const [ids, metadataEntries] = await Promise.all([
      getAllLocalBookIds(),
      getAllLocalBookMetadata(),
    ]);
    // 로컬 bookID는 사용하지 않음 - bookId를 키로 사용
    const bookIdKeys = new Set(
      (ids || [])
        .map((id) => (typeof id === 'string' ? id : id?.toString?.() || ''))
        .filter(Boolean)
    );
    
    // 모든 메타데이터를 먼저 처리
    const allMetadata = [];
    (metadataEntries || []).forEach(({ key, value }) => {
      if (!key || !value) return;
      // 키는 bookId를 그대로 사용 (정규화하지 않음)
      const bookIdKey = key;
      // bookId는 서버에서 받은 id를 우선 사용
      const baseId = value.id || value._bookId || value.bookId || bookIdKey;
      const coverImgUrl =
        value.coverImgUrl ||
        value.coverImage ||
        value.coverUrl ||
        '';

      const merged = {
        ...value,
        id: baseId,
        _bookId: baseId,
        title: value.title || value.name || baseId || '제목 없음',
        author: value.author || value.writer || '저자 미상',
        language: value.language || 'ko',
        coverImgUrl,
        coverImage: coverImgUrl,
        favorite: !!value.favorite,
        uploadedAt: value.uploadedAt || value.createdAt || value.updatedAt || new Date().toISOString(),
        updatedAt: value.updatedAt || value.uploadedAt || value.createdAt || new Date().toISOString(),
        isLocalOnly: value.isLocalOnly ?? !baseId,
        _bookIdKey: bookIdKey, // 원본 키 보존
      };

      allMetadata.push(merged);
    });
    
    // 책 이름 기준으로 정규화하여 중복 제거 (최초 저장한 것을 기준)
    const titleMap = new Map();
    allMetadata.forEach((book) => {
      const normalizedTitle = normalizeTitle(book.title);
      if (!normalizedTitle) return;
      
      const existing = titleMap.get(normalizedTitle);
      if (!existing) {
        // 첫 번째 책 저장
        titleMap.set(normalizedTitle, book);
      } else {
        // 같은 이름의 책이 있으면 최초 저장한 것(업로드 시간이 더 이른 것)을 기준으로 함
        const existingTime = new Date(existing.uploadedAt || existing.createdAt || existing.updatedAt || 0).getTime();
        const currentTime = new Date(book.uploadedAt || book.createdAt || book.updatedAt || 0).getTime();
        
        if (currentTime < existingTime) {
          // 현재 책이 더 이전에 저장됨 - 현재 책을 기준으로 함
          titleMap.set(normalizedTitle, book);
        }
        // 그렇지 않으면 기존 책 유지
      }
    });
    
    // 최종 메타데이터 목록 (책 이름 기준 중복 제거됨)
    const metadataBooks = Array.from(titleMap.values());
    
    // IndexedDB에 저장된 모든 책 ID를 키로 사용 (항상 표시)
    const finalBookIdKeys = new Set();
    metadataBooks.forEach((book) => {
      if (book._bookIdKey) {
        finalBookIdKeys.add(book._bookIdKey);
      }
      if (book.id) {
        finalBookIdKeys.add(String(book.id));
      }
    });
    // IndexedDB에 있지만 메타데이터가 없는 책도 포함
    bookIdKeys.forEach((key) => {
      finalBookIdKeys.add(key);
    });

    const metadataKeySet = new Set(metadataBooks.map((book) => book.id || book._bookId || book._bookIdKey).filter(Boolean));

    // IndexedDB에 있지만 메타데이터가 없는 책도 추가 (항상 표시)
    const fallbackBooks = Array.from(finalBookIdKeys)
      .filter((key) => key && !metadataKeySet.has(key))
      .map((key) => ({
        id: key,
        _bookId: key,
        title: key,
        author: '로컬 도서',
        language: 'ko',
        coverImgUrl: '',
        coverImage: '',
        description: '',
        favorite: false,
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLocalOnly: true,
        _bookIdKey: key,
      }));

    // IndexedDB에 저장된 모든 책을 항상 표시
    setLocalBookKeys(new Set(finalBookIdKeys));
    return {
      keys: finalBookIdKeys,
      metadataBooks: [...metadataBooks, ...fallbackBooks],
    };
  }, []);

  const fetchAndCacheManifest = useCallback(
    async (bookId) => {
      if (!bookId || !Number.isFinite(Number(bookId))) {
        return;
      }
      const numericId = Number(bookId);
      if (numericId <= 0) {
        return;
      }
      try {
        await prefetchManifest(numericId, (id) => getBookManifest(id, { forceRefresh: false }));
      } catch (error) {
        console.warn('Manifest prefetch 실패', { bookId: numericId, error });
      }
    },
    [],
  );

  const fetchBooks = useCallback(
    async (params = {}) => {
      const token = localStorage.getItem('accessToken');
      lastFetchParamsRef.current = params;

      try {
        setLoading(true);
        setError(null);

        // IndexedDB에서 로컬 책 데이터는 항상 가져오기
        const localData = await fetchLocalData();

        // 토큰이 없으면 로컬 책만 표시
        if (!token) {
          setServerBooks([]);
          const localBooks = localData?.metadataBooks || [];
          setLocalOnlyBooks(localBooks);
          setBooks(localBooks);
          setLoading(false);
          // 에러 메시지는 표시하지 않음 (로컬 책이 있으면 정상 동작)
          if (localBooks.length === 0) {
            setError('인증이 필요합니다. 로그인해주세요.');
          }
          return;
        }

        // 토큰이 있으면 서버에서도 가져오기
        const [response] = await Promise.all([
          getBooks(params),
        ]);

        if (!response?.isSuccess) {
          throw new Error(response?.message || '책 정보를 불러올 수 없습니다.');
        }

        const fetched = response.result || [];
        setServerBooks(fetched);

        fetched.forEach((book) => {
          if (book?.id && Number.isFinite(Number(book.id))) {
            fetchAndCacheManifest(book.id);
          }
        });

        applyMergedBooks(fetched, localData);
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

        // 로컬 책이 있으면 에러 메시지를 표시하지 않음
        if (fallbackLocal.length > 0) {
          setError(null);
        } else {
          if (err.message?.includes('인증이 만료되었습니다') || err.message?.includes('401')) {
            setError('인증이 만료되었습니다. 다시 로그인해주세요.');
          } else {
            setError(err.message || '책 정보를 불러올 수 없습니다.');
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchLocalData, reconcileBooks, applyMergedBooks, fetchAndCacheManifest],
  );

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const retryFetch = useCallback(() => {
    fetchBooks(lastFetchParamsRef.current || {});
  }, [fetchBooks]);

  // IndexedDB 변경을 실시간으로 감지
  useEffect(() => {
    let cancelled = false;

    // IndexedDB에서 직접 책 목록 가져오기
    const refreshBooksFromIndexedDB = async () => {
      if (cancelled) return;
      try {
        const localData = await fetchLocalData();
        if (cancelled) return;
        
        // 서버 책도 가져오기
        const token = localStorage.getItem('accessToken');
        let serverList = [];
        if (token) {
          try {
            const response = await getBooks(lastFetchParamsRef.current || {});
            if (response?.isSuccess && !cancelled) {
              serverList = response.result || [];
              setServerBooks(serverList);
            }
          } catch (error) {
            // 서버 호출 실패해도 로컬 책은 표시
          }
        }
        
        if (!cancelled) {
          applyMergedBooks(serverList, localData);
        }
      } catch (error) {
        console.error('IndexedDB 새로고침 실패:', error);
      }
    };

    // IndexedDB에 책이 추가되었을 때 즉시 새로고침
    const handleBookAdded = async () => {
      if (cancelled) return;
      // 짧은 지연 후 새로고침 (IndexedDB 쓰기 완료 대기)
      setTimeout(() => {
        if (!cancelled) {
          refreshBooksFromIndexedDB();
        }
      }, 100);
    };

    // 이벤트 리스너 등록
    window.addEventListener('indexeddb-book-added', handleBookAdded);

    // 초기 로드
    refreshBooksFromIndexedDB();

    return () => {
      cancelled = true;
      window.removeEventListener('indexeddb-book-added', handleBookAdded);
    };
  }, [fetchLocalData, applyMergedBooks]);

  const removeBook = useCallback(
    async (bookId) => {
      try {
        const target = books.find((book) => `${book.id}` === `${bookId}`);

        if (!target) {
          throw new Error('삭제할 책을 찾을 수 없습니다.');
        }

        setBooks((prev) => prev.filter((book) => `${book.id}` !== `${bookId}`));
        setServerBooks((prev) => prev.filter((book) => `${book.id}` !== `${bookId}`));

        // 로컬 bookID는 사용하지 않음 - bookId를 키로 사용
        const targetBookId = target.id || target._bookId;
        if (targetBookId) {
          const bookIdKey = String(targetBookId);
          await Promise.all([
            deleteLocalBookBuffer(bookIdKey),
            deleteLocalBookMetadata(bookIdKey),
          ]);
          setLocalBookKeys((prev) => {
            const next = new Set(prev);
            next.delete(bookIdKey);
            return next;
          });
          setLocalOnlyBooks((prev) =>
            prev.filter((book) => {
              const key = getBookKey(book);
              return key !== bookIdKey;
            }),
          );
        }

        if (!target.isLocalOnly && target.id !== undefined && target.id !== null) {
          const idKey = `${target.id}`;
          setHiddenServerBookIds((prev) => {
            const next = new Set(prev);
            next.add(idKey);
            localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify(Array.from(next)));
            return next;
          });
        }

        await fetchBooks(lastFetchParamsRef.current || {});
      } catch (err) {
        setError(err.message || 'IndexedDB에서 책 삭제에 실패했습니다.');
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
        // 로컬 bookID는 사용하지 않음 - bookId를 키로 사용
        const key = getBookKey(newBook);
        const assignedId = newBook.id || newBook._bookId;
        
        if (assignedId) {
          const bookIdKey = String(assignedId);
          setLocalBookKeys((prev) => {
            const next = new Set(prev);
            next.add(bookIdKey);
            // ref도 즉시 업데이트 (applyMergedBooks에서 사용)
            localBookKeysRef.current = next;
            return next;
          });
        }

        const nextBook = {
          ...newBook,
          id: assignedId || newBook.id,
          _bookId: assignedId || newBook._bookId,
        };

        setLocalOnlyBooks((prev) => {
          if (!key) {
            return [nextBook, ...prev];
          }
          let replaced = false;
          const updated = prev.map((book) => {
            const bookKey = getBookKey(book);
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
          if (!key) {
            return [nextBook, ...prev];
          }
          let replaced = false;
          const updated = prev.map((book) => {
            const bookKey = getBookKey(book);
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

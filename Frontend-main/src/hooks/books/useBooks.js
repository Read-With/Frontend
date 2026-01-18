import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBooks, getBook, toggleBookFavorite } from '../../utils/api/booksApi';
import {
  getAllLocalBookIds,
  deleteLocalBookBuffer,
  getAllLocalBookMetadata,
  deleteLocalBookMetadata,
} from '../../utils/localBookStorage';
import { prefetchManifest } from '../../utils/common/cache/manifestCache';
import { getBookManifest } from '../../utils/api/api';
import { normalizeTitle } from '../../utils/stringUtils';

const isDefaultBook = (book) => book?.default === true || book?.isDefault === true;

const getBookKey = (book) => {
  if (!book) return '';
  if (book.id !== undefined && book.id !== null) {
    return `${book.id}`;
  }
  if (book._bookId !== undefined && book._bookId !== null) {
    return `${book._bookId}`;
  }
  if (typeof book.filename === 'string') {
    return book.filename;
  }
  return '';
};

const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';

export const useBooks = () => {
  const queryClient = useQueryClient();
  const [localBookKeys, setLocalBookKeys] = useState(new Set());
  const [localOnlyBooks, setLocalOnlyBooks] = useState([]);
  const [hiddenServerBookIds, setHiddenServerBookIds] = useState(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_SERVER_BOOK_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        return new Set(parsed.map((id) => `${id}`));
      }
    } catch (error) {
      console.warn('hiddenServerBookIds 초기화 실패:', error);
    }
    return new Set();
  });
  
  const localOnlyBooksRef = useRef([]);
  const hiddenServerBookIdsRef = useRef(new Set(hiddenServerBookIds));
  const localBookKeysRef = useRef(new Set());

  useEffect(() => {
    localOnlyBooksRef.current = localOnlyBooks;
  }, [localOnlyBooks]);

  useEffect(() => {
    hiddenServerBookIdsRef.current = new Set(hiddenServerBookIds);
  }, [hiddenServerBookIds]);

  useEffect(() => {
    localBookKeysRef.current = localBookKeys;
  }, [localBookKeys]);

  // 로컬 데이터 조회 (기존 로직 유지)
  const fetchLocalData = useCallback(async () => {
    const [ids, metadataEntries] = await Promise.all([
      getAllLocalBookIds(),
      getAllLocalBookMetadata(),
    ]);
    
    const bookIdKeys = new Set(
      (ids || [])
        .map((id) => (typeof id === 'string' ? id : id?.toString?.() || ''))
        .filter(Boolean)
    );
    
    const allMetadata = [];
    (metadataEntries || []).forEach(({ key, value }) => {
      if (!key || !value) return;
      const bookIdKey = key;
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
        _bookIdKey: bookIdKey,
      };

      allMetadata.push(merged);
    });
    
    const titleMap = new Map();
    allMetadata.forEach((book) => {
      const normalizedTitle = normalizeTitle(book.title);
      if (!normalizedTitle) return;
      
      const existing = titleMap.get(normalizedTitle);
      if (!existing) {
        titleMap.set(normalizedTitle, book);
      } else {
        const existingTime = new Date(existing.uploadedAt || existing.createdAt || existing.updatedAt || 0).getTime();
        const currentTime = new Date(book.uploadedAt || book.createdAt || book.updatedAt || 0).getTime();
        
        if (currentTime < existingTime) {
          titleMap.set(normalizedTitle, book);
        }
      }
    });
    
    const metadataBooks = Array.from(titleMap.values());
    
    const finalBookIdKeys = new Set();
    metadataBooks.forEach((book) => {
      if (book._bookIdKey) {
        finalBookIdKeys.add(book._bookIdKey);
      }
      if (book.id) {
        finalBookIdKeys.add(String(book.id));
      }
    });
    bookIdKeys.forEach((key) => {
      finalBookIdKeys.add(key);
    });

    const metadataKeySet = new Set(metadataBooks.map((book) => book.id || book._bookId || book._bookIdKey).filter(Boolean));

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

    setLocalBookKeys(new Set(finalBookIdKeys));
    return {
      keys: finalBookIdKeys,
      metadataBooks: [...metadataBooks, ...fallbackBooks],
    };
  }, []);

  // 서버 책 조회 - React Query 사용
  const {
    data: serverBooksData,
    isLoading: isServerLoading,
    error: serverError,
    refetch: refetchServer,
  } = useQuery({
    queryKey: ['books', 'server'],
    queryFn: async () => {
      const token = localStorage.getItem('accessToken');
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

  // 로컬 책 조회
  useEffect(() => {
    let cancelled = false;

    const loadLocalBooks = async () => {
      try {
        const localData = await fetchLocalData();
        if (!cancelled) {
          setLocalOnlyBooks(localData.metadataBooks || []);
        }
      } catch (error) {
        console.error('로컬 책 로드 실패:', error);
      }
    };

    loadLocalBooks();

    // IndexedDB 변경 이벤트 리스너
    const handleBookAdded = () => {
      if (!cancelled) {
        setTimeout(() => {
          if (!cancelled) {
            loadLocalBooks();
          }
        }, 100);
      }
    };

    window.addEventListener('indexeddb-book-added', handleBookAdded);

    return () => {
      cancelled = true;
      window.removeEventListener('indexeddb-book-added', handleBookAdded);
    };
  }, [fetchLocalData]);

  // 서버 책 + 로컬 책 병합
  const reconcileBooks = useCallback((fetchedBooks, localKeys) => {
    if (!Array.isArray(fetchedBooks)) return [];

    const deduped = new Map();

    fetchedBooks.forEach((book) => {
      const bookId = book?.id !== undefined && book?.id !== null ? `${book.id}` : null;
      const bookKey = bookId || `__temp_${book?.title || ''}`;
      
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

  // 최종 병합된 책 목록
  const books = useMemo(() => {
    const serverBooks = serverBooksData?.books || [];
    const localKeys = new Set(localBookKeys);
    localBookKeysRef.current.forEach((key) => localKeys.add(key));
    
    const reconciled = reconcileBooks(serverBooks, localKeys);

    const combinedMap = new Map();
    
    localOnlyBooks.forEach((book) => {
      const key = book._bookIdKey || getBookKey(book);
      if (key) {
        combinedMap.set(key, { ...book });
      }
    });

    reconciled.forEach((book) => {
      const key = getBookKey(book);
      if (!key) {
        return;
      }
      const localInfo = combinedMap.get(key);
      if (localInfo) {
        combinedMap.set(key, {
          ...localInfo,
          ...book,
          id: book.id,
          _bookId: book.id,
          isLocalOnly: false,
          coverImgUrl: book.coverImgUrl || localInfo.coverImgUrl || '',
          coverImage: book.coverImgUrl || localInfo.coverImgUrl || '',
        });
      } else if (localKeys.has(key)) {
        combinedMap.set(key, {
          ...book,
          _bookId: book.id,
        });
      }
    });

    const hiddenIds = hiddenServerBookIdsRef.current;
    return Array.from(combinedMap.values()).filter((book) => {
      const idKey = book?.id !== undefined && book?.id !== null ? `${book.id}` : null;
      return !idKey || !hiddenIds.has(idKey);
    });
  }, [serverBooksData, localOnlyBooks, localBookKeys, reconcileBooks]);

  // 즐겨찾기 토글 - useMutation + 낙관적 업데이트
  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ bookId, favorite }) => toggleBookFavorite(bookId, favorite),
    onMutate: async ({ bookId, favorite }) => {
      // 진행 중인 쿼리 취소
      await queryClient.cancelQueries({ queryKey: ['books', 'server'] });

      // 이전 상태 스냅샷
      const previousServerBooks = queryClient.getQueryData(['books', 'server']);

      // 낙관적 업데이트
      queryClient.setQueryData(['books', 'server'], (old) => {
        if (!old) return old;
        return {
          ...old,
          books: (old.books || []).map((book) =>
            book.id === bookId ? { ...book, favorite } : book
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
      // 성공/실패 상관없이 서버 데이터 갱신
      queryClient.invalidateQueries({ queryKey: ['books', 'server'] });
    },
  });

  // 책 삭제 - useMutation + 낙관적 업데이트
  const removeBookMutation = useMutation({
    mutationFn: async (bookId) => {
      const targetBookId = String(bookId);
      
      // 로컬 데이터 삭제
      await Promise.all([
        deleteLocalBookBuffer(targetBookId),
        deleteLocalBookMetadata(targetBookId),
      ]);

      // 숨김 목록에 추가
      const hiddenIds = new Set(hiddenServerBookIdsRef.current);
      hiddenIds.add(targetBookId);
      localStorage.setItem(HIDDEN_SERVER_BOOK_IDS_KEY, JSON.stringify(Array.from(hiddenIds)));
      
      return targetBookId;
    },
    onMutate: async (bookId) => {
      const targetBookId = String(bookId);
      
      await queryClient.cancelQueries({ queryKey: ['books', 'server'] });

      const previousServerBooks = queryClient.getQueryData(['books', 'server']);

      // 낙관적 업데이트
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
      // 로컬 상태 업데이트
      setLocalBookKeys((prev) => {
        const next = new Set(prev);
        next.delete(deletedBookId);
        return next;
      });
      setLocalOnlyBooks((prev) =>
        prev.filter((book) => {
          const key = getBookKey(book);
          return key !== deletedBookId;
        })
      );
      setHiddenServerBookIds((prev) => {
        const next = new Set(prev);
        next.add(deletedBookId);
        return next;
      });
    },
    onError: (err, variables, context) => {
      if (context?.previousServerBooks) {
        queryClient.setQueryData(['books', 'server'], context.previousServerBooks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['books', 'server'] });
    },
  });

  // 책 추가 (로컬)
  const addBook = useCallback(
    async (newBook) => {
      if (newBook) {
        const key = getBookKey(newBook);
        const assignedId = newBook.id || newBook._bookId;
        
        if (assignedId) {
          const bookIdKey = String(assignedId);
          setLocalBookKeys((prev) => {
            const next = new Set(prev);
            next.add(bookIdKey);
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

        // 서버 책 목록도 갱신
        queryClient.invalidateQueries({ queryKey: ['books', 'server'] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['books', 'server'] });
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
  const error = serverError?.message || (serverBooksData?.needsAuth && localOnlyBooks.length === 0 ? '인증이 필요합니다. 로그인해주세요.' : null);
  
  const retryFetch = useCallback(() => {
    refetchServer();
  }, [refetchServer]);

  const toggleFavorite = useCallback(
    async (bookId, favorite) => {
      try {
        await toggleFavoriteMutation.mutateAsync({ bookId, favorite });
      } catch (err) {
        throw err;
      }
    },
    [toggleFavoriteMutation],
  );

  const removeBook = useCallback(
    async (bookId) => {
      try {
        await removeBookMutation.mutateAsync(bookId);
      } catch (err) {
        throw err;
      }
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

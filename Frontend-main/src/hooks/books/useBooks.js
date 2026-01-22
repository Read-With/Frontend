import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBooks, getBook, toggleBookFavorite } from '../../utils/api/booksApi';
import {
  deleteLocalBookBuffer,
  deleteLocalBookMetadata,
  loadLocalBookBuffer,
  getAllLocalBookIds,
} from '../../utils/localBookStorage';
import { prefetchManifest } from '../../utils/common/cache/manifestCache';
import { getBookManifest } from '../../utils/api/api';
const HIDDEN_SERVER_BOOK_IDS_KEY = 'readwith_hidden_server_book_ids';

export const useBooks = () => {
  const queryClient = useQueryClient();
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
  
  const hiddenServerBookIdsRef = useRef(new Set(hiddenServerBookIds));
  const [indexedDbBookIds, setIndexedDbBookIds] = useState(new Set());
  const indexedDbBookIdsRef = useRef(new Set());

  useEffect(() => {
    hiddenServerBookIdsRef.current = new Set(hiddenServerBookIds);
  }, [hiddenServerBookIds]);

  useEffect(() => {
    indexedDbBookIdsRef.current = new Set(indexedDbBookIds);
  }, [indexedDbBookIds]);

  // IndexedDB에서 EPUB 파일(buffer)이 실제로 있는 책 ID만 가져오기
  useEffect(() => {
    const loadIndexedDbBookIds = async () => {
      try {
        const allBookIds = await getAllLocalBookIds();
        const bookIdsWithBuffer = new Set();
        
        // 각 책 ID에 대해 실제 buffer가 있는지 확인
        const checkPromises = allBookIds.map(async (bookId) => {
          try {
            const buffer = await loadLocalBookBuffer(bookId);
            if (buffer) {
              return bookId;
            }
          } catch (error) {
            // 에러는 조용히 처리
          }
          return null;
        });

        const results = await Promise.all(checkPromises);
        results.forEach((bookId) => {
          if (bookId) {
            bookIdsWithBuffer.add(bookId);
          }
        });

        setIndexedDbBookIds(bookIdsWithBuffer);
      } catch (error) {
        console.warn('IndexedDB 책 ID 로드 실패:', error);
        setIndexedDbBookIds(new Set());
      }
    };

    loadIndexedDbBookIds();
  }, []);

  // 서버 책 조회 - React Query 사용
  // 중요: 서버에는 메타데이터만 저장되며, EPUB 파일은 IndexedDB에만 저장됨
  // 서버 bookId를 키로 사용하여 IndexedDB의 EPUB 파일과 매칭함
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

  // 서버 책 목록이 갱신될 때 IndexedDB도 다시 확인 (debounce 적용)
  useEffect(() => {
    if (!serverBooksData?.books) {
      return;
    }

    // debounce를 위한 timeout
    const timeoutId = setTimeout(async () => {
      try {
        const allBookIds = await getAllLocalBookIds();
        const bookIdsWithBuffer = new Set();
        
        // 각 책 ID에 대해 실제 buffer가 있는지 확인
        const checkPromises = allBookIds.map(async (bookId) => {
          try {
            const buffer = await loadLocalBookBuffer(bookId);
            if (buffer && buffer.byteLength > 0) {
              return bookId;
            }
          } catch (error) {
            // 에러는 조용히 처리
          }
          return null;
        });

        const results = await Promise.all(checkPromises);
        results.forEach((bookId) => {
          if (bookId) {
            bookIdsWithBuffer.add(bookId);
          }
        });

        setIndexedDbBookIds(bookIdsWithBuffer);
      } catch (error) {
        console.warn('IndexedDB 책 ID 갱신 실패:', error);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [serverBooksData]);

  // IndexedDB에 있는 책 중 서버에 존재하는 책만 표시
  const books = useMemo(() => {
    const hiddenIds = hiddenServerBookIdsRef.current;
    const indexedDbIds = indexedDbBookIdsRef.current;
    
    // 서버 책을 Map으로 변환 (빠른 조회를 위해)
    const serverBooksMap = new Map();
    reconciledBooks.forEach((book) => {
      const idKey = book?.id !== undefined && book?.id !== null ? `${book.id}` : null;
      if (idKey) {
        serverBooksMap.set(idKey, book);
      }
    });

    // IndexedDB에 있는 책 ID 중 서버에 존재하는 책만 필터링
    const result = [];
    indexedDbIds.forEach((bookId) => {
      // 숨김 처리된 책 제외
      if (hiddenIds.has(bookId)) return;
      
      // 서버에 존재하는 책만 추가
      const serverBook = serverBooksMap.get(bookId);
      if (serverBook) {
        result.push(serverBook);
      }
    });

    return result;
  }, [reconciledBooks, indexedDbBookIds]);

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
      // 성공/실패 상관없이 서버 데이터 갱신 (refetchQueries 사용하여 stale 경고 방지)
      queryClient.refetchQueries({ 
        queryKey: ['books', 'server'],
        type: 'active'
      });
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
      // 서버 데이터 갱신 (refetchQueries 사용하여 stale 경고 방지)
      queryClient.refetchQueries({ 
        queryKey: ['books', 'server'],
        type: 'active'
      });
    },
  });

  // 책 추가 후 서버 책 목록 갱신 및 IndexedDB 책 ID 목록 갱신
  const addBook = useCallback(
    async (newBook) => {
      // 새 책의 ID 추출
      const newBookId = newBook?.id || newBook?._bookId;
      const newBookIdStr = newBookId ? String(newBookId) : null;
      
      // 서버 책 목록 갱신 (refetchQueries 사용하여 stale 경고 방지)
      await queryClient.refetchQueries({ 
        queryKey: ['books', 'server'],
        type: 'active'
      });
      
      // 새 책이 있으면 IndexedDB에 buffer가 있는지 확인하고 즉시 추가
      if (newBookIdStr) {
        try {
          // 최대 10번 재시도 (IndexedDB 저장 완료 대기, 총 최대 2초)
          let buffer = null;
          for (let i = 0; i < 10; i++) {
            buffer = await loadLocalBookBuffer(newBookIdStr);
            if (buffer) {
              // 새 책 ID를 즉시 추가
              setIndexedDbBookIds((prev) => {
                const next = new Set(prev);
                next.add(newBookIdStr);
                return next;
              });
              return;
            }
            // 저장이 완료되지 않았으면 잠시 대기 후 재시도
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
          // 재시도 후에도 없으면 전체 IndexedDB 다시 로드
          console.warn('IndexedDB buffer 확인 실패, 전체 재로드 시도');
        } catch (error) {
          console.warn('IndexedDB buffer 확인 실패:', error);
        }
      }
      
      // 새 책이 없거나 buffer가 없으면 전체 IndexedDB 다시 로드
      try {
        const allBookIds = await getAllLocalBookIds();
        const bookIdsWithBuffer = new Set();
        
        // 각 책 ID에 대해 실제 buffer가 있는지 확인
        const checkPromises = allBookIds.map(async (bookId) => {
          try {
            const buffer = await loadLocalBookBuffer(bookId);
            if (buffer) {
              return bookId;
            }
          } catch (error) {
            // 에러는 조용히 처리
          }
          return null;
        });

        const results = await Promise.all(checkPromises);
        results.forEach((bookId) => {
          if (bookId) {
            bookIdsWithBuffer.add(bookId);
          }
        });

        setIndexedDbBookIds(bookIdsWithBuffer);
      } catch (error) {
        console.warn('IndexedDB 책 ID 갱신 실패:', error);
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

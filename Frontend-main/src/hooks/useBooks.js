import { useState, useEffect, useCallback } from 'react';
import { getBooks, getBook, deleteBook, toggleBookFavorite, getFavorites } from '../utils/api/booksApi';
import { getAllLocalBookIds, deleteLocalBookBuffer } from '../utils/localBookStorage';

export const useBooks = () => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBooks = useCallback(async (params = {}) => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('accessToken');
      
      if (!token) {
        // 토큰이 없으면 에러
        setBooks([]);
        setLoading(false);
        setError('인증이 필요합니다. 로그인해주세요.');
        return;
      }
      
      const response = await getBooks(params);
      
      // IndexedDB에서 저장된 책 ID 목록 가져오기
      const indexedDbBookIds = await getAllLocalBookIds();
      // 숫자 ID와 문자열 ID 모두 처리
      const indexedDbNumericIds = indexedDbBookIds
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
      const indexedDbBookIdSet = new Set(indexedDbNumericIds);
      const indexedDbStringIds = indexedDbBookIds.filter(id => isNaN(parseInt(id, 10)));
      
      if (response.isSuccess) {
        // 서버에서 모든 책 정보 가져오기 (승인 대기 중이어도 표시)
        const allBooks = response.result || [];
        
        // 제목 정규화 함수 (EPUB 파일 매칭용)
        const normalizeTitle = (title) => {
          if (!title) return '';
          return title
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s가-힣]/g, '')
            .replace(/\s/g, '');
        };
        
        // IndexedDB에 저장된 모든 키(정규화된 제목)를 Set으로 변환
        const indexedDbTitleSet = new Set(indexedDbBookIds.map(id => id.toLowerCase()));
        
        // 서버 책에 IndexedDB EPUB 파일 매칭
        const booksWithStatus = allBooks.map(book => {
          const normalizedTitle = normalizeTitle(book.title);
          
          // IndexedDB에 정규화된 제목으로 EPUB 파일이 있는지 확인
          const hasIndexedDbFile = indexedDbTitleSet.has(normalizedTitle);
          
          return {
            ...book,
            _isApproved: book.approved === true ||
                        book.status === 'approved' ||
                        book.approvalStatus === 'approved' ||
                        book.approval_status === 'approved' ||
                        book.default === true ||
                        (book.status &&
                         book.status !== 'pending' &&
                         book.status !== 'waiting' &&
                         book.status !== 'rejected'),
            _hasIndexedDbFile: hasIndexedDbFile, // EPUB 파일 존재 여부
            _indexedDbId: normalizedTitle // EPUB 로드용 정규화된 제목
          };
        });
        
        // 서버 책만 표시 (IndexedDB는 EPUB 파일 존재 여부만 확인)
        const apiBooks = booksWithStatus.map(book => ({
          ...book,
          favorite: book.favorite || false
        }));
        
        // 중요: IndexedDB에 EPUB 파일이 있는 책만 표시
        // 단, 기본 책(default book)은 IndexedDB 파일 여부와 관계없이 항상 표시
        const apiBooksWithFile = apiBooks.filter(book => 
          book.default === true || book._hasIndexedDbFile === true
        );
        
        // 중복 제거 (같은 제목이면 하나만 유지, 최신 책 우선)
        const seenTitles = new Map();
        apiBooksWithFile.forEach(book => {
          const normalizedTitle = normalizeTitle(book.title);
          const existingBook = seenTitles.get(normalizedTitle);
          if (!existingBook || (book.id && existingBook.id && book.id > existingBook.id)) {
            seenTitles.set(normalizedTitle, book);
          }
        });
        const allBooksCombined = Array.from(seenTitles.values());
        
        // 모든 책을 서버 bookID 기반으로 관리
        setBooks(allBooksCombined);
      } else {
        // API 실패 시 빈 배열 (서버 API 정보에만 의존)
        setBooks([]);
        throw new Error(response.message || '책 정보를 불러올 수 없습니다.');
      }
      
    } catch (err) {
      // 서버 API 의존이므로 에러 시 빈 배열
      setBooks([]);
      
      if (err.message?.includes('인증이 만료되었습니다') || err.message?.includes('401')) {
        setError('인증이 만료되었습니다. 다시 로그인해주세요.');
      } else {
        setError(err.message || '책 정보를 불러올 수 없습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const retryFetch = () => {
    fetchBooks();
  };

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // 책 삭제 함수
  const removeBook = async (bookId) => {
    try {
      // 현재 책 목록에서 해당 책 찾기
      const bookToDelete = books.find(b => {
        const bid = b.id?.toString();
        const targetId = bookId?.toString();
        return bid === targetId;
      });
      
      if (!bookToDelete) {
        throw new Error('삭제할 책을 찾을 수 없습니다.');
      }
      
      // 서버에서 삭제 (모든 책은 서버 API 기반)
      const response = await deleteBook(bookId);
      
      if (response.isSuccess) {
        // IndexedDB에서 EPUB 파일도 삭제 (제목 기반)
        if (bookToDelete._indexedDbId) {
          await deleteLocalBookBuffer(bookToDelete._indexedDbId);
        }
        
        // 책 목록에서 즉시 제거
        setBooks(prevBooks => prevBooks.filter(b => {
          const bid = b.id?.toString();
          const targetId = bookId?.toString();
          return bid !== targetId;
        }));
        
        // 책 목록 새로고침
        await fetchBooks();
      } else {
        throw new Error(response.message || '책 삭제에 실패했습니다.');
      }
    } catch (err) {
      setError(err.message || '책 삭제에 실패했습니다.');
      throw err;
    }
  };

  const toggleFavorite = async (bookId, favorite) => {
    try {
      setBooks(prevBooks => 
        prevBooks.map(book => 
          book.id === bookId ? { ...book, favorite } : book
        )
      );
      
      const response = await toggleBookFavorite(bookId, favorite);
      
      if (response.isSuccess) {
        await fetchBooks();
      } else {
        throw new Error(response.message || '즐겨찾기 설정에 실패했습니다.');
      }
    } catch (err) {
      setBooks(prevBooks => 
        prevBooks.map(book => 
          book.id === bookId ? { ...book, favorite: !favorite } : book
        )
      );
      setError(err.message || '즐겨찾기 설정에 실패했습니다.');
      throw err;
    }
  };

  const fetchFavorites = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await getFavorites();
      if (response.isSuccess) {
        setBooks(response.result || []);
      } else {
        throw new Error(response.message || '즐겨찾기 목록을 불러올 수 없습니다.');
      }
      
    } catch (err) {
      const errorMessage = err.message || '즐겨찾기 목록을 불러올 수 없습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchBooks = (params) => {
    fetchBooks(params);
  };

  const fetchBook = async (bookId) => {
    try {
      const response = await getBook(bookId);
      if (response.isSuccess) {
        return response.result;
      } else {
        throw new Error(response.message || '도서 정보를 불러올 수 없습니다.');
      }
    } catch (err) {
      throw err;
    }
  };

  const addBook = async (newBook) => {
    try {
      // 모든 책을 서버에서 받은 bookID로 관리
      // 서버에서 받은 책을 상태에 추가
      setBooks(prevBooks => {
        // 이미 같은 id가 있으면 제거하고 새로 추가
        const filtered = prevBooks.filter(b => b.id !== newBook.id);
        return [newBook, ...filtered];
      });
      // 책 목록 새로고침
      await fetchBooks();
    } catch (err) {
      console.error('책 추가 실패:', err);
    }
  };

  return {
    books,
    loading,
    error,
    retryFetch,
    removeBook,
    toggleFavorite,
    searchBooks,
    fetchFavorites,
    fetchBook,
    addBook
  };
};

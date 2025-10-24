import { useState, useEffect, useCallback } from 'react';
import { getBooks, getBook, deleteBook, toggleBookFavorite, addToFavorites, removeFromFavorites, getFavorites } from '../utils/common/api';

export const useBooks = () => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBooks = useCallback(async (params = {}) => {
    try {
      setLoading(true);
      setError(null);
      
      // 토큰 확인
      const token = localStorage.getItem('accessToken');
      console.log('useBooks - 현재 토큰 상태:', token ? '토큰 있음' : '토큰 없음');
      
      // API와 로컬 데이터를 병렬로 가져오기
      const [apiResponse, localResponse] = await Promise.allSettled([
        token ? getBooks(params) : Promise.reject(new Error('인증 토큰이 없습니다')),
        fetch('/books.json')
      ]);
      
      let apiBooks = [];
      let localBooks = [];
      let hasApiError = false;
      let hasLocalError = false;
      
      // API 응답 처리
      if (apiResponse.status === 'fulfilled' && apiResponse.value.isSuccess) {
        apiBooks = apiResponse.value.result || [];
      } else if (apiResponse.status === 'rejected') {
        hasApiError = true;
        console.warn('API 요청 실패:', apiResponse.reason);
      }
      
      // 로컬 데이터 응답 처리
      if (localResponse.status === 'fulfilled' && localResponse.value.ok) {
        try {
          localBooks = await localResponse.value.json();
        } catch (parseError) {
          hasLocalError = true;
          console.warn('로컬 데이터 파싱 실패:', parseError);
        }
      } else if (localResponse.status === 'rejected') {
        hasLocalError = true;
        console.warn('로컬 데이터 요청 실패:', localResponse.reason);
      }
      
      // API 책과 로컬 책을 합치기 (중복 제거)
      const allBooks = [...apiBooks];
      
      // 로컬 책 중에서 API에 없는 것만 추가
      if (Array.isArray(localBooks)) {
        localBooks.forEach(localBook => {
          const exists = apiBooks.some(apiBook => 
            apiBook.title === localBook.title && apiBook.author === localBook.author
          );
          if (!exists) {
            // 로컬 책을 API 형식으로 변환
            const convertedBook = {
              id: `local_${localBook.filename}`,
              title: localBook.title,
              author: localBook.author,
              coverImgUrl: localBook.cover || null,
              epubPath: localBook.filename,
              summary: false,
              default: true,
              favorite: false,
              updatedAt: localBook.uploadedAt || new Date().toISOString()
            };
            allBooks.push(convertedBook);
          }
        });
      }
      
      setBooks(allBooks);
      
      // 둘 다 실패한 경우에만 에러 표시
      if (hasApiError && hasLocalError) {
        setError('책 정보를 불러올 수 없습니다. 네트워크 연결을 확인해주세요.');
      } else if (hasApiError && allBooks.length === 0) {
        setError('서버에서 책 정보를 불러올 수 없습니다. 로컬 책만 표시됩니다.');
      }
      
    } catch (err) {
      console.error('fetchBooks 에러:', err);
      setError('책 정보를 불러올 수 없습니다.');
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
    // 로컬 책은 삭제할 수 없음
    if (typeof bookId === 'string' && bookId.startsWith('local_')) {
      setError('기본 책은 삭제할 수 없습니다.');
      return;
    }
    
    try {
      const response = await deleteBook(bookId);
      if (response.isSuccess) {
        setBooks(prevBooks => prevBooks.filter(book => book.id !== bookId));
      } else {
        throw new Error(response.message || '책 삭제에 실패했습니다.');
      }
    } catch (err) {
      setError(err.message || '책 삭제에 실패했습니다.');
    }
  };

  // 즐겨찾기 토글 함수
  const toggleFavorite = async (bookId, favorite) => {
    // 로컬 책은 로컬 상태만 업데이트
    if (typeof bookId === 'string' && bookId.startsWith('local_')) {
      setBooks(prevBooks => 
        prevBooks.map(book => 
          book.id === bookId ? { ...book, favorite } : book
        )
      );
      return;
    }
    
    try {
      let response;
      if (favorite) {
        response = await addToFavorites(bookId);
      } else {
        response = await removeFromFavorites(bookId);
      }
      
      if (response.isSuccess) {
        setBooks(prevBooks => 
          prevBooks.map(book => 
            book.id === bookId ? { ...book, favorite } : book
          )
        );
      } else {
        throw new Error(response.message || '즐겨찾기 설정에 실패했습니다.');
      }
    } catch (err) {
      setError(err.message || '즐겨찾기 설정에 실패했습니다.');
    }
  };

  // 즐겨찾기 목록만 조회
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
      setError(err.message || '즐겨찾기 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 검색/필터 함수
  const searchBooks = (params) => {
    fetchBooks(params);
  };

  // 단일 도서 조회
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

  // 책 추가
  const addBook = (newBook) => {
    setBooks(prevBooks => [newBook, ...prevBooks]);
  };

  // 책 상태 변경 (읽는 중, 완독, 읽고 싶은 등)
  const changeBookStatus = async (bookId, status) => {
    // 로컬 책은 로컬 상태만 업데이트
    if (typeof bookId === 'string' && bookId.startsWith('local_')) {
      setBooks(prevBooks => 
        prevBooks.map(book => 
          book.id === bookId ? { ...book, readingStatus: status } : book
        )
      );
      return;
    }
    
    // TODO: API가 준비되면 실제 API 호출 추가
    setBooks(prevBooks => 
      prevBooks.map(book => 
        book.id === bookId ? { ...book, readingStatus: status } : book
      )
    );
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
    addBook,
    changeBookStatus
  };
};

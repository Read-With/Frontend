import { useState, useEffect, useCallback } from 'react';
import { getBooks, getBook, deleteBook, toggleBookFavorite, getFavorites } from '../utils/api/booksApi';

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
        // API 책들의 즐겨찾기 상태를 명시적으로 설정
        apiBooks = apiBooks.map(book => ({
          ...book,
          favorite: book.favorite || false // API에서 받은 즐겨찾기 상태 보장
        }));
      } else if (apiResponse.status === 'rejected') {
        hasApiError = true;
        const errorMessage = apiResponse.reason?.message || apiResponse.reason;
        console.warn('API 요청 실패:', errorMessage);
        
        // 인증 에러인 경우 특별 처리
        if (errorMessage.includes('인증이 만료되었습니다') || errorMessage.includes('401')) {
          console.warn('인증 토큰이 만료되었습니다. 로그인이 필요합니다.');
        }
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
        // localStorage에서 로컬 책 상태들 가져오기
        const localFavorites = JSON.parse(localStorage.getItem('localBookFavorites') || '{}');
        const localBookStatuses = JSON.parse(localStorage.getItem('localBookStatuses') || '{}');
        
        localBooks.forEach(localBook => {
          const exists = apiBooks.some(apiBook => 
            apiBook.title === localBook.title && apiBook.author === localBook.author
          );
          if (!exists) {
            const bookId = `local_${localBook.filename}`;
            // 로컬 책을 API 형식으로 변환
            const convertedBook = {
              id: bookId,
              title: localBook.title,
              author: localBook.author,
              coverImgUrl: localBook.cover || null,
              epubPath: localBook.filename,
              summary: false,
              default: true,
              favorite: localFavorites[bookId] || false, // localStorage에서 즐겨찾기 상태 복원
              readingStatus: localBookStatuses[bookId] || 'none', // localStorage에서 읽기 상태 복원
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
    // 로컬 책은 로컬 상태와 localStorage에 저장
    if (typeof bookId === 'string' && bookId.startsWith('local_')) {
      // localStorage에서 즐겨찾기 목록 가져오기
      const localFavorites = JSON.parse(localStorage.getItem('localBookFavorites') || '{}');
      
      if (favorite) {
        // 즐겨찾기 추가
        localFavorites[bookId] = true;
      } else {
        // 즐겨찾기 제거
        delete localFavorites[bookId];
      }
      
      // localStorage에 저장
      localStorage.setItem('localBookFavorites', JSON.stringify(localFavorites));
      
      // 상태 업데이트
      setBooks(prevBooks => 
        prevBooks.map(book => 
          book.id === bookId ? { ...book, favorite } : book
        )
      );
      return;
    }
    
    try {
      const response = await toggleBookFavorite(bookId, favorite);
      
      if (response.isSuccess) {
        // 즉시 UI 업데이트 (낙관적 업데이트)
        setBooks(prevBooks => 
          prevBooks.map(book => 
            book.id === bookId ? { ...book, favorite } : book
          )
        );
        
        // 성공 메시지 (선택적)
        console.log(`즐겨찾기 ${favorite ? '추가' : '제거'} 완료`);
      } else {
        throw new Error(response.message || '즐겨찾기 설정에 실패했습니다.');
      }
    } catch (err) {
      // 실패 시 이전 상태로 롤백
      setBooks(prevBooks => 
        prevBooks.map(book => 
          book.id === bookId ? { ...book, favorite: !favorite } : book
        )
      );
      setError(err.message || '즐겨찾기 설정에 실패했습니다.');
      console.error('즐겨찾기 토글 실패:', err);
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
      const errorMessage = err.message || '즐겨찾기 목록을 불러올 수 없습니다.';
      setError(errorMessage);
      console.error('즐겨찾기 목록 조회 실패:', err);
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
    // 로컬 책은 로컬 상태와 localStorage에 저장
    if (typeof bookId === 'string' && bookId.startsWith('local_')) {
      // localStorage에서 로컬 책 상태 가져오기
      const localBookStatuses = JSON.parse(localStorage.getItem('localBookStatuses') || '{}');
      
      // 상태 저장
      localBookStatuses[bookId] = status;
      localStorage.setItem('localBookStatuses', JSON.stringify(localBookStatuses));
      
      // 상태 업데이트
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

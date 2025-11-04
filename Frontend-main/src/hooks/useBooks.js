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
      
      const token = localStorage.getItem('accessToken');
      
      if (!token) {
        setError('인증이 필요합니다. 로그인해주세요.');
        setBooks([]);
        setLoading(false);
        return;
      }
      
      const response = await getBooks(params);
      
      if (response.isSuccess) {
        const apiBooks = (response.result || []).map(book => ({
          ...book,
          favorite: book.favorite || false
        }));
        const bookInfo = apiBooks.map(b => ({ 
          id: b.id, 
          title: b.title,
          isDefault: b.default,
          summary: b.summary,
          favorite: b.favorite
        }));
        
        const defaultBooks = bookInfo.filter(b => b.isDefault);
        const userBooks = bookInfo.filter(b => !b.isDefault);
        const summaryBooks = bookInfo.filter(b => b.summary);
        const noSummaryBooks = bookInfo.filter(b => !b.summary);
        
        setBooks(apiBooks);
      } else {
        throw new Error(response.message || '책 정보를 불러올 수 없습니다.');
      }
      
    } catch (err) {
      if (err.message?.includes('인증이 만료되었습니다') || err.message?.includes('401')) {
        setError('인증이 만료되었습니다. 다시 로그인해주세요.');
      } else {
        setError(err.message || '책 정보를 불러올 수 없습니다.');
      }
      
      setBooks([]);
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
      const response = await deleteBook(bookId);
      if (response.isSuccess) {
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
      setBooks(prevBooks => [newBook, ...prevBooks]);
      await fetchBooks();
    } catch (err) {
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

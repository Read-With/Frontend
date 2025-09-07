import { useState, useEffect, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';

export const useBooks = () => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadedBooks, setUploadedBooks] = useLocalStorage('uploadedBooks', []);

  const fetchBooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // 기본 책 목록 가져오기
      const response = await fetch('/books.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const defaultBooks = await response.json();
      
      // 업로드된 책들에서 기본 책과 중복되지 않는 것만 필터링
      const filteredUploadedBooks = uploadedBooks.filter(book => 
        !defaultBooks.some(defaultBook => defaultBook.filename === book.filename)
      );
      
      // 기본 책들과 업로드된 책들 합치기
      const allBooks = [...defaultBooks, ...filteredUploadedBooks];
      setBooks(allBooks);
      
    } catch (err) {
      setError(err.message || '책 정보를 불러올 수 없습니다.');

    } finally {
      setLoading(false);
    }
  }, [uploadedBooks]);

  const retryFetch = () => {
    fetchBooks();
  };

  useEffect(() => {
    fetchBooks();
  }, [uploadedBooks]);

  // 새 책 추가 함수
  const addBook = (newBook) => {
    setBooks(prevBooks => [...prevBooks, newBook]);
    
    // 업로드된 책들만 localStorage에 저장 (기본 책 제외)
    if (!['gatsby.epub', 'alice.epub'].includes(newBook.filename)) {
      setUploadedBooks(prevUploaded => [...prevUploaded, newBook]);
    }
  };

  // 책 삭제 함수
  const removeBook = (filename) => {
    setBooks(prevBooks => prevBooks.filter(book => book.filename !== filename));
    
    // 업로드된 책들만 localStorage에서 제거 (기본 책 제외)
    if (!['gatsby.epub', 'alice.epub'].includes(filename)) {
      setUploadedBooks(prevUploaded => prevUploaded.filter(book => book.filename !== filename));
    }
  };

  return {
    books,
    loading,
    error,
    retryFetch,
    addBook,
    removeBook
  };
};

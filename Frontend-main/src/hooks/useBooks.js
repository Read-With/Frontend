import { useState, useEffect } from 'react';

/**
 * 책 데이터를 관리하는 커스텀 훅
 */
export const useBooks = () => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBooks = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // 기본 책 목록 가져오기
      const response = await fetch('/books.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const defaultBooks = await response.json();
      
      // 로컬 스토리지에서 업로드된 책들 가져오기
      let uploadedBooks = [];
      try {
        const stored = localStorage.getItem('uploadedBooks');
        if (stored) {
          uploadedBooks = JSON.parse(stored);
          // 기본 책과 중복되지 않는지 확인
          uploadedBooks = uploadedBooks.filter(book => 
            !defaultBooks.some(defaultBook => defaultBook.filename === book.filename)
          );
        }
      } catch (err) {
        console.warn('로컬 스토리지 읽기 실패:', err);
      }
      
      // 기본 책들과 업로드된 책들 합치기
      const allBooks = [...defaultBooks, ...uploadedBooks];
      setBooks(allBooks);
      
    } catch (err) {
      setError(err.message || '책 정보를 불러올 수 없습니다.');
      console.error('Books fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const retryFetch = () => {
    fetchBooks();
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  // 새 책 추가 함수
  const addBook = (newBook) => {
    setBooks(prevBooks => {
      const updatedBooks = [...prevBooks, newBook];
      
      // 업로드된 책들만 로컬 스토리지에 저장
      try {
        const uploadedOnly = updatedBooks.filter(book => 
          !['gatsby.epub', 'alice.epub'].includes(book.filename)
        );
        localStorage.setItem('uploadedBooks', JSON.stringify(uploadedOnly));
      } catch (err) {
        console.warn('로컬 스토리지 저장 실패:', err);
      }
      return updatedBooks;
    });
  };

  // 책 삭제 함수
  const removeBook = (filename) => {
    setBooks(prevBooks => {
      const updatedBooks = prevBooks.filter(book => book.filename !== filename);
      
      // 업로드된 책들만 로컬 스토리지에 저장
      try {
        const uploadedOnly = updatedBooks.filter(book => 
          !['gatsby.epub', 'alice.epub'].includes(book.filename)
        );
        localStorage.setItem('uploadedBooks', JSON.stringify(uploadedOnly));
      } catch (err) {
        console.warn('로컬 스토리지 저장 실패:', err);
      }
      return updatedBooks;
    });
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

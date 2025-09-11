import React, { useState } from 'react';
import UserProfile from '../components/common/UserProfile';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/useBooks';
import { useUserProfile } from '../hooks/useUserProfile';
import { theme } from '../components/common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../utils/styles/styles';
import { ANIMATION_VALUES } from '../utils/styles/animations';

export default function MyPage() {
  const { books, loading, error, retryFetch, addBook, toggleFavorite, fetchBook } = useBooks();
  const { userProfile } = useUserProfile();
  const [showUpload, setShowUpload] = useState(false);

  // 테스트용: 단일 도서 조회 함수
  const testSingleBook = async (bookId) => {
    try {
      const book = await fetchBook(bookId);
      return book;
    } catch (error) {
    }
  };

  const rootStyle = {
    background: theme.colors.background.main,
    minHeight: '100vh',
    width: '100vw',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch'
  };

  const mainStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    gap: '10px'
  };

  const uploadButtonStyle = {
    ...createButtonStyle(ANIMATION_VALUES, 'primary'),
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    borderRadius: '50%',
    width: '56px',
    height: '56px',
    fontSize: '24px',
    fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(79, 109, 222, 0.3)',
    zIndex: 1000,
    padding: '0'
  };

  const handleUploadSuccess = (newBook) => {
    addBook(newBook);
    setShowUpload(false);
  };

  const handleBookClick = async (book) => {
    
    // API 책인 경우 단일 도서 조회 테스트
    if (typeof book.id === 'number') {
      try {
        const detailedBook = await testSingleBook(book.id);
      } catch (error) {
      }
    }
  };

  return (
    <div style={rootStyle}>
      <div style={mainStyle}>
        <UserProfile userProfile={userProfile} />
        <BookLibrary 
          books={books} 
          loading={loading} 
          error={error} 
          onRetry={retryFetch}
          onToggleFavorite={toggleFavorite}
          onBookClick={handleBookClick}
        />
      </div>
      
      {/* 플로팅 업로드 버튼 */}
      <button 
        style={uploadButtonStyle}
        onClick={() => setShowUpload(true)}
        {...createAdvancedButtonHandlers('primary')}
        title="새 책 업로드"
      >
        +
      </button>
      
      {/* 업로드 모달 */}
      {showUpload && (
        <FileUpload 
          onUploadSuccess={handleUploadSuccess}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
} 
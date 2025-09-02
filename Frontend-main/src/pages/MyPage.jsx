import React, { useState } from 'react';
import UserProfile from '../components/common/UserProfile';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/useBooks';
import { useUserProfile } from '../hooks/useUserProfile';
import { theme } from '../components/common/theme';

export default function MyPage() {
  const { books, loading, error, retryFetch, addBook } = useBooks();
  const { userProfile } = useUserProfile();
  const [showUpload, setShowUpload] = useState(false);

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
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: '#4F6DDE',
    color: 'white',
    border: 'none',
    borderRadius: '50%',
    width: '56px',
    height: '56px',
    fontSize: '24px',
    cursor: 'pointer',
    boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
    transition: 'all 0.2s ease',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const handleUploadSuccess = (newBook) => {
    addBook(newBook);
    setShowUpload(false);
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
        />
      </div>
      
      {/* 플로팅 업로드 버튼 */}
      <button 
        style={uploadButtonStyle}
        onClick={() => setShowUpload(true)}
        onMouseEnter={(e) => {
          e.target.style.transform = 'scale(1.05)';
          e.target.style.backgroundColor = '#3a57c4';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'scale(1)';
          e.target.style.backgroundColor = '#4F6DDE';
        }}
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
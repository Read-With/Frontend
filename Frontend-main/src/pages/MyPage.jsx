import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/useBooks';
import useAuth from '../hooks/useAuth';
import { theme } from '../components/common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../utils/styles/styles';
import { ANIMATION_VALUES } from '../utils/styles/animations';

export default function MyPage() {
  const { books, loading, error, retryFetch, addBook, toggleFavorite } = useBooks();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showUpload, setShowUpload] = useState(false);


  const rootStyle = {
    background: theme.colors.background.main,
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    overflow: 'visible',
    position: 'relative'
  };

  const mainStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    gap: '10px',
    overflow: 'visible',
    paddingBottom: theme.spacing.xl
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


  const titleStyle = {
    fontSize: 'clamp(2.5rem, 5vw, 3.5rem)',
    fontWeight: 800,
    color: theme.colors.primary.main,
    margin: 0,
    lineHeight: '1.1',
    letterSpacing: '-0.02em'
  };

  const subtitleStyle = {
    fontSize: theme.fontSize.xl,
    fontWeight: 500,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
    opacity: 0.9
  };

  const descriptionStyle = {
    fontSize: theme.fontSize.lg,
    color: theme.colors.text.secondary,
    lineHeight: '1.7',
    marginBottom: theme.spacing.lg,
    opacity: 0.8
  };


  const statItemStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    background: 'rgba(255, 255, 255, 0.6)',
    borderRadius: '12px',
    border: '1px solid rgba(79, 109, 222, 0.1)',
    minWidth: '100px',
    transition: 'all 0.3s ease'
  };

  const statNumberStyle = {
    fontSize: '2.5rem',
    fontWeight: 800,
    color: theme.colors.primary.main,
    lineHeight: '1',
    marginBottom: theme.spacing.xs
  };

  const statLabelStyle = {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text.secondary,
    opacity: 0.8,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  };


  // 통합된 대시보드 스타일
  const dashboardStyle = {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: '20px',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    marginBottom: theme.spacing.xl,
    overflow: 'hidden',
    maxWidth: '900px',
    width: '100%'
  };

  const headerSectionStyle = {
    padding: `${theme.spacing.xl} ${theme.spacing.xl} ${theme.spacing.lg} ${theme.spacing.xl}`,
    textAlign: 'center',
    borderBottom: '1px solid rgba(0, 0, 0, 0.05)'
  };

  const headerContentStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    borderBottom: '1px solid rgba(0, 0, 0, 0.08)'
  };

  const welcomeContentStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.xl
  };

  const welcomeTextStyle = {
    flex: 1,
    textAlign: 'left'
  };

  const readingStatsInlineStyle = {
    display: 'flex',
    alignItems: 'center'
  };

  const handleSignOut = () => {
    logout();
    navigate('/');
  };

  // Google ID에서 가져온 이름 직접 사용
  const getDisplayName = () => {
    console.log('MyPage에서 사용자 정보:', user);
    console.log('MyPage에서 사용자 이름:', user?.name);
    console.log('최종 표시될 이름:', user?.name || '사용자');
    return user?.name || '사용자';
  };

  return (
    <>
      <style>
        {`
          body {
            overflow: auto !important;
            position: static !important;
          }
          html {
            overflow: auto !important;
          }
        `}
      </style>
      <div style={rootStyle}>
        <div style={mainStyle}>
        {/* 간소화된 사용자 대시보드 */}
        <div style={dashboardStyle}>
          {/* 헤더 섹션 - ReadWith와 로그아웃 버튼 */}
          <div style={headerSectionStyle}>
            <div style={headerContentStyle}>
              <h1 style={titleStyle}>ReadWith</h1>
              <button
                style={{
                  ...createButtonStyle(ANIMATION_VALUES, 'secondary'),
                  padding: `${theme.spacing.md} ${theme.spacing.lg}`,
                  fontSize: theme.fontSize.sm,
                  fontWeight: 600,
                  borderRadius: '12px',
                  minWidth: '80px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                }}
                onClick={handleSignOut}
                {...createAdvancedButtonHandlers('secondary')}
              >
                로그아웃
              </button>
            </div>
            <div style={welcomeContentStyle}>
              <div style={welcomeTextStyle}>
                <p style={subtitleStyle}>안녕하세요, {getDisplayName()}님! 👋</p>
                <p style={descriptionStyle}>나만의 서재에서 책을 읽고, 분석하고, 관리해보세요.</p>
              </div>
              <div style={readingStatsInlineStyle}>
                <div style={statItemStyle}>
                  <span style={statNumberStyle}>0</span>
                  <span style={statLabelStyle}>읽은 책</span>
                </div>
              </div>
            </div>
          </div>

        </div>
        <BookLibrary 
          books={books} 
          loading={loading} 
          error={error} 
          onRetry={retryFetch}
          onToggleFavorite={toggleFavorite}
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
    </>
  );
} 
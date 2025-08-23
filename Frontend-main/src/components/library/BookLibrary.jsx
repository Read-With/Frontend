import React from 'react';
import PropTypes from 'prop-types';
import BookCard from './BookCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { theme } from '../common/theme';

// 그리드 레이아웃 사용으로 chunk 함수 제거

const BookLibrary = ({ books, loading, error, onRetry }) => {
  const sectionStyle = {
    width: '100%',
    maxWidth: '1100px',
    background: theme.colors.background.section,
    borderRadius: theme.borderRadius.lg,
    boxShadow: '0 4px 24px rgba(79,109,222,0.07)',
    margin: '0 auto 36px auto',
    padding: `36px ${theme.spacing.lg} ${theme.spacing.lg} ${theme.spacing.lg}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '18px'
  };

  // 그리드 레이아웃으로 변경하여 불필요한 스타일 제거

  const errorStyle = {
    color: 'red',
    padding: '40px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing.sm
  };

  const retryButtonStyle = {
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    fontSize: theme.fontSize.base,
    borderRadius: theme.borderRadius.full,
    background: theme.gradients.primary,
    color: theme.colors.text.white,
    border: 'none',
    fontWeight: 600,
    cursor: 'pointer',
    transition: `transform ${theme.transitions.default}`
  };

  const emptyStateStyle = {
    padding: '60px 20px',
    textAlign: 'center',
    color: theme.colors.text.secondary
  };

  if (loading) {
    return (
      <div style={sectionStyle}>
        <LoadingSpinner />
        <div style={{ color: theme.colors.text.secondary }}>책 목록을 불러오는 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={sectionStyle}>
        <div style={errorStyle}>
          <div>{error}</div>
          {onRetry && (
            <button 
              style={retryButtonStyle} 
              onClick={onRetry}
              onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
            >
              다시 시도
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!books || books.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={emptyStateStyle}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
          <div style={{ fontSize: theme.fontSize.xl, marginBottom: theme.spacing.sm, fontWeight: 600 }}>
            아직 책이 없네요!
          </div>
          <div style={{ fontSize: theme.fontSize.base, color: theme.colors.text.secondary, lineHeight: '1.5' }}>
            우측 하단의 + 버튼을 눌러서<br />
            첫 번째 책을 추가해보세요
          </div>
        </div>
      </div>
    );
  }

  // 왼쪽 정렬 그리드 레이아웃
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 200px)',
    gap: theme.spacing.md,
    width: '100%',
    justifyContent: 'flex-start',
    justifyItems: 'center'
  };

  return (
    <div style={sectionStyle}>
      <div style={gridStyle}>
        {books.map((book) => (
          <BookCard 
            key={`${book.title}-${book.filename}`} 
            book={book} 
          />
        ))}
      </div>
    </div>
  );
};

BookLibrary.propTypes = {
  books: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      filename: PropTypes.string.isRequired,
      cover: PropTypes.string,
      author: PropTypes.string.isRequired
    })
  ).isRequired,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onRetry: PropTypes.func
};

export default BookLibrary;

import React from 'react';
import PropTypes from 'prop-types';
import BookCard from './BookCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { theme } from '../../styles/theme';

// 배열을 지정된 크기로 청크 분할하는 유틸리티 함수
const chunk = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

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

  const listStyle = {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px'
  };

  const rowStyle = {
    display: 'flex',
    gap: theme.spacing.md,
    justifyContent: 'center'
  };

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
          <div style={{ fontSize: theme.fontSize.xl, marginBottom: theme.spacing.sm }}>
            아직 등록된 책이 없습니다
          </div>
          <div>새로운 책을 추가해보세요!</div>
        </div>
      </div>
    );
  }

  const rows = chunk(books, 2);

  return (
    <div style={sectionStyle}>
      <div style={listStyle}>
        {rows.map((row, index) => (
          <div key={index} style={rowStyle}>
            {row.map((book) => (
              <BookCard 
                key={`${book.title}-${book.filename}`} 
                book={book} 
              />
            ))}
          </div>
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

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from '../common/LoadingSpinner';
import { theme } from '../common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../../utils/styles/styles';
import { ANIMATION_VALUES } from '../../utils/styles/animations';
import BookDetailModal from './BookDetailModal';

const BookCard = ({ book, onToggleFavorite, onBookClick, onBookDetailClick }) => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);

  const cardStyle = {
    background: theme.colors.background.card,
    border: `1.5px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.boxShadow.sm,
    width: '100%',
    maxWidth: '200px',
    minHeight: '320px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: '20px 16px',
    boxSizing: 'border-box',
    cursor: 'pointer',
    transition: `transform ${theme.transitions.default}, box-shadow ${theme.transitions.default}`,
    position: 'relative'
  };

  const cardHoverStyle = {
    ...cardStyle,
    transform: 'translateY(-8px) scale(1.03)',
    boxShadow: theme.boxShadow.hover
  };

  const imageContainerStyle = {
    width: '80px',
    height: '120px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const imageStyle = {
    width: '80px',
    height: '120px',
    objectFit: 'cover',
    borderRadius: theme.borderRadius.sm,
    boxShadow: '0 2px 8px #b0b8c1cc'
  };

  const textContentStyle = {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    position: 'relative',
    minWidth: 0
  };

  const titleStyle = {
    fontWeight: 600,
    fontSize: theme.fontSize.lg,
    lineHeight: '1.3',
    minHeight: '1.5em',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    width: '100%'
  };

  const authorStyle = {
    fontWeight: 400,
    fontSize: '0.97rem',
    color: theme.colors.text.secondary,
    lineHeight: '1.2',
    minHeight: '1.5em',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    width: '100%'
  };

  const buttonsStyle = {
    display: 'flex',
    gap: '4px',
    justifyContent: 'center',
    marginTop: '10px'
  };

  const primaryButtonStyle = {
    ...createButtonStyle(ANIMATION_VALUES, 'primary'),
    padding: '2px 8px',
    fontSize: theme.fontSize.xs,
    borderRadius: theme.borderRadius.full,
    minWidth: '60px',
    height: 'auto'
  };

  const secondaryButtonStyle = {
    ...createButtonStyle(ANIMATION_VALUES, 'default'),
    padding: '2px 8px',
    fontSize: theme.fontSize.xs,
    borderRadius: theme.borderRadius.full,
    background: '#f0f4fa',
    color: theme.colors.primary,
    border: 'none',
    minWidth: '60px',
    height: 'auto'
  };


  const [isHovered, setIsHovered] = React.useState(false);
  
  // 로컬 책인지 확인
  const isLocalBook = typeof book.id === 'string' && book.id.startsWith('local_');

  const handleReadClick = (e) => {
    e.stopPropagation();
    // 로컬 책은 filename을 사용, API 책은 id를 사용
    const identifier = isLocalBook ? book.epubPath : book.id;
    // API 책인 경우 책 정보를 state로 전달
    const state = isLocalBook ? undefined : { book };
    navigate(`/user/viewer/${identifier}`, { state });
  };

  const handleGraphClick = (e) => {
    e.stopPropagation();
    // 로컬 책은 filename을 사용, API 책은 id를 사용
    const identifier = isLocalBook ? book.epubPath : book.id;
    // API 책인 경우 책 정보를 state로 전달
    const state = isLocalBook ? undefined : { book };
    navigate(`/user/graph/${identifier}`, { state });
  };

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(book.id, !book.favorite);
    }
  };

  const handleCardClick = () => {
    if (onBookClick) {
      onBookClick(book);
    } else {
      // onBookClick이 없으면 기본적으로 읽기 페이지로 이동
      handleReadClick({ stopPropagation: () => {} });
    }
  };

  const handleDetailClick = (e) => {
    e.stopPropagation();
    if (onBookDetailClick) {
      onBookDetailClick(book);
    }
  };

  const renderBookImage = () => {
    if (book.coverImgUrl && !imageError) {
      return (
        <img 
          src={book.coverImgUrl} 
          alt={book.title} 
          style={imageStyle}
          onError={() => setImageError(true)}
          onLoad={() => setImageError(false)}
        />
      );
    }
    
    return (
      <svg width="80" height="120" viewBox="0 0 80 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="16" width="60" height="88" rx="8" fill="#b0b8c1" />
        <rect x="18" y="28" width="44" height="64" rx="4" fill="#e3e9f7" />
        <rect x="22" y="36" width="36" height="6" rx="3" fill="#b0b8c1" />
        <rect x="22" y="48" width="26" height="6" rx="3" fill="#b0b8c1" />
      </svg>
    );
  };

  return (
    <div 
      style={isHovered ? cardHoverStyle : cardStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleCardClick}
    >
      
      {/* 즐겨찾기 버튼 */}
      <button
        onClick={handleFavoriteClick}
        style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          backgroundColor: 'transparent',
          border: 'none',
          fontSize: '18px',
          cursor: 'pointer',
          zIndex: 1,
          padding: '4px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
        }}
        onMouseLeave={(e) => {
          e.target.style.backgroundColor = 'transparent';
        }}
      >
        {book.favorite ? '❤️' : '🤍'}
      </button>

      {/* 상세 버튼 */}
      <button
        onClick={handleDetailClick}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          border: '1px solid rgba(0, 0, 0, 0.1)',
          fontSize: '12px',
          fontWeight: '600',
          cursor: 'pointer',
          zIndex: 1,
          padding: '4px 8px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          color: '#4F6DDE',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
        }}
        onMouseEnter={(e) => {
          e.target.style.backgroundColor = 'rgba(255, 255, 255, 1)';
          e.target.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
          e.target.style.transform = 'scale(1)';
        }}
      >
        상세
      </button>
      
      <div style={imageContainerStyle}>
        {renderBookImage()}
      </div>
      <div style={textContentStyle}>
        <div style={{ width: '100%' }}>
          <div style={titleStyle}>{book.title}</div>
          <div style={authorStyle}>{book.author}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={buttonsStyle}>
          <button 
            style={primaryButtonStyle} 
            onClick={handleReadClick}
            {...createAdvancedButtonHandlers('primary')}
          >
            읽기
          </button>
          <button 
            style={secondaryButtonStyle} 
            onClick={handleGraphClick}
            {...createAdvancedButtonHandlers('default')}
          >
            그래프
          </button>
        </div>
      </div>
    </div>
  );
};

BookCard.propTypes = {
  book: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    title: PropTypes.string.isRequired,
    author: PropTypes.string.isRequired,
    coverImgUrl: PropTypes.string,
    epubPath: PropTypes.string,
    summary: PropTypes.bool,
    default: PropTypes.bool,
    favorite: PropTypes.bool,
    updatedAt: PropTypes.string
  }).isRequired,
  onToggleFavorite: PropTypes.func,
  onBookClick: PropTypes.func,
  onBookDetailClick: PropTypes.func
};

const BookLibrary = ({ books, loading, error, onRetry, onToggleFavorite, onBookClick }) => {
  const [selectedBook, setSelectedBook] = React.useState(null);
  const [showDetailModal, setShowDetailModal] = React.useState(false);

  const handleBookDetailClick = (book) => {
    setSelectedBook(book);
    setShowDetailModal(true);
  };

  const handleCloseDetailModal = () => {
    setShowDetailModal(false);
    setSelectedBook(null);
  };
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

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 200px)',
    gap: theme.spacing.md,
    width: '100%',
    justifyContent: 'flex-start',
    justifyItems: 'center'
  };

  return (
    <>
      <div style={sectionStyle}>
        <div style={gridStyle}>
          {books.map((book) => (
            <BookCard 
              key={`${book.title}-${book.id}`} 
              book={book}
              onToggleFavorite={onToggleFavorite}
              onBookClick={onBookClick}
              onBookDetailClick={handleBookDetailClick}
            />
          ))}
        </div>
      </div>
      
      <BookDetailModal
        book={selectedBook}
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
      />
    </>
  );
};

BookLibrary.propTypes = {
  books: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
      title: PropTypes.string.isRequired,
      author: PropTypes.string.isRequired,
      coverImgUrl: PropTypes.string,
      epubPath: PropTypes.string,
      summary: PropTypes.bool,
      default: PropTypes.bool,
      favorite: PropTypes.bool,
      updatedAt: PropTypes.string
    })
  ).isRequired,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onRetry: PropTypes.func,
  onToggleFavorite: PropTypes.func,
  onBookClick: PropTypes.func
};

export default BookLibrary;

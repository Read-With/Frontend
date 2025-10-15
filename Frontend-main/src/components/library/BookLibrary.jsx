import React, { useState, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { Heart, BookOpen, Network, MoreVertical, Info, CheckCircle, Clock, FileText } from 'lucide-react';
import BookDetailModal from './BookDetailModal';
import './BookLibrary.css';

const BookCard = ({ book, onToggleFavorite, onBookClick, onBookDetailClick, onStatusChange, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);

  const isLocalBook = typeof book.id === 'string' && book.id.startsWith('local_');
  
  // 독서 진행률 계산 (임시로 랜덤값, 실제로는 book.progress 사용) - 수정예정
  const progress = book.progress || 0;

  const handleReadClick = (e) => {
    e.stopPropagation();
    const identifier = isLocalBook ? book.epubPath : book.id;
    const state = isLocalBook ? undefined : { book };
    navigate(`/user/viewer/${identifier}`, { state });
  };

  const handleGraphClick = (e) => {
    e.stopPropagation();
    const identifier = isLocalBook ? book.epubPath : book.id;
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
      handleReadClick({ stopPropagation: () => {} });
    }
  };

  const handleDetailClick = (e) => {
    e.stopPropagation();
    if (onBookDetailClick) {
      onBookDetailClick(book);
    }
  };

  const handleContextMenu = (e) => {
    e.stopPropagation();
    setShowContextMenu(!showContextMenu);
  };

  const handleStatusChangeClick = (status, e) => {
    e.stopPropagation();
    if (onStatusChange) {
      onStatusChange(book.id, status);
    }
    setShowContextMenu(false);
  };

  const getStatusInfo = () => {
    const status = book.readingStatus || 'none';
    const statusMap = {
      reading: { label: '읽는 중', className: 'status-reading', icon: <BookOpen size={14} /> },
      completed: { label: '완독', className: 'status-completed', icon: <CheckCircle size={14} /> },
      none: { label: '미분류', className: 'status-default', icon: <BookOpen size={14} /> }
    };
    return statusMap[status] || statusMap.none;
  };

  const statusInfo = getStatusInfo();

  const renderBookImage = () => {
    if (book.coverImgUrl && !imageError) {
      return (
        <img 
          src={book.coverImgUrl} 
          alt={book.title} 
          className="book-image"
          onError={() => setImageError(true)}
          onLoad={() => setImageError(false)}
        />
      );
    }
    
    return (
      <div className="book-image-placeholder">
        <svg width="100%" height="100%" viewBox="0 0 120 180" fill="none">
          <rect x="15" y="24" width="90" height="132" rx="8" fill="#b0b8c1" />
          <rect x="27" y="42" width="66" height="96" rx="6" fill="#e3e9f7" />
          <rect x="33" y="54" width="54" height="9" rx="4" fill="#b0b8c1" />
          <rect x="33" y="72" width="39" height="9" rx="4" fill="#b0b8c1" />
        </svg>
      </div>
    );
  };

  return (
    <div 
      className={`book-card ${viewMode === 'list' ? 'list-view' : 'grid-view'}`}
      onMouseLeave={() => setShowContextMenu(false)}
      onClick={handleCardClick}
    >
      {/* 상태 배지 */}
      {book.readingStatus && book.readingStatus !== 'none' && (
        <div className={`book-status-badge ${statusInfo.className}`}>
          <span>{statusInfo.icon}</span> {statusInfo.label}
        </div>
      )}

      {/* 즐겨찾기 버튼 */}
      <button
        className="book-favorite-btn"
        onClick={handleFavoriteClick}
        title={book.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      >
        <Heart 
          size={20} 
          fill={book.favorite ? '#ff6b6b' : 'none'} 
          stroke={book.favorite ? '#ff6b6b' : '#999'}
          strokeWidth={2}
        />
      </button>

      {/* 카드 헤더 - 이미지 영역 */}
      <div className="book-card-header">
        <div className="book-image-container">
          {renderBookImage()}
        </div>

        {/* 독서 진행률 (읽는 중인 책만) */}
        {book.readingStatus === 'reading' && progress > 0 && (
          <div className="book-progress-container">
            <div className="progress-label">
              <span>독서 진행률</span>
              <span>{progress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 카드 바디 - 정보 영역 */}
      <div className="book-card-body">
        <h3 className="book-title" title={book.title}>
          {book.title}
        </h3>
        <p className="book-author" title={book.author}>
          {book.author}
        </p>
        
        {/* 메타 정보 */}
        <div className="book-meta">
          {book.updatedAt && (
            <span className="book-meta-item">
              <Clock size={14} />
              {(() => {
                const date = new Date(book.updatedAt);
                const now = new Date();
                const diffTime = Math.abs(now - date);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays === 1) return '오늘';
                if (diffDays === 2) return '어제';
                if (diffDays <= 7) return `${diffDays - 1}일 전`;
                return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
              })()}
            </span>
          )}
          
          {book.format && (
            <span className="book-meta-item book-format">
              <FileText size={14} />
              {book.format.toUpperCase()}
            </span>
          )}
          
          {book.pages && (
            <span className="book-meta-item">
              📄 {book.pages}페이지
            </span>
          )}
        </div>
      </div>

      {/* 카드 액션 버튼 */}
      <div className="book-card-actions">
        <button 
          className="book-action-btn book-action-primary"
          onClick={handleReadClick}
          title="책 읽기"
        >
          <BookOpen size={16} className="book-action-icon" />
          읽기
        </button>
        <button 
          className="book-action-btn book-action-secondary"
          onClick={handleGraphClick}
          title="인물 관계도 보기"
        >
          <Network size={16} className="book-action-icon" />
          관계도
        </button>
      </div>

      {/* 컨텍스트 메뉴 */}
      <div className="book-context-menu">
        <button
          className="book-context-trigger"
          onClick={handleContextMenu}
          title="더보기"
        >
          <MoreVertical size={20} />
        </button>
        
        {showContextMenu && (
          <div className="book-context-dropdown">
            <button
              className="book-context-item"
              onClick={(e) => handleStatusChangeClick('reading', e)}
            >
              <BookOpen size={18} className="book-context-icon" />
              읽는 중            </button>
            <button
              className="book-context-item"
              onClick={(e) => handleStatusChangeClick('completed', e)}
            >
              <CheckCircle size={18} className="book-context-icon" />
              완독
            </button>
            <button
              className="book-context-item"
              onClick={handleDetailClick}
            >
              <Info size={18} className="book-context-icon" />
              상세 정보
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// 공통 book shape 정의
const bookShape = PropTypes.shape({
  id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  title: PropTypes.string.isRequired,
  author: PropTypes.string.isRequired,
  coverImgUrl: PropTypes.string,
  epubPath: PropTypes.string,
  summary: PropTypes.bool,
  default: PropTypes.bool,
  favorite: PropTypes.bool,
  readingStatus: PropTypes.string,
  progress: PropTypes.number,
  updatedAt: PropTypes.string
});

BookCard.propTypes = {
  book: bookShape.isRequired,
  onToggleFavorite: PropTypes.func,
  onBookClick: PropTypes.func,
  onBookDetailClick: PropTypes.func,
  onStatusChange: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list'])
};

const BookLibrary = memo(({ books, loading, error, onRetry, onToggleFavorite, onBookClick, onStatusChange, viewMode = 'grid' }) => {
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

  // BookLibrary 컴포넌트는 이제 그리드 컨테이너 역할만 함
  // 로딩, 에러, 빈 상태는 MyPage에서 처리
  if (loading || error || !books || books.length === 0) {
    return null;
  }

  return (
    <>
      {books.map((book) => (
        <BookCard 
          key={`${book.title}-${book.id}`} 
          book={book}
          onToggleFavorite={onToggleFavorite}
          onBookClick={onBookClick}
          onBookDetailClick={handleBookDetailClick}
          onStatusChange={onStatusChange}
          viewMode={viewMode}
        />
      ))}
      
      <BookDetailModal
        book={selectedBook}
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
      />
    </>
  );
});

BookLibrary.propTypes = {
  books: PropTypes.arrayOf(bookShape).isRequired,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onRetry: PropTypes.func,
  onToggleFavorite: PropTypes.func,
  onBookClick: PropTypes.func,
  onStatusChange: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list'])
};

BookLibrary.displayName = 'BookLibrary';

export default BookLibrary;

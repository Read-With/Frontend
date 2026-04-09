import React, { useState, useEffect, useCallback, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { Heart, BookOpen, Network, MoreVertical, Info, Clock, FileText, Trash2, X } from 'lucide-react';
import BookDetailModal from './BookDetailModal';
import './BookLibrary.css';
import { ensureGraphBookCache } from '../../utils/common/cache/chapterEventCache';
import { USER_VIEWER_PREFIX } from '../../utils/navigation/viewerPaths';

function navigateFromLibrary(navigate, book, graphMode) {
  const base = graphMode === 'graph' ? '/user/graph' : USER_VIEWER_PREFIX;
  navigate(`${base}/${book.id}`, {
    state: { book, fromLibrary: true, from: { pathname: '/user/mypage' } },
    replace: false,
  });
}

function formatLibraryRelativeDate(updatedAt) {
  const date = new Date(updatedAt);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return '오늘';
  if (diffDays === 2) return '어제';
  if (diffDays <= 7) return `${diffDays - 1}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

const DeleteConfirmModal = ({ isOpen, onClose, onConfirm }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="delete-confirm-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
    >
      <div 
        className="delete-confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="delete-confirm-header">
          <h3 id="delete-confirm-title">책 삭제</h3>
          <button
            className="delete-confirm-close"
            onClick={onClose}
            aria-label="닫기"
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className="delete-confirm-body">
          <p className="delete-confirm-message">이 책을 삭제하시겠습니까?</p>
        </div>
        <div className="delete-confirm-actions">
          <button
            className="delete-confirm-cancel"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="delete-confirm-delete"
            onClick={onConfirm}
            type="button"
            autoFocus
          >
            삭제하기
          </button>
        </div>
      </div>
    </div>
  );
};

DeleteConfirmModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};

const BookCard = memo(({ book, onToggleFavorite, onBookClick, onBookDetailClick, onShowDeleteModal, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [optimisticFavorite, setOptimisticFavorite] = useState(null);
  const displayFavorite = optimisticFavorite !== null ? optimisticFavorite : !!book.favorite;

  const handleReadClick = (e) => {
    e.stopPropagation();
    navigateFromLibrary(navigate, book, 'viewer');
  };

  const handleGraphClick = (e) => {
    e.stopPropagation();
    navigateFromLibrary(navigate, book, 'graph');
  };

  useEffect(() => {
    setOptimisticFavorite(null);
  }, [book.favorite]);

  const handleFavoriteClick = async (e) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const next = !displayFavorite;
    setOptimisticFavorite(next);
    try {
      await onToggleFavorite(book.id, next);
    } catch {
      setOptimisticFavorite(null);
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

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (onShowDeleteModal) {
      onShowDeleteModal(book);
    }
  };

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
          <rect x="27" y="42" width="66" height="96" rx="6" fill="#e8f5e8" />
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
      {/* 즐겨찾기 버튼 - 왼쪽 상단 */}
      <button
        className={`book-favorite-btn ${displayFavorite ? 'favorited' : ''}`}
        onClick={handleFavoriteClick}
        title={displayFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      >
        <Heart 
          size={20} 
          fill={displayFavorite ? '#ff6b6b' : 'none'} 
          stroke={displayFavorite ? '#ff6b6b' : '#999'}
          strokeWidth={2}
        />
      </button>

      {/* 카드 헤더 - 이미지 영역 */}
      <div className="book-card-header">
        <div className="book-image-container">
          {renderBookImage()}
        </div>

        {/* 독서 진행률 */}
        {book.progress > 0 && (
          <div className="book-progress-container">
            <div className="progress-label">
              <span>독서 진행률</span>
              <span>{book.progress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${book.progress}%` }}
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
              {formatLibraryRelativeDate(book.updatedAt)}
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
              onClick={handleDetailClick}
            >
              <Info size={18} className="book-context-icon" />
              상세 정보
            </button>
            <button
              className="book-context-item book-context-item-danger"
              onClick={handleDeleteClick}
            >
              <Trash2 size={18} className="book-context-icon" />
              삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

BookCard.displayName = 'BookCard';

// 공통 book shape 정의 (서버 책만 표시)
const bookShape = PropTypes.shape({
  id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  title: PropTypes.string.isRequired,
  author: PropTypes.string.isRequired,
  coverImgUrl: PropTypes.string,
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
  onShowDeleteModal: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list'])
};

const BookLibrary = memo(({ books, loading: _loading, error: _loadError, onRetry: _onRetry, onToggleFavorite, onBookClick, onBookDelete, viewMode = 'grid' }) => {
  const [selectedBook, setSelectedBook] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [deleteTargetBook, setDeleteTargetBook] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (!Array.isArray(books) || books.length === 0) {
      return undefined;
    }

    const numericBooks = books.filter((book) => Number.isFinite(Number(book?.id)));
    if (numericBooks.length === 0) {
      return undefined;
    }

    let cancelled = false;

    const initializeSequentially = async () => {
      for (const book of numericBooks) {
        if (cancelled) break;

        const bookId = Number(book.id);
        if (!Number.isFinite(bookId)) {
          continue;
        }

        try {
          await ensureGraphBookCache(bookId);
        } catch (error) {
          console.warn('도서 캐시 초기화 실패', { bookId, error });
        }
      }
    };

    initializeSequentially();

    return () => {
      cancelled = true;
    };
  }, [books]);

  const handleBookDetailClick = useCallback((book) => {
    setSelectedBook(book);
    setShowDetailModal(true);
  }, []);

  const handleCloseDetailModal = useCallback(() => {
    setShowDetailModal(false);
    setSelectedBook(null);
  }, []);

  const handleShowDeleteModal = useCallback((book) => {
    setDeleteTargetBook(book);
    setShowDeleteModal(true);
  }, []);

  const handleCloseDeleteModal = useCallback(() => {
    setShowDeleteModal(false);
    setDeleteTargetBook(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetBook?.id) return;

    setShowDeleteModal(false);

    if (onBookDelete) {
      try {
        await onBookDelete(deleteTargetBook.id);
      } catch (err) {
        console.error('책 삭제 실패:', err);
      }
    }

    setDeleteTargetBook(null);
  }, [deleteTargetBook, onBookDelete]);

  const handleBookDelete = useCallback(
    async (bookId) => {
      if (onBookDelete) {
        await onBookDelete(bookId);
      }
      handleCloseDetailModal();
    },
    [onBookDelete, handleCloseDetailModal]
  );

  // BookLibrary 컴포넌트는 이제 그리드 컨테이너 역할만 함
  // 로딩, 에러, 빈 상태는 MyPage에서 처리
  // books가 없거나 빈 배열이면 빈 fragment 반환 (null 대신)
  if (!books || books.length === 0) {
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
          onShowDeleteModal={handleShowDeleteModal}
          viewMode={viewMode}
        />
      ))}
      
      <BookDetailModal
        book={selectedBook}
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
        onDelete={handleBookDelete}
      />

      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={handleCloseDeleteModal}
        onConfirm={handleDeleteConfirm}
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
  onBookDelete: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list'])
};

BookLibrary.displayName = 'BookLibrary';

export default BookLibrary;

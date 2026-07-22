import { useState, useEffect, useCallback, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { Heart, BookOpen, Network, MoreVertical, Info, Clock, FileText, Trash2, X } from 'lucide-react';
import BookDetailModal from './BookDetailModal';
import AuthenticatedImage from './AuthenticatedImage';
import './BookLibrary.css';
import { ensureGraphBookCache } from '../../utils/graph/graphFetch';
import { USER_VIEWER_PREFIX, USER_GRAPH_PREFIX } from '../../utils/common/urlUtils';
import { formatLibraryRelativeDate } from '../../utils/library/libraryUtils';

const getNumericBookId = (book) => {
  const bookId = Number(book?.id);
  return Number.isFinite(bookId) && bookId > 0 ? bookId : null;
};

async function prewarmGraphBookCache(book, options = {}) {
  const bookId = getNumericBookId(book);
  if (!bookId) return null;

  try {
    return await ensureGraphBookCache(bookId, options);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('도서 그래프 캐시 준비 실패', { bookId, error });
    }
    return null;
  }
}

function navigateFromLibrary(navigate, book, graphMode) {
  const base = graphMode === 'graph' ? USER_GRAPH_PREFIX : USER_VIEWER_PREFIX;
  navigate(`${base}/${book.id}`, {
    state: { book, fromLibrary: true, from: { pathname: '/mypage' } },
    replace: false,
  });
}

async function openBookFromLibrary(navigate, book, graphMode) {
  await prewarmGraphBookCache(book);
  navigateFromLibrary(navigate, book, graphMode);
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

const BookCard = memo(({ book, onToggleFavorite, onOpenBook, onBookDetailClick, onShowDeleteModal, viewMode = 'grid', openingMode = null }) => {
  const [imageError, setImageError] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [optimisticFavorite, setOptimisticFavorite] = useState(null);
  const displayFavorite = optimisticFavorite !== null ? optimisticFavorite : !!book.isFavorite;
  const isOpeningReader = openingMode === 'viewer';
  const isOpeningGraph = openingMode === 'graph';
  const isOpening = Boolean(openingMode);

  const handleReadClick = (e) => {
    e.stopPropagation();
    onOpenBook?.(book, 'viewer');
  };

  const handleGraphClick = (e) => {
    e.stopPropagation();
    onOpenBook?.(book, 'graph');
  };

  useEffect(() => {
    setOptimisticFavorite(null);
  }, [book.isFavorite]);

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
    onOpenBook?.(book, 'viewer');
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
        <AuthenticatedImage
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
      className={`book-card${viewMode === 'list' ? ' list-view' : ''}`}
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
          disabled={isOpening}
        >
          <BookOpen size={16} className="book-action-icon" />
          {isOpeningReader ? '준비중' : '읽기'}
        </button>
        <button 
          className="book-action-btn book-action-secondary"
          onClick={handleGraphClick}
          title="인물 관계도 보기"
          disabled={isOpening}
        >
          <Network size={16} className="book-action-icon" />
          {isOpeningGraph ? '준비중' : '관계도'}
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
  isFavorite: PropTypes.bool,
  progress: PropTypes.number,
  updatedAt: PropTypes.string
});

BookCard.propTypes = {
  book: bookShape.isRequired,
  onToggleFavorite: PropTypes.func,
  onOpenBook: PropTypes.func,
  onBookDetailClick: PropTypes.func,
  onShowDeleteModal: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list']),
  openingMode: PropTypes.oneOf(['viewer', 'graph'])
};

const BookLibrary = memo(({ books, onToggleFavorite, onBookDelete, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const [selectedBook, setSelectedBook] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [deleteTargetBook, setDeleteTargetBook] = useState(null);
  const [openingTarget, setOpeningTarget] = useState(null);

  useEffect(() => {
    if (!selectedBook?.id) return;
    const next = books.find((b) => String(b.id) === String(selectedBook.id));
    if (next && next !== selectedBook) {
      setSelectedBook(next);
    }
  }, [books, selectedBook]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (!Array.isArray(books) || books.length === 0) {
      return undefined;
    }

    const numericBooks = books.filter((book) => Number.isFinite(Number(book?.id)));
    if (numericBooks.length === 0) {
      return undefined;
    }

    const abortController = new AbortController();

    const initializeSequentially = async () => {
      for (const book of numericBooks) {
        if (abortController.signal.aborted) break;
        await prewarmGraphBookCache(book, { signal: abortController.signal });
      }
    };

    initializeSequentially();

    return () => {
      abortController.abort();
    };
  }, [books]);

  const handleOpenBook = useCallback(
    async (book, graphMode) => {
      const bookId = getNumericBookId(book);
      const targetKey = bookId ? `${bookId}:${graphMode}` : null;
      if (targetKey && openingTarget === targetKey) return;

      setOpeningTarget(targetKey);
      try {
        await openBookFromLibrary(navigate, book, graphMode);
      } finally {
        setOpeningTarget(null);
      }
    },
    [navigate, openingTarget]
  );

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
          onOpenBook={handleOpenBook}
          onBookDetailClick={handleBookDetailClick}
          onShowDeleteModal={handleShowDeleteModal}
          viewMode={viewMode}
          openingMode={openingTarget === `${Number(book.id)}:viewer`
            ? 'viewer'
            : openingTarget === `${Number(book.id)}:graph`
              ? 'graph'
              : null}
        />
      ))}
      
      <BookDetailModal
        book={selectedBook}
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
        onDelete={handleBookDelete}
        viewMode={viewMode}
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
  onToggleFavorite: PropTypes.func,
  onBookDelete: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list'])
};

BookLibrary.displayName = 'BookLibrary';

export default BookLibrary;

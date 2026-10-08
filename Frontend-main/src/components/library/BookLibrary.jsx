import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Heart, BookOpen, Network, MoreVertical, Info, Clock, EyeOff } from 'lucide-react';
import BookDetailModal, { AuthenticatedImage } from './BookDetailModal';
import ConfirmDialog from './ConfirmDialog';
import './BookLibrary.css';
import { USER_VIEWER_PREFIX, USER_GRAPH_PREFIX } from '../../utils/common/urlUtils';
import { errorUtils } from '../../utils/common/valueUtils';
import { resolveServerBookId } from '../../utils/viewer/viewerCore';
import {
  formatLibraryRelativeDate,
  makeOpeningTargetKey,
  getOpeningMode,
  HIDE_BOOK_COPY,
} from '../../utils/library/libraryUtils';
import { useMountedRef, useLatestRef } from '../../hooks/common/hooksShared';

const COVER_PLACEHOLDER_SVG = (
  <svg width="100%" height="100%" viewBox="0 0 120 180" fill="none">
    <rect x="15" y="24" width="90" height="132" rx="8" fill="#b0b8c1" />
    <rect x="27" y="42" width="66" height="96" rx="6" fill="#e8f5e8" />
    <rect x="33" y="54" width="54" height="9" rx="4" fill="#b0b8c1" />
    <rect x="33" y="72" width="39" height="9" rx="4" fill="#b0b8c1" />
  </svg>
);

const BOOK_DISPLAY_COMPARE_KEYS = ['id', 'title', 'author', 'coverImgUrl', 'isFavorite', 'progress', 'updatedAt'];

function isSameBookContent(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return BOOK_DISPLAY_COMPARE_KEYS.every((key) => a[key] === b[key]);
}

async function prewarmGraphBookCache(book, options = {}) {
  const bookId = resolveServerBookId(book);
  if (!bookId) return null;

  try {
    const { ensureGraphBookCache } = await import('../../utils/graph/graphModel');
    return await ensureGraphBookCache(bookId, options);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      errorUtils.logWarning('BookLibrary', '도서 그래프 캐시 준비 실패', {
        bookId,
        message: error?.message,
      });
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
  // 책 전체 그래프 빌드를 기다리면 첫 진입이 막힘 — 뷰어는 필요한 챕터를 직접 discover
  void prewarmGraphBookCache(book);
  navigateFromLibrary(navigate, book, graphMode);
}

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

  useEffect(() => {
    setImageError(false);
  }, [book.coverImgUrl]);

  const handleFavoriteClick = async (e) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const next = !displayFavorite;
    setOptimisticFavorite(next);
    try {
      await onToggleFavorite(book.id, next);
    } catch (error) {
      setOptimisticFavorite(null);
      errorUtils.logError('BookLibrary', error, { action: 'toggleFavorite', bookId: book.id });
      toast.error('즐겨찾기 변경에 실패했습니다');
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

  const contextMenuRef = useRef(null);

  useEffect(() => {
    if (!showContextMenu) return undefined;
    const handlePointerDown = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setShowContextMenu(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowContextMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showContextMenu]);

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
        {COVER_PLACEHOLDER_SVG}
      </div>
    );
  };

  return (
    <div 
      className={`book-card${viewMode === 'list' ? ' list-view' : ''}`}
      onMouseLeave={() => setShowContextMenu(false)}
    >
      <button
        type="button"
        className="book-card-open"
        onClick={handleCardClick}
        aria-label={`${book.title} 읽기`}
        disabled={isOpening}
      />
      <button
        type="button"
        className={`book-favorite-btn ${displayFavorite ? 'favorited' : ''}`}
        onClick={handleFavoriteClick}
        title={displayFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-label={displayFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-pressed={displayFavorite}
      >
        <Heart
          size={20}
          fill={displayFavorite ? 'var(--bl-favorite)' : 'none'}
          stroke={displayFavorite ? 'var(--bl-favorite)' : 'var(--bl-text-faint)'}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      <div className="book-card-header">
        <div className="book-image-container">
          {renderBookImage()}
        </div>

        {viewMode !== 'list' && book.progress > 0 && (
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

      <div className="book-card-body">
        <h3 className="book-title" title={book.title}>
          {book.title}
        </h3>
        <p className="book-author" title={book.author}>
          {book.author}
        </p>
        
        <div className="book-meta">
          {viewMode === 'list' && book.progress > 0 && (
            <span className="book-meta-item book-progress-meta" title={`독서 진행률 ${book.progress}%`}>
              {book.progress}% 읽음
            </span>
          )}

          {book.updatedAt && (
            <span className="book-meta-item">
              <Clock size={14} aria-hidden />
              {formatLibraryRelativeDate(book.updatedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="book-card-actions">
        <button
          type="button"
          className="book-action-btn book-action-primary"
          onClick={handleReadClick}
          title="책 읽기"
          aria-label={`${book.title} 읽기`}
          disabled={isOpening}
        >
          <BookOpen size={16} className="book-action-icon" aria-hidden />
          {isOpeningReader ? '준비중' : '읽기'}
        </button>
        <button
          type="button"
          className="book-action-btn book-action-secondary"
          onClick={handleGraphClick}
          title="인물 관계도 보기"
          aria-label={`${book.title} 인물 관계도 보기`}
          disabled={isOpening}
        >
          <Network size={16} className="book-action-icon" aria-hidden />
          {isOpeningGraph ? '준비중' : '관계도'}
        </button>
      </div>

      <div className="book-context-menu" ref={contextMenuRef}>
        <button
          type="button"
          className="book-context-trigger"
          onClick={handleContextMenu}
          title="더보기"
          aria-label={`${book.title} 더보기`}
          aria-expanded={showContextMenu}
          aria-haspopup="menu"
        >
          <MoreVertical size={20} aria-hidden />
        </button>
        
        {showContextMenu && (
          <div className="book-context-dropdown" role="menu">
            <button
              type="button"
              className="book-context-item"
              role="menuitem"
              onClick={handleDetailClick}
            >
              <Info size={18} className="book-context-icon" aria-hidden />
              상세 정보
            </button>
            <button
              type="button"
              className="book-context-item book-context-item-danger"
              role="menuitem"
              onClick={handleDeleteClick}
            >
              <EyeOff size={18} className="book-context-icon" aria-hidden />
              서재에서 숨기기
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

BookCard.displayName = 'BookCard';

const BookLibrary = memo(({ books, onToggleFavorite, onBookDelete, onBookRestore, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const [selectedBook, setSelectedBook] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [deleteTargetBook, setDeleteTargetBook] = useState(null);
  const [openingTarget, setOpeningTarget] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const mountedRef = useMountedRef();
  const openingTargetRef = useLatestRef(openingTarget);

  useEffect(() => {
    if (!selectedBook?.id) return;
    const next = books.find((b) => String(b.id) === String(selectedBook.id));
    if (next && !isSameBookContent(next, selectedBook)) {
      setSelectedBook(next);
    }
  }, [books, selectedBook]);

  const numericBookIdsKey = useMemo(() => {
    if (!Array.isArray(books)) return '';
    return books
      .map((book) => resolveServerBookId(book))
      .filter((id) => Number.isFinite(id))
      .join(',');
  }, [books]);

  useEffect(() => {
    if (!Array.isArray(books) || books.length === 0) {
      return undefined;
    }

    const numericBooks = books.filter((book) => Number.isFinite(resolveServerBookId(book)));
    if (numericBooks.length === 0) {
      return undefined;
    }

    const abortController = new AbortController();
    const PREWARM_CONCURRENCY = 3;

    const initializeWithLimitedConcurrency = async () => {
      let cursor = 0;
      const runNext = async () => {
        while (cursor < numericBooks.length) {
          if (abortController.signal.aborted) return;
          const book = numericBooks[cursor];
          cursor += 1;
          await prewarmGraphBookCache(book, { signal: abortController.signal });
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PREWARM_CONCURRENCY, numericBooks.length) }, runNext)
      );
    };

    initializeWithLimitedConcurrency();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericBookIdsKey]);

  const handleOpenBook = useCallback(
    async (book, graphMode) => {
      const bookId = resolveServerBookId(book);
      const targetKey = makeOpeningTargetKey(bookId, graphMode);
      if (targetKey && openingTargetRef.current === targetKey) return;

      setOpeningTarget(targetKey);
      try {
        await openBookFromLibrary(navigate, book, graphMode);
      } finally {
        if (mountedRef.current) {
          setOpeningTarget((current) => (current === targetKey ? null : current));
        }
      }
    },
    [navigate, openingTargetRef, mountedRef]
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

  // 서버 삭제 API가 없어 이 기기의 목록에서만 숨긴다 — 되돌리기 토스트로 실수 복구
  const hideBook = useCallback(
    async (bookId) => {
      if (!onBookDelete) return;
      await onBookDelete(bookId);
      toast(
        ({ closeToast }) => (
          <span className="book-hidden-toast">
            서재에서 숨겼습니다
            <button
              type="button"
              className="book-hidden-toast-undo"
              onClick={() => {
                onBookRestore(bookId);
                closeToast();
              }}
            >
              되돌리기
            </button>
          </span>
        ),
        { autoClose: 5000, closeOnClick: false }
      );
    },
    [onBookDelete, onBookRestore]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetBook?.id) return;

    setShowDeleteModal(false);

    try {
      await hideBook(deleteTargetBook.id);
    } catch (err) {
      errorUtils.logError('BookLibrary', err, { action: 'hideBook' });
      toast.error(HIDE_BOOK_COPY.failed);
    }

    setDeleteTargetBook(null);
  }, [deleteTargetBook, hideBook]);

  // 실패 시 BookDetailModal이 에러 토스트를 띄우도록 그대로 throw
  const handleBookDelete = useCallback(
    async (bookId) => {
      await hideBook(bookId);
      handleCloseDetailModal();
    },
    [hideBook, handleCloseDetailModal]
  );

  if (!books || books.length === 0) {
    return null;
  }

  return (
    <>
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          onToggleFavorite={onToggleFavorite}
          onOpenBook={handleOpenBook}
          onBookDetailClick={handleBookDetailClick}
          onShowDeleteModal={handleShowDeleteModal}
          viewMode={viewMode}
          openingMode={getOpeningMode(openingTarget, book.id)}
        />
      ))}
      
      <BookDetailModal
        book={selectedBook}
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
        onDelete={handleBookDelete}
        viewMode={viewMode}
      />

      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={handleCloseDeleteModal}
        onConfirm={handleDeleteConfirm}
        title={HIDE_BOOK_COPY.title}
        message={HIDE_BOOK_COPY.message}
        confirmLabel={HIDE_BOOK_COPY.confirmLabel}
      />
    </>
  );
});

BookLibrary.displayName = 'BookLibrary';

export default BookLibrary;

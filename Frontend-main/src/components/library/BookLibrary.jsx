import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Heart, BookOpen, Network, MoreVertical, Info, Clock, EyeOff } from 'lucide-react';
import BookDetailModal, { AuthenticatedImage } from './BookDetailModal';
import ConfirmDialog from '../common/ConfirmDialog';
import './BookLibrary.css';
import { USER_VIEWER_PREFIX, USER_GRAPH_PREFIX } from '../../utils/common/urlUtils';
import { errorUtils, formatRelativeTime } from '../../utils/common/valueUtils';
import { resolveServerBookId } from '../../utils/common/bookNormalize';
import { HIDE_BOOK_COPY } from '../../utils/libraryUtils';

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
    const { ensureGraphBookCache } = await import('../../utils/graph/graphChapters');
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

function openBookFromLibrary(navigate, book, graphMode) {
  // 책 전체 그래프 빌드를 기다리면 첫 진입이 막힘 — 뷰어는 필요한 챕터를 직접 discover
  void prewarmGraphBookCache(book);
  const base = graphMode === 'graph' ? USER_GRAPH_PREFIX : USER_VIEWER_PREFIX;
  navigate(`${base}/${book.id}`, {
    state: { book, fromLibrary: true, from: { pathname: '/mypage' } },
    replace: false,
  });
}

/** 즐겨찾기 낙관적 갱신: 실패하면 서버 값으로 되돌림 */
function useOptimisticFavorite(book, onToggleFavorite) {
  const [optimistic, setOptimistic] = useState(null);
  const isFavorite = optimistic ?? !!book.isFavorite;

  useEffect(() => {
    setOptimistic(null);
  }, [book.isFavorite]);

  const toggle = async () => {
    if (!onToggleFavorite) return;
    const next = !isFavorite;
    setOptimistic(next);
    try {
      await onToggleFavorite(book.id, next);
    } catch (error) {
      setOptimistic(null);
      errorUtils.logError('BookLibrary', error, { action: 'toggleFavorite', bookId: book.id });
      toast.error('즐겨찾기 변경에 실패했습니다');
    }
  };

  return [isFavorite, toggle];
}

/** 메뉴 바깥 pointerdown·Escape로 닫기 */
function useDismissableMenu(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);
  return ref;
}

/** 클릭이 카드 전체 열기 버튼으로 번지지 않게 */
const stop = (handler) => (e) => {
  e.stopPropagation();
  handler();
};

function FavoriteButton({ active, onToggle }) {
  const label = active ? '즐겨찾기 해제' : '즐겨찾기 추가';
  return (
    <button
      type="button"
      className={`book-favorite-btn ${active ? 'favorited' : ''}`}
      onClick={stop(onToggle)}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Heart
        size={20}
        fill={active ? 'var(--bl-favorite)' : 'none'}
        stroke={active ? 'var(--bl-favorite)' : 'var(--bl-text-faint)'}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}

function BookCover({ src, title }) {
  // 실패한 src만 기억 → src가 바뀌면 자동으로 다시 시도
  const [failedSrc, setFailedSrc] = useState(null);
  if (src && failedSrc !== src) {
    return <AuthenticatedImage src={src} alt={title} className="book-image" onError={() => setFailedSrc(src)} />;
  }
  return <div className="book-image-placeholder">{COVER_PLACEHOLDER_SVG}</div>;
}

function BookContextMenu({ book, open, onToggle, onClose, onDetail, onHide }) {
  const ref = useDismissableMenu(open, onClose);
  return (
    <div className="book-context-menu" ref={ref}>
      <button
        type="button"
        className="book-context-trigger"
        onClick={stop(onToggle)}
        title="더보기"
        aria-label={`${book.title} 더보기`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical size={20} aria-hidden />
      </button>

      {open && (
        <div className="book-context-dropdown" role="menu">
          <button type="button" className="book-context-item" role="menuitem" onClick={stop(onDetail)}>
            <Info size={18} className="book-context-icon" aria-hidden />
            상세 정보
          </button>
          <button
            type="button"
            className="book-context-item book-context-item-danger"
            role="menuitem"
            onClick={stop(() => {
              onClose();
              onHide();
            })}
          >
            <EyeOff size={18} className="book-context-icon" aria-hidden />
            서재에서 숨기기
          </button>
        </div>
      )}
    </div>
  );
}

const BookCard = memo(({ book, onToggleFavorite, onOpenBook, onBookDetailClick, onShowDeleteModal, viewMode = 'grid' }) => {
  const [isFavorite, toggleFavorite] = useOptimisticFavorite(book, onToggleFavorite);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const isList = viewMode === 'list';
  const hasProgress = book.progress > 0;
  const openReader = () => onOpenBook(book, 'viewer');

  return (
    <div className={`book-card${isList ? ' list-view' : ''}`} onMouseLeave={closeMenu}>
      <button type="button" className="book-card-open" onClick={openReader} aria-label={`${book.title} 읽기`} />
      <FavoriteButton active={isFavorite} onToggle={toggleFavorite} />

      <div className="book-card-header">
        <div className="book-image-container">
          <BookCover src={book.coverImgUrl} title={book.title} />
        </div>

        {!isList && hasProgress && (
          <div className="book-progress-container">
            <div className="progress-label">
              <span>독서 진행률</span>
              <span>{book.progress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${book.progress}%` }} />
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
          {isList && hasProgress && (
            <span className="book-meta-item book-progress-meta" title={`독서 진행률 ${book.progress}%`}>
              {book.progress}% 읽음
            </span>
          )}
          {book.updatedAt && (
            <span className="book-meta-item">
              <Clock size={14} aria-hidden />
              {formatRelativeTime(book.updatedAt, { withTime: false })}
            </span>
          )}
        </div>
      </div>

      <div className="book-card-actions">
        <button
          type="button"
          className="book-action-btn book-action-primary"
          onClick={stop(openReader)}
          title="책 읽기"
          aria-label={`${book.title} 읽기`}
        >
          <BookOpen size={16} className="book-action-icon" aria-hidden />
          읽기
        </button>
        <button
          type="button"
          className="book-action-btn book-action-secondary"
          onClick={stop(() => onOpenBook(book, 'graph'))}
          title="인물 관계도 보기"
          aria-label={`${book.title} 인물 관계도 보기`}
        >
          <Network size={16} className="book-action-icon" aria-hidden />
          관계도
        </button>
      </div>

      <BookContextMenu
        book={book}
        open={menuOpen}
        onToggle={() => setMenuOpen((v) => !v)}
        onClose={closeMenu}
        onDetail={() => onBookDetailClick(book)}
        onHide={() => onShowDeleteModal(book)}
      />
    </div>
  );
});

BookCard.displayName = 'BookCard';

const PREWARM_CONCURRENCY = 3;

/** 서재 책들의 그래프 캐시를 동시 3개씩 미리 준비. 책 목록(id)이 바뀌면 이전 작업 중단 */
function useGraphCachePrewarm(books) {
  const numericBookIdsKey = useMemo(
    () => (Array.isArray(books) ? books : [])
      .map((book) => resolveServerBookId(book))
      .filter((id) => Number.isFinite(id))
      .join(','),
    [books],
  );

  useEffect(() => {
    const numericBooks = (Array.isArray(books) ? books : [])
      .filter((book) => Number.isFinite(resolveServerBookId(book)));
    if (numericBooks.length === 0) return undefined;

    const abortController = new AbortController();
    let cursor = 0;
    const runNext = async () => {
      while (cursor < numericBooks.length && !abortController.signal.aborted) {
        const book = numericBooks[cursor];
        cursor += 1;
        await prewarmGraphBookCache(book, { signal: abortController.signal });
      }
    };
    void Promise.all(Array.from({ length: Math.min(PREWARM_CONCURRENCY, numericBooks.length) }, runNext));

    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- numericBookIdsKey가 books의 안정적인 식별자
  }, [numericBookIdsKey]);
}

/** 서버 삭제 API가 없어 이 기기의 목록에서만 숨긴다 — 되돌리기 토스트로 실수 복구 */
function useHideBook(onBookDelete, onBookRestore) {
  return useCallback(
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
}

const BookLibrary = memo(({ books, onToggleFavorite, onBookDelete, onBookRestore, viewMode = 'grid' }) => {
  const navigate = useNavigate();
  const [selectedBook, setSelectedBook] = useState(null);
  const [deleteTargetBook, setDeleteTargetBook] = useState(null);
  const hideBook = useHideBook(onBookDelete, onBookRestore);
  useGraphCachePrewarm(books);

  // 목록이 갱신되면 열린 상세 모달의 책도 최신 값으로
  useEffect(() => {
    if (!selectedBook?.id) return;
    const next = books.find((b) => String(b.id) === String(selectedBook.id));
    if (next && !isSameBookContent(next, selectedBook)) setSelectedBook(next);
  }, [books, selectedBook]);

  const handleOpenBook = useCallback(
    (book, graphMode) => openBookFromLibrary(navigate, book, graphMode),
    [navigate]
  );
  const closeDetail = useCallback(() => setSelectedBook(null), []);
  const closeDeleteConfirm = useCallback(() => setDeleteTargetBook(null), []);

  const handleDeleteConfirm = useCallback(async () => {
    const bookId = deleteTargetBook?.id;
    if (!bookId) return;
    setDeleteTargetBook(null);
    try {
      await hideBook(bookId);
    } catch (err) {
      errorUtils.logError('BookLibrary', err, { action: 'hideBook' });
      toast.error(HIDE_BOOK_COPY.failed);
    }
  }, [deleteTargetBook, hideBook]);

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
          onBookDetailClick={setSelectedBook}
          onShowDeleteModal={setDeleteTargetBook}
          viewMode={viewMode}
        />
      ))}

      <BookDetailModal
        book={selectedBook}
        isOpen={selectedBook != null}
        onClose={closeDetail}
        onDelete={hideBook}
        viewMode={viewMode}
      />

      <ConfirmDialog
        isOpen={deleteTargetBook != null}
        onClose={closeDeleteConfirm}
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

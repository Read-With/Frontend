import { useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { Book, Plus, Library, Heart, AlertCircle, Grid3X3, List, Upload, LogOut } from 'lucide-react';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/bookHooks';
import useAuth from '../hooks/useAuth';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { onActivationKey } from '../utils/common/domUtils';
import { EPUB_FILE_CONSTRAINTS } from '../utils/libraryUtils';
import { compareLocale } from '../utils/common/valueUtils';
import './MyPage.css';

const MAX_EPUB_MB = Math.round(EPUB_FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024));

const SORT_OPTIONS = [
  { value: 'recent', label: '최근 추가순' },
  { value: 'title', label: '제목순' },
  { value: 'author', label: '저자순' },
  { value: 'progress', label: '진행률 높은 순' },
  { value: 'lastRead', label: '최근 읽은 순' },
];

function HeaderBrand({ userName = null }) {
  return (
    <div className="header-brand">
      <div className="header-brand-icon" aria-hidden>
        <Book size={22} strokeWidth={2} />
      </div>
      <span className="header-brand-text" lang="en">ReadWith</span>
      {userName != null && (
        <>
          <span className="header-brand-separator">:</span>
          <span className="header-user-name">{userName}</span>
        </>
      )}
    </div>
  );
}

function Header({ displayName }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogoutConfirm = async () => {
    setLoggingOut(true);
    await logout(); // 실패해도 throw하지 않고 로컬 인증만 정리
    navigate('/');
  };

  return (
    <div className="user-topbar">
      <div className="user-topbar-left">
        <HeaderBrand userName={displayName} />
      </div>

      <div className="user-topbar-right">
        <button type="button" className="user-topbar-logout" onClick={() => setShowLogoutConfirm(true)}>
          <LogOut size={16} strokeWidth={2} />
          <span>로그아웃</span>
        </button>
      </div>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="로그아웃"
        message="정말 로그아웃 하시겠습니까?"
        confirmLabel="로그아웃"
        busy={loggingOut}
        onConfirm={handleLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}

const toTime = (value) => new Date(value).getTime();

/** 정렬 기준별 키 추출·비교. 키는 책마다 한 번만 계산 (비교마다 Date 생성 → O(N log N)회 → O(N)회) */
const BOOK_SORTERS = {
  title: { key: (b) => b.title, compare: compareLocale },
  author: { key: (b) => b.author, compare: compareLocale },
  progress: { key: (b) => b.progress || 0, compare: (a, b) => b - a },
  lastRead: { key: (b) => toTime(b.lastReadAt || b.updatedAt), compare: (a, b) => b - a },
  recent: { key: (b) => toTime(b.updatedAt), compare: (a, b) => b - a },
};

function sortBooks(books, sortBy) {
  const { key, compare } = BOOK_SORTERS[sortBy] ?? BOOK_SORTERS.recent;
  return books
    .map((book) => ({ book, k: key(book) }))
    .sort((a, b) => compare(a.k, b.k))
    .map(({ book }) => book);
}

export default function MyPage() {
  const navigate = useNavigate();
  const { books, loading, error, needsAuth, refetch, addBook, toggleFavorite, removeBook, restoreBook } = useBooks();
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const isSearching = searchQuery !== '';
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid');

  const openUpload = useCallback(() => setShowUpload(true), []);

  const handleSearch = useCallback(() => {
    const term = searchInput.trim();
    if (!term) return;
    setSearchQuery(term);
  }, [searchInput]);

  const handleShowAll = useCallback(() => {
    setSearchQuery('');
    setSearchInput('');
  }, []);

  const displayName = user?.name || '사용자';

  useEffect(() => {
    if (!needsAuth) return;
    toast.info('로그인이 만료되었습니다. 다시 로그인해 주세요.', { toastId: 'auth-expired' });
    navigate('/', { replace: true });
  }, [needsAuth, navigate]);

  const stats = useMemo(() => {
    const list = books || [];
    return {
      total: list.length,
      favorites: list.filter((book) => book.isFavorite).length,
    };
  }, [books]);

  const filteredBooks = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = (books || []).filter(
      (book) =>
        (activeTab !== 'favorites' || book.isFavorite) &&
        (!q || book.title.toLowerCase().includes(q) || book.author.toLowerCase().includes(q))
    );
    return sortBooks(filtered, sortBy);
  }, [books, activeTab, searchQuery, sortBy]);

  const isLibraryEmpty =
    !loading && !error && books.length === 0 && activeTab === 'all' && !isSearching;

  const renderEmptyWelcome = (icon, title, description, extra = null) => (
    <div className="empty-welcome">
      <div
        className={`empty-welcome-content${extra ? '' : ' empty-welcome-content--text-only'}`}
      >
        <div className="empty-welcome-info">
          <div className="empty-welcome-icon">{icon}</div>
          <h2 className="empty-welcome-title">{title}</h2>
          <p className="empty-welcome-description">{description}</p>
        </div>
        {extra}
      </div>
    </div>
  );

  return (
    <>
      <Header displayName={displayName} />
      <div className="mypage-root">
        <div className="mypage-main">
          <section className="hero-banner">
            <div className="hero-content">
              <div className="hero-left">
                <h1 className="hero-title" lang="en">
                  ReadWith
                </h1>
                <p className="hero-subtitle">안녕하세요, {displayName}님!</p>
                <p className="hero-description">
                  모든 독서의 순간이 쌓여, 당신만의 이야기가 됩니다.
                </p>
              </div>
            </div>
          </section>

          <div className="content-container">
            <div className="tabs-container">
              <nav className="tabs-nav">
                <button
                  type="button"
                  className={`tab-button${activeTab === 'all' ? ' active' : ''}`}
                  onClick={() => setActiveTab('all')}
                >
                  전체 도서
                  <span className="tab-badge">{stats.total}</span>
                </button>
                <button
                  type="button"
                  className={`tab-button${activeTab === 'favorites' ? ' active' : ''}`}
                  onClick={() => setActiveTab('favorites')}
                  aria-label={`즐겨찾기${stats.favorites > 0 ? `, ${stats.favorites}권` : ''}`}
                >
                  <Heart size={16} strokeWidth={2} aria-hidden />
                  즐겨찾기
                  {stats.favorites > 0 && (
                    <span className="tab-badge">{stats.favorites}</span>
                  )}
                </button>
              </nav>

              {books.length > 0 && (
                <div className="search-filter-bar">
                  <div className="search-input-wrapper">
                    <input
                      type="text"
                      className="search-input"
                      placeholder="책 제목이나 저자로 검색하세요..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSearch();
                      }}
                    />
                    {isSearching ? (
                      <button
                        type="button"
                        className="search-button show-all-button"
                        onClick={handleShowAll}
                      >
                        전체보기
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="search-button"
                        onClick={handleSearch}
                        disabled={!searchInput.trim()}
                      >
                        검색
                      </button>
                    )}
                  </div>

                  <div className="filter-controls">
                    <select
                      className="filter-select"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    <div className="view-toggle" role="group" aria-label="보기 방식">
                      <button
                        type="button"
                        className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`}
                        onClick={() => setViewMode('grid')}
                        title="그리드 뷰"
                        aria-label="그리드 뷰"
                        aria-pressed={viewMode === 'grid'}
                      >
                        <Grid3X3 size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
                        onClick={() => setViewMode('list')}
                        title="리스트 뷰"
                        aria-label="리스트 뷰"
                        aria-pressed={viewMode === 'list'}
                      >
                        <List size={18} aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="books-grid-section">
                {loading ? (
                  <div className="loading-container">
                    <Library size={48} strokeWidth={1.5} className="loading-icon" />
                    <div className="loading-text">책 목록을 불러오는 중...</div>
                  </div>
                ) : error ? (
                  <div className="error-container">
                    <AlertCircle size={32} strokeWidth={2} className="error-icon" />
                    <div className="error-message">{error}</div>
                    {refetch && (
                      <button type="button" className="retry-button" onClick={refetch}>
                        다시 시도
                      </button>
                    )}
                  </div>
                ) : isLibraryEmpty ? (
                  renderEmptyWelcome(
                    <Library size={48} strokeWidth={1.5} />,
                    '내 서재가 비어 있어요',
                    <>
                      EPUB 파일을 업로드하면 XHTML 뷰어에서 바로 읽고,
                      <br />
                      인물 관계도도 함께 확인할 수 있어요.
                    </>,
                    <div
                      className="epub-dropzone empty-welcome-upload"
                      onClick={openUpload}
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivationKey(openUpload)}
                    >
                      <div className="epub-dropzone-icon" aria-hidden>
                        <Upload size={32} strokeWidth={1.5} />
                      </div>
                      <strong>EPUB 파일 업로드</strong>
                      <span>파일을 드래그하거나 클릭하세요</span>
                      <small>최대 {MAX_EPUB_MB}MB · .epub</small>
                    </div>
                  )
                ) : filteredBooks.length === 0 ? (
                  renderEmptyWelcome(
                    isSearching ? (
                      <Library size={48} strokeWidth={1.5} />
                    ) : (
                      <Heart size={48} strokeWidth={1.5} />
                    ),
                    isSearching ? '검색 결과가 없습니다' : '즐겨찾기한 책이 없어요',
                    isSearching
                      ? `"${searchQuery}"에 대한 검색 결과가 없습니다. 다른 키워드로 검색해보세요.`
                      : '책 카드의 하트를 눌러 추가할 수 있어요.'
                  )
                ) : (
                  <div
                    className={`books-grid ${viewMode === 'list' ? 'list-view' : 'grid-view'}`}
                  >
                    <BookLibrary
                      books={filteredBooks}
                      onToggleFavorite={toggleFavorite}
                      onBookDelete={removeBook}
                      onBookRestore={restoreBook}
                      viewMode={viewMode}
                    />
                    <button
                      type="button"
                      className={`add-book-card${viewMode === 'list' ? ' list-view' : ''}`}
                      onClick={openUpload}
                      aria-label="책 추가"
                    >
                      <span className="add-book-card-icon">
                        <Plus size={viewMode === 'list' ? 28 : 36} strokeWidth={2} />
                      </span>
                      <span className="add-book-card-label">책 추가</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {showUpload && (
          <FileUpload
            onUploadSuccess={addBook}
            onClose={() => setShowUpload(false)}
          />
        )}
      </div>
    </>
  );
}

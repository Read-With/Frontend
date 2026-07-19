import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Book, Plus, Library, Heart, AlertCircle, Grid3X3, List, Upload } from 'lucide-react';
import Header from '../components/common/Header';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/books/bookHooks';
import useAuth from '../hooks/auth/useAuth';
import { EPUB_FILE_CONSTRAINTS } from '../utils/library/libraryUtils';
import { READER_PROGRESS_CACHE_PREFIX } from '../utils/common/cache/cacheManager';
import './MyPage.css';

const MAX_EPUB_MB = Math.round(EPUB_FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024));

const SORT_OPTIONS = [
  { value: 'recent', label: '최근 추가순' },
  { value: 'title', label: '제목순' },
  { value: 'author', label: '저자순' },
  { value: 'progress', label: '진행률 높은 순' },
  { value: 'lastRead', label: '최근 읽은 순' },
];

function compareBooks(a, b, sortBy) {
  switch (sortBy) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author':
      return a.author.localeCompare(b.author);
    case 'progress':
      return (b.progress || 0) - (a.progress || 0);
    case 'lastRead': {
      const aTime = new Date(a.lastReadAt || a.updatedAt);
      const bTime = new Date(b.lastReadAt || b.updatedAt);
      return bTime - aTime;
    }
    case 'recent':
    default:
      return new Date(b.updatedAt) - new Date(a.updatedAt);
  }
}

export default function MyPage() {
  const navigate = useNavigate();
  const { books, loading, error, refetch, addBook, toggleFavorite, removeBook } = useBooks();
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid');

  const openUpload = useCallback(() => setShowUpload(true), []);

  const handleSearch = useCallback(() => {
    const term = searchInput.trim();
    if (!term) return;
    setSearchQuery(term);
    setIsSearching(true);
  }, [searchInput]);

  const handleShowAll = useCallback(() => {
    setSearchQuery('');
    setSearchInput('');
    setIsSearching(false);
  }, []);

  const displayName = user?.name || '사용자';

  useEffect(() => {
    if (error && (error.includes('인증이 필요합니다') || error.includes('인증'))) {
      navigate('/', { replace: true });
    }
  }, [error, navigate]);

  const stats = useMemo(() => {
    const list = books || [];
    const total = list.length;
    const favorites = list.filter((book) => book.isFavorite).length;

    const bookIds = new Set();
    for (const book of list) {
      if (book.id != null) bookIds.add(String(book.id));
      if (book._bookId != null) bookIds.add(String(book._bookId));
    }

    let reading = 0;
    try {
      const matched = new Set();
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(READER_PROGRESS_CACHE_PREFIX)) continue;
        const bookId = key.slice(READER_PROGRESS_CACHE_PREFIX.length);
        if (bookId && bookIds.has(bookId)) matched.add(bookId);
      }
      reading = Math.min(matched.size, total);
    } catch {
      /* ignore */
    }

    return { total, reading, favorites };
  }, [books]);

  const filteredBooks = useMemo(() => {
    let filtered = [...(books || [])];

    if (activeTab === 'favorites') {
      filtered = filtered.filter((b) => b.isFavorite);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (book) =>
          book.title.toLowerCase().includes(q) || book.author.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => compareBooks(a, b, sortBy));
    return filtered;
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
      <Header userNickname={displayName} />
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

              <div className="hero-stats">
                <div className="stat-card">
                  <div className="stat-icon-wrapper">
                    <Book className="stat-icon-svg" />
                    <div className="stat-badge">총 {stats.total}권</div>
                  </div>
                  <div className="stat-content">
                    <div className="stat-main">
                      <span className="stat-number">{stats.reading}</span>
                      <span className="stat-label">권 읽는 중</span>
                    </div>
                  </div>
                </div>
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
                >
                  즐겨찾기 ❤️
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

                    <div className="view-toggle">
                      <button
                        type="button"
                        className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`}
                        onClick={() => setViewMode('grid')}
                        title="그리드 뷰"
                      >
                        <Grid3X3 size={18} />
                      </button>
                      <button
                        type="button"
                        className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
                        onClick={() => setViewMode('list')}
                        title="리스트 뷰"
                      >
                        <List size={18} />
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openUpload();
                        }
                      }}
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

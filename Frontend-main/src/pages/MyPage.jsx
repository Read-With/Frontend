import React, { useState, useMemo, useCallback } from 'react';
import { Book, BookOpen, CheckCircle2, Search, Plus, Library, Heart, AlertCircle, Grid3X3, List } from 'lucide-react';
import Header from '../components/common/Header';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/useBooks';
import useAuth from '../hooks/useAuth';
import './MyPage.css';

export default function MyPage() {
  const { books, loading, error, retryFetch, addBook, toggleFavorite, changeBookStatus } = useBooks();
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' 또는 'list'

  const handleUploadSuccess = useCallback((newBook) => {
    addBook(newBook);
    setShowUpload(false);
  }, [addBook]);

  const getDisplayName = useCallback(() => {
    return user?.name || '사용자';
  }, [user?.name]);

  // 통계 계산 - 메모이제이션
  const stats = useMemo(() => {
    const total = books?.length || 0;
    const reading = books?.filter(book => {
      // CFI 정보가 있는 책만 카운트 (읽는 중으로 간주)
      const isLocalBook = typeof book.id === 'string' && book.id.startsWith('local_');
      if (isLocalBook) {
        const filename = book.epubPath || book.filename;
        const lastCFI = localStorage.getItem(`lastCFI_${filename}`);
        return lastCFI && lastCFI.trim() !== '';
      } else {
        // API 책의 경우 progress가 있으면 읽는 중으로 간주
        return book.progress && book.progress > 0;
      }
    }).length || 0;
    
    return {
      total,
      reading
    };
  }, [books]);

  // 탭별 필터링 - 메모이제이션
  const filteredBooks = useMemo(() => {
    let filtered = books || [];

    // 탭 필터링
    if (activeTab === 'favorites') {
      filtered = filtered.filter(b => b.favorite);
    }

    // 검색 필터링
    if (searchQuery) {
      filtered = filtered.filter(book =>
        book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        book.author.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // 정렬
    if (sortBy === 'recent') {
      filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } else if (sortBy === 'title') {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'author') {
      filtered.sort((a, b) => a.author.localeCompare(b.author));
    } else if (sortBy === 'progress') {
      filtered.sort((a, b) => {
        const aProgress = a.progress || 0;
        const bProgress = b.progress || 0;
        return bProgress - aProgress;
      });
    } else if (sortBy === 'lastRead') {
      filtered.sort((a, b) => {
        const aLastRead = a.lastReadAt ? new Date(a.lastReadAt) : new Date(a.updatedAt);
        const bLastRead = b.lastReadAt ? new Date(b.lastReadAt) : new Date(b.updatedAt);
        return bLastRead - aLastRead;
      });
    }

    return filtered;
  }, [books, activeTab, searchQuery, sortBy]);

  return (
    <>
      <style>
        {`
          .mypage-root body {
            overflow: auto !important;
            position: static !important;
          }
          .mypage-root html {
            overflow: auto !important;
          }
        `}
      </style>
      <Header userNickname={getDisplayName()} />
      <div className="mypage-root">
        <div className="mypage-main">
          {/* 히어로 배너 */}
          <section className="hero-banner">
            <div className="hero-content">
              <div className="hero-left">
                <h1 className="hero-title">ReadWith</h1>
                <p className="hero-subtitle">안녕하세요, {getDisplayName()}님!</p>
                <p className="hero-description">
                  모든 독서의 순간이 쌓여, 당신만의 이야기가 됩니다.
                </p>
              </div>

              <div className="hero-stats">
                <div className="stat-card stat-card-total">
                  <div className="stat-icon-wrapper">
                    <Book className="stat-icon-svg" />
                    <div className="stat-badge">
                      총 {stats.total}권
                    </div>
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

          {/* 컨텐츠 영역 */}
          <div className="content-container">
            {/* 탭 네비게이션 */}
            <div className="tabs-container">
              <nav className="tabs-nav">
                <button
                  className={`tab-button ${activeTab === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveTab('all')}
                >
                  전체 도서
                  <span className="tab-badge">{stats.total}</span>
                </button>
                <button
                  className={`tab-button ${activeTab === 'favorites' ? 'active' : ''}`}
                  onClick={() => setActiveTab('favorites')}
                >
                  즐겨찾기 ❤️
                  {stats.favorites > 0 && <span className="tab-badge">{stats.favorites}</span>}
                </button>
              </nav>

              {/* 검색 및 필터 */}
              <div className="search-filter-bar">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="책 제목이나 저자로 검색하세요..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <Search className="search-icon" size={20} />
                </div>
                
                <div className="filter-controls">
                  <select
                    className="filter-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="recent">최근 추가순</option>
                    <option value="title">제목순</option>
                    <option value="author">저자순</option>
                    <option value="progress">진행률 높은 순</option>
                    <option value="lastRead">최근 읽은 순</option>
                  </select>
                  
                  <div className="view-toggle">
                    <button
                      className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                      onClick={() => setViewMode('grid')}
                      title="그리드 뷰"
                    >
                      <Grid3X3 size={18} />
                    </button>
                    <button
                      className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                      onClick={() => setViewMode('list')}
                      title="리스트 뷰"
                    >
                      <List size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 책 목록 */}
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
                    {retryFetch && (
                      <button
                        className="retry-button"
                        onClick={retryFetch}
                      >
                        다시 시도
                      </button>
                    )}
                  </div>
                ) : filteredBooks.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      {activeTab === 'all' ? <Library size={80} strokeWidth={1.5} /> : 
                       <Heart size={80} strokeWidth={1.5} />}
                    </div>
                    <h2 className="empty-title">
                      {activeTab === 'all' ? '아직 책이 없네요!' :
                       activeTab === 'favorites' ? '즐겨찾기한 책이 없어요' :
                       '즐겨찾기한 책이 없어요'}
                    </h2>
                    <p className="empty-description">
                      {activeTab === 'all' 
                        ? '우측 하단의 + 버튼을 눌러서 첫 번째 책을 추가해보세요. EPUB 파일을 업로드하면 바로 읽을 수 있어요!'
                        : activeTab === 'favorites'
                        ? '즐겨찾기한 책이 아직 없어요. 책을 즐겨찾기하면 여기에 표시됩니다.'
                        : searchQuery
                        ? '검색 결과가 없습니다. 다른 키워드로 검색해보세요.'
                        : '해당하는 책이 없습니다.'}
                    </p>
                    {activeTab === 'all' && !searchQuery && (
                      <button
                        className="empty-cta-button"
                        onClick={() => setShowUpload(true)}
                      >
                        첫 번째 책 추가하기
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={`books-grid ${viewMode === 'list' ? 'list-view' : 'grid-view'}`}>
                    <BookLibrary
                      books={filteredBooks}
                      loading={false}
                      error={null}
                      onRetry={retryFetch}
            onToggleFavorite={toggleFavorite}
                      viewMode={viewMode}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 플로팅 업로드 버튼 */}
        <button
          className="floating-upload-btn"
          onClick={() => setShowUpload(true)}
          title="새 책 업로드"
        >
          <Plus size={28} strokeWidth={2.5} />
        </button>

        {/* 업로드 모달 */}
        {showUpload && (
          <FileUpload
            onUploadSuccess={handleUploadSuccess}
            onClose={() => setShowUpload(false)}
          />
        )}
      </div>
    </>
  );
}
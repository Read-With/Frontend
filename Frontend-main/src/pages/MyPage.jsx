import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Book, Plus, Library, Heart, AlertCircle, Grid3X3, List, Upload } from 'lucide-react';
import Header from '../components/common/Header';
import BookLibrary from '../components/library/BookLibrary';
import FileUpload from '../components/library/FileUpload';
import { useBooks } from '../hooks/books/bookHooks';
import useAuth from '../hooks/auth/useAuth';
import { EPUB_FILE_CONSTRAINTS, validateEpubFile } from '../utils/library/libraryUtils';
import './MyPage.css';

export default function MyPage() {
  const navigate = useNavigate();
  const { books, loading, error, retryFetch, addBook, toggleFavorite, removeBook } = useBooks();
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState(''); // 검색 입력 필드용
  const [isSearching, setIsSearching] = useState(false); // 검색 중인지 여부
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' 또는 'list'

  const handleUploadSuccess = useCallback((newBook) => {
    addBook(newBook);
    setShowUpload(false);
    setPendingUploadFile(null);
  }, [addBook]);

  const handleCloseUpload = useCallback(() => {
    setShowUpload(false);
    setPendingUploadFile(null);
  }, []);

  const openUploadWithFile = useCallback((file) => {
    if (!file) {
      setShowUpload(true);
      return;
    }
    const validation = validateEpubFile(file);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }
    setPendingUploadFile(file);
    setShowUpload(true);
  }, []);

  // 검색 실행 함수
  const handleSearch = useCallback(() => {
    if (searchInput.trim()) {
      setSearchQuery(searchInput.trim());
      setIsSearching(true);
    }
  }, [searchInput]);

  // 전체보기로 돌아가기 함수
  const handleShowAll = useCallback(() => {
    setSearchQuery('');
    setSearchInput('');
    setIsSearching(false);
  }, []);

  // Enter 키 이벤트 핸들러
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }, [handleSearch]);


  const displayName = user?.name || '사용자';

  useEffect(() => {
    if (error && (error.includes('인증이 필요합니다') || error.includes('인증'))) {
      navigate('/', { replace: true });
    }
  }, [error, navigate]);

  // 통계 계산 - 메모이제이션 (reader_progress_{bookId} 키 기반)
  const stats = useMemo(() => {
    const total = books?.length || 0;
    
    // localStorage에서 reader_progress_{bookId} 키가 있는 책 찾기
    const bookIds = new Set();
    if (books && Array.isArray(books)) {
      books.forEach(book => {
        if (book.id !== undefined && book.id !== null) {
          bookIds.add(String(book.id));
        }
        if (book._bookId !== undefined && book._bookId !== null) {
          bookIds.add(String(book._bookId));
        }
      });
    }
    
    // localStorage에서 reader_progress_로 시작하는 모든 키 찾기
    let reading = 0;
    try {
      if (typeof localStorage !== 'undefined') {
        const allKeys = Object.keys(localStorage);
        const readerProgressKeys = allKeys.filter(key => key.startsWith('reader_progress_'));
        
        const validBookIds = new Set();
        readerProgressKeys.forEach(key => {
          const bookId = key.replace('reader_progress_', '');
          if (bookId && bookIds.has(bookId)) {
            validBookIds.add(bookId);
          }
        });
        
        reading = validBookIds.size;
      }
    } catch (error) {
      console.warn('읽는 중 책 수 계산 실패:', error);
    }
    
    // 읽는 중 권수가 총 권수를 초과하지 않도록 제한
    const validReading = Math.min(reading, total);
    
    // 즐겨찾기된 책 개수
    const favorites = books?.filter(book => book.isFavorite).length || 0;
    
    return {
      total,
      reading: validReading,
      favorites
    };
  }, [books]);

  // 탭별 필터링 - 메모이제이션
  const filteredBooks = useMemo(() => {
    let filtered = [...(books || [])];

    // 탭 필터링
    if (activeTab === 'favorites') {
      filtered = filtered.filter(b => b.isFavorite);
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

  const isLibraryEmpty =
    !loading && !error && books.length === 0 && activeTab === 'all' && !isSearching;

  return (
    <>
      <Header userNickname={displayName} />
      <div className="mypage-root">
        <div className="mypage-main">
          {/* 히어로 배너 */}
          <section className="hero-banner">
            <div className="hero-content">
              <div className="hero-left">
                <h1 className="hero-title" lang="en">ReadWith</h1>
                <p className="hero-subtitle">안녕하세요, {displayName}님!</p>
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
              {books.length > 0 && (
              <div className="search-filter-bar">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="책 제목이나 저자로 검색하세요..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                  />
                  {!isSearching ? (
                    <button
                      className="search-button"
                      onClick={handleSearch}
                      disabled={!searchInput.trim()}
                    >
                      검색
                    </button>
                  ) : (
                    <button
                      className="search-button show-all-button"
                      onClick={handleShowAll}
                    >
                      전체보기
                    </button>
                  )}
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
              )}

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
                ) : isLibraryEmpty ? (
                  <div className="empty-welcome">
                    <div className="empty-welcome-content">
                      <div className="empty-welcome-info">
                        <div className="empty-welcome-icon">
                          <Library size={48} strokeWidth={1.5} />
                        </div>
                        <h2 className="empty-welcome-title">내 서재가 비어 있어요</h2>
                        <p className="empty-welcome-description">
                          EPUB 파일을 업로드하면 XHTML 뷰어에서 바로 읽고,
                          <br />
                          인물 관계도도 함께 확인할 수 있어요.
                        </p>
                      </div>
                      <div
                        className="empty-welcome-upload"
                        onClick={() => openUploadWithFile(null)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openUploadWithFile(null);
                          }
                        }}
                      >
                        <div className="empty-welcome-upload-icon">
                          <Upload size={32} strokeWidth={1.5} />
                        </div>
                        <strong>EPUB 파일 업로드</strong>
                        <span>파일을 드래그하거나 클릭하세요</span>
                        <small>
                          최대 {Math.round(EPUB_FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024))}MB · .epub
                        </small>
                      </div>
                    </div>
                  </div>
                ) : filteredBooks.length === 0 ? (
                  <div className="empty-welcome">
                    <div className="empty-welcome-content empty-welcome-content--text-only">
                      <div className="empty-welcome-info">
                        <div className="empty-welcome-icon">
                          {isSearching
                            ? <Library size={48} strokeWidth={1.5} />
                            : <Heart size={48} strokeWidth={1.5} />}
                        </div>
                        <h2 className="empty-welcome-title">
                          {isSearching ? '검색 결과가 없습니다' : '즐겨찾기한 책이 없어요'}
                        </h2>
                        <p className="empty-welcome-description">
                          {isSearching
                            ? `"${searchQuery}"에 대한 검색 결과가 없습니다. 다른 키워드로 검색해보세요.`
                            : '책 카드의 하트를 눌러 추가할 수 있어요.'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`books-grid ${viewMode === 'list' ? 'list-view' : 'grid-view'}`}>
                    <BookLibrary
                      books={filteredBooks}
                      onToggleFavorite={toggleFavorite}
                      onBookDelete={removeBook}
                      viewMode={viewMode}
                    />
                    <button
                      type="button"
                      className={`add-book-card${viewMode === 'list' ? ' list-view' : ''}`}
                      onClick={() => openUploadWithFile(null)}
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
            initialFile={pendingUploadFile}
            onUploadSuccess={handleUploadSuccess}
            onClose={handleCloseUpload}
          />
        )}
      </div>
    </>
  );
}

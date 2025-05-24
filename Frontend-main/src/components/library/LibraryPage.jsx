import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../common/Header';
import UserProfile from '../common/UserProfile';
import './LibraryPage.css';
import { FaStar, FaRegStar } from 'react-icons/fa';
import { FaSortAlphaDown, FaRegClock, FaSortAmountDown } from 'react-icons/fa';

const getFavorites = () => {
  try {
    return JSON.parse(localStorage.getItem('favoriteBooks') || '[]');
  } catch {
    return [];
  }
};
const setFavorites = (arr) => {
  localStorage.setItem('favoriteBooks', JSON.stringify(arr));
};

const sortBooks = (books, sort) => {
  if (sort === 'title') {
    return [...books].sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === 'recent') {
    return [...books].sort((a, b) => new Date(b.lastRead || 0) - new Date(a.lastRead || 0));
  } else if (sort === 'uploaded') {
    return [...books].sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  }
  return books;
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}`;
}

const getProgress = (book) => {
  // 예시: localStorage에서 진척도(%) 불러오기
  const progress = localStorage.getItem(`progress_${book.filename}`);
  return progress ? parseInt(progress, 10) : 0;
};

const LibraryPage = () => {
  const [books, setBooks] = useState([]);
  const [sort, setSort] = useState('title');
  const [showFav, setShowFav] = useState(false);
  const [favorites, setFavoritesState] = useState(getFavorites());
  const navigate = useNavigate();
  
  useEffect(() => {
    fetch('/books.json')
      .then(res => res.json())
      .then(setBooks);
  }, []);

  const handleSelect = (book) => {
    // 최근 읽은 날짜 갱신
    const updatedBooks = books.map(b => b.filename === book.filename ? { ...b, lastRead: new Date().toISOString() } : b);
    setBooks(updatedBooks);
    navigate(`/viewer/${encodeURIComponent(book.filename)}`, { state: { book } });
  };

  const handleToggleFavorite = (filename) => {
    let newFav;
    if (favorites.includes(filename)) {
      newFav = favorites.filter(f => f !== filename);
    } else {
      newFav = [...favorites, filename];
    }
    setFavoritesState(newFav);
    setFavorites(newFav);
  };

  const handleProgressClick = (book) => {
    // 진척도 위치로 이동 (예시: cfi 정보가 있다면 전달)
    navigate(`/viewer/${encodeURIComponent(book.filename)}`, { state: { book, goToLast: true } });
  };

  const filteredBooks = showFav ? books.filter(b => favorites.includes(b.filename)) : books;
  const sortedBooks = sortBooks(filteredBooks, sort);

  return (
    <div className="library-root">
      {/* Top Bar - 항상 고정 */}
      <Header userNickname="user Nickname" />
      {/* Main Content */}
      <div className="library-main">
        {/* UserProfile 컴포넌트 추가 */}
        <UserProfile userNickname="User's Nickname" onLogout={() => alert('로그아웃')} />
        
        {/* 라이브러리 헤더 섹션 */}
        <div className="library-header-section">
        <div className="library-title">나의 서재</div>
        <div className="library-controls">
          <div className="library-sort-dropdown">
            <select value={sort} onChange={e => setSort(e.target.value)} className="library-sort-select">
              <option value="title">제목순</option>
              <option value="recent">최근 읽은 순</option>
              <option value="uploaded">업로드순</option>
            </select>
          </div>
          <button className={`library-fav-toggle${showFav ? ' active' : ''}`} onClick={() => setShowFav(v => !v)}>
            즐겨찾기만 보기
          </button>
        </div>
      </div>
        
        {/* 책 목록 섹션 */}
        <div className="library-books-section">
          {sortedBooks.length === 0 ? (
        <div className="library-empty">
          {showFav ? '즐겨찾기한 책이 없습니다.' : '책이 없습니다.'}
        </div>
          ) : (
      <div className="library-grid">
        {sortedBooks.map((book, idx) => {
          const progress = getProgress(book);
          return (
            <div
              className="library-card enhanced"
              key={idx}
              onClick={e => {
                // 진척도 바 클릭 시만 이동, 별 클릭 시 제외
                if (e.target.className && e.target.className.includes('library-progress-bar')) {
                  handleProgressClick(book);
                } else if (e.target.className && e.target.className.includes('library-fav-star')) {
                  handleToggleFavorite(book.filename);
                } else {
                  handleSelect(book);
                }
              }}
            >
              <img
                className="library-cover large"
                src={book.cover}
                alt={book.title}
              />
              <div className="library-card-content info-card">
                <div className="library-book-title">{book.title}</div>
                <div className="library-book-meta">
                  {book.author && <span>{book.author}</span>}
                  {book.lastRead && (
                    <span style={{ fontSize: '0.93em', color: '#bfc8e6', marginLeft: '0.7em' }}>
                      최근 읽음: {formatDate(book.lastRead)}
                    </span>
                  )}
                </div>
                <div className="library-progress-row">
                  <div
                    className="library-progress-bar"
                    title="진척도 클릭 시 이어서 읽기"
                    style={{ width: '70%', cursor: 'pointer' }}
                  >
                    <div className="progress-bg">
                      <div className="progress-fg" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="progress-label">{progress}%</span>
                  </div>
                  <span
                    className="library-fav-star"
                    title={favorites.includes(book.filename) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                    style={{ color: favorites.includes(book.filename) ? '#FFD600' : '#bfc8e6', fontSize: '1.7rem', marginLeft: 'auto', cursor: 'pointer' }}
                    onClick={e => { e.stopPropagation(); handleToggleFavorite(book.filename); }}
                  >
                    {favorites.includes(book.filename) ? <FaStar /> : <FaRegStar />}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryPage; 
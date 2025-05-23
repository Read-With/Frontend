import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/common/Header';
import UserProfile from '../components/common/UserProfile';
import './UserPage.css';

const books = [
  {
    genre: 'Mystery',
    title: 'Mystery at the Manor',
    author: 'John Smith',
    desc: 'Mystery Novel',
  },
  {
    genre: 'Romance',
    title: 'Love in Times of War',
    author: 'Mary Johnson',
    desc: 'Romance Novel',
  },
  {
    genre: 'Fantasy',
    title: 'Realm of the Forgotten',
    author: 'Alex Lee',
    desc: 'Fantasy Novel',
  },
  {
    genre: 'Sci-Fi',
    title: 'Beyond the Stars',
    author: 'Sarah Wilson',
    desc: 'Science Fiction',
  },
  {
    genre: 'Thriller',
    title: 'Silent Whispers',
    author: 'Michael Brown',
    desc: 'Thriller Novel',
  },
  {
    genre: 'History',
    title: 'Ancient Civilizations',
    author: 'David Thompson',
    desc: 'Historical Book',
  },
];

const UserPage = () => {
  const footerRef = useRef(null);
  const navigate = useNavigate();
  
  // 로그아웃 핸들러
  const handleLogout = () => {
    // 로그아웃 로직 구현
    console.log('로그아웃 처리');
    // navigate('/login'); // 로그인 페이지로 이동
  };

  // 라이브러리 페이지로 이동하는 함수
  const handleGoToLibrary = () => {
    navigate('/user/library');
  };

  return (
    <div className="user-root">
      {/* Top Bar - 항상 고정 */}
      <Header userNickname="user Nickname" />
      {/* Main Content */}
      <div className="user-main">
        {/* 유저 정보 섹션 - 컴포넌트로 대체 */}
        <UserProfile 
          userNickname="User's Nickname"
          onLogout={handleLogout}
        />
        {/* 라이브러리 섹션 */}
        <div className="user-library-section">
          <div className="user-library-container">
            <div className="user-library-title">Library : Books in one space</div>
            <div className="user-library-desc">모든 책을 한 곳에서 관리하세요.</div>
            <button className="user-btn-primary" onClick={handleGoToLibrary}>모든 책 보기</button>
          </div>
          <div className="user-library-list">
            {/* 첫 번째 행 */}
            <div className="user-library-row">
              {books.slice(0, 3).map((book, idx) => (
                <div className="user-library-card" key={idx} style={{ flex: '0 0 32%' }}>
                  <div className="user-library-image-container">
                    <div className="user-library-image" />
                    <div className="user-library-tag">{book.genre}</div>
                  </div>
                  <div className="user-library-text-content">
                    <div className="user-library-card-title">{book.desc}</div>
                    <div className="user-library-card-subtitle">{book.title}<br/>Author: {book.author}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* 두 번째 행 */}
            <div className="user-library-row">
              {books.slice(3, 6).map((book, idx) => (
                <div className="user-library-card" key={idx + 3} style={{ flex: '0 0 32%' }}>
                  <div className="user-library-image-container">
                    <div className="user-library-image" />
                    <div className="user-library-tag">{book.genre}</div>
                  </div>
                  <div className="user-library-text-content">
                    <div className="user-library-card-title">{book.desc}</div>
                    <div className="user-library-card-subtitle">{book.title}<br/>Author: {book.author}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* 푸터 - ref 추가 */}
        <div ref={footerRef} className="user-footer">
          <div className="user-footer-link">Privacy Policy</div>
          <div className="user-footer-link">Terms of Service</div>
          <div className="user-footer-link">Help Center</div>
          <div className="user-footer-link">Contact Us</div>
        </div>
      </div>
    </div>
  );
};

export default UserPage; 
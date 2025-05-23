import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/common/Header';
import UserProfile from '../components/common/UserProfile';
import './LibraryPage.css';

// 임시 도서 데이터 - public 폴더의 epub 파일 참조
const books = [
  {
    id: 1,
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    cover: '/images/gatsby.jpg',
    genre: 'Classic',
    filename: 'gatsby.epub'  // 파일명만 저장 (public 폴더 루트에 있는 파일)
  },
  {
    id: 2,
    title: 'To Kill a Mockingbird',
    author: 'Harper Lee',
    cover: '/images/mockingbird.jpg',
    genre: 'Fiction',
    filename: 'mockingbird.epub'  // 파일명만 저장 (public 폴더 루트에 있는 파일)
  },
  {
    id: 3,
    title: '1984',
    author: 'George Orwell',
    cover: '/images/1984.jpg',
    genre: 'Dystopian',
    filename: '1984.epub'  // 파일명만 저장 (public 폴더 루트에 있는 파일)
  }
];

const LibraryPage = () => {
  const [library, setLibrary] = useState(books);
  const navigate = useNavigate();
  
  // 로그아웃 핸들러
  const handleLogout = () => {
    // 로그아웃 로직 구현
    console.log('로그아웃 처리');
    // navigate('/login'); // 로그인 페이지로 이동
  };

  // 책 읽기 버튼 핸들러
  const handleReadBook = (book) => {
    // 책 정보와 함께 뷰어 페이지로 이동
    // 파일명만 URL에 포함하고, 전체 경로는 state로 전달
    const bookData = {
      ...book,
      path: `/${book.filename}` // public 폴더 루트 경로 지정
    };
    
    console.log('뷰어로 이동:', bookData);
    navigate(`/user/viewer/${book.filename}`, { state: { book: bookData } });
  };

  // 관계 보기 버튼 핸들러
  const handleViewGraph = (book) => {
    // 파일명에서 경로 제거하고 순수 파일명만 추출
    const cleanFilename = book.filename;
    // 랜덤으로 그래프 또는 챗봇 페이지로 이동
    const isGraph = Math.random() > 0.5;
    
    // 책 정보와 함께 페이지로 이동
    const bookData = {
      ...book,
      path: `/${book.filename}` // public 폴더 루트 경로 지정
    };
    
    if (isGraph) {
      navigate(`/user/graph/${cleanFilename}`, { state: { book: bookData } });
    } else {
      navigate(`/user/chatbot/${cleanFilename}`, { state: { book: bookData } });
    }
  };

  return (
    <div className="library-root">
      {/* Top Bar - 항상 고정 */}
      <Header userNickname="User Nickname" />
      {/* Main Content */}
      <div className="library-main">
        {/* 유저 정보 섹션 - 컴포넌트로 대체 */}
        <UserProfile 
          userNickname="User's Nickname"
          onLogout={handleLogout}
        />
        
        {/* 라이브러리 섹션 */}
        <div className="library-content-section">
          <div className="library-header">
            <h1 className="library-title">나의 서재</h1>
            <p className="library-description">내 라이브러리에 있는 모든 책을 확인하세요.</p>
          </div>
          
          <div className="library-books">
            {library.map(book => (
              <div key={book.id} className="library-book-card">
                <div className="library-book-cover">
                  <img src={book.cover} alt={book.title} />
                  <div className="library-book-genre">{book.genre}</div>
                </div>
                <div className="library-book-info">
                  <h3 className="library-book-title">{book.title}</h3>
                  <p className="library-book-author">{book.author}</p>
                  <div className="library-book-buttons">
                    <button 
                      className="library-book-button read-button"
                      onClick={() => handleReadBook(book)}
                    >
                      📖 읽기
                    </button>
                    <button 
                      className="library-book-button graph-button"
                      onClick={() => handleViewGraph(book)}
                    >
                      🔍 관계 보기
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LibraryPage; 
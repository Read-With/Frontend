import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, useParams } from 'react-router-dom';
import MainPage from './components/main/MainPage';
import LibraryPage from './pages/LibraryPage';
import ViewerPage from './components/viewer/ViewerPage';
import BookmarksPage from './components/viewer/BookmarksPage';
import RelationGraphWrapper from './components/graph/RelationGraphWrapper.jsx';
import TimelineView from './components/viewer/timeline/TimelineView';
import UploadPage from './pages/UploadPage';
import ChatbotPage from './components/chatbot/ChatbotPage';
import LoginPage from './pages/LoginPage';
import UserPage from './pages/UserPage';

// 본 프로젝트의 모든 주요 페이지는 반응형 웹앱(미디어 쿼리 적용)으로 구성되어 있습니다.

const AppContent = () => {
  const location = useLocation();
  // '/viewer' 또는 '/graph'로 시작하는 모든 페이지에서 Header 숨김
  // const hideHeader = location.pathname.startsWith('/viewer') || location.pathname.startsWith('/graph');

  return (
    <>
      {/* {!hideHeader && <Header />} */}

      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/signup" element={<DummyPage title="회원가입" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/user/myPage" element={<UserPage />} />
        <Route path="/user/upload" element={<UploadPage />} />
        <Route path="/user/library" element={<LibraryPage />} />
        <Route path="/search" element={<DummyPage title="책 검색" />} />
        <Route path="/viewer/:filename/*" element={<ViewerPage />} />
        <Route path="/viewer/:filename/bookmarks" element={<BookmarksPage />} />
        <Route path="/viewer/:filename/timeline" element={<TimelineView />} />
        <Route path="/viewer/:filename/relations" element={<RelationRedirect />} />
        
        {/* 새로 추가된 경로 */}
        <Route path="/user/viewer/:filename" element={<ViewerPage />} />
        <Route path="/user/graph/:filename" element={<RelationGraphWrapper />} />
        <Route path="/user/chatbot/:filename" element={<ChatbotPage />} />
        <Route path="/user/character-chat/:filename/:characterName" element={<ChatbotPage />} />
      </Routes>
    </>
  );
};

// :filename을 실제 파일명으로 치환해주는 래퍼 컴포넌트
function RelationRedirect() {
  const { filename } = useParams();
  return <Navigate to={`/user/graph/${filename}`} replace />;
}

const DummyPage = ({ title }) => (
  <div style={{ padding: '100px 0', textAlign: 'center', fontSize: 32 }}>{title} (준비중)</div>
);

const App = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;

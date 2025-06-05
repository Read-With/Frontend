import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, useParams, Outlet } from 'react-router-dom';
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
import { RecoilRoot } from 'recoil';
import CytoscapeGraphPortalProvider from './components/graph/CytoscapeGraphPortalProvider';

// 그래프 컴포넌트를 유지하는 레이아웃
const GraphLayout = () => {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Outlet />
    </div>
  );
};

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
        {/* /user/viewer/:filename 경로는 GraphLayout으로 감싸지 않고 ViewerPage만 렌더링 */}
        <Route path="/user/viewer/:filename" element={<ViewerPage />} />
        {/* 그래프 단독 페이지만 GraphLayout으로 감싸서 RelationGraphWrapper 렌더링 */}
        <Route element={<GraphLayout />}>
          <Route path="/user/graph/:filename" element={<RelationGraphWrapper />} />
          <Route path="/user/chatbot/:filename" element={<ChatbotPage />} />
          <Route path="/user/character-chat/:filename/:characterName" element={<ChatbotPage />} />
        </Route>
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
    <RecoilRoot>
      <Router>
        <AppContent />
      </Router>
    </RecoilRoot>
  );
};

export default App;

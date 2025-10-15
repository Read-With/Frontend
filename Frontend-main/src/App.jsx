import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, useParams, Outlet } from 'react-router-dom';
import ViewerPage from './components/viewer/ViewerPage';
import BookmarksPage from './components/viewer/bookmark/BookmarksPage';
import RelationGraphWrapper from './components/graph/RelationGraphWrapper';
import MyPage from './pages/MyPage';
import { RecoilRoot } from 'recoil';
import HomePage from './pages/HomePage';
import AdminPage from './pages/AdminPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OAuthCallback from './components/auth/OAuthCallback';

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

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/mypage" element={
          <ProtectedRoute>
            <MyPage />
          </ProtectedRoute>
        } />
        <Route path="/viewer/:filename/*" element={
          <ProtectedRoute>
            <ViewerPage />
          </ProtectedRoute>
        } />
        <Route path="/viewer/:filename/bookmarks" element={
          <ProtectedRoute>
            <BookmarksPage />
          </ProtectedRoute>
        } />
        <Route path="/viewer/:filename/relations" element={<RelationRedirect />} />
        {/* /user/viewer/:filename 경로는 GraphLayout으로 감싸지 않고 ViewerPage만 렌더링 */}
        <Route path="/user/viewer/:filename" element={
          <ProtectedRoute>
            <ViewerPage />
          </ProtectedRoute>
        } />
        {/* 그래프 단독 페이지만 GraphLayout으로 감싸서 RelationGraphWrapper 렌더링 */}
        <Route element={<GraphLayout />}>
          <Route path="/user/graph/:filename" element={
            <ProtectedRoute>
              <RelationGraphWrapper />
            </ProtectedRoute>
          } />
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

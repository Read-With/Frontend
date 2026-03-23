import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams, Outlet } from 'react-router-dom';
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
  return (
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
      <Route path="/user/viewer/:filename" element={
        <ProtectedRoute>
          <ViewerPage />
        </ProtectedRoute>
      } />
      <Route element={<GraphLayout />}>
        <Route path="/user/graph/:filename" element={
          <ProtectedRoute>
            <RelationGraphWrapper />
          </ProtectedRoute>
        } />
        <Route path="/user/graph/:bookId" element={
          <ProtectedRoute>
            <RelationGraphWrapper />
          </ProtectedRoute>
        } />
      </Route>
    </Routes>
  );
};

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

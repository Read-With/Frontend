import React from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet } from 'react-router-dom';
import ViewerPage from './components/viewer/ViewerPage';
import BookmarksPage from './components/viewer/bookmark/BookmarksPage';
import RelationGraphWrapper from './components/graph/RelationGraphWrapper';
import MyPage from './pages/MyPage';
import { RecoilRoot } from 'recoil';
import HomePage from './pages/HomePage';
import AdminPage from './pages/AdminPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OAuthCallback from './components/auth/OAuthCallback';

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
      <Route path="/user/viewer/:filename/bookmarks" element={
        <ProtectedRoute>
          <BookmarksPage />
        </ProtectedRoute>
      } />
      <Route path="/user/viewer/:filename/*" element={
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
      </Route>
    </Routes>
  );
};

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

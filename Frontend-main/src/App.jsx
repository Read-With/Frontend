import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ViewerPage from './components/viewer/ViewerPage';
import BookmarksPage from './components/viewer/bookmark/BookmarksPage';
import RelationGraphWrapper from './components/graph/RelationGraphWrapper';
import MyPage from './pages/MyPage';
import { RecoilRoot } from 'recoil';
import HomePage from './pages/HomePage';
import AdminPage from './pages/AdminPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OAuthCallback from './components/auth/OAuthCallback';

const AppContent = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="/admin" element={<AdminPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/mypage" element={<MyPage />} />
        <Route path="/user/viewer/:filename/bookmarks" element={<BookmarksPage />} />
        <Route path="/user/viewer/:filename/*" element={<ViewerPage />} />
        <Route path="/user/graph/:filename" element={<RelationGraphWrapper />} />
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

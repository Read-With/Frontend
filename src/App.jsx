import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/common/Header';
import MainPage from './components/main/MainPage';
import LibraryPage from './components/library/LibraryPage';
import ViewerPage from './components/viewer/ViewerPage';
import BookmarksPage from './components/viewer/BookmarksPage';
import RelationGraphWrapper from './components/graph/RelationGraphWrapper.jsx';
import TimelineView from './components/viewer/timeline/TimelineView';
import UploadPage from './components/main/UploadPage';
import SearchPage from './components/main/SearchPage';
import ChatPage from './pages/ChatPage';

const AppContent = () => {
  const location = useLocation();
  // '/viewer'로 시작하는 모든 페이지에서 Header 숨김
  const isViewerPage = location.pathname.startsWith('/viewer');

  return (
    <>
      {!isViewerPage && <Header />}

      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/viewer/:filename" element={<ViewerPage />} />
        <Route path="/viewer/:filename/bookmarks" element={<BookmarksPage />} />
        <Route path="/viewer/:filename/relations" element={<RelationGraphWrapper />} />
        <Route path="/viewer/:filename/timeline" element={<TimelineView />} />
        <Route path="/viewer/:filename/chat/:node" element={<ChatPage />} />
      </Routes>
    </>
  );
};

const App = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;

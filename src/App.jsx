import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/common/Header';
import MainPage from './components/main/MainPage';
import Library from './components/library/Library';
import ViewerPage from './components/viewer/ViewerPage';
import BookmarksPage from './components/viewer/BookmarksPage';
import RelationGraphWrapper from './graph/RelationGraphWrapper'

const AppContent = () => {
  const location = useLocation();
  const isViewerPage = location.pathname.startsWith('/viewer');



  return (
    <>
      {!isViewerPage && <Header />}

      <Routes>
        <Route
          path="/"
          element={
            <MainPage/>
          }
        />
        <Route path="/library" element={<Library />} />
        <Route path="/viewer/:filename" element={<ViewerPage />} />
        <Route path="/viewer/:filename/bookmarks" element={<BookmarksPage />} /> 
        <Route path="/viewer/:filename/relations" element={<RelationGraphWrapper />}/>
          
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

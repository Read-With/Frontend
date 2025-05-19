import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
  useParams,
} from "react-router-dom";
import Header from "./components/common/Header";
import MainPage from "./components/main/MainPage";
import LibraryPage from "./components/library/LibraryPage";
import ViewerPage from "./components/viewer/ViewerPage";
import BookmarksPage from "./components/viewer/BookmarksPage";
import RelationGraphWrapper from "./components/graph/RelationGraphWrapper.jsx";
import TimelineView from "./components/viewer/timeline/TimelineView";
import UploadPage from "./components/main/UploadPage";
import SearchPage from "./pages/SearchPage";
import ChatPage from "./pages/ChatPage.jsx";
import GraphPage from "./pages/GraphPage";

const AppContent = () => {
  const location = useLocation();
  // '/viewer' 또는 '/graph'로 시작하는 모든 페이지에서 Header 숨김
  const hideHeader =
    location.pathname.startsWith("/viewer") ||
    location.pathname.startsWith("/graph");

  return (
    <>
      {!hideHeader && <Header />}

      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/viewer/:filename/*" element={<ViewerPage />} />
        <Route path="/viewer/:filename/bookmarks" element={<BookmarksPage />} />
        <Route path="/viewer/:filename/timeline" element={<TimelineView />} />
        <Route
          path="/viewer/:filename/relations"
          element={<RelationRedirect />}
        />
        <Route path="/viewer/:filename/chat/:label" element={<ChatPage />} />
        <Route path="/graph/:filename" element={<GraphRedirect />} />
        <Route path="/graph/:filename/:chapter" element={<GraphPage />} />
        <Route path="/search" element={<SearchPage />} />
      </Routes>
    </>
  );
};

// :filename을 실제 파일명으로 치환해주는 래퍼 컴포넌트
function RelationRedirect() {
  const { filename } = useParams();
  return <Navigate to={`/graph/${filename}/chapter1`} replace />;
}
function GraphRedirect() {
  const { filename } = useParams();
  return <Navigate to={`/graph/${filename}/chapter1`} replace />;
}

const App = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;

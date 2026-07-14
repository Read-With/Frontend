import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { RecoilRoot } from 'recoil';
import HomePage from './pages/HomePage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OAuthCallback from './components/auth/OAuthCallback';
import { AuthProvider } from './hooks/auth/useAuth';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const MyPage = lazy(() => import('./pages/MyPage'));
const ViewerPage = lazy(() => import('./components/viewer/ViewerPage'));
const BookmarksPage = lazy(() => import('./components/viewer/bookmark/BookmarksPage'));
const RelationGraphWrapper = lazy(() => import('./components/graph/RelationGraphWrapper'));

const routeFallback = (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '40vh',
      color: '#6b7280',
      fontSize: '0.95rem',
    }}
  >
    로딩 중…
  </div>
);

const AppContent = () => {
  return (
    <Suspense fallback={routeFallback}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/user/viewer/:filename/bookmarks" element={<BookmarksPage />} />
          <Route path="/user/viewer/:filename/*" element={<ViewerPage />} />
          <Route path="/user/graph/:filename" element={<RelationGraphWrapper />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

const App = () => {
  return (
    <RecoilRoot>
      <Router>
        <AuthProvider>
          <AppContent />
          <ToastContainer
            position="bottom-center"
            autoClose={2200}
            hideProgressBar
            newestOnTop
            closeOnClick
            pauseOnHover
            draggable={false}
            theme="light"
            limit={3}
          />
        </AuthProvider>
      </Router>
    </RecoilRoot>
  );
};

export default App;

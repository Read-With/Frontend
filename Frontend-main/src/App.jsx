import { Component, lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import HomePage from './pages/HomePage';
import OAuthCallback from './components/auth/OAuthCallback';
import useAuth, { AuthProvider } from './hooks/auth/useAuth';
import { prefetchBooks } from './hooks/books/bookHooks';
import { COLORS } from './utils/styles/styles.js';
import { errorUtils } from './utils/common/urlUtils';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const MyPage = lazy(() => import('./pages/MyPage'));
const ViewerPage = lazy(() => import('./components/viewer/ViewerPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));
const RelationGraphWrapper = lazy(() => import('./components/graph/RelationGraphWrapper'));

const routeFallback = (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '40vh',
      color: COLORS.textSecondary,
      fontSize: '0.95rem',
    }}
  >
    로딩 중…
  </div>
);

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    errorUtils.logError('AppErrorBoundary', error, {
      componentStack: info?.componentStack || null,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            gap: 12,
            padding: 24,
            color: COLORS.nodeText || '#1a1a1a',
          }}
        >
          <p style={{ fontSize: '1.05rem', margin: 0 }}>화면을 표시하는 중 문제가 발생했습니다.</p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            style={{
              border: `1px solid ${COLORS.border}`,
              background: COLORS.white || '#fff',
              color: COLORS.nodeText || '#1a1a1a',
              borderRadius: 8,
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            홈으로 이동
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const ready = !isLoading && isAuthenticated();

  useEffect(() => {
    if (!ready) return;
    void prefetchBooks(queryClient);
  }, [ready, queryClient]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200"
          style={{ borderTopColor: COLORS.primary }}
          aria-label="로딩 중"
        />
      </div>
    );
  }

  if (!ready) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const AppContent = () => {
  return (
    <Suspense fallback={routeFallback}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/user/viewer/bookmarks" element={<Navigate to="/mypage" replace />} />
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
    <Router>
      <AuthProvider>
        <AppErrorBoundary>
          <AppContent />
        </AppErrorBoundary>
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
  );
};

export default App;

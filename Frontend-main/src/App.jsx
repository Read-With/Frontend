import { Component, lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import HomePage from './pages/HomePage';
import OAuthCallback from './components/auth/OAuthCallback';
import useAuth, { AuthProvider } from './hooks/auth/useAuth';
import { prefetchBooks } from './hooks/books/bookHooks';
import { COLORS } from './utils/styles/styles.js';
import { errorUtils } from './utils/common/valueUtils';
import { rememberPostLoginPath } from './utils/common/urlUtils';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const MyPage = lazy(() => import('./pages/MyPage'));
const ViewerPage = lazy(() => import('./components/viewer/ViewerPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));
const RelationGraphWrapper = lazy(() => import('./components/graph/RelationGraphWrapper'));

const PageLoader = ({ fullScreen = false }) => (
  <div
    role="status"
    className={`flex flex-col items-center justify-center gap-3 ${fullScreen ? 'min-h-screen' : 'min-h-[40vh]'}`}
    style={{ color: COLORS.textSecondary, fontSize: '0.95rem' }}
  >
    <div
      className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200"
      style={{ borderTopColor: COLORS.primary }}
      aria-hidden
    />
    로딩 중…
  </div>
);

const TEXT_COLOR = COLORS.nodeText || '#1a1a1a';
const actionClass = 'rounded-lg px-4 py-2 no-underline cursor-pointer';
const actionStyle = {
  border: `1px solid ${COLORS.border}`,
  background: COLORS.white || '#fff',
  color: TEXT_COLOR,
};

/** 404·에러 경계 공용 안내 화면 */
const MessageScreen = ({ title, description, children }) => (
  <div
    className="flex flex-col items-center justify-center gap-3 px-6 text-center"
    style={{ minHeight: '60vh', color: COLORS.textSecondary }}
  >
    <h1 className="m-0 text-xl font-semibold" style={{ color: TEXT_COLOR }}>
      {title}
    </h1>
    {description && <p className="m-0">{description}</p>}
    {children}
  </div>
);

const NotFoundPage = () => (
  <MessageScreen title="페이지를 찾을 수 없습니다" description="주소가 바뀌었거나 삭제된 페이지일 수 있어요.">
    <Link to="/mypage" className={actionClass} style={actionStyle}>
      서재로 가기
    </Link>
  </MessageScreen>
);

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  // 뒤로가기 등으로 경로가 바뀌면 에러 화면 해제
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error, info) {
    errorUtils.logError('AppErrorBoundary', error, {
      componentStack: info?.componentStack || null,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <MessageScreen
          title="화면을 표시하는 중 문제가 발생했습니다."
          description="일시적인 문제일 수 있어요. 다시 시도해 주세요."
        >
          {/* 새로고침: 배포 후 청크 로드 실패(lazy)도 함께 복구 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={actionClass}
              style={actionStyle}
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className={actionClass}
              style={actionStyle}
            >
              홈으로 이동
            </button>
          </div>
        </MessageScreen>
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

  if (isLoading) return <PageLoader fullScreen />;

  if (!ready) {
    rememberPostLoginPath();
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const AppContent = () => {
  const { pathname } = useLocation();
  return (
    <AppErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoader />}>
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

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
};

const App = () => {
  return (
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
  );
};

export default App;

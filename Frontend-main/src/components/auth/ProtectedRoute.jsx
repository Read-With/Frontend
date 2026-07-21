import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '../../hooks/auth/useAuth';
import { prefetchBooks } from '../../hooks/books/bookHooks';

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
          style={{ borderTopColor: '#5C6F5C' }}
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

export default ProtectedRoute;

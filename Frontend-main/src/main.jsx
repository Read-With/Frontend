import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import './index.css'
import App from './App.jsx'
import { errorUtils } from './utils/common/valueUtils.js'
import { getApiBaseUrl } from './utils/common/urlUtils.js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

if (import.meta.env.DEV) {
  import('./utils/security/oauthSecurity.js');
}

// Render 무료 플랜은 15분 무요청 시 슬립 → 앱 진입 즉시 깨우고, 탭이 보이는 동안 10분마다 핑
// ponytail: 탭이 닫혀 있으면 효과 없음. 항상 깨어 있어야 하면 외부 크론(UptimeRobot 등)으로 /health 핑
if (import.meta.env.PROD) {
  const pingBackend = () => {
    if (document.visibilityState !== 'visible') return;
    fetch(`${getApiBaseUrl()}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  };
  pingBackend();
  setInterval(pingBackend, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', pingBackend);
}

/**
 * - unhandledrejection: AbortError 제외
 * - error: 런타임 sync만 (img/script 리소스 로드 실패 제외)
 * React 렌더 에러는 AppErrorBoundary → logError (prod에서 window.error와 보통 중복 없음)
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (reason?.name === 'AbortError') return;
  errorUtils.logError(
    'unhandledrejection',
    reason instanceof Error ? reason : new Error(String(reason ?? 'Unhandled rejection')),
  );
});

window.addEventListener('error', (event) => {
  // 리소스 로드 실패(script/img/link 등) — event.error 없음, target이 Element
  if (event.target && event.target !== window) return;
  const err =
    event.error instanceof Error
      ? event.error
      : new Error(event.message || 'Unhandled error');
  if (err.name === 'AbortError') return;
  errorUtils.logError('window.onerror', err, {
    filename: event.filename || undefined,
    lineno: event.lineno || undefined,
    colno: event.colno || undefined,
  });
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
)

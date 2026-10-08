import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { buildContentSecurityPolicy } from './vite/csp.js';
import { DEFAULT_DEV_PROXY_TARGET } from './src/utils/common/urlUtils.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cspForServer = buildContentSecurityPolicy(env, { dev: mode === 'development' });
  const cspForProdHtml = buildContentSecurityPolicy(env, { dev: false });
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET || env.VITE_API_BASE_URL || DEFAULT_DEV_PROXY_TARGET;
  const publicProxyTarget =
    env.VITE_CDN_BASE_URL || env.VITE_API_BASE_URL || proxyTarget;
  const clientId = env.VITE_GOOGLE_CLIENT_ID?.trim() || null;
  
  return {
    plugins: [
      react(),
      {
        name: 'inject-csp-meta',
        transformIndexHtml(html, ctx) {
          if (ctx.server) return html;
          const escaped = cspForProdHtml.replace(/"/g, '&quot;');
          const meta = `\n    <meta http-equiv="Content-Security-Policy" content="${escaped}" />`;
          return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />${meta}`);
        },
      },
      // Vercel: vite build 성공 후에도 Node 핸들이 남아 Building에 멈추는 경우 방지
      // https://vercel.com/kb/guide/fixing-deployments-that-hang-after-the-build-step-succeeds
      {
        name: 'force-exit-after-build',
        apply: 'build',
        closeBundle() {
          setTimeout(() => process.exit(0), 0);
        },
      },
    ],
    define: {
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(clientId),
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
    build: {
      target: 'esnext',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          // 함수형: 'react-dom/client' 같은 서브패스까지 잡기 위함
          manualChunks(id) {
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react-vendor';
            if (id.includes('node_modules/@tanstack/react-query/')) return 'query';
            if (id.includes('node_modules/recharts/')) return 'charts';
            if (id.includes('node_modules/cytoscape')) return 'graph';
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    server: {
      cors: {
        origin: true,
        credentials: true,
      },
      // CORS 문제 해결을 위한 프록시 설정 (개발 환경 전용)
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          ws: false,
          timeout: 30000,
        },
        // Health check용 (백엔드가 /health를 직접 제공하는 경우)
        '/health': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          ws: false,
        },
        '/public': {
          target: publicProxyTarget,
          changeOrigin: true,
          secure: publicProxyTarget.startsWith('https'),
          ws: false,
        },
      },
      // Google OAuth를 위한 보안 헤더 설정
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': cspForServer,
      },
      hmr: {
        port: 24678,
        host: 'localhost',
        clientPort: 24678,
      },
      watch: {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      },
    },
  };
});

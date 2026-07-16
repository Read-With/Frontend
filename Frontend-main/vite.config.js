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
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
            charts: ['recharts'],
            graph: ['cytoscape', 'cytoscape-cose-bilkent', 'react-cytoscapejs'],
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
          // 프록시 요청 시 헤더 유지 (Authorization 포함)
          headers: {
            'Connection': 'keep-alive',
          },
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const authHeader = req.headers['authorization'] || req.headers['Authorization'];
              if (authHeader && !proxyReq.getHeader('Authorization')) {
                proxyReq.setHeader('Authorization', authHeader);
              }
            });
            proxy.on('proxyRes', (proxyRes, req) => {
              if (proxyRes.statusCode !== 404) return;

              const url = req.url || '';
              const silent404Endpoints = [
                '/relationship-graph',
                '/api/v2/progress',
                '/api/v2/books/',
                '/manifest'
              ];

              if (silent404Endpoints.some((endpoint) => url.includes(endpoint))) return;

              console.error('🔴 [404 에러] 백엔드에서 경로를 찾지 못함:', {
                요청경로: url,
                전체URL: `${options.target}${url}`,
                백엔드서버: options.target,
                메시지: '백엔드 서버에 해당 엔드포인트가 존재하지 않거나 경로가 다를 수 있습니다.'
              });
            });
            proxy.on('error', (err, req) => {
              console.error('❌ [프록시 에러]', {
                메시지: err.message,
                코드: err.code,
                경로: req.url,
                스택: err.stack
              });
            });
          },
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
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const authHeader = req.headers['authorization'] || req.headers['Authorization'];
              if (authHeader && !proxyReq.getHeader('Authorization')) {
                proxyReq.setHeader('Authorization', authHeader);
              }
            });
          },
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

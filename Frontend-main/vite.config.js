import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs';
import path from 'path';

export default defineConfig(({ mode }) => {
  const envPath = path.resolve(process.cwd(), '.env');
  let clientId = null;
  const isDev = mode === 'development';
  
  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const cleanLine = line.replace(/^\uFEFF/, '').trim();
        if (cleanLine.startsWith('VITE_GOOGLE_CLIENT_ID=')) {
          clientId = cleanLine.split('=')[1].trim();
          break;
        }
      }
    }
  } catch (error) {
    console.error('환경변수 파일 읽기 실패:', error);
  }
  
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(clientId),
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
      exclude: ['@google-cloud/local-auth', 'googleapis'],
    },
    build: {
      target: 'esnext',
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            charts: ['recharts', 'react-chartjs-2', 'chart.js'],
            graph: ['cytoscape', 'cytoscape-cose-bilkent'],
            ui: ['@ant-design/pro-components', 'antd'],
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
          target: 'http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com',
          changeOrigin: true,
          secure: false,
          ws: false,
          timeout: 30000,
          // 프록시 요청 시 헤더 유지 (Authorization 포함)
          headers: {
            'Connection': 'keep-alive',
          },
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              if (req.url?.includes('/api/books') && req.method === 'POST') {
                const authHeader = req.headers['authorization'] || req.headers['Authorization'];
                if (!proxyReq.getHeader('Authorization') && authHeader) {
                  proxyReq.setHeader('Authorization', authHeader);
                }
              }
            });
            proxy.on('proxyRes', (proxyRes, req, res) => {
              // 404 에러인 경우 - 데이터가 없을 수 있는 엔드포인트는 조용히 처리
              if (proxyRes.statusCode === 404) {
                const url = req.url || '';
                
                // 데이터가 없을 수 있는 정상적인 404 엔드포인트들
                const silent404Endpoints = [
                  '/api/v2/graph/',
                  '/api/v2/progress',
                  '/api/books/',
                  '/api/v2/books/',
                  '/manifest'
                ];
                
                const isSilent404 = silent404Endpoints.some(endpoint => url.includes(endpoint));
                
                if (isSilent404) {
                  // 데이터 부재로 정상적인 상황이므로 로깅하지 않음
                  // 디버그가 필요할 때만 활성화
                  // console.debug('⚠️ [404] 데이터 없음 (정상):', url);
                } else {
                  // 다른 엔드포인트의 404는 에러로 로깅
                  console.error('🔴 [404 에러] 백엔드에서 경로를 찾지 못함:', {
                    요청경로: url,
                    전체URL: `${options.target}${url}`,
                    백엔드서버: options.target,
                    메시지: '백엔드 서버에 해당 엔드포인트가 존재하지 않거나 경로가 다를 수 있습니다.'
                  });
                }
              }
            });
            proxy.on('error', (err, req, res) => {
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
          target: 'http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com',
          changeOrigin: true,
          secure: false,
          ws: false,
        },
      },
      // Google OAuth를 위한 보안 헤더 설정
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com blob:; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' ws://localhost:* http://localhost:8080 https://dev.readwith.store http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com https://accounts.google.com https://oauth2.googleapis.com https://*.s3.ap-northeast-2.amazonaws.com https://*.s3.amazonaws.com; frame-src 'self' https://accounts.google.com;",
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

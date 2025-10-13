import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs';
import path from 'path';
import process from 'process';

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
    plugins: [
      react({
        // React Fast Refresh 최적화
        fastRefresh: true,
        // 개발 시 불필요한 체크 비활성화
        babel: {
          plugins: isDev ? [] : [
            // 프로덕션에서만 적용할 최적화 플러그인
          ]
        }
      })
    ],
    define: {
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(clientId),
      // 개발 모드에서 불필요한 경고 비활성화
      __DEV__: isDev,
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
      exclude: ['@google-cloud/local-auth', 'googleapis'],
      // 메모리 사용량 최적화를 위한 강제 포함
      force: isDev ? false : true,
    },
    build: {
      target: 'esnext',
      minify: 'terser',
      // 메모리 사용량 최적화를 위한 Terser 옵션
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info'],
        },
        mangle: {
          safari10: true,
        },
      },
      rollupOptions: {
        output: {
          // 더 세분화된 청크 분할로 메모리 효율성 향상
          manualChunks: {
            vendor: ['react', 'react-dom'],
            router: ['react-router-dom'],
            charts: ['recharts', 'react-chartjs-2'],
            epub: ['epubjs'],
            graph: ['cytoscape', 'cytoscape-cose-bilkent', 'react-cytoscapejs'],
            ui: ['@ant-design/pro-components', 'lucide-react', 'react-icons'],
            auth: ['@react-oauth/google', 'google-auth-library'],
            utils: ['axios', 'recoil', 'framer-motion'],
          },
          // 청크 크기 제한으로 메모리 사용량 관리
          chunkFileNames: (chunkInfo) => {
            const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : 'chunk';
            return `js/[name]-[hash].js`;
          },
        },
      },
      // 청크 크기 경고 임계값 증가
      chunkSizeWarningLimit: 2000,
      // 소스맵 비활성화로 빌드 메모리 사용량 감소
      sourcemap: false,
    },
    server: {
      cors: {
        origin: true,
        credentials: true,
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com blob:; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' ws://localhost:* http://localhost:8080 https://dev.readwith.store https://accounts.google.com https://oauth2.googleapis.com; frame-src 'self' https://accounts.google.com;",
      },
      hmr: {
        port: 24678,
        host: 'localhost',
        clientPort: 24678,
      },
      // 파일 감시 최적화로 메모리 사용량 감소
      watch: {
        ignored: [
          '**/node_modules/**', 
          '**/dist/**', 
          '**/.git/**',
          '**/src/data/**', // 대용량 데이터 파일 감시 제외
          '**/*.json' // JSON 파일 변경 감시 제외 (개발 시)
        ],
        // 파일 시스템 이벤트 제한
        usePolling: false,
        interval: 300,
      },
      // 개발 서버 메모리 최적화
      fs: {
        strict: false,
        allow: ['..'],
      },
    },
    // 메모리 사용량 최적화를 위한 추가 설정
    esbuild: {
      target: 'es2020',
      // 개발 시 불필요한 최적화 비활성화
      minify: !isDev,
      drop: isDev ? [] : ['console', 'debugger'],
    },
  };
});

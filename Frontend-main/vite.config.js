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
            epub: ['epubjs'],
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
      // Google OAuth를 위한 보안 헤더 설정
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
      watch: {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      },
    },
  };
});

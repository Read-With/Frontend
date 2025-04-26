
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/naver': 'http://localhost:5000', // 백엔드 주소
    },
  },
});
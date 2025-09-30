import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs';
import path from 'path';

export default defineConfig(({ mode }) => {
  const envPath = path.resolve(process.cwd(), '.env');
  let clientId = null;
  
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
    server: {
      proxy: {
        "/api": {
          target: "https://dev.readwith.store",
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});

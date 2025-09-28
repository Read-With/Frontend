import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs';
import path from 'path';

export default defineConfig(({ mode }) => {
  // 직접 .env 파일 읽기
  const envPath = path.resolve(process.cwd(), '.env');
  let clientId = null;
  
  console.log('환경변수 파일 경로:', envPath);
  console.log('파일 존재 여부:', fs.existsSync(envPath));
  
  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      console.log('파일 내용:', envContent);
      console.log('파일 내용 길이:', envContent.length);
      
      const lines = envContent.split('\n');
      console.log('분할된 라인 수:', lines.length);
      
      for (const line of lines) {
        console.log('라인:', line);
        // BOM 문자 제거 후 검사
        const cleanLine = line.replace(/^\uFEFF/, '').trim();
        if (cleanLine.startsWith('VITE_GOOGLE_CLIENT_ID=')) {
          clientId = cleanLine.split('=')[1].trim();
          console.log('찾은 Client ID:', clientId);
          break;
        }
      }
    }
  } catch (error) {
    console.error('환경변수 파일 읽기 실패:', error);
  }
  
  console.log('최종 Client ID:', clientId);
  
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

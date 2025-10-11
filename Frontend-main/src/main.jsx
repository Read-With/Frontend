import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 개발 환경에서만 안전한 디버깅 시스템 로드
if (import.meta.env.DEV) {
  import('./utils/security/safeDebug.js');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

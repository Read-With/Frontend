import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Material Symbols 폰트 로드 확인
const checkFontLoaded = () => {
  const addFontsLoaded = () => {
    if (!document.documentElement.classList.contains('fonts-loaded')) {
      document.documentElement.classList.add('fonts-loaded');
    }
  };

  const checkMaterialSymbolsFont = () => {
    if (!document.fonts || !document.fonts.check) {
      return false;
    }

    // 여러 방법으로 폰트 확인
    const testStrings = [
      '24px "Material Symbols Outlined"',
      '16px "Material Symbols Outlined"',
      'normal 24px "Material Symbols Outlined"',
    ];

    for (const testString of testStrings) {
      if (document.fonts.check(testString)) {
        return true;
      }
    }
    return false;
  };

  // 즉시 확인 (캐시된 경우)
  if (checkMaterialSymbolsFont()) {
    addFontsLoaded();
    return;
  }

  // 폰트 로드 대기
  if (document.fonts && document.fonts.ready) {
    // fonts.ready는 이미 로드된 폰트를 확인하므로 즉시 실행될 수 있음
    Promise.resolve(document.fonts.ready).then(() => {
      // 약간의 지연 후 다시 확인 (폰트가 실제로 적용되는 시간 고려)
      setTimeout(() => {
        if (checkMaterialSymbolsFont()) {
          addFontsLoaded();
        } else {
          // 여전히 로드되지 않았다면 주기적으로 확인
          const interval = setInterval(() => {
            if (checkMaterialSymbolsFont()) {
              clearInterval(interval);
              addFontsLoaded();
            }
          }, 100);
          
          // 최대 3초 후 타임아웃 (폰트가 있으면 표시)
          setTimeout(() => {
            clearInterval(interval);
            addFontsLoaded();
          }, 3000);
        }
      }, 100);
    });
  } else {
    // FontFace API를 지원하지 않는 경우 약간의 지연 후 표시
    setTimeout(addFontsLoaded, 500);
  }
};

// 폰트 로드 확인 시작
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkFontLoaded);
} else {
  checkFontLoaded();
}

// 개발 환경에서만 안전한 디버깅 시스템 로드
if (import.meta.env.DEV) {
  import('./utils/security/safeDebug.js');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

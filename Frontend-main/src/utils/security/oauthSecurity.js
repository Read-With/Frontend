/**
 * OAuth 보안 관련 유틸리티 함수들
 */

// Google OAuth Client ID 형식 검증
export const validateGoogleClientId = (clientId) => {
  if (!clientId) {
    return { isValid: false, error: 'Client ID가 없습니다.' };
  }

  // Google OAuth Client ID 패턴: 숫자-문자.apps.googleusercontent.com
  const pattern = /^\d+-\w+\.apps\.googleusercontent\.com$/;
  if (!pattern.test(clientId)) {
    return { isValid: false, error: '유효하지 않은 Google Client ID 형식입니다.' };
  }

  return { isValid: true };
};

// OAuth State 파라미터 생성 및 검증
export const generateOAuthState = () => {
  return crypto.randomUUID();
};

export const validateOAuthState = (receivedState, storedState) => {
  if (!receivedState || !storedState) {
    return { isValid: false, error: 'State 파라미터가 없습니다.' };
  }

  if (receivedState !== storedState) {
    return { isValid: false, error: 'State 파라미터가 일치하지 않습니다.' };
  }

  return { isValid: true };
};

// OAuth 코드 형식 검증
export const validateOAuthCode = (code) => {
  if (!code) {
    return { isValid: false, error: '인증 코드가 없습니다.' };
  }

  // Google OAuth 코드는 Base64 URL-safe 문자로 구성됨
  const pattern = /^[A-Za-z0-9\/\-_]+$/;
  if (!pattern.test(code)) {
    return { isValid: false, error: '유효하지 않은 인증 코드 형식입니다.' };
  }

  // 코드 길이 검증 (일반적으로 100-200자)
  if (code.length < 50 || code.length > 500) {
    return { isValid: false, error: '인증 코드 길이가 올바르지 않습니다.' };
  }

  return { isValid: true };
};

// 사용자 데이터 검증
export const validateUserData = (userData) => {
  if (!userData || typeof userData !== 'object') {
    return { isValid: false, error: '사용자 데이터가 없습니다.' };
  }

  const requiredFields = ['id', 'email'];
  for (const field of requiredFields) {
    if (!userData[field]) {
      return { isValid: false, error: `필수 사용자 정보가 없습니다: ${field}` };
    }
  }

  // 이메일 형식 검증
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(userData.email)) {
    return { isValid: false, error: '유효하지 않은 이메일 형식입니다.' };
  }

  return { isValid: true };
};

// 환경 변수 검증
export const validateEnvironmentVariables = () => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const validation = validateGoogleClientId(clientId);
  
  if (!validation.isValid) {
    console.error('환경 변수 검증 실패:', validation.error);
    return { isValid: false, error: validation.error };
  }

  return { isValid: true };
};

// CSRF 토큰 생성
export const generateCSRFToken = () => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

// URL 안전성 검증
export const validateRedirectUri = (redirectUri) => {
  try {
    const url = new URL(redirectUri);
    
    // HTTPS 강제 (프로덕션 환경)
    if (import.meta.env.PROD && url.protocol !== 'https:') {
      return { isValid: false, error: '프로덕션 환경에서는 HTTPS를 사용해야 합니다.' };
    }

    // localhost 허용 (개발 환경)
    if (import.meta.env.DEV && !['http:', 'https:'].includes(url.protocol)) {
      return { isValid: false, error: '유효하지 않은 프로토콜입니다.' };
    }

    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: '유효하지 않은 URL 형식입니다.' };
  }
};

// 로그 보안 (민감한 정보 마스킹)
export const secureLog = (message, data = null) => {
  if (import.meta.env.DEV) {
    void message;
    void data;
  }
};

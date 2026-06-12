/** OAuth 검증·state·dev 디버그 (Self-XSS 방지) */

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

/** Google OAuth authorize 직전 sessionStorage 키 */
export const GOOGLE_OAUTH_STATE_SESSION_KEY = 'readwith_google_oauth_state';

export function createAndStoreGoogleOAuthState() {
  const state = generateOAuthState();
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(GOOGLE_OAUTH_STATE_SESSION_KEY, state);
    } catch {
      /* quota / private mode */
    }
  }
  return state;
}

export function clearGoogleOAuthStateSession() {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(GOOGLE_OAUTH_STATE_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 콜백 URL state와 sessionStorage 비교 후 저장값 제거
 */
export function verifyGoogleOAuthState(receivedState) {
  let stored = null;
  if (typeof sessionStorage !== 'undefined') {
    try {
      stored = sessionStorage.getItem(GOOGLE_OAUTH_STATE_SESSION_KEY);
    } catch {
      return { isValid: false, error: 'OAuth state를 읽을 수 없습니다.' };
    }
  }
  const result = validateOAuthState(receivedState, stored);
  clearGoogleOAuthStateSession();
  return result;
}

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

export const secureLog = (message, data = null) => {
  if (import.meta.env.DEV) {
    void message;
    void data;
  }
};

function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  const masked = { ...data };
  const sensitiveFields = ['code', 'token', 'password', 'secret', 'key', 'id'];
  for (const [key, value] of Object.entries(masked)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      if (typeof value === 'string' && value.length > 10) {
        masked[key] = value.substring(0, 6) + '...' + value.substring(value.length - 4);
      } else if (typeof value === 'string') {
        masked[key] = '*'.repeat(value.length);
      }
    }
  }
  return masked;
}

if (import.meta.env.DEV) {
  window.DEBUG_OAUTH = (message, data = null) => {
    try {
      const safeData = data ? maskSensitiveData(data) : null;
      const logEntry = {
        message,
        data: safeData,
        timestamp: new Date().toISOString(),
        source: 'OAuth',
      };
      const existingLogs = JSON.parse(localStorage.getItem('oauth_debug_logs') || '[]');
      existingLogs.push(logEntry);
      if (existingLogs.length > 50) {
        existingLogs.splice(0, existingLogs.length - 50);
      }
      localStorage.setItem('oauth_debug_logs', JSON.stringify(existingLogs));
      console.group(`🔒 ${message}`);
      if (safeData) console.table(safeData);
      console.groupEnd();
    } catch {
      /* ignore */
    }
  };
  window.GET_OAUTH_LOGS = () => {
    try {
      return JSON.parse(localStorage.getItem('oauth_debug_logs') || '[]');
    } catch {
      return [];
    }
  };
  window.CLEAR_OAUTH_LOGS = () => {
    try {
      localStorage.removeItem('oauth_debug_logs');
    } catch {
      /* ignore */
    }
  };
} else {
  window.DEBUG_OAUTH = () => {};
  window.GET_OAUTH_LOGS = () => [];
  window.CLEAR_OAUTH_LOGS = () => {};
}

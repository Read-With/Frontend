/** OAuth 검증·state·dev 디버그 (Self-XSS 방지) */

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

export const GOOGLE_OAUTH_STATE_SESSION_KEY = 'readwith_google_oauth_state';
export const GOOGLE_OAUTH_STATE_VERIFIED_KEY = 'readwith_google_oauth_state_verified';

export function createAndStoreGoogleOAuthState() {
  const state = generateOAuthState();
  if (typeof sessionStorage === 'undefined') {
    return state;
  }
  try {
    sessionStorage.setItem(GOOGLE_OAUTH_STATE_SESSION_KEY, state);
    sessionStorage.removeItem(GOOGLE_OAUTH_STATE_VERIFIED_KEY);
  } catch {
    throw new Error('OAuth state를 저장할 수 없습니다. 시크릿 모드 또는 브라우저 저장소 제한을 확인해주세요.');
  }
  return state;
}

export function clearGoogleOAuthStateSession() {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(GOOGLE_OAUTH_STATE_SESSION_KEY);
      sessionStorage.removeItem(GOOGLE_OAUTH_STATE_VERIFIED_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function verifyGoogleOAuthState(receivedState) {
  if (!receivedState) {
    return { isValid: false, error: 'State 파라미터가 없습니다. (Google 콜백 URL에 state가 없습니다.)' };
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      if (sessionStorage.getItem(GOOGLE_OAUTH_STATE_VERIFIED_KEY) === receivedState) {
        return { isValid: true };
      }
    } catch {
      return { isValid: false, error: 'OAuth state를 읽을 수 없습니다.' };
    }
  }

  let stored = null;
  if (typeof sessionStorage !== 'undefined') {
    try {
      stored = sessionStorage.getItem(GOOGLE_OAUTH_STATE_SESSION_KEY);
    } catch {
      return { isValid: false, error: 'OAuth state를 읽을 수 없습니다.' };
    }
  }

  if (!stored) {
    return {
      isValid: false,
      error:
        'OAuth state가 만료되었거나 저장되지 않았습니다. 로그인을 다시 시도해주세요. (다른 탭·창에서 시작했거나 브라우저 저장소가 차단된 경우에도 발생할 수 있습니다.)',
    };
  }

  const result = validateOAuthState(receivedState, stored);
  if (result.isValid && typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(GOOGLE_OAUTH_STATE_SESSION_KEY);
      sessionStorage.setItem(GOOGLE_OAUTH_STATE_VERIFIED_KEY, receivedState);
    } catch {
      /* ignore */
    }
  }
  return result;
}

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

if (typeof window !== 'undefined') {
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
}

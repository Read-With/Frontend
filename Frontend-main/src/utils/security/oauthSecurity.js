/** OAuth 검증·state·PKCE·dev 디버그 (Self-XSS 방지)
 * PKCE helpers(generateCodeVerifier 등)는 백엔드 PKCE 연동 전까지 dormant — 삭제하지 말 것.
 */

const GOOGLE_OAUTH_STATE_SESSION_KEY = 'readwith_google_oauth_state';
const GOOGLE_OAUTH_STATE_VERIFIED_KEY = 'readwith_google_oauth_state_verified';
const GOOGLE_OAUTH_PKCE_VERIFIER_KEY = 'readwith_google_oauth_pkce_verifier';

const generateOAuthState = () => crypto.randomUUID();

const validateOAuthState = (receivedState, storedState) => {
  if (!receivedState || !storedState) {
    return { isValid: false, error: 'State 파라미터가 없습니다.' };
  }

  if (receivedState !== storedState) {
    return { isValid: false, error: 'State 파라미터가 일치하지 않습니다.' };
  }

  return { isValid: true };
};

function base64UrlEncode(bytes) {
  let binary = '';
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sessionGet(key) {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key, value) {
  if (typeof sessionStorage === 'undefined') {
    throw new Error('브라우저 저장소를 사용할 수 없습니다.');
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    throw new Error('시크릿 모드 또는 브라우저 저장소 제한을 확인해주세요.');
  }
}

function sessionRemove(...keys) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

/** @deprecated dormant — 백엔드 PKCE 미사용 */
export function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** @deprecated dormant — 백엔드 PKCE 미사용 */
export async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

export function createAndStoreGoogleOAuthState() {
  const state = generateOAuthState();
  try {
    sessionSet(GOOGLE_OAUTH_STATE_SESSION_KEY, state);
    sessionRemove(GOOGLE_OAUTH_STATE_VERIFIED_KEY);
  } catch (error) {
    throw new Error(
      `OAuth state를 저장할 수 없습니다. ${error?.message || ''}`.trim(),
    );
  }
  return state;
}

/** @deprecated dormant — 백엔드 PKCE 미사용 */
export async function createAndStoreGoogleOAuthPkce() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  try {
    sessionSet(GOOGLE_OAUTH_PKCE_VERIFIER_KEY, verifier);
  } catch (error) {
    throw new Error(
      `PKCE verifier를 저장할 수 없습니다. ${error?.message || ''}`.trim(),
    );
  }
  return { verifier, challenge };
}

/** @deprecated dormant — 백엔드 PKCE 미사용 */
export function getGoogleOAuthPkceVerifier() {
  return sessionGet(GOOGLE_OAUTH_PKCE_VERIFIER_KEY);
}

/** @deprecated dormant — 백엔드 PKCE 미사용 */
export function clearGoogleOAuthPkceVerifier() {
  sessionRemove(GOOGLE_OAUTH_PKCE_VERIFIER_KEY);
}

export function clearGoogleOAuthStateSession() {
  sessionRemove(
    GOOGLE_OAUTH_STATE_SESSION_KEY,
    GOOGLE_OAUTH_STATE_VERIFIED_KEY,
    GOOGLE_OAUTH_PKCE_VERIFIER_KEY,
  );
}

export function verifyGoogleOAuthState(receivedState) {
  if (!receivedState) {
    return {
      isValid: false,
      error: 'State 파라미터가 없습니다. (Google 콜백 URL에 state가 없습니다.)',
    };
  }

  try {
    if (sessionGet(GOOGLE_OAUTH_STATE_VERIFIED_KEY) === receivedState) {
      return { isValid: true };
    }
  } catch {
    return { isValid: false, error: 'OAuth state를 읽을 수 없습니다.' };
  }

  let stored = null;
  try {
    stored = sessionGet(GOOGLE_OAUTH_STATE_SESSION_KEY);
  } catch {
    return { isValid: false, error: 'OAuth state를 읽을 수 없습니다.' };
  }

  if (!stored) {
    return {
      isValid: false,
      error:
        'OAuth state가 만료되었거나 저장되지 않았습니다. 로그인을 다시 시도해주세요. (다른 탭·창에서 시작했거나 브라우저 저장소가 차단된 경우에도 발생할 수 있습니다.)',
    };
  }

  const result = validateOAuthState(receivedState, stored);
  if (result.isValid) {
    try {
      sessionRemove(GOOGLE_OAUTH_STATE_SESSION_KEY);
      sessionSet(GOOGLE_OAUTH_STATE_VERIFIED_KEY, receivedState);
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

function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  const masked = { ...data };
  const sensitiveFields = ['code', 'token', 'password', 'secret', 'key', 'id', 'verifier'];
  for (const [key, value] of Object.entries(masked)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      if (typeof value === 'string' && value.length > 10) {
        masked[key] = `${value.substring(0, 6)}...${value.substring(value.length - 4)}`;
      } else if (typeof value === 'string') {
        masked[key] = '*'.repeat(value.length);
      }
    }
  }
  return masked;
}

export function secureLog(message, data = null) {
  if (typeof window !== 'undefined' && typeof window.DEBUG_OAUTH === 'function') {
    window.DEBUG_OAUTH(message, data);
  }
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

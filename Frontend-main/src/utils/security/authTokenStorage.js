/**
 * 액세스 토큰: 메모리만 사용 — localStorage에 남지 않아 동일 출처 XSS가 저장소만 훑을 때 유출이 줄어듦.
 * 리프레시 토큰: localStorage (멀티 탭·재방문 유지). 완전한 XSS 방어는 httpOnly·Secure 쿠키 세션이 필요하다.
 */

const KEY_ACCESS = 'accessToken';
const KEY_REFRESH = 'refreshToken';
const KEY_GOOGLE_USER = 'google_user';

let memoryAccessToken = null;
let legacyAccessMigrated = false;

function migrateLegacyAccessFromLocalStorage() {
  if (legacyAccessMigrated) return;
  legacyAccessMigrated = true;
  try {
    const fromLs = localStorage.getItem(KEY_ACCESS);
    if (fromLs) {
      memoryAccessToken = fromLs;
      localStorage.removeItem(KEY_ACCESS);
    }
  } catch {
    /* ignore */
  }
}

export function getStoredAccessToken() {
  migrateLegacyAccessFromLocalStorage();
  return memoryAccessToken;
}

export function setStoredAccessToken(token) {
  migrateLegacyAccessFromLocalStorage();
  if (token == null || token === '') {
    memoryAccessToken = null;
    try {
      localStorage.removeItem(KEY_ACCESS);
    } catch {
      /* ignore */
    }
    return;
  }
  memoryAccessToken = token;
  try {
    localStorage.removeItem(KEY_ACCESS);
  } catch {
    /* ignore */
  }
}

export function getStoredRefreshToken() {
  try {
    return localStorage.getItem(KEY_REFRESH);
  } catch {
    return null;
  }
}

export function setStoredRefreshToken(token) {
  try {
    if (token == null || token === '') {
      localStorage.removeItem(KEY_REFRESH);
      return;
    }
    localStorage.setItem(KEY_REFRESH, token);
  } catch {
    /* ignore */
  }
}

export function getStoredGoogleUserJson() {
  try {
    return localStorage.getItem(KEY_GOOGLE_USER);
  } catch {
    return null;
  }
}

export function setStoredGoogleUserJson(jsonString) {
  try {
    if (jsonString == null || jsonString === '') {
      localStorage.removeItem(KEY_GOOGLE_USER);
      return;
    }
    localStorage.setItem(KEY_GOOGLE_USER, jsonString);
  } catch {
    /* ignore */
  }
}

export function removeStoredGoogleUser() {
  try {
    localStorage.removeItem(KEY_GOOGLE_USER);
  } catch {
    /* ignore */
  }
}

export function clearAuthTokenStorage() {
  memoryAccessToken = null;
  legacyAccessMigrated = false;
  try {
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_GOOGLE_USER);
  } catch {
    console.error('localStorage 접근 실패');
  }
}

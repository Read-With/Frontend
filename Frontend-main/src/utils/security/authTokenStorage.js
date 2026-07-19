/**
 * 액세스 토큰: 메모리 + sessionStorage (같은 탭에서 새로고침 시 복원). localStorage에는 두지 않음.
 * 리프레시 토큰: localStorage (멀티 탭·재방문). 완전한 XSS 방어는 httpOnly·Secure 쿠키 세션이 필요하다.
 */

import { clearBooksCache } from '../common/cache/cacheManager';

const KEY_ACCESS = 'accessToken';
const KEY_SESSION_ACCESS = 'readwith_session_access';
const KEY_REFRESH = 'refreshToken';
const KEY_GOOGLE_USER = 'google_user';

let memoryAccessToken = null;
let legacyAccessMigrated = false;

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value == null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function lsRemove(...keys) {
  try {
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

function ssGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function ssSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function ssRemove(...keys) {
  try {
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

function migrateLegacyAccessFromLocalStorage() {
  if (legacyAccessMigrated) return;
  legacyAccessMigrated = true;
  const fromLs = lsGet(KEY_ACCESS);
  if (fromLs) {
    memoryAccessToken = fromLs;
    lsRemove(KEY_ACCESS);
  }
}

export function getStoredAccessToken() {
  migrateLegacyAccessFromLocalStorage();
  if (memoryAccessToken) return memoryAccessToken;
  const fromSs = ssGet(KEY_SESSION_ACCESS);
  if (fromSs) {
    memoryAccessToken = fromSs;
    return fromSs;
  }
  return null;
}

export function setStoredAccessToken(token) {
  migrateLegacyAccessFromLocalStorage();
  if (token == null || token === '') {
    memoryAccessToken = null;
    lsRemove(KEY_ACCESS);
    ssRemove(KEY_SESSION_ACCESS);
    return;
  }
  memoryAccessToken = token;
  lsRemove(KEY_ACCESS);
  ssSet(KEY_SESSION_ACCESS, token);
}

export function getStoredRefreshToken() {
  return lsGet(KEY_REFRESH);
}

export function setStoredRefreshToken(token) {
  lsSet(KEY_REFRESH, token);
}

export function getStoredGoogleUserJson() {
  return lsGet(KEY_GOOGLE_USER);
}

export function setStoredGoogleUserJson(jsonString) {
  lsSet(KEY_GOOGLE_USER, jsonString);
}

export function removeStoredGoogleUser() {
  lsRemove(KEY_GOOGLE_USER);
}

/** authApi·urlUtils 순환 없이 로그아웃/세션 초기화 */
export function clearAuthData() {
  memoryAccessToken = null;
  legacyAccessMigrated = false;
  clearBooksCache();
  try {
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_GOOGLE_USER);
    sessionStorage.removeItem(KEY_SESSION_ACCESS);
  } catch {
    console.error('localStorage 접근 실패');
  }
}

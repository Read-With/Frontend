/**
 * 액세스 토큰: 메모리 + sessionStorage (같은 탭에서 새로고침 시 복원). localStorage에는 두지 않음.
 * 리프레시 토큰: localStorage (멀티 탭·재방문). 완전한 XSS 방어는 httpOnly·Secure 쿠키 세션이 필요하다.
 */

import { clearBooksCache, readRaw, writeRaw, removeKeys } from '../common/cache/cacheManager';
import { errorUtils } from '../common/valueUtils';

export const AUTH_CLEARED_EVENT = 'readwith:auth-cleared';

const KEY_ACCESS = 'accessToken';
const KEY_SESSION_ACCESS = 'readwith_session_access';
const KEY_REFRESH = 'refreshToken';
const KEY_GOOGLE_USER = 'google_user';

let memoryAccessToken = null;
let legacyAccessMigrated = false;

function migrateLegacyAccessFromLocalStorage() {
  if (legacyAccessMigrated) return;
  legacyAccessMigrated = true;
  const fromLs = readRaw(KEY_ACCESS);
  if (fromLs) {
    memoryAccessToken = fromLs;
    removeKeys('localStorage', KEY_ACCESS);
  }
}

export function getStoredAccessToken() {
  migrateLegacyAccessFromLocalStorage();
  if (memoryAccessToken) return memoryAccessToken;
  const fromSs = readRaw(KEY_SESSION_ACCESS, 'sessionStorage');
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
    removeKeys('localStorage', KEY_ACCESS);
    removeKeys('sessionStorage', KEY_SESSION_ACCESS);
    return;
  }
  memoryAccessToken = token;
  removeKeys('localStorage', KEY_ACCESS);
  writeRaw(KEY_SESSION_ACCESS, token, 'sessionStorage');
}

export function getStoredRefreshToken() {
  return readRaw(KEY_REFRESH);
}

export function setStoredRefreshToken(token) {
  writeRaw(KEY_REFRESH, token);
}

export function getStoredGoogleUserJson() {
  return readRaw(KEY_GOOGLE_USER);
}

export function setStoredGoogleUserJson(jsonString) {
  writeRaw(KEY_GOOGLE_USER, jsonString);
}

export function removeStoredGoogleUser() {
  removeKeys('localStorage', KEY_GOOGLE_USER);
}

/** authApi·urlUtils 순환 없이 로그아웃/세션 초기화 */
export function clearAuthData() {
  memoryAccessToken = null;
  legacyAccessMigrated = false;
  clearBooksCache();
  const lsCleared = removeKeys('localStorage', KEY_ACCESS, KEY_REFRESH, KEY_GOOGLE_USER);
  const ssCleared = removeKeys('sessionStorage', KEY_SESSION_ACCESS);
  if (!lsCleared || !ssCleared) {
    errorUtils.logWarning('authTokenStorage', '스토리지 접근 실패 — 토큰 삭제 불완전', { lsCleared, ssCleared });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
  }
}

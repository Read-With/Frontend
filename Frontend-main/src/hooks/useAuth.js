/** 인증: 토큰 갱신·Google 프로필·로그인/로그아웃 (공유 Context) */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  logout as apiLogout,
  refreshToken,
  isTokenExpiringSoon,
  getProactiveRefreshBufferSeconds,
  isTokenValid,
  ensureSessionAccessToken,
  getStoredAccessToken,
  setStoredAccessToken,
  setStoredRefreshToken,
  getStoredRefreshToken,
  getStoredGoogleUserJson,
  setStoredGoogleUserJson,
  removeStoredGoogleUser,
  clearAuthData,
  AUTH_CLEARED_EVENT,
} from '../utils/api/authApi';
import { getPostLoginHomeUrl, isOAuthCallbackRoute, rememberPostLoginPath } from '../utils/common/urlUtils';
import { errorUtils } from '../utils/common/valueUtils';
import { removeKeys } from '../utils/common/cache/cacheManager';

const AuthContext = createContext(null);

function profileFromUserData(userData) {
  return {
    id: userData.id != null ? String(userData.id) : '',
    name: userData.name,
    email: userData.email,
    imageUrl: userData.imageUrl || '',
    provider: userData.provider || 'GOOGLE',
  };
}

function storeTokens(userData) {
  if (userData.accessToken) setStoredAccessToken(userData.accessToken);
  if (userData.refreshToken) setStoredRefreshToken(userData.refreshToken);
}

const isCorruptedName = (name) => {
  if (!name) return false;
  return /[ìíîïðñòóôõö]/.test(name) || /\\x[0-9A-Fa-f]{2}/.test(name);
};

/** 저장된 Google 사용자 복원(토큰 재저장 포함). 이름이 깨졌으면 저장분을 지우고 corrupted */
function restoreSavedUser() {
  const savedUser = getStoredGoogleUserJson();
  if (!savedUser) return { profile: null, corrupted: false };
  let profile = null;
  try {
    const userData = JSON.parse(savedUser);
    storeTokens(userData);
    profile = profileFromUserData(userData);
    setStoredGoogleUserJson(JSON.stringify(profile));

    if (isCorruptedName(profile.name)) {
      removeStoredGoogleUser();
      return { profile, corrupted: true };
    }
  } catch {
    removeStoredGoogleUser();
  }
  return { profile, corrupted: false };
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOAuthCallbackRoute()) return undefined;

    const checkAndRefreshToken = async () => {
      try {
        const token = getStoredAccessToken();
        if (token && isTokenExpiringSoon(token, getProactiveRefreshBufferSeconds(token))) {
          await refreshToken();
        }
      } catch (error) {
        errorUtils.logWarning('useAuth', '토큰 자동 갱신 실패', {
          message: error?.message,
        });
      }
    };

    void checkAndRefreshToken();
    const intervalId = setInterval(checkAndRefreshToken, 45 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (isOAuthCallbackRoute()) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        const { profile, corrupted } = restoreSavedUser();
        if (corrupted) return;

        await ensureSessionAccessToken();
        if (cancelled) return;

        // 구버전 snake_case 키 정리 (authApi 토큰 저장소는 camelCase만 마이그레이션)
        removeKeys('localStorage', 'access_token');

        const accessToken = getStoredAccessToken();
        if (accessToken && !isTokenValid(accessToken)) {
          clearAuthData();
          const currentPath = window.location.pathname;
          if (currentPath !== '/') {
            rememberPostLoginPath();
            window.location.href = getPostLoginHomeUrl();
          }
          return;
        }

        if (profile && accessToken) {
          setUser(profile);
        } else if (profile && !accessToken && !getStoredRefreshToken()) {
          removeStoredGoogleUser();
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((userData) => {
    const profile = profileFromUserData(userData);
    setUser(profile);

    try {
      setStoredGoogleUserJson(JSON.stringify(profile));
      storeTokens(userData);
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);

    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }, []);

  // 토큰 만료·로그아웃으로 저장소가 비면 user도 해제
  // AUTH_CLEARED_EVENT는 같은 탭만, storage 이벤트는 다른 탭의 로그아웃을 전달
  useEffect(() => {
    const onCleared = () => setUser(null);
    const onStorage = () => {
      if (!getStoredGoogleUserJson()) setUser(null);
    };
    window.addEventListener(AUTH_CLEARED_EVENT, onCleared);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AUTH_CLEARED_EVENT, onCleared);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      login,
      logout,
      isAuthenticated: Boolean(user),
    }),
    [user, isLoading, login, logout],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth는 AuthProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}

export { AuthProvider };
export default useAuth;

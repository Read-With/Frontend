import { useState, useEffect, useRef } from 'react';
import {
  logout as apiLogout,
  refreshToken,
  isTokenExpiringSoon,
  isTokenValid,
  ensureSessionAccessToken,
} from '../../utils/api/authApi';
import { clearAuthData, getPostLoginHomeUrl } from '../../utils/common/authUtils';
import {
  getStoredAccessToken,
  setStoredAccessToken,
  setStoredRefreshToken,
  getStoredRefreshToken,
  getStoredGoogleUserJson,
  setStoredGoogleUserJson,
  removeStoredGoogleUser,
} from '../../utils/security/authTokenStorage';

function profileFromUserData(userData) {
  return {
    id: userData.id != null ? String(userData.id) : '',
    name: userData.name,
    email: userData.email,
    imageUrl: userData.imageUrl || '',
    provider: userData.provider || 'GOOGLE',
  };
}

const useAuth = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const tokenRefreshIntervalRef = useRef(null);

  useEffect(() => {
    const checkAndRefreshToken = async () => {
      try {
        const token = getStoredAccessToken();
        if (token && isTokenExpiringSoon(token, 15 * 60)) {
          await refreshToken();
        }
      } catch (error) {
        console.warn('토큰 자동 갱신 실패:', error);
      }
    };

    tokenRefreshIntervalRef.current = setInterval(checkAndRefreshToken, 10 * 60 * 1000);

    return () => {
      if (tokenRefreshIntervalRef.current) {
        clearInterval(tokenRefreshIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const isCorruptedName = (name) => {
      if (!name) return false;
      return /[ìíîïðñòóôõö]/.test(name) || /\\x[0-9A-Fa-f]{2}/.test(name);
    };

    (async () => {
      try {
        const savedUser = getStoredGoogleUserJson();
        let profile = null;

        if (savedUser) {
          try {
            const userData = JSON.parse(savedUser);
            if (userData.accessToken) {
              setStoredAccessToken(userData.accessToken);
            }
            if (userData.refreshToken) {
              setStoredRefreshToken(userData.refreshToken);
            }
            profile = profileFromUserData(userData);
            setStoredGoogleUserJson(JSON.stringify(profile));

            if (isCorruptedName(profile.name)) {
              removeStoredGoogleUser();
              if (!cancelled) setIsLoading(false);
              return;
            }
          } catch {
            removeStoredGoogleUser();
          }
        }

        await ensureSessionAccessToken();
        if (cancelled) return;

        try {
          const oldToken = localStorage.getItem('access_token');
          if (oldToken) {
            localStorage.removeItem('access_token');
          }
        } catch {
          /* ignore */
        }

        const accessToken = getStoredAccessToken();
        if (accessToken && !isTokenValid(accessToken)) {
          clearAuthData();
          const currentPath = window.location.pathname;
          if (currentPath !== '/') {
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

  const login = (userData) => {
    const profile = profileFromUserData(userData);
    setUser(profile);

    try {
      setStoredGoogleUserJson(JSON.stringify(profile));
      if (userData.accessToken) {
        setStoredAccessToken(userData.accessToken);
      }
      if (userData.refreshToken) {
        setStoredRefreshToken(userData.refreshToken);
      }
    } catch {
      /* ignore */
    }
  };

  const logout = async () => {
    await apiLogout();

    setUser(null);

    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  };

  const isAuthenticated = () => {
    if (!user) return false;

    try {
      const hasToken = !!getStoredAccessToken();
      const hasGoogleUser = !!getStoredGoogleUserJson();
      return hasToken && hasGoogleUser;
    } catch {
      return false;
    }
  };

  return {
    user,
    isLoading,
    login,
    logout,
    isAuthenticated,
  };
};

export default useAuth;

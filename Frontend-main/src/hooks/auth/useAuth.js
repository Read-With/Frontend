import { useState, useEffect, useRef } from 'react';
import { logout as apiLogout, refreshToken, isTokenExpiringSoon, isTokenValid } from '../../utils/api/authApi';
import { clearAuthData } from '../../utils/common/authUtils';

const useAuth = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const tokenRefreshIntervalRef = useRef(null);

  // 토큰 자동 갱신 (10분마다 체크)
  useEffect(() => {
    const checkAndRefreshToken = async () => {
      try {
        const token = localStorage.getItem('accessToken');
        if (token && isTokenExpiringSoon(token, 15 * 60)) {
          await refreshToken();
        }
      } catch (error) {
        console.warn('토큰 자동 갱신 실패:', error);
      }
    };

    // 10분마다 토큰 만료 여부 확인
    tokenRefreshIntervalRef.current = setInterval(checkAndRefreshToken, 10 * 60 * 1000);

    return () => {
      if (tokenRefreshIntervalRef.current) {
        clearInterval(tokenRefreshIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('google_user');
      const accessToken = localStorage.getItem('accessToken');
      
      // 최초 접근시 토큰 만료 체크
      if (accessToken && !isTokenValid(accessToken)) {
        clearAuthData();
        const currentPath = window.location.pathname;
        if (currentPath !== '/') {
          window.location.href = 'http://localhost:5173/';
          return;
        }
      }
      
      try {
        const oldToken = localStorage.getItem('access_token');
        if (oldToken) {
          localStorage.removeItem('access_token');
        }
      } catch (err) {
        // localStorage 접근 실패 무시
      }
      
      if (savedUser) {
        try {
          const userData = JSON.parse(savedUser);
          
          const isCorruptedName = (name) => {
            if (!name) return false;
            return /[ìíîïðñòóôõö]/.test(name) || /\\x[0-9A-Fa-f]{2}/.test(name);
          };

          if (isCorruptedName(userData.name)) {
            try {
              localStorage.removeItem('google_user');
            } catch (err) {
              // localStorage 접근 실패 무시
            }
            setIsLoading(false);
            return;
          }

          setUser(userData);
          
          if (userData.accessToken) {
            try {
              localStorage.setItem('accessToken', userData.accessToken);
            } catch (err) {
              // localStorage 접근 실패 무시
            }
          }
        } catch (err) {
          try {
            localStorage.removeItem('google_user');
          } catch (storageErr) {
            // localStorage 접근 실패 무시
          }
        }
      }
    } catch (err) {
      // localStorage 접근 실패 처리
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = (userData) => {
    setUser(userData);
    
    try {
      localStorage.setItem('google_user', JSON.stringify(userData));
      
      if (userData.accessToken) {
        localStorage.setItem('accessToken', userData.accessToken);
      }
      
      if (userData.refreshToken) {
        localStorage.setItem('refreshToken', userData.refreshToken);
      }
    } catch (err) {
      // localStorage 접근 실패 처리
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
      const hasToken = !!localStorage.getItem('accessToken');
      const hasGoogleUser = !!localStorage.getItem('google_user');
      return hasToken && hasGoogleUser;
    } catch (err) {
      return false;
    }
  };

  return {
    user,
    isLoading,
    login,
    logout,
    isAuthenticated
  };
};

export default useAuth;

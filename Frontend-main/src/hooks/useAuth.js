import { useState, useEffect } from 'react';
import { logout as apiLogout } from '../utils/api/authApi';

const useAuth = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 로컬 스토리지에서 사용자 정보 확인
    const savedUser = localStorage.getItem('google_user');
    
    // 기존 잘못된 토큰 키 정리
    const oldToken = localStorage.getItem('access_token');
    if (oldToken) {
      localStorage.removeItem('access_token');
    }
    
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        
        // 깨진 데이터 감지
        const isCorruptedName = (name) => {
          if (!name) return false;
          // 깨진 UTF-8 패턴 감지 (ì, í, ì± 등)
          return /[ìíîïðñòóôõö]/.test(name) || /\\x[0-9A-Fa-f]{2}/.test(name);
        };

        // 깨진 데이터가 있으면 정리
        if (isCorruptedName(userData.name)) {
          localStorage.removeItem('google_user');
          setIsLoading(false);
          return;
        }

        // 한글 인코딩 문제 해결
        const decodeName = (name) => {
          if (!name) return '사용자';
          
          try {
            // 깨진 UTF-8 문자열을 올바르게 디코딩
            const decoded = decodeURIComponent(escape(name));
            return decoded;
          } catch (error) {
            return name;
          }
        };
        
        // 이름 디코딩 후 사용자 정보 업데이트
        const decodedUserData = {
          ...userData,
          name: decodeName(userData.name)
        };
        
        setUser(decodedUserData);
        
        // accessToken이 있으면 올바른 키로 저장
        if (decodedUserData.accessToken) {
          localStorage.setItem('accessToken', decodedUserData.accessToken);
        }
      } catch (err) {
        localStorage.removeItem('google_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem('google_user', JSON.stringify(userData));
    
    // accessToken이 있으면 별도로 저장 (api.js에서 사용하는 키와 일치)
    if (userData.accessToken) {
      localStorage.setItem('accessToken', userData.accessToken);
    }
  };

  const logout = async () => {
    // API 로그아웃 호출
    await apiLogout();
    
    setUser(null);
    localStorage.removeItem('google_user');
    localStorage.removeItem('accessToken'); // 키 이름 수정
    
    // Google Identity Services 정리
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  };

  // 깨진 사용자 데이터 정리 함수
  const clearCorruptedData = () => {
    setUser(null);
    localStorage.removeItem('google_user');
  };

  const isAuthenticated = () => {
    return !!user;
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

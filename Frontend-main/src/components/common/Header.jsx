import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, BookOpen } from 'lucide-react';
import './Header.css';
import useAuth from '../../hooks/useAuth';
import { secureLog } from '../../utils/security/oauthSecurity';

const Header = ({ userNickname, showAuthLinks = false }) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [loginError, setLoginError] = useState(null);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Google OAuth 로그인 시작
  const handleGoogleLogin = () => {
    try {
      setLoginError(null);
      
      // redirect_uri 설정 (로컬/프로덕션 구분)
      // 백엔드가 요청 본문의 redirectUri를 읽을 수 있도록 각 환경에 맞는 값 사용
      const getRedirectUri = () => {
        // 환경변수가 있으면 우선 사용
        if (import.meta.env.VITE_GOOGLE_REDIRECT_URI) {
          return import.meta.env.VITE_GOOGLE_REDIRECT_URI;
        }
        // 로컬 개발 환경: 로컬 프론트엔드 사용
        if (import.meta.env.DEV) {
          return `${window.location.protocol}//${window.location.host}/auth/callback`;
        }
        // 프로덕션 환경: 배포 서버 사용
        return 'https://dev.readwith.store/auth/callback';
      };
      
      // 환경변수에서 구글 클라이언트 ID 가져오기
      const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      const GOOGLE_REDIRECT_URI = getRedirectUri();
      
      if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'CLIENT_ID' || GOOGLE_CLIENT_ID === 'your_google_client_id_here') {
        setLoginError('Google OAuth 설정이 올바르지 않습니다. .env 파일에 VITE_GOOGLE_CLIENT_ID를 설정해주세요.');
        return;
      }
      
      // 구글 OAuth URL 구성 (가이드에 따라 직접 생성)
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&` +
        `response_type=code&` +
        `scope=email profile&` +
        `access_type=offline&` +
        `prompt=consent`;
      
      secureLog('Google OAuth 로그인 시작', { 
        clientId: GOOGLE_CLIENT_ID.substring(0, 10) + '...', 
        redirectUri: GOOGLE_REDIRECT_URI
      });
      
      // Google OAuth URL로 리다이렉트
      window.location.href = authUrl;
    } catch (err) {
      setLoginError(`로그인 실패: ${err.message}`);
    }
  };

  if (showAuthLinks && !user) {
    return (
      <div className="header-auth">
        <div className="header-left">
          <div className="header-logo">
            <span className="logo-icon">📖</span>
            <span className="logo-text">ReadWith</span>
          </div>
        </div>
        <div className="header-right">
          <div className="google-login-container">
            <button
              onClick={handleGoogleLogin}
              className="google-login-button"
              style={{ marginRight: '6rem'}}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#22c55e" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#16a34a" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#15803d" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#166534" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google 로그인
            </button>
            {loginError && (
              <div className="login-error">
                {loginError}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="user-topbar">
      <div className="user-topbar-left">
        <div className="user-topbar-brand">
          <div className="user-topbar-avatar">
            📖
          </div>
          <span className="brand-text">ReadWith</span>
          <span className="brand-separator">:</span>
          <span className="user-name">{userNickname || user?.name || 'User'}</span>
        </div>
      </div>
      
      <div className="user-topbar-right">
        <button 
          className="user-topbar-logout"
          onClick={handleLogout}
        >
          <LogOut size={16} strokeWidth={2} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};

export default Header; 
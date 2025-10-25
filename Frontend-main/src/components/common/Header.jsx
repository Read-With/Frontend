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
  const handleGoogleLogin = async () => {
    try {
      setLoginError(null);
      
      // 백엔드에서 OAuth URL 생성 요청
      console.log('백엔드에서 OAuth URL 생성 요청...');
      
      const response = await fetch('http://localhost:8080/api/auth/google/url', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`백엔드 응답 오류: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.isSuccess || !data.result || !data.result.authUrl) {
        throw new Error('백엔드에서 OAuth URL을 생성할 수 없습니다.');
      }
      
      // 백엔드에서 제공한 URL 템플릿을 실제 값으로 치환
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      const redirectUri = 'http://localhost:5173/auth/callback';
      
      if (!clientId || clientId === 'CLIENT_ID' || clientId === 'your_google_client_id_here') {
        setLoginError('Google OAuth 설정이 올바르지 않습니다. 환경변수를 확인해주세요.');
        return;
      }
      
      const authUrl = data.result.authUrl
        .replace('${GOOGLE_CLIENT_ID}', clientId)
        .replace('${GOOGLE_REDIRECT_URI}', redirectUri);
      
      console.log('백엔드 응답 데이터:', data);
      console.log('생성된 OAuth URL:', authUrl);
      console.log('사용된 리다이렉트 URI:', redirectUri);
      secureLog('Google OAuth 로그인 시작', { 
        clientId: clientId.substring(0, 10) + '...', 
        redirectUri 
      });
      
      // Google OAuth URL로 리다이렉트
      window.location.href = authUrl;
    } catch (err) {
      let errorMessage = '로그인 실패';
      
      if (err.message.includes('Failed to fetch')) {
        errorMessage = '백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.';
      } else {
        errorMessage = `로그인 실패: ${err.message}`;
      }
      
      setLoginError(errorMessage);
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
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../../utils/styles/styles';
import { ANIMATION_VALUES } from '../../utils/styles/animations';

const GoogleAuth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Google API 스크립트 로드
    const loadGoogleAPI = () => {
      if (window.google) {
        initializeGoogleAuth();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        window.gapi.load('auth2', initializeGoogleAuth);
      };
      document.head.appendChild(script);
    };

    const initializeGoogleAuth = () => {
      window.gapi.auth2.init({
        client_id: process.env.REACT_APP_GOOGLE_CLIENT_ID || 'your-google-client-id',
        scope: 'profile email'
      }).then(() => {
        const authInstance = window.gapi.auth2.getAuthInstance();
        if (authInstance.isSignedIn.get()) {
          const user = authInstance.currentUser.get();
          handleSignInSuccess(user);
        }
      }).catch(err => {
        console.error('Google Auth 초기화 실패:', err);
        setError('Google 인증을 초기화할 수 없습니다.');
      });
    };

    loadGoogleAPI();
  }, []);

  const handleSignInSuccess = (googleUser) => {
    const profile = googleUser.getBasicProfile();
    const userData = {
      id: profile.getId(),
      name: profile.getName(),
      email: profile.getEmail(),
      imageUrl: profile.getImageUrl()
    };
    
    setUser(userData);
    setIsLoading(false);
    
    // 로그인 성공 후 HomePage로 이동
    navigate('/');
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const authInstance = window.gapi.auth2.getAuthInstance();
      const googleUser = await authInstance.signIn();
      handleSignInSuccess(googleUser);
    } catch (err) {
      console.error('Google 로그인 실패:', err);
      setError('Google 로그인에 실패했습니다. 다시 시도해주세요.');
      setIsLoading(false);
    }
  };

  const handleSignOut = () => {
    const authInstance = window.gapi.auth2.getAuthInstance();
    authInstance.signOut().then(() => {
      setUser(null);
    });
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: theme.spacing.lg,
    padding: theme.spacing.md,
    background: theme.colors.background.main
  };

  const titleStyle = {
    fontSize: theme.fontSize['3xl'],
    fontWeight: 700,
    marginBottom: theme.spacing.xs,
    color: theme.colors.text.primary,
    textAlign: 'center',
    letterSpacing: '-0.01em'
  };

  const descriptionStyle = {
    fontSize: theme.fontSize.lg,
    color: theme.colors.text.secondary,
    maxWidth: '400px',
    textAlign: 'center',
    lineHeight: '1.6',
    marginBottom: theme.spacing.md
  };

  const userInfoStyle = {
    background: theme.colors.background.white,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    boxShadow: theme.boxShadow.md,
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%'
  };

  const userImageStyle = {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    marginBottom: theme.spacing.md,
    border: `3px solid ${theme.colors.primary.main}`
  };

  const userNameStyle = {
    fontSize: theme.fontSize.xl,
    fontWeight: 600,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs
  };

  const userEmailStyle = {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md
  };

  const errorStyle = {
    color: '#ef4444',
    fontSize: theme.fontSize.sm,
    textAlign: 'center',
    marginTop: theme.spacing.sm
  };

  const loadingStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    color: theme.colors.text.secondary
  };

  if (user) {
    return (
      <div style={containerStyle}>
        <h1 style={titleStyle}>환영합니다!</h1>
        <div style={userInfoStyle}>
          <img 
            src={user.imageUrl} 
            alt={user.name}
            style={userImageStyle}
          />
          <div style={userNameStyle}>{user.name}</div>
          <div style={userEmailStyle}>{user.email}</div>
          <button
            style={{
              ...createButtonStyle(ANIMATION_VALUES, 'secondary'),
              marginTop: theme.spacing.sm
            }}
            onClick={handleSignOut}
            {...createAdvancedButtonHandlers('secondary')}
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>ReadWith</h1>
      <p style={descriptionStyle}>
        Google 계정으로 로그인하여<br/>
        나만의 독서 공간을 시작하세요
      </p>
      
      <button
        style={{
          ...createButtonStyle(ANIMATION_VALUES, 'primary'),
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          minWidth: '200px',
          justifyContent: 'center'
        }}
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        {...createAdvancedButtonHandlers('primary')}
      >
        {isLoading ? (
          <div style={loadingStyle}>
            <div style={{
              width: '16px',
              height: '16px',
              border: '2px solid #ffffff',
              borderTop: '2px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            로그인 중...
          </div>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google로 로그인
          </>
        )}
      </button>

      {error && <div style={errorStyle}>{error}</div>}

      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default GoogleAuth;

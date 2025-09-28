import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../../utils/styles/styles';
import { ANIMATION_VALUES } from '../../utils/styles/animations';
import useAuth from '../../hooks/useAuth';

// 전문적인 UI 스타일 개선 - 스크롤 방지
const containerStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  minHeight: '100vh',
  width: '100%',
  padding: `${theme.spacing.lg} ${theme.spacing.md}`,
  background: `linear-gradient(135deg, ${theme.colors.background.main} 0%, rgba(79, 109, 222, 0.05) 100%)`
};

const heroSectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  maxWidth: '600px',
  marginBottom: theme.spacing.sm,
  animation: 'fadeInUp 0.8s ease-out 0.2s both'
};

const titleStyle = {
  fontSize: 'clamp(2.5rem, 5vw, 4rem)',
  fontWeight: 800,
  marginBottom: theme.spacing.xs,
  color: theme.colors.primary.main,
  textAlign: 'center',
  letterSpacing: '-0.02em',
  lineHeight: '1.1'
};

const subtitleStyle = {
  fontSize: theme.fontSize.xl,
  fontWeight: 500,
  color: theme.colors.text.secondary,
  marginBottom: 0,
  opacity: 0.9
};

const descriptionStyle = {
  fontSize: theme.fontSize.lg,
  color: theme.colors.text.secondary,
  maxWidth: '500px',
  textAlign: 'center',
  lineHeight: '1.7',
  marginTop: theme.spacing.xs,
  marginBottom: theme.spacing.sm,
  opacity: 0.8
};

const userInfoStyle = {
  background: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(20px)',
  padding: `${theme.spacing.xl} ${theme.spacing.lg}`,
  borderRadius: '24px',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
  textAlign: 'center',
  maxWidth: '450px',
  width: '100%',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  animation: 'fadeInUp 0.8s ease-out'
};

const userImageStyle = {
  width: '100px',
  height: '100px',
  borderRadius: '50%',
  marginBottom: theme.spacing.sm,
  border: `4px solid ${theme.colors.primary.main}`,
  boxShadow: '0 8px 25px rgba(79, 109, 222, 0.2)',
  transition: 'transform 0.3s ease'
};

const userNameStyle = {
  fontSize: theme.fontSize['2xl'],
  fontWeight: 700,
  color: theme.colors.text.primary,
  marginBottom: theme.spacing.sm,
  lineHeight: '1.2'
};

const userEmailStyle = {
  fontSize: theme.fontSize.base,
  color: theme.colors.text.secondary,
  marginBottom: theme.spacing.lg,
  opacity: 0.8
};

const errorStyle = {
  color: '#ef4444',
  fontSize: theme.fontSize.sm,
  textAlign: 'center',
  marginTop: theme.spacing.xs
};


const googleButtonContainerStyle = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: theme.spacing.lg,
  animation: 'fadeInUp 0.8s ease-out 0.2s both'
};

const authSectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 0,
  maxWidth: '500px',
  width: '100%'
};



const GoogleAuth = () => {
  const [error, setError] = useState(null);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
  const navigate = useNavigate();
  const { user, login, logout } = useAuth();

  const handleCredentialResponse = useCallback((response) => {
    if (!response.credential) {
      setError('Google 인증 응답이 올바르지 않습니다.');
      return;
    }
    
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      
      // 한글 인코딩 문제 해결
      const decodeName = (name) => {
        if (!name) return '사용자';
        
        try {
          // 깨진 UTF-8 문자열을 올바르게 디코딩
          const decoded = decodeURIComponent(escape(name));
          console.log('원본 이름:', name);
          console.log('디코딩된 이름:', decoded);
          return decoded;
        } catch (error) {
          console.warn('이름 디코딩 실패, 원본 사용:', name);
          return name;
        }
      };
      
      const userData = {
        id: payload.sub,
        name: decodeName(payload.name),
        email: payload.email,
        imageUrl: payload.picture
      };
      
      console.log('Google에서 가져온 사용자 정보:', userData);
      console.log('사용자 이름:', payload.name);
      console.log('디코딩된 사용자 이름:', userData.name);
      console.log('사용자 이름 타입:', typeof userData.name);
      
      login(userData);
      navigate('/mypage');
    } catch (err) {
      setError(`사용자 정보 처리 실패: ${err.message}`);
    }
  }, [navigate, login]);

  const initializeGoogleAuth = useCallback(() => {
    if (!window.google?.accounts?.id) {
      setError('Google Identity Services가 로드되지 않았습니다.');
      return;
    }

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

    // Client ID 검증
    if (!clientId) {
      setError('Google Client ID가 설정되지 않았습니다. .env 파일에 VITE_GOOGLE_CLIENT_ID를 설정해주세요.');
      return;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: false
      });
      
      // Google 버튼 렌더링
      window.google.accounts.id.renderButton(
        document.getElementById('g_id_signin'),
        {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          shape: 'rectangular',
          text: 'sign_in_with',
          logo_alignment: 'left'
        }
      );
    } catch (err) {
      console.error('Google Auth 초기화 실패:', err);
      setError(`Google 인증 초기화 실패: ${err.message}`);
    }
  }, [handleCredentialResponse]);

  const loadGoogleIdentityServices = () => {
    if (window.google?.accounts?.id) {
      initializeGoogleAuth();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setIsGoogleLoaded(true);
      initializeGoogleAuth();
    };
    script.onerror = () => {
      setError('Google 인증 서비스를 로드할 수 없습니다. 네트워크 연결을 확인해주세요.');
    };
    document.head.appendChild(script);
  };

  useEffect(() => {
    window.handleCredentialResponse = handleCredentialResponse;
    loadGoogleIdentityServices();
    
    return () => {
      delete window.handleCredentialResponse;
    };
  }, [handleCredentialResponse]);


  const handleSignOut = () => {
    logout();
  };



  if (user) {
    // 로그인된 사용자는 바로 마이페이지로 리다이렉트
    navigate('/mypage');
    return null;
  }

  return (
    <div style={containerStyle}>
      {/* 히어로 섹션 */}
      <div style={heroSectionStyle}>
        <h1 style={titleStyle}>ReadWith</h1>
        <p style={subtitleStyle}>스마트 독서 플랫폼</p>
        <p style={descriptionStyle}>나만의 독서 공간을 시작하세요</p>
      </div>

      {/* 인증 섹션 */}
      <div style={authSectionStyle}>
        <div 
          id="g_id_signin"
          style={googleButtonContainerStyle}
        ></div>
        
        {error && <div style={errorStyle}>{error}</div>}
      </div>

      <style>
        {`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          /* Google 버튼 둥근 모서리 스타일 */
          #g_id_signin {
            border-radius: 12px !important;
            box-shadow: none !important;
            border: 1px solid rgba(0, 0, 0, 0.1) !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            overflow: hidden !important;
          }
          
          #g_id_signin:hover {
            transform: translateY(-1px) !important;
            border-color: rgba(0, 0, 0, 0.2) !important;
          }
          
          #g_id_signin:active {
            transform: translateY(0) !important;
            border-color: rgba(0, 0, 0, 0.15) !important;
          }
          
          /* Google 버튼 내부 iframe도 둥글게 */
          #g_id_signin iframe {
            border-radius: 12px !important;
            border: none !important;
          }
        `}
      </style>
    </div>
  );
};

export default GoogleAuth;

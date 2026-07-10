import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../hooks/auth/useAuth';
import { startGoogleOAuthLogin } from '../utils/common/authUtils';
import './HomePage.css';

const GoogleIcon = () => (
  <svg className="landing-google-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/mypage');
    }
  }, [user, navigate]);

  const handleGoogleLogin = () => {
    setIsLoggingIn(true);
    const result = startGoogleOAuthLogin();
    if (!result?.ok) {
      setIsLoggingIn(false);
      alert(result.error || '구글 로그인을 시작할 수 없습니다.');
    }
  };

  return (
    <section className="landing-page">
      <div className="landing-content">
        <p className="landing-logo" lang="en">ReadWith</p>

        <h1 className="landing-title">이 책, 등장인물 관계가 어떻게 되더라?</h1>

        <div className="landing-body">
          <p className="landing-lead">
            책을 읽다 보면 누구나 한 번쯤 멈춥니다. 누가 누구 편인지, 언제부터 사이가 달라졌는지.
          </p>
          <p className="landing-desc">
            <span className="landing-desc-line">
              <span lang="en">ReadWith</span>는 읽는 위치에 맞춰 인물 관계도를 보여줍니다.
            </span>
            <span className="landing-desc-line">책을 올리고 읽다가, 헷갈리면 그래프를 열어보면 됩니다.</span>
          </p>
        </div>

        <button
          type="button"
          className="landing-login-btn"
          onClick={handleGoogleLogin}
          disabled={isLoggingIn}
          aria-busy={isLoggingIn}
          aria-label="Google로 시작하기"
        >
          {isLoggingIn ? (
            <>
              <span className="landing-login-spinner" aria-hidden="true" />
              <span>로그인 중...</span>
            </>
          ) : (
            <>
              <span className="landing-google-icon-wrap">
                <GoogleIcon />
              </span>
              <span>
                <span lang="en">Google</span>로 시작하기
              </span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}

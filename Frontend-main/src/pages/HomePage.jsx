import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import useAuth from '../hooks/auth/useAuth';
import { GoogleIcon } from '../components/auth/OAuthCallback';
import { startGoogleOAuthLogin, errorUtils } from '../utils/common/urlUtils';
import landingHero from '../assets/landing-hero-book.jpg';
import './HomePage.css';

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
      errorUtils.logWarning('HomePage', result?.error || '구글 로그인 시작 실패', {
        action: 'startGoogleOAuthLogin',
      });
      toast.error(result.error || '구글 로그인을 시작할 수 없습니다.');
    }
  };

  return (
    <section className="landing-page">
      <div className="landing-hero-media" aria-hidden="true">
        <img
          className="landing-hero-img"
          src={landingHero}
          alt=""
          width={1536}
          height={1024}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className="landing-scrim" aria-hidden="true" />

      <div className="landing-content">
        <h1 className="landing-logo" lang="en">
          ReadWith
        </h1>

        <p className="landing-title">이 책, 등장인물 관계가 어떻게 되더라?</p>

        <p className="landing-lead">
          읽는 위치에 맞춰 인물 관계도를 보여줍니다. 헷갈리면 그래프를 열어보세요.
        </p>

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
                <GoogleIcon className="landing-google-icon" />
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

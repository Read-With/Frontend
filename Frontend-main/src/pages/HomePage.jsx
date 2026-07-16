import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../hooks/auth/useAuth';
import { startGoogleOAuthLogin } from '../utils/common/urlUtils';
import { GoogleIcon } from '../components/common/headerShared';
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

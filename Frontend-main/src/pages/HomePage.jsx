import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../hooks/auth/useAuth';
import OAuthCallback from '../components/auth/OAuthCallback';
import { getGoogleOAuthRedirectUri } from '../utils/common/authUtils';
import { createAndStoreGoogleOAuthState } from '../utils/security/oauthSecurity';
import './HomePage.css';

// 스크롤 섹션 컴포넌트들
const HeroSection = () => {
  const [currentPage, setCurrentPage] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  useEffect(() => {
    setIsVisible(true);
  }, []);

  const storyPages = [
    {
      title: "이 책, 등장인물 관계가 어떻게 되더라?",
      subtitle: "책을 읽다 보면 누구나 한 번쯤 드는 생각이죠",
      content: "'해리와 말포이는 정말 숙명의 적일까?', '헤르미온느와 론은 언제부터 서로를 좋아한걸까?'\n\n<strong>이런 궁금증과 복잡함을 한눈에 해결해 줄 무언가가 필요하다고 생각한 적 없으신가요?</strong>",
      illustration: "🤔",
      pageClass: 'page-1'
    },
    {
      title: "이제, 책을 탐험하는 시대",
      subtitle: "단순히 읽는 것을 넘어, 이야기 속으로 직접 뛰어드세요",
      content: "XHTML 뷰어에서 실시간으로 펼쳐지는 인물 관계도를 확인하고, 터치 한 번으로 다른 인물의 시점에서 사건을 다시 보세요.\n\n<strong>독서의 새로운 기준, 지금 경험해보세요.</strong>",
      pageClass: 'page-2'
    }
  ];

  const nextPage = () => {
    setCurrentPage(prev => {
      const newPage = prev + 1;
      return newPage;
    });
  };

  const prevPage = () => {
    setCurrentPage(prev => {
      const newPage = prev - 1;
      return newPage;
    });
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      // redirect_uri 설정 (로컬/프로덕션 구분)
      // 백엔드가 요청 본문의 redirectUri를 읽을 수 있도록 각 환경에 맞는 값 사용
      const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'your-google-client-id';
      const GOOGLE_REDIRECT_URI = getGoogleOAuthRedirectUri();
      
      // 구글 OAuth URL 구성
      const oauthState = createAndStoreGoogleOAuthState();
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&` +
        `response_type=code&` +
        `scope=email profile&` +
        `access_type=offline&` +
        `prompt=consent&` +
        `state=${encodeURIComponent(oauthState)}`;
      
      // 구글 인증 페이지로 리다이렉트
      window.location.href = authUrl;
      
    } catch (_err) {
      setIsLoggingIn(false);
      alert('구글 로그인 중 오류가 발생했습니다.');
    }
  };

  return (
    <section className="scroll-section hero-section story-book">
      {/* 고정된 투명 벽 */}
      <div 
        className="fixed-navigation-wall"
        style={{
          position: 'fixed',
          bottom: '0',
          left: '0',
          right: '0',
          height: '120px',
          zIndex: 10000,
          pointerEvents: 'auto',
          background: 'linear-gradient(0deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div 
          className="story-navigation"
          style={{
            position: 'relative',
            zIndex: 10001,
            pointerEvents: 'auto',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            padding: '15px 25px',
            borderRadius: '25px',
            border: '2px solid #5C6F5C',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            gap: '15px',
            marginBottom: '100px'
          }}
        >
          <button 
            className="nav-button prev" 
            onClick={() => {
              prevPage();
            }}
            disabled={currentPage === 0}
            style={{
              pointerEvents: 'auto',
              zIndex: 10002,
              position: 'relative',
              backgroundColor: currentPage === 0 ? '#ccc' : '#5C6F5C',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              fontSize: '14px',
              cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
              borderRadius: '20px',
              fontWeight: '600',
              transition: 'all 0.3s ease',
              opacity: currentPage === 0 ? 0.5 : 1
            }}
          >
            ← 이전
          </button>
          <button 
            className="nav-button next" 
            onClick={() => {
              nextPage();
            }}
            disabled={currentPage === storyPages.length - 1}
            style={{
              pointerEvents: 'auto',
              zIndex: 10002,
              position: 'relative',
              backgroundColor: currentPage === storyPages.length - 1 ? '#ccc' : '#4A7C28',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              fontSize: '14px',
              cursor: currentPage === storyPages.length - 1 ? 'not-allowed' : 'pointer',
              borderRadius: '20px',
              fontWeight: '600',
              transition: 'all 0.3s ease',
              opacity: currentPage === storyPages.length - 1 ? 0.5 : 1
            }}
          >
            다음 →
          </button>
        </div>
      </div>

      <div className="book-container">
        <div className="book-cover">
          <div className="library-card-spine"></div>
          <div className="book-pages">
            <div className={`story-page ${storyPages[currentPage].pageClass} ${isVisible ? 'visible' : ''}`}>
              {currentPage === storyPages.length - 1 && (
                <div className="space-background">
                  <div className="planet"></div>
                  <div className="planet"></div>
                  <div className="planet"></div>
                  <div className="planet"></div>
                  <div className="planet"></div>
                  <div className="star"></div>
                  <div className="star"></div>
                  <div className="star"></div>
                  <div className="star"></div>
                  <div className="star"></div>
                  <div className="orbit-line"></div>
                  <div className="orbit-line"></div>
                  <div className="orbit-line"></div>
                </div>
              )}
              <div className="page-number">{currentPage + 1} / {storyPages.length}</div>
              <div className="story-illustration">
                {storyPages[currentPage].illustration}
              </div>
              <h1 className="story-title">{storyPages[currentPage].title}</h1>
              <h2 className="story-subtitle">{storyPages[currentPage].subtitle}</h2>
              <div className="story-content-wrapper">
                <p className="story-content" dangerouslySetInnerHTML={{__html: storyPages[currentPage].content}}></p>
                
                {/* 마지막 페이지에서만 구글 로그인 버튼 표시 */}
                {currentPage === storyPages.length - 1 && (
                  <div className="google-login-section" style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button 
                      className={`google-login-button ${isLoggingIn ? 'loading' : ''}`}
                      onClick={handleGoogleLogin}
                      disabled={isLoggingIn}
                    >
                      {isLoggingIn ? (
                        <>
                          <div className="loading-spinner"></div>
                          로그인 중...
                        </>
                      ) : (
                        <>
                          <svg className="google-icon" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                          Google로 시작하기
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="book-shadow"></div>
      </div>
    </section>
  );
};

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');

  useEffect(() => {
    if (user && !code && !oauthError) {
      navigate('/mypage');
    }
  }, [user, navigate, code, oauthError]);

  if (code || oauthError) {
    return <OAuthCallback />;
  }

  return (
    <div className="homepage-container">
      <HeroSection />
    </div>
  );
} 
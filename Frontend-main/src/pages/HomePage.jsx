import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import OAuthCallback from '../components/auth/OAuthCallback';
import './HomePage.css';

// 스크롤 섹션 컴포넌트들
const HeroSection = () => {
  const [currentPage, setCurrentPage] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  useEffect(() => {
    console.log('HeroSection mounted');
    setIsVisible(true);
  }, []);

  useEffect(() => {
    console.log('currentPage changed to:', currentPage);
  }, [currentPage]);

  const storyPages = [
    {
      title: "이 책, 등장인물 관계가 어떻게 되더라?",
      subtitle: "책을 읽다 보면 누구나 한 번쯤 드는 생각이죠",
      content: "'해리와 말포이는 정말 숙명의 적일까?', '헤르미온느와 론은 언제부터 서로를 좋아한걸까?'\n\n<strong>이런 궁금증과 복잡함을 한눈에 해결해 줄 무언가가 필요하다고 생각한 적 없으신가요?</strong>",
      illustration: "🤔"
    },
    {
      title: "관계의 지도",
      subtitle: "이제 당신의 손으로 인물들의 관계를 탐험해보세요",
      content: "인물들을 드래그해보고, 관계선을 클릭해보세요.\n\n해리, 헤르미온느, 론, 말포이, 덤블도어, 볼드모트... 이들의 관계를 시각적으로 탐험해보세요. 드래그하고, 클릭하고, 발견해보세요.",
    },
    {
      title: "시점의 전환",
      subtitle: "같은 사건도 누구의 관점에서 보느냐에 따라 완전히 다르게 해석됩니다",
      content: "해리와 말포이의 첫 만남을 예로 들어보세요.\n\n해리에게는 '오만한 놈'이었지만, 말포이에게는 '유명세에 취한 놈'이었습니다. 진실은 하나지만, 해석은 무수히 많습니다.",
    },
    {
      title: "이제, 책을 탐험하는 시대",
      subtitle: "단순히 읽는 것을 넘어, 이야기 속으로 직접 뛰어드세요",
      content: "EPUB 뷰어에서 실시간으로 펼쳐지는 인물 관계도를 확인하고, 터치 한 번으로 다른 인물의 시점에서 사건을 다시 보세요.\n\n<strong>독서의 새로운 기준, 지금 경험해보세요.</strong>",
    }
  ];

  const nextPage = () => {
    console.log('nextPage clicked, currentPage:', currentPage);
    setCurrentPage(prev => {
      const newPage = prev + 1;
      console.log('Page changing from', prev, 'to', newPage);
      return newPage;
    });
  };

  const prevPage = () => {
    console.log('prevPage clicked, currentPage:', currentPage);
    setCurrentPage(prev => {
      const newPage = prev - 1;
      console.log('Page changing from', prev, 'to', newPage);
      return newPage;
    });
  };

  const handleGoogleLogin = () => {
    setIsLoggingIn(true);
    try {
      // 현재 로컬 스토리지 상태 확인
      console.log('현재 로컬 스토리지 상태:');
      console.log('accessToken:', localStorage.getItem('accessToken'));
      console.log('google_user:', localStorage.getItem('google_user'));
      
      // 백엔드 서버가 작동하지 않을 경우를 대비한 임시 로그인
      // 실제 환경에서는 백엔드 OAuth를 사용해야 함
      setTimeout(() => {
        const mockUser = {
          id: 'mock_user_123',
          name: '테스트 사용자',
          email: 'test@example.com',
          picture: 'https://via.placeholder.com/150'
        };
        
        const mockToken = 'mock_access_token_' + Date.now();
        
        // 로컬 스토리지에 저장
        localStorage.setItem('accessToken', mockToken);
        localStorage.setItem('google_user', JSON.stringify(mockUser));
        
        console.log('임시 로그인 완료:', mockUser);
        setIsLoggingIn(false);
        
        // 페이지 새로고침하여 로그인 상태 반영
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Google 로그인 오류:', error);
      setIsLoggingIn(false);
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
            border: '2px solid #2C3E50',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            gap: '15px',
            marginBottom: '100px'
          }}
        >
          <button 
            className="nav-button prev" 
            onClick={() => {
              console.log('PREV BUTTON CLICKED!');
              prevPage();
            }}
            disabled={currentPage === 0}
            style={{
              pointerEvents: 'auto',
              zIndex: 10002,
              position: 'relative',
              backgroundColor: currentPage === 0 ? '#ccc' : '#2C3E50',
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
              console.log('NEXT BUTTON CLICKED!');
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
          <div className="book-spine"></div>
          <div className="book-pages">
            <div className={`story-page ${isVisible ? 'visible' : ''}`}>
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
              <div className="story-illustration">{storyPages[currentPage].illustration}</div>
              <h1 className="story-title">{storyPages[currentPage].title}</h1>
              <h2 className="story-subtitle">{storyPages[currentPage].subtitle}</h2>
              <div className="story-content-wrapper">
                <p className="story-content" dangerouslySetInnerHTML={{__html: storyPages[currentPage].content}}></p>
                
                {/* 마지막 페이지에서만 구글 로그인 버튼 표시 */}
                {currentPage === storyPages.length - 1 && (
                  <div className="google-login-section">
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
  
  // OAuth 콜백 처리
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // OAuth 콜백이 있으면 OAuthCallback 컴포넌트 렌더링
  if (code || error) {
    return <OAuthCallback />;
  }

  // OAuth 오류 처리
  const oauthError = searchParams.get('error');
  if (oauthError) {
    return (
      <div className="homepage-container">
        <div className="main-content">
          <div className="hero-section">
            <h1 className="hero-title">OAuth 오류</h1>
            <p className="hero-subtitle">로그인 중 오류가 발생했습니다.</p>
            <p className="hero-description">
              오류 코드: {oauthError}
            </p>
            <button 
              className="cta-button"
              onClick={() => navigate('/')}
            >
              홈으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 로그인된 사용자는 마이페이지로 리다이렉트
  useEffect(() => {
    console.log('useEffect user check:', user);
    if (user) {
      console.log('User logged in, redirecting to mypage');
      navigate('/mypage');
    }
  }, [user, navigate]);


  console.log('HomePage rendering, user:', user);
  
  return (
    <div className="homepage-container">
      <HeroSection />
    </div>
  );
} 
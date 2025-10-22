import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import Header from '../components/common/Header';
import OAuthCallback from '../components/auth/OAuthCallback';
import './HomePage.css';

// 스크롤 섹션 컴포넌트들
const HeroSection = () => {
  const [scrollY, setScrollY] = useState(0);
  
  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <section className="scroll-section hero-section">
      <div className="hero-background">
        <div className="network-animation" style={{ transform: `translateY(${scrollY * 0.5}px)` }}>
          <div className="network-node" style={{ top: '15%', left: '10%', animationDelay: '0s' }}></div>
          <div className="network-node" style={{ top: '25%', right: '15%', animationDelay: '0.5s' }}></div>
          <div className="network-node" style={{ top: '75%', left: '20%', animationDelay: '1s' }}></div>
          <div className="network-node" style={{ top: '85%', right: '25%', animationDelay: '1.5s' }}></div>
          <div className="network-node" style={{ top: '50%', left: '5%', animationDelay: '2s' }}></div>
          <div className="network-node" style={{ top: '50%', right: '5%', animationDelay: '2.5s' }}></div>
          <div className="network-connection" style={{ top: '20%', left: '15%', width: '200px', transform: 'rotate(15deg)' }}></div>
          <div className="network-connection" style={{ top: '80%', left: '25%', width: '150px', transform: 'rotate(-20deg)' }}></div>
          <div className="network-connection" style={{ top: '55%', left: '10%', width: '180px', transform: 'rotate(10deg)' }}></div>
        </div>
      </div>
      <div className="hero-content">
          <h1 className="hero-title">
            <span className="title-main">작품 속 인물들간의</span>
            <span className="title-brand">관계를 탐험해보세요</span>
          </h1>
        <div className="hero-guide">
          <p className="hero-subtitle">스크롤을 내려 기능을 직접 체험해보세요</p>
          <div className="scroll-arrows">
            <div className="arrow"></div>
            <div className="arrow"></div>
            <div className="arrow"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const InteractionSection = () => {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="scroll-section interaction-section">
      <div className="section-content">
        <h2 className="section-title">그래프를 직접 조작해보세요</h2>
        <p className="section-description">
          드래그하거나 인물 위에 마우스를 올려보세요
        </p>
        <div className={`interactive-demo ${isVisible ? 'visible' : ''}`}>
          <div className="demo-graph">
            <div className="demo-node" style={{ top: '30%', left: '20%' }}>A</div>
            <div className="demo-node" style={{ top: '40%', right: '25%' }}>B</div>
            <div className="demo-node" style={{ top: '60%', left: '30%' }}>C</div>
            <div className="demo-connection" style={{ top: '35%', left: '25%', width: '200px', transform: 'rotate(15deg)' }}></div>
            <div className="demo-connection" style={{ top: '50%', left: '35%', width: '150px', transform: 'rotate(-20deg)' }}></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const RelationshipSection = () => {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="scroll-section relationship-section">
      <div className="section-content">
        <h2 className="section-title">관계의 다채로운 의미</h2>
        <div className={`relationship-demo ${isVisible ? 'visible' : ''}`}>
          <div className="relationship-focus">
            <div className="focus-node focus-node-a">A</div>
            <div className="focus-node focus-node-b">B</div>
            <div className="focus-connection strong-friendly"></div>
            <div className="relationship-legend">
              <div className="legend-item">
                <div className="legend-line strong-friendly"></div>
                <span>선 굵기: 관계의 강도</span>
              </div>
              <div className="legend-item">
                <div className="legend-line friendly"></div>
                <span>색상: 관계 유형 (우호/적대)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const PerspectiveSection = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [selectedPerspective, setSelectedPerspective] = useState('A');
  const sectionRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="scroll-section perspective-section">
      <div className="section-content">
        <h2 className="section-title">시점의 전환</h2>
        <p className="section-description">
          다른 인물의 관점에서 보면 세상이 달라 보입니다
        </p>
        <div className={`perspective-demo ${isVisible ? 'visible' : ''}`}>
          <div className="perspective-controls">
            <button 
              className={`perspective-btn ${selectedPerspective === 'A' ? 'active' : ''}`}
              onClick={() => setSelectedPerspective('A')}
            >
              A의 시점
            </button>
            <button 
              className={`perspective-btn ${selectedPerspective === 'B' ? 'active' : ''}`}
              onClick={() => setSelectedPerspective('B')}
            >
              B의 시점
            </button>
          </div>
          <div className={`perspective-graph ${selectedPerspective.toLowerCase()}-perspective`}>
            <div className="perspective-node" style={{ opacity: selectedPerspective === 'A' ? 1 : 0.3 }}>A</div>
            <div className="perspective-node" style={{ opacity: selectedPerspective === 'B' ? 1 : 0.3 }}>B</div>
            <div className="perspective-node" style={{ opacity: selectedPerspective === 'A' ? 1 : 0.1 }}>C</div>
            <div className="perspective-connection" style={{ 
              opacity: selectedPerspective === 'A' ? 1 : 0.2,
              backgroundColor: selectedPerspective === 'B' ? '#ef4444' : '#10b981'
            }}></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const CTASection = () => {
  const navigate = useNavigate();
  
  return (
    <section className="scroll-section cta-section">
      <div className="section-content">
        <h2 className="section-title">이제 당신의 이야기로</h2>
        <p className="section-description">
          원하는 작품을 선택해 직접 관계를 분석해보세요
        </p>
        <button 
          className="cta-button"
          onClick={() => navigate('/mypage')}
        >
          서비스 시작하기
        </button>
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
        <Header showAuthLinks={true} />
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
    if (user) {
      navigate('/mypage');
    }
  }, [user, navigate]);

  return (
    <div className="scrolltelling-container">
      <Header showAuthLinks={true} />
      <HeroSection />
      <InteractionSection />
      <RelationshipSection />
      <PerspectiveSection />
      <CTASection />
    </div>
  );
} 
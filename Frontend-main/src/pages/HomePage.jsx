import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import './HomePage.css';

const features = [
  {
    id: 1,
    title: '인물 관계도 파악',
    description: '노드 및 간선에 따라 등장인물 간의 관계를 시각화합니다',
    details: [
      '• 네트워크 그래프로 인물 관계 시각화',
      '• 인물 간 연결 강도 표시',
      '• 특정 인물 중심 관계 분석',
      '• 관계 유형별 색상 구분',
      '• 인터랙티브 그래프 탐색'
    ]
  },
  {
    id: 2,
    title: '타인물 시점으로 보기',
    description: '다른 인물의 관점에서 이야기를 다시 해석해보세요',
    details: [
      '• 등장인물 선택 시점 변경',
      '• 해당 인물이 알 수 있는 정보만 표시',
      '• 인물별 감정과 생각 분석',
      '• 시점별 이야기 해석 차이',
      '• 인물 심리 상태 추적'
    ]
  },
  {
    id: 3,
    title: '챗봇',
    description: 'AI와 대화하며 독서에 대한 질문을 해보세요',
    details: [
      '• 인물에 대한 질문과 답변',
      '• 줄거리 요약 및 설명',
      '• 테마와 의미 해석 도움',
      '• 독서 가이드 및 팁 제공',
      '• 개인화된 독서 경험'
    ]
  }
];


const FeatureCard = ({ feature, index, isExpanded, onToggle }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  
  const cardStyle = {
    animation: `fadeInUp 0.6s ease-out ${0.4 + index * 0.1}s both`,
    ...(isExpanded ? {
      gridRow: '1 / 3',
      gridColumn: `${index + 1} / ${index + 2}`
    } : {
      gridRow: '1 / 2',
      gridColumn: `${index + 1} / ${index + 2}`
    })
  };

  const cardClassName = isExpanded ? 'feature-card expanded' : 'feature-card';

  const handleClick = () => {
    if (isExpanded) {
      setIsClosing(true);
      setTimeout(() => {
        onToggle(feature.id);
        setIsClosing(false);
      }, 100);
    } else {
      onToggle(feature.id);
    }
  };

  return (
    <div
      className={cardClassName}
      style={cardStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <h3 className="feature-title">{feature.title}</h3>
      <p className="feature-description">{feature.description}</p>
      {isExpanded && (
        <ul className={isClosing ? 'feature-details closing' : 'feature-details'}>
          {feature.details.map((detail, idx) => (
            <li key={idx} className="feature-detail-item">
              {detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default function HomePage() {
  const [error, setError] = useState(null);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
  const [expandedFeature, setExpandedFeature] = useState(null);
  const navigate = useNavigate();
  const { user, login, logout } = useAuth();

  const handleFeatureToggle = (featureId) => {
    setExpandedFeature(expandedFeature === featureId ? null : featureId);
  };

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
          if (import.meta.env.DEV) {
            console.log('원본 이름:', name);
            console.log('디코딩된 이름:', decoded);
          }
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
      
      // 프로덕션에서는 디버깅 로그 제거
      if (import.meta.env.DEV) {
        console.log('Google에서 가져온 사용자 정보:', userData);
      }
      
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

    // 환경변수에서 Client ID 가져오기
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

  if (user) {
    // 로그인된 사용자는 바로 마이페이지로 리다이렉트
    navigate('/mypage');
    return null;
  }

  return (
    <div className="homepage-container">
      {/* 히어로 섹션 */}
      <div className="hero-section">
        <h1 className="hero-title">ReadWith</h1>
        <p className="hero-subtitle">스마트 독서 플랫폼</p>
        <p className="hero-description">나만의 독서 공간을 시작하세요</p>
      </div>

      {/* 인증 섹션 */}
      <div className="auth-section">
        <div 
          id="g_id_signin"
          className="google-button-container"
        ></div>
        
        {error && <div className="error-message">{error}</div>}
      </div>

      {/* 기능 소개 섹션 */}
      <div className="features-section">
        <h2 className="features-title">주요 기능</h2>
        <div className="features-grid">
          {features.map((feature, index) => (
            <FeatureCard 
              key={feature.id} 
              feature={feature} 
              index={index}
              isExpanded={expandedFeature === feature.id}
              onToggle={handleFeatureToggle}
            />
          ))}
        </div>
      </div>

    </div>
  );
} 
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../components/common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../utils/styles/styles';
import { ANIMATION_VALUES } from '../utils/styles/animations';
import useAuth from '../hooks/useAuth';

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

// GoogleAuth와 동일한 스타일 정의
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

const featuresSectionStyle = {
  width: '100%',
  maxWidth: '1200px',
  marginTop: theme.spacing.xl,
  padding: `0 ${theme.spacing.md}`
};

const featuresGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gridTemplateRows: '1fr 1fr',
  gap: theme.spacing.lg,
  marginTop: theme.spacing.lg,
  maxWidth: '1200px',
  margin: `${theme.spacing.lg} auto 0 auto`,
  alignContent: 'start',
  minHeight: '320px'
};

const featureCardStyle = {
  background: 'rgba(255, 255, 255, 0.95)',
  borderRadius: '16px',
  padding: theme.spacing.lg,
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden'
};

const featureCardHoverStyle = {
  transform: 'translateY(-2px)',
  boxShadow: '0 8px 25px rgba(0, 0, 0, 0.12)'
};

const featureCardExpandedStyle = {
  transform: 'scale(1.03)',
  zIndex: 10,
  boxShadow: '0 25px 80px rgba(0, 0, 0, 0.25)',
  background: 'rgba(255, 255, 255, 0.98)'
};

const featureTitleStyle = {
  fontSize: theme.fontSize.lg,
  fontWeight: 700,
  color: theme.colors.text.primary,
  marginBottom: theme.spacing.sm,
  lineHeight: '1.4'
};

const featureDescriptionStyle = {
  fontSize: theme.fontSize.md,
  color: theme.colors.text.secondary,
  marginBottom: theme.spacing.md,
  lineHeight: '1.6'
};

const featureDetailsStyle = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  animation: 'slideDown 0.4s ease-out'
};

const featureDetailsClosingStyle = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  animation: 'slideUp 0.005s ease-out'
};

const featureDetailItemStyle = {
  fontSize: theme.fontSize.sm,
  color: theme.colors.text.secondary,
  marginBottom: theme.spacing.xs,
  paddingLeft: theme.spacing.sm,
  lineHeight: '1.5'
};

const sectionTitleStyle = {
  fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
  fontWeight: 700,
  color: theme.colors.text.primary,
  textAlign: 'center',
  marginTop: theme.spacing.xs,
  marginBottom: theme.spacing.xl,
  opacity: 0.9,
  animation: 'fadeInUp 0.6s ease-out 0.3s both'
};

const FeatureCard = ({ feature, index, isExpanded, onToggle }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  
  const cardStyle = {
    ...featureCardStyle,
    ...(isExpanded ? featureCardExpandedStyle : isHovered ? featureCardHoverStyle : {}),
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
      <h3 style={featureTitleStyle}>{feature.title}</h3>
      <p style={featureDescriptionStyle}>{feature.description}</p>
      {isExpanded && (
        <ul style={isClosing ? featureDetailsClosingStyle : featureDetailsStyle}>
          {feature.details.map((detail, idx) => (
            <li key={idx} style={featureDetailItemStyle}>
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

    // 개발 환경에서만 디버깅 로그 출력
    if (import.meta.env.DEV) {
      console.log('환경변수 VITE_GOOGLE_CLIENT_ID:', import.meta.env.VITE_GOOGLE_CLIENT_ID);
      console.log('사용할 Client ID:', clientId);
    }

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

      {/* 기능 소개 섹션 */}
      <div style={featuresSectionStyle}>
        <h2 style={sectionTitleStyle}>주요 기능</h2>
        <div className="features-grid" style={featuresGridStyle}>
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
          
          @keyframes slideDown {
            from {
              opacity: 0;
              transform: translateY(-10px);
              max-height: 0;
            }
            to {
              opacity: 1;
              transform: translateY(0);
              max-height: 200px;
            }
          }
          
          @keyframes slideUp {
            from {
              opacity: 1;
              transform: translateY(0);
              max-height: 200px;
            }
            to {
              opacity: 0;
              transform: translateY(-10px);
              max-height: 0;
            }
          }
          
          /* 반응형 그리드 */
          @media (max-width: 768px) {
            .features-grid {
              grid-template-columns: 1fr !important;
              grid-template-rows: repeat(3, 1fr) !important;
              min-height: auto !important;
            }
            
            .feature-card {
              grid-column: 1 / 2 !important;
            }
            
            .feature-card.expanded {
              grid-row: span 2 !important;
            }
          }
          
          @media (max-width: 1024px) and (min-width: 769px) {
            .features-grid {
              grid-template-columns: repeat(2, 1fr) !important;
              grid-template-rows: 1fr 2fr !important;
            }
            
            .feature-card:nth-child(3) {
              grid-column: 1 / 3 !important;
              grid-row: 2 / 3 !important;
            }
          }
          
          @media (max-width: 480px) {
            .features-grid {
              grid-template-columns: 1fr !important;
              grid-template-rows: repeat(3, auto) !important;
              gap: 1rem !important;
              min-height: auto !important;
            }
            
            .feature-card {
              grid-column: 1 / 2 !important;
              grid-row: auto !important;
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
} 
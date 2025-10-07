import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import Header from '../components/common/Header';
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
  const [expandedFeature, setExpandedFeature] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleFeatureToggle = (featureId) => {
    setExpandedFeature(expandedFeature === featureId ? null : featureId);
  };

  const handleImageClick = (imageId) => {
    setSelectedImage(imageId);
  };

  const handleCloseTooltip = () => {
    setSelectedImage(null);
  };


  // ESC 키로 툴팁 닫기
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && selectedImage) {
        setSelectedImage(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedImage]);

  if (user) {
    // 로그인된 사용자는 바로 마이페이지로 리다이렉트
    navigate('/mypage');
    return null;
  }

  return (
    <div className="homepage-container">
      <Header showAuthLinks={true} />
      
      {/* 메인 콘텐츠 */}
      <div className="main-content">
        {/* 히어로 섹션 */}
        <div className="hero-section">
          <h1 className="hero-title">
            <span className="title-main">스마트 독서 플랫폼, </span>
            <span className="title-brand">ReadWith</span>
          </h1>
          <p className="hero-description">나를 위한 독서 공간에서 독서 경험을 재정의하세요</p>
        </div>

        {/* 이미지 박스들 */}
        <div className="placeholder-section">
           <div className="image-box" onClick={() => handleImageClick(1)}>
             <div className="image-container">
               <img 
                 src="/viewerpage.png" 
                 alt="뷰어 페이지" 
                 className="preview-image"
               />
               <div className="image-overlay">
                 <span className="image-text">뷰어 페이지</span>
               </div>
             </div>
           </div>
           <div className="image-box" onClick={() => handleImageClick(2)}>
             <div className="image-container">
               <img 
                 src="/graphpage.png" 
                 alt="그래프 페이지" 
                 className="preview-image"
               />
               <div className="image-overlay">
                 <span className="image-text">그래프 페이지</span>
               </div>
             </div>
           </div>
        </div>
      </div>

      {/* 확대된 이미지 툴팁 */}
      {selectedImage && (
        <div className="image-tooltip-overlay" onClick={handleCloseTooltip}>
          <div className="image-tooltip-content" onClick={(e) => e.stopPropagation()}>
            <button className="tooltip-close-btn" onClick={handleCloseTooltip}>×</button>
             <div className="tooltip-image-container">
               {selectedImage === 1 ? (
                 <img 
                   src="/viewerpage.png" 
                   alt="뷰어 페이지 확대" 
                   className="tooltip-image"
                 />
               ) : selectedImage === 2 ? (
                 <img 
                   src="/graphpage.png" 
                   alt="그래프 페이지 확대" 
                   className="tooltip-image"
                 />
               ) : (
                 <div className="tooltip-image-placeholder">
                   <span className="tooltip-image-icon">🖼️</span>
                   <span className="tooltip-image-text">이미지 {selectedImage} 확대</span>
                   <span className="tooltip-image-description">여기에 실제 이미지가 표시됩니다</span>
                 </div>
               )}
             </div>
          </div>
        </div>
      )}

    </div>
  );
} 
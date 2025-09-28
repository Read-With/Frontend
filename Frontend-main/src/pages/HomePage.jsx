import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { theme } from '../components/common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../utils/styles/styles';
import { ANIMATION_VALUES } from '../utils/styles/animations';
import useAuth from '../hooks/useAuth';

const HomeButton = ({ onClick, children, variant = 'primary' }) => {
  const baseButtonStyle = {
    background: variant === 'primary' 
      ? theme.gradients.primary
      : 'rgba(255, 255, 255, 0.8)',
    color: variant === 'primary' 
      ? '#ffffff'
      : theme.colors.primary,
    border: variant === 'primary' 
      ? 'none' 
      : `2px solid ${theme.colors.primary}`,
    padding: `${theme.spacing.md} ${theme.spacing.xl}`,
    borderRadius: '50px',
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    boxShadow: variant === 'primary'
      ? theme.boxShadow.md
      : theme.boxShadow.sm,
    minWidth: '200px',
    textAlign: 'center',
    letterSpacing: '0.5px',
    transform: 'translateY(0)'
  };

  return (
    <button
      style={baseButtonStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.target.style.transform = 'translateY(-2px)';
        e.target.style.boxShadow = theme.boxShadow.hover;
      }}
      onMouseLeave={(e) => {
        e.target.style.transform = 'translateY(0)';
        e.target.style.boxShadow = variant === 'primary'
          ? theme.boxShadow.md
          : theme.boxShadow.sm;
      }}
    >
      {children}
    </button>
  );
};

HomeButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['primary', 'secondary'])
};

export default function HomePage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  // 페이지 로드 시 스크롤 활성화
  useEffect(() => {
    // body 스크롤 활성화
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    
    // html 스크롤 활성화
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    
    // 컴포넌트 언마운트 시 원래대로 복원
    return () => {
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    };
  }, []);
  
  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: '100vh',
    padding: `${theme.spacing.xl} ${theme.spacing.lg} ${theme.spacing.xl * 4} ${theme.spacing.lg}`,
    background: theme.colors.background.main,
    position: 'relative',
    overflow: 'visible',
    width: '100%',
    height: 'auto'
  };

  const backgroundPattern = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: `
      radial-gradient(circle at 20% 80%, rgba(79, 109, 222, 0.08) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(108, 168, 255, 0.05) 0%, transparent 50%),
      radial-gradient(circle at 40% 40%, rgba(79, 109, 222, 0.06) 0%, transparent 50%)
    `,
    zIndex: 1
  };

  const contentStyle = {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '800px',
    width: '100%',
    gap: theme.spacing.xl,
    padding: `${theme.spacing.xl} 0`
  };

  const titleStyle = {
    fontSize: 'clamp(2.5rem, 5vw, 4rem)',
    fontWeight: 800,
    color: theme.colors.primary,
    textAlign: 'center',
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    margin: 0,
    textShadow: 'none'
  };

  const subtitleStyle = {
    fontSize: theme.fontSize.xl,
    color: theme.colors.text.primary,
    textAlign: 'center',
    fontWeight: 500,
    margin: 0,
    maxWidth: '600px',
    lineHeight: 1.5
  };

  const welcomeStyle = {
    fontSize: theme.fontSize['2xl'],
    color: theme.colors.primary,
    margin: 0,
    textAlign: 'center',
    fontWeight: 600,
    textShadow: 'none'
  };

  const descriptionStyle = {
    fontSize: theme.fontSize.lg,
    color: theme.colors.text.secondary,
    maxWidth: '500px',
    textAlign: 'center',
    lineHeight: 1.6,
    margin: 0,
    fontWeight: 400
  };

  const buttonContainerStyle = {
    display: 'flex',
    gap: theme.spacing.lg,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: theme.spacing.md
  };


  return (
    <div style={containerStyle}>
      <div style={backgroundPattern}></div>
      
      <div style={contentStyle}>
        <h1 style={titleStyle}>ReadWith</h1>
        
        {isAuthenticated() ? (
          <>
            <h2 style={welcomeStyle}>
              안녕하세요, 사용자님! 👋
            </h2>
            <p style={descriptionStyle}>
              나만의 서재에서 책을 읽고, 분석하고, 관리해보세요.
            </p>
            
            <div style={buttonContainerStyle}>
              <HomeButton onClick={() => navigate('/mypage')}>
                내 서재로 가기
              </HomeButton>
            </div>
          </>
        ) : (
          <>
            <p style={subtitleStyle}>
              책을 모으고, 읽고, 관리하는 가장 간단한 방법
            </p>
            <p style={descriptionStyle}>
              지금 바로 나만의 서재를 시작하세요!
            </p>
            
            <div style={buttonContainerStyle}>
              <HomeButton onClick={() => navigate('/login')}>
                로그인하여 시작하기
              </HomeButton>
            </div>
          </>
        )}
        
      </div>
    </div>
  );
} 
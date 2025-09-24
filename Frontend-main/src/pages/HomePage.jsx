import React from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { theme } from '../components/common/theme';
import { createButtonStyle, createAdvancedButtonHandlers } from '../utils/styles/styles';
import { ANIMATION_VALUES } from '../utils/styles/animations';

const HomeButton = ({ onClick, children, variant = 'primary' }) => {
  const buttonStyle = createButtonStyle(ANIMATION_VALUES, variant);
  const hoverHandlers = createAdvancedButtonHandlers(variant);

  return (
    <button
      style={buttonStyle}
      onClick={onClick}
      {...hoverHandlers}
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
  
  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '70vh',
    gap: theme.spacing.lg,
    padding: theme.spacing.md,
    background: theme.colors.background.main
  };

  const titleStyle = {
    fontSize: theme.fontSize['3xl'],
    fontWeight: 700,
    marginBottom: theme.spacing.xs,
    color: theme.colors.text.primary,
    textAlign: 'center',
    letterSpacing: '-0.01em'
  };

  const descriptionStyle = {
    fontSize: theme.fontSize.xl,
    color: theme.colors.text.secondary,
    maxWidth: '450px',
    textAlign: 'center',
    lineHeight: '1.6',
    marginBottom: theme.spacing.sm
  };

  const featuresStyle = {
    display: 'flex',
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center'
  };

  const featureStyle = {
    background: theme.colors.background.white,
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.boxShadow.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.text.secondary,
    border: `1px solid #e0e7ff`
  };

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>나만의 독서 공간</h1>
      <p style={descriptionStyle}>
        책을 모으고, 읽고, 관리하는 가장 간단한 방법.<br/>
        지금 바로 나만의 서재를 시작하세요!
      </p>
      
      <div style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap', justifyContent: 'center' }}>
        <HomeButton onClick={() => navigate('/mypage')}>
          내 서재로 가기
        </HomeButton>
        <HomeButton onClick={() => navigate('/login')} variant="secondary">
          로그인
        </HomeButton>
      </div>
      
      <div style={featuresStyle}>
        <div style={featureStyle}>EPUB 리더</div>
        <div style={featureStyle}>관계 분석</div>
        <div style={featureStyle}>타임라인</div>
      </div>


    </div>
  );
} 
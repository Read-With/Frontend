import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { createButtonStyle, createAdvancedButtonHandlers, COLORS } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/animations';

const BackButton = memo(function BackButton({ onBack }) {
  const backButtonHandlers = createAdvancedButtonHandlers('default');

  return (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        right: '24px',
        zIndex: 10002,
        pointerEvents: 'auto',
      }}
    >
      <button
        onClick={onBack}
        style={{
          ...createButtonStyle(ANIMATION_VALUES, 'default'),
          height: 32,
          padding: '0 12px',
          borderRadius: 8,
          border: `1px solid ${COLORS.border}`,
          background: 'rgba(255, 255, 255, 0.9)',
          color: COLORS.textPrimary,
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          backdropFilter: 'blur(8px)',
          justifyContent: 'center',
        }}
        aria-label="뷰어로 돌아가기"
        {...backButtonHandlers}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
          close
        </span>
        돌아가기
      </button>
    </div>
  );
});

BackButton.propTypes = {
  onBack: PropTypes.func.isRequired,
};

export default BackButton;

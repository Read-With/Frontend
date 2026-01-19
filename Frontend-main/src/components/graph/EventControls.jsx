import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { createButtonStyle } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/animations';
import { COLORS } from '../../utils/styles/styles.js';

const EventControls = memo(function EventControls({ currentEvent, onEventChange }) {
  const handlePrevious = () => {
    onEventChange(Math.max(1, currentEvent - 1));
  };

  const handleNext = () => {
    onEventChange(currentEvent + 1);
  };

  return (
    <div
      role="region"
      aria-label="이벤트 컨트롤"
      style={{
        position: 'fixed',
        top: '60px',
        right: '24px',
        background: 'rgba(255, 255, 255, 0.95)',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: '10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 10001,
        pointerEvents: 'auto',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          fontWeight: '500',
          color: COLORS.textPrimary,
        }}
      >
        이벤트
      </div>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <button
          onClick={handlePrevious}
          disabled={currentEvent <= 1}
          style={{
            ...createButtonStyle(ANIMATION_VALUES, 'default'),
            padding: '6px 12px',
            border: `1px solid ${COLORS.border}`,
            borderRadius: '6px',
            background: currentEvent <= 1 ? COLORS.backgroundLight : COLORS.background,
            color: currentEvent <= 1 ? COLORS.textSecondary : COLORS.textPrimary,
            cursor: currentEvent <= 1 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            transition: 'all 0.2s ease',
          }}
          aria-label="이전 이벤트"
        >
          이전
        </button>
        <span
          role="status"
          aria-live="polite"
          aria-label={`현재 이벤트 ${currentEvent}`}
          style={{
            fontSize: '11px',
            color: COLORS.textPrimary,
            minWidth: '40px',
            textAlign: 'center',
            fontWeight: '500',
          }}
        >
          {currentEvent}
        </span>
        <button
          onClick={handleNext}
          style={{
            ...createButtonStyle(ANIMATION_VALUES, 'default'),
            padding: '6px 12px',
            border: `1px solid ${COLORS.border}`,
            borderRadius: '6px',
            background: COLORS.background,
            color: COLORS.textPrimary,
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            transition: 'all 0.2s ease',
          }}
          aria-label="다음 이벤트"
        >
          다음
        </button>
      </div>
    </div>
  );
});

EventControls.propTypes = {
  currentEvent: PropTypes.number.isRequired,
  onEventChange: PropTypes.func.isRequired,
};

export default EventControls;

import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { createButtonStyle, COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';

// ─── 정적 스타일 상수 (모듈 수준, 렌더마다 재생성되지 않음) ────────────────��─
const containerStyle = {
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
};

const labelStyle = {
  marginBottom: '6px',
  fontSize: '11px',
  fontWeight: '500',
  color: COLORS.textPrimary,
};

const buttonRowStyle = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
};

const eventNumberStyle = {
  fontSize: '11px',
  color: COLORS.textPrimary,
  minWidth: '40px',
  textAlign: 'center',
  fontWeight: '500',
};

// 버튼 공통 베이스
const buttonBase = {
  ...createButtonStyle(ANIMATION_VALUES, 'default'),
  padding: '6px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '500',
  transition: 'all 0.2s ease',
};

// 활성/비활성 버튼 스타일 (이전/다음 공통)
const buttonActiveStyle = {
  ...buttonBase,
  background: COLORS.background,
  color: COLORS.textPrimary,
  cursor: 'pointer',
};

const buttonDisabledStyle = {
  ...buttonBase,
  background: COLORS.backgroundLight,
  color: COLORS.textSecondary,
  cursor: 'not-allowed',
};

// ─── EventControls ─────────────────────────────────────────────────────────────
const EventControls = memo(function EventControls({ currentEvent, onEventChange, maxEvent }) {
  const isPrevDisabled = currentEvent <= 1;
  const isNextDisabled = maxEvent !== null && currentEvent >= maxEvent;

  const handlePrevious = () => {
    if (!isPrevDisabled) onEventChange(currentEvent - 1);
  };

  const handleNext = () => {
    if (!isNextDisabled) onEventChange(currentEvent + 1);
  };

  return (
    <div role="region" aria-label="이벤트 컨트롤" style={containerStyle}>
      <div style={labelStyle}>이벤트</div>
      <div style={buttonRowStyle}>
        <button
          onClick={handlePrevious}
          disabled={isPrevDisabled}
          style={isPrevDisabled ? buttonDisabledStyle : buttonActiveStyle}
          aria-label="이전 이벤트"
        >
          이전
        </button>

        <span
          role="status"
          aria-live="polite"
          aria-label={`현재 이벤트 ${currentEvent}`}
          style={eventNumberStyle}
        >
          {maxEvent !== null ? `${currentEvent} / ${maxEvent}` : currentEvent}
        </span>

        <button
          onClick={handleNext}
          disabled={isNextDisabled}
          style={isNextDisabled ? buttonDisabledStyle : buttonActiveStyle}
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
  /** 현재 챕터의 최대 이벤트 번호. null이면 상한 없음. */
  maxEvent: PropTypes.number,
};

EventControls.defaultProps = {
  maxEvent: null,
};

export default EventControls;

import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { COLORS } from '../../utils/styles/styles.js';
import { errorUtils } from '../../utils/common/errorUtils';

function ErrorToast({ error, onClose, duration = 5000 }) {
  useEffect(() => {
    if (error && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [error, duration, onClose]);

  if (!error) return null;

  const userFriendlyMessage = errorUtils.getUserFriendlyMessage(error);

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: '80px',
        right: '24px',
        zIndex: 10003,
        background: 'rgba(220, 38, 38, 0.95)',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        minWidth: '300px',
        maxWidth: '500px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        animation: 'slideInRight 0.3s ease-out',
      }}
    >
      <style>
        {`
          @keyframes slideInRight {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `}
      </style>
      <span className="material-symbols-outlined" style={{ fontSize: '20px', flexShrink: 0 }}>
        error
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '14px' }}>
          오류 발생
        </div>
        <div style={{ fontSize: '13px', lineHeight: '1.4', opacity: 0.95 }}>
          {userFriendlyMessage}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.8,
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
        aria-label="오류 메시지 닫기"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
          close
        </span>
      </button>
    </div>
  );
}

ErrorToast.propTypes = {
  error: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.object,
    PropTypes.instanceOf(Error),
  ]),
  onClose: PropTypes.func.isRequired,
  duration: PropTypes.number,
};

export default ErrorToast;

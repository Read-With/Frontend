import React from 'react';

const EdgeLabelToggle = ({ visible, onToggle }) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 8px',
      borderRadius: '6px',
      background: '#f8fafc',
      border: '1px solid #e7eaf7',
    }}>
      <span style={{
        fontSize: '12px',
        fontWeight: '500',
        color: '#22336b',
        whiteSpace: 'nowrap',
      }}>
        간선 라벨
      </span>
      <button
        onClick={onToggle}
        style={{
          width: '32px',
          height: '18px',
          borderRadius: '9px',
          border: 'none',
          background: visible ? '#6C8EFF' : '#e2e8f0',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease',
          outline: 'none',
        }}
        title={visible ? '간선 라벨 숨기기' : '간선 라벨 보이기'}
      >
        <div style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: '2px',
          left: visible ? '16px' : '2px',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
};

export default EdgeLabelToggle; 
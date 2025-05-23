import React from 'react';

const LoadingSpinner = () => {
  return (
    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
      <div className="spinner" style={{
        width: '40px',
        height: '40px',
        border: '4px solid #ccc',
        borderTop: '4px solid #333',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: 'auto'
      }} />
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default LoadingSpinner;
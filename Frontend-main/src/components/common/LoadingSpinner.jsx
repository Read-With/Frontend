import React from 'react';

const LoadingSpinner = ({ size = 'medium', message = '로딩 중...', type = 'default' }) => {
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return { width: '24px', height: '24px', borderWidth: '3px' };
      case 'large':
        return { width: '64px', height: '64px', borderWidth: '6px' };
      default:
        return { width: '40px', height: '40px', borderWidth: '4px' };
    }
  };

  const sizeStyles = getSizeStyles();

  if (type === 'dots') {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 animate-fade-in">
        <div className="flex space-x-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-3 h-3 bg-blue-500 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.2}s` }}
            ></div>
          ))}
        </div>
        {message && (
          <p className="text-gray-600 text-sm font-medium animate-pulse">{message}</p>
        )}
      </div>
    );
  }

  if (type === 'pulse') {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 animate-fade-in">
        <div 
          className="bg-blue-500 rounded-full animate-enhanced-pulse"
          style={{
            width: sizeStyles.width,
            height: sizeStyles.height
          }}
        ></div>
        {message && (
          <p className="text-gray-600 text-sm font-medium animate-pulse">{message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-4 animate-fade-in">
      {/* 향상된 스피너 */}
      <div className="relative">
        {/* 외부 링 */}
        <div 
          className="border-gray-200 rounded-full animate-spin"
          style={{
            ...sizeStyles,
            borderStyle: 'solid',
            borderTopColor: '#2563eb'
          }}
        />
        
        {/* 내부 펄스 효과 */}
        <div 
          className="absolute inset-0 border-2 border-blue-300 rounded-full animate-enhanced-pulse opacity-30"
          style={{
            top: sizeStyles.borderWidth,
            left: sizeStyles.borderWidth,
            right: sizeStyles.borderWidth,
            bottom: sizeStyles.borderWidth
          }}
        />
      </div>
      
      {message && (
        <p className="text-gray-600 text-sm font-medium animate-pulse text-center max-w-xs">
          {message}
        </p>
      )}
    </div>
  );
};

export default LoadingSpinner;
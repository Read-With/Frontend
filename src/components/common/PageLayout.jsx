import React, { useEffect, useState } from 'react';

const PageLayout = ({ children, darkMode }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setIsMobile(width <= 600);
      setIsTablet(width > 600 && width <= 1024);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      style={{
        fontFamily: "'Noto Serif KR', 'Georgia', serif",
        backgroundColor: darkMode ? '#121212' : '#fafafa',
        minHeight: '100vh',
        padding: isMobile ? '1rem 0.5rem' : isTablet ? '1.5rem 1rem' : '2rem 1.5rem',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
  style={{
    maxWidth: '1200px',  // PC 버전 최대 크기 고정
    width: '100%',
    margin: '0 auto',    // 좌우 자동 가운데 정렬
    padding: isMobile ? '1rem' : isTablet ? '1.5rem' : '2rem',
    borderRadius: isMobile ? '0.5rem' : isTablet ? '0.75rem' : '1rem',
    backgroundColor: darkMode ? '#1e1e1e' : '#ffffff',
    boxShadow: darkMode
      ? '0 0 10px rgba(255,255,255,0.05)'
      : isMobile
      ? '0 1px 4px rgba(0,0,0,0.05)'
      : '0 2px 12px rgba(0,0,0,0.1)',
  }}
>
        {children}
      </div>
    </div>
  );
};

export default PageLayout;

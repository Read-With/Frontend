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
      {/* 내부 흰색 상자 완전 제거, children만 렌더 */}
      {children}
    </div>
  );
};

export default PageLayout;

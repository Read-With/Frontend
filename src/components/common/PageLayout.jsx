import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const PageLayout = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const location = useLocation();
  const isGraphPage = location.pathname.startsWith('/graph/');

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
      className="page-layout"
      style={{
        fontFamily: "'Noto Serif KR', 'Georgia', serif",
        backgroundColor: '#fafafa',
        minHeight: '100vh',
        padding: isGraphPage ? '0' : (isMobile ? '1rem 0.5rem' : isTablet ? '1.5rem 1rem' : '2rem 1.5rem'),
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
};

export default PageLayout;

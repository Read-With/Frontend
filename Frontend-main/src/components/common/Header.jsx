import React from 'react';
import { useNavigate } from 'react-router-dom';

const Header = () => {
  const navigate = useNavigate();

  return (
    <header
      style={{
        backgroundColor: '#282c34',
        padding: '1rem 2rem', // 좌우 padding 추가
        color: 'white',
      }}
    >
      <div
        style={{
          maxWidth: '1200px', // PC 기준 최대 너비 고정
          margin: '0 auto',  // 좌우 자동 가운데 정렬
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',  // 수직 정렬 정리
        }}
      >
        <span
          style={{ cursor: 'pointer', fontSize: '1.25rem' }} // rem 적용
          onClick={() => navigate('/')}
        >
          📖Readwith
        </span>
        <button
          onClick={() => navigate('/library')}
          style={{
            background: 'white',
            color: '#282c34',
            padding: '0.5rem 1rem',
            border: 'none',
            borderRadius: '5px',
            fontSize: '1rem', // rem 적용
          }}
        >
          나의 서재
        </button>
      </div>
    </header>
  );
};

export default Header;

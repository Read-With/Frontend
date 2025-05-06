import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Header.css';

const Header = () => {
  const navigate = useNavigate();

  return (
    <header className="header">
      <div className="container nav">
        <a className="logo" onClick={() => navigate('/')}> 
          <span role="img" aria-label="logo">📖</span>
          <span>Readwith</span>
        </a>
        <nav>
          <ul className="nav-links" style={{ alignItems: 'flex-end' }}>
            <li><a className="nav-link" style={{ marginTop: '0.5rem' }} onClick={() => navigate('/')}>홈</a></li>
            <li><a className="nav-link" style={{ marginTop: '0.5rem' }} onClick={() => navigate('/library')}>나의 서재</a></li>
          </ul>
        </nav>
      </div>
    </header>
  );
};

export default Header;

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Header.css';
import useAuth from '../../hooks/useAuth';

const Header = ({ userNickname, showAuthLinks = false }) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleLoginClick = () => {
    // 방법 1: 숨겨진 Google 버튼 클릭 (가장 확실한 방법)
    const hiddenButton = document.getElementById('g_id_signin');
    if (hiddenButton) {
      // 여러 방법으로 클릭 시도
      const clickableElements = [
        hiddenButton.querySelector('div[role="button"]'),
        hiddenButton.querySelector('iframe'),
        hiddenButton.querySelector('div'),
        hiddenButton
      ].filter(el => el !== null);
      
      for (const element of clickableElements) {
        try {
          element.click();
          return;
        } catch (error) {
          // 클릭 실패 시 다음 요소 시도
        }
      }
    }
    
    // 방법 2: Google Auth prompt() 시도
    if (window.google?.accounts?.id && window.googleAuthInitialized) {
      try {
        if (typeof window.google.accounts.id.prompt === 'function') {
          window.google.accounts.id.prompt();
        }
      } catch (error) {
        // 프롬프트 실패 시 무시
      }
    }
  };

  if (showAuthLinks && !user) {
    return (
      <div className="header-auth">
        <div className="header-left">
          <div className="header-logo">
            <span className="logo-icon">📖</span>
            <span className="logo-text">ReadWith</span>
          </div>
        </div>
        <div className="header-right">
          <button className="auth-link signup-link">회원가입</button>
          <button className="auth-link login-link" onClick={handleLoginClick}>로그인</button>
        </div>
      </div>
    );
  }

  return (
    <div className="user-topbar">
      <div className="user-topbar-left">
        <div className="user-topbar-avatar" />
        <Link to="/user/mypage" className="user-topbar-title-link">
          <div className="user-topbar-title">Read With : __ {userNickname || user?.name || 'User'} __</div>
        </Link>
      </div>
      
      <div className="user-topbar-right">
        <div className="user-topbar-nav">
          <div className="user-topbar-tab">My Page</div>
          <div className="user-topbar-tab">Settings</div>
          <button 
            className="user-topbar-tab logout-button"
            onClick={handleLogout}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit'
            }}
          >
            Logout
          </button>
        </div>
        <div className="user-topbar-search">
          <input className="user-topbar-search-input" placeholder="Search in site" />
          <span className="user-topbar-search-icon">🔍</span>
        </div>
      </div>
    </div>
  );
};

export default Header; 
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Header.css';
import useAuth from '../../hooks/useAuth';

const Header = ({ userNickname }) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
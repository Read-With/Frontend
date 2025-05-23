import React from 'react';
import { Link } from 'react-router-dom';
import './Header.css';

const Header = ({ userNickname }) => (
  <div className="user-topbar">
    <div className="user-topbar-left">
      <div className="user-topbar-avatar" />
      <Link to="/user/mypage" className="user-topbar-title-link">
        <div className="user-topbar-title">Read With : __ {userNickname} __</div>
      </Link>
    </div>
    
    <div className="user-topbar-right">
      <div className="user-topbar-nav">
        <div className="user-topbar-tab">My Page</div>
        <div className="user-topbar-tab">Settings</div>
      </div>
      <div className="user-topbar-search">
        <input className="user-topbar-search-input" placeholder="Search in site" />
        <span className="user-topbar-search-icon">🔍</span>
      </div>
    </div>
  </div>
);

export default Header; 
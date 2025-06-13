import React from 'react';
import './UserProfile.css';

const UserProfile = ({ userNickname, onLogout }) => {
  return (
    <div className="user-profile-section">
      <div className="user-profile-avatar">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="28" cy="28" r="28" fill="#e3e9f7" />
          <ellipse cx="28" cy="23" rx="10" ry="10" fill="#b0b8c1" />
          <ellipse cx="28" cy="41" rx="15" ry="8" fill="#b0b8c1" />
        </svg>
      </div>
      <div className="user-profile-container">
        <div className="user-profile-title">{userNickname || "User's Nickname"}</div>
        <div className="user-profile-labels">
          <div className="user-profile-label">Reading Progress</div>
          <div className="user-profile-label">Bookmarks</div>
        </div>
        <div className="user-profile-desc">Welcome to your intelligent reading experience!</div>
      </div>
      <div className="user-profile-btns">
        <button className="user-btn-secondary" onClick={onLogout}>Logout</button>
        <button className="user-btn-primary">Edit Profile</button>
      </div>
    </div>
  );
};

export default UserProfile; 
import React from 'react';
import './UserProfile.css';

const UserProfile = ({ userNickname, onLogout }) => {
  return (
    <div className="user-profile-section">
      <div className="user-profile-avatar" />
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
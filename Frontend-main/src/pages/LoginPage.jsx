import React, { useState } from 'react';
import './LoginPage.css';

const socialList = [
  { label: 'Google' },
  { label: 'Naver' },
  { label: 'Kakao' },
];

const LoginPage = () => {
  const [selected, setSelected] = useState('Google');
  const [nickname, setNickname] = useState('');
  const [profileUrl, setProfileUrl] = useState('');

  return (
    <div className="login-root">
      <div className="login-form-section">
        {/* 좌측 타이틀/설명 */}
        <div className="login-form-left">
          <div className="login-title">Read With :</div>
          <div className="login-desc">Login or 계정 생성</div>
        </div>
        {/* 우측 폼 */}
        <form className="login-form-right" onSubmit={e => e.preventDefault()}>
          <div className="login-form-group">
            <div className="login-form-label">Login Method</div>
            <div className="login-chip-group">
              {socialList.map(s => (
                <button
                  type="button"
                  key={s.label}
                  className={`login-chip${selected === s.label ? ' selected' : ''}`}
                  onClick={() => setSelected(s.label)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="login-form-info">Choose a social login method.</div>
          </div>
          <div className="login-form-group">
            <div className="login-form-label">Nickname (optional)</div>
            <input
              className="login-input"
              type="text"
              placeholder="Enter your nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
            />
          </div>
          <div className="login-form-group">
            <div className="login-form-label">Profile Image URL (optional)</div>
            <input
              className="login-input"
              type="text"
              placeholder="Enter image URL"
              value={profileUrl}
              onChange={e => setProfileUrl(e.target.value)}
            />
          </div>
          <div className="login-form-btns">
            <button type="button" className="login-btn-secondary">Register</button>
            <button type="submit" className="login-btn-primary">Login</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginPage; 
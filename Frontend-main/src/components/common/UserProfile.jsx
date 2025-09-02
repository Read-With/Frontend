import React from 'react';
import PropTypes from 'prop-types';
import { theme } from './theme';

const UserProfile = ({ userProfile }) => {
  const profileStyle = {
    width: 'calc(100vw - 48px)',
    maxWidth: '700px',
    margin: '0 auto 36px auto',
    background: theme.gradients.background,
    borderRadius: theme.borderRadius.xl,
    boxShadow: theme.boxShadow.lg,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.lg,
    padding: `${theme.spacing.xl} ${theme.spacing.lg}`,
    position: 'relative'
  };

  const avatarStyle = {
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    background: '#e3e9f7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: theme.boxShadow.sm,
    fontSize: '48px'
  };

  const infoStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs
  };

  const titleStyle = {
    fontSize: theme.fontSize['2xl'],
    fontWeight: 800,
    color: theme.colors.text.white,
    letterSpacing: '-0.01em'
  };

  const labelsStyle = {
    display: 'flex',
    gap: theme.spacing.xs,
    marginBottom: '4px'
  };

  const labelStyle = {
    background: 'rgba(255,255,255,0.18)',
    color: theme.colors.text.white,
    fontSize: theme.fontSize.sm,
    borderRadius: '6px',
    padding: '2px 10px',
    fontWeight: 500
  };

  const descStyle = {
    color: theme.colors.text.light,
    fontSize: theme.fontSize.xl,
    fontWeight: 400
  };

  return (
    <div style={profileStyle}>
      <div style={avatarStyle}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="avatarGrad" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e3e9f7" />
              <stop offset="1" stopColor="#b0b8c1" />
            </linearGradient>
          </defs>
          <circle cx="28" cy="28" r="28" fill="url(#avatarGrad)" />
          <ellipse cx="28" cy="23" rx="10" ry="10" fill="#b0b8c1" />
          <ellipse cx="28" cy="41" rx="15" ry="8" fill="#b0b8c1" />
        </svg>
      </div>
      <div style={infoStyle}>
        <div style={titleStyle}>{userProfile.nickname}</div>
        <div style={labelsStyle}>
          <div style={labelStyle}>읽은 책 {userProfile.totalBooksRead}권</div>
          <div style={labelStyle}>북마크 {userProfile.totalBookmarks}개</div>
        </div>
        <div style={descStyle}>당신만의 지능형 독서 경험에 오신 것을 환영합니다!</div>
      </div>
    </div>
  );
};

UserProfile.propTypes = {
  userProfile: PropTypes.shape({
    nickname: PropTypes.string.isRequired,
    totalBooksRead: PropTypes.number,
    totalBookmarks: PropTypes.number
  }).isRequired
};

export default UserProfile;
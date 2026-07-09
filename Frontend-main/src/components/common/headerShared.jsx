import React, { useEffect } from 'react';

export function resolveHeaderDisplayName(userNickname, user) {
  if (userNickname) return userNickname;
  if (user?.name) return user.name;
  return 'User';
}

export function HeaderBrand({ userName = null }) {
  return (
    <div className="header-brand">
      <div className="header-brand-icon" aria-hidden>
        📖
      </div>
      <span className="header-brand-text">ReadWith</span>
      {userName != null && (
        <>
          <span className="header-brand-separator">:</span>
          <span className="header-user-name">{userName}</span>
        </>
      )}
    </div>
  );
}

export function LogoutConfirmDialog({ open, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="logout-confirm-overlay" onClick={onCancel}>
      <div className="logout-confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <h3 className="logout-confirm-title">로그아웃</h3>
        <p className="logout-confirm-message">정말 로그아웃 하시겠습니까?</p>
        <div className="logout-confirm-buttons">
          <button type="button" className="logout-confirm-cancel" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="logout-confirm-logout" onClick={onConfirm}>
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';

export function GoogleIcon({ className, ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

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
      <span className="header-brand-text" lang="en">ReadWith</span>
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

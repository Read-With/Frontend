import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import './Header.css';
import useAuth from '../../hooks/auth/useAuth';
import { HeaderBrand, LogoutConfirmDialog, resolveHeaderDisplayName } from './headerShared';

function Header({ userNickname }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const displayName = resolveHeaderDisplayName(userNickname, user);

  const handleLogoutConfirm = async () => {
    await logout();
    setShowLogoutConfirm(false);
    navigate('/');
  };

  return (
    <div className="user-topbar">
      <div className="user-topbar-left">
        <HeaderBrand userName={displayName} />
      </div>

      <div className="user-topbar-right">
        <button type="button" className="user-topbar-logout" onClick={() => setShowLogoutConfirm(true)}>
          <LogOut size={16} strokeWidth={2} />
          <span>Logout</span>
        </button>
      </div>

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        onConfirm={handleLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}

export default Header;

export const getApiBaseUrl = () => {
  if (import.meta.env.DEV) {
    return '';
  }
  return 'https://dev.readwith.store';
};

export const clearAuthData = () => {
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('google_user');
  } catch {
    console.error('localStorage 접근 실패');
  }
};

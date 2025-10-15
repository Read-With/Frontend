// Google OAuth 설정 디버깅 스크립트
console.log('=== Google OAuth 설정 확인 ===');

// 환경변수 확인
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
console.log('VITE_GOOGLE_CLIENT_ID:', clientId ? clientId.substring(0, 10) + '...' : 'undefined');

// 리다이렉트 URI 확인
const redirectUri = 'http://localhost:5173/login/oauth2/code/google';
console.log('리다이렉트 URI:', redirectUri);

// Google OAuth URL 생성
if (clientId && clientId !== 'CLIENT_ID' && clientId !== 'your_google_client_id_here') {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent('openid email profile')}&` +
    `access_type=offline&` +
    `prompt=consent`;
  
  console.log('생성된 OAuth URL:', authUrl);
} else {
  console.error('❌ Google Client ID가 올바르게 설정되지 않았습니다.');
  console.log('해결방법:');
  console.log('1. .env 파일을 생성하고 VITE_GOOGLE_CLIENT_ID=실제_클라이언트_ID 설정');
  console.log('2. Google Console에서 OAuth 2.0 클라이언트 ID 확인');
  console.log('3. 승인된 리다이렉트 URI에 http://localhost:5173/login/oauth2/code/google 추가');
}

console.log('=== Google Console 설정 확인사항 ===');
console.log('1. Google Cloud Console > API 및 서비스 > 사용자 인증 정보');
console.log('2. OAuth 2.0 클라이언트 ID 확인');
console.log('3. 승인된 리다이렉트 URI에 다음 URL 추가:');
console.log('   - http://localhost:5173/login/oauth2/code/google');
console.log('   - http://localhost:5173 (개발용)');
console.log('4. JavaScript 원본에 http://localhost:5173 추가');

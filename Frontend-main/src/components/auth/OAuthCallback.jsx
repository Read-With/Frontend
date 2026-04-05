import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/auth/useAuth';
import {
  validateUserData,
  secureLog,
  verifyGoogleOAuthState,
  clearGoogleOAuthStateSession,
} from '../../utils/security/oauthSecurity';
import {
  getApiBaseUrl,
  getGoogleOAuthRedirectUri,
  getDevBackendHintUrl,
} from '../../utils/common/authUtils';

const OAuthCallback = () => {
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
      if (isProcessing || isCompleted) {
        return;
      }
      
      const code = searchParams.get('code');
      const oauthErrorParam = searchParams.get('error');

      if (oauthErrorParam && !code) {
        clearGoogleOAuthStateSession();
        let errorMessage = `OAuth 오류: ${oauthErrorParam}`;
        if (oauthErrorParam === 'access_denied') {
          errorMessage = '사용자가 로그인을 취소했습니다.';
        } else if (oauthErrorParam === 'redirect_uri_mismatch') {
          errorMessage =
            'Google OAuth 리다이렉트 URI가 일치하지 않습니다. Google Console에서 설정을 확인해주세요.';
        }
        setError(errorMessage);
        setIsLoading(false);
        return;
      }

      if (!code) {
        setIsLoading(false);
        return;
      }

      const stateCheck = verifyGoogleOAuthState(searchParams.get('state'));
      if (!stateCheck.isValid) {
        setError(stateCheck.error || 'OAuth state 검증에 실패했습니다. 다시 로그인해주세요.');
        setIsLoading(false);
        return;
      }

      const processedCode = localStorage.getItem('oauth_processed_code');
      if (processedCode === code) {
        setIsLoading(false);
        return;
      }
      
      localStorage.setItem('oauth_processed_code', code);
      setIsProcessing(true);
      
      try {
        if (window.history && window.history.replaceState) {
          const cleanUrl = new URL(window.location);
          cleanUrl.searchParams.delete('code');
          cleanUrl.searchParams.delete('state');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        const makeRequest = async (retryCount = 0) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);
          
          try {
            const apiBaseUrl = getApiBaseUrl();
            const requestUrl = `${apiBaseUrl}/api/auth/google`;
            
            const redirectUri = getGoogleOAuthRedirectUri();
            
            const requestBody = {
              code: code,
              redirectUri: redirectUri
            };
            
            const response = await fetch(requestUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify(requestBody),
              credentials: 'include',
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            return response;
          } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
              if (retryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, 3000 * (retryCount + 1)));
                return makeRequest(retryCount + 1);
              } else {
                throw new Error('백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.');
              }
            }
            
            throw error;
          }
        };
        
        let response;
        try {
          response = await makeRequest();
        } catch (fetchError) {
          if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
            const isLocalFrontend =
              window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1';
            if (isLocalFrontend && import.meta.env.DEV) {
              throw new Error(
                `CORS 에러: 백엔드에서 ${window.location.origin}을(를) CORS에 허용해야 할 수 있습니다.`
              );
            }
          }
          throw fetchError;
        }

        if (!response.ok) {
          const errorText = await response.text();
          
          if (response.status === 401) {
            let errorData = null;
            try {
              const clonedResponse = response.clone();
              errorData = await clonedResponse.json();
            } catch (_parseError) {
            }
            
            if (errorData && errorData.code === 'COMMON401') {
              throw new Error(`인증이 필요합니다 (COMMON401).

백엔드 응답:
- 코드: ${errorData.code}
- 메시지: ${errorData.message}

가능한 원인:
1. 백엔드가 Google OAuth 토큰 교환에 실패했습니다
2. OAuth 인증 코드가 유효하지 않거나 만료되었습니다
3. 백엔드의 GOOGLE_REDIRECT_URI 환경 변수가 일치하지 않습니다

해결 방법:
- 백엔드 개발자에게 다음 확인 요청:
  1. 서버 로그에서 Google OAuth 토큰 교환 오류 확인
  2. GOOGLE_REDIRECT_URI 환경 변수 확인 (${getGoogleOAuthRedirectUri()})
  3. Google Client ID/Secret 확인
  4. Spring Security에서 /api/auth/google 경로 허용 확인`);
            }
            
            throw new Error('Google OAuth2 인증 실패. 인증 코드가 유효하지 않거나 만료되었습니다.');
          }
          
          if (response.status === 404) {
            const actualRequestUrl = response.url || `${getApiBaseUrl()}/api/auth/google`;
            const backendUrl = import.meta.env.DEV ? getDevBackendHintUrl() : getApiBaseUrl();
            
            const errorMessage = `백엔드 서버에서 OAuth API를 찾을 수 없습니다 (404).

🔍 요청 정보:
- 요청 경로: POST ${actualRequestUrl}
- 프록시 사용: ${import.meta.env.DEV ? '예 (개발 환경)' : '아니오 (프로덕션)'}
- 예상 백엔드 URL: ${backendUrl}/api/auth/google

📋 확인 방법:
1. 개발 서버 터미널 확인:
   - "🔄 [프록시 요청]" 로그: 프록시가 백엔드로 전달한 실제 URL
   - "🔴 [404 에러]" 로그: 백엔드 응답 상세 정보
   
2. 백엔드 개발자에게 확인 요청:
   ✅ POST /api/auth/google 엔드포인트가 구현되어 있는지
   ✅ OAuth API가 배포 서버에 포함되어 있는지  
   ✅ 다른 경로를 사용하는지 (예: /auth/google, /oauth/google)
   ✅ Spring Security 설정에서 해당 경로가 차단되지 않았는지
   ✅ 서버 로그에서 요청이 도달했는지 확인
   
💡 참고:
- Swagger 문서에는 OAuth API가 표시되지 않습니다
- 보안상 이유로 숨겨져 있을 수 있지만, 실제로는 존재하지 않을 수도 있습니다
- 가이드에는 POST /api/auth/google이 있다고 명시되어 있으므로, 배포가 누락되었을 가능성이 높습니다`;

            throw new Error(errorMessage);
          }
          
          if (response.status === 500) {
            throw new Error('서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          }
          
          throw new Error(`서버 응답 오류: ${response.status} - ${errorText}`);
        }

        if (response.status === 401) {
          try {
            const errorData = await response.clone().json();
            
            if (errorData.code === 'COMMON401') {
              throw new Error(`인증이 필요합니다 (COMMON401).

백엔드 응답:
- 코드: ${errorData.code}
- 메시지: ${errorData.message}

가능한 원인:
1. OAuth 인증 코드가 유효하지 않거나 만료되었습니다
2. 백엔드가 Google OAuth 토큰 교환에 실패했습니다
3. 백엔드의 GOOGLE_REDIRECT_URI 환경 변수가 일치하지 않습니다

해결 방법:
- OAuth 로그인을 다시 시도해주세요
- 백엔드 개발자에게 GOOGLE_REDIRECT_URI 환경 변수 확인 요청
- 백엔드 서버 로그에서 Google OAuth 토큰 교환 오류 확인`);
            }
          } catch (_parseError) {
          }
          
          throw new Error(`인증이 필요합니다 (401 Unauthorized).

백엔드에서 인증을 확인하지 못했습니다.
OAuth 로그인을 다시 시도해주세요.`);
        }
        
        const data = await response.json();
        
        if (!data || typeof data !== 'object') {
          throw new Error('서버 응답 형식이 올바르지 않습니다.');
        }
        
        const isSuccess = data.isSuccess === true || data.success === true;
        
        if (isSuccess && data.result) {
          if (data.result.user) {
            const userData = data.result.user;
            
            const userValidation = validateUserData(userData);
            if (!userValidation.isValid) {
              throw new Error(userValidation.error);
            }
            
            const frontendUserData = {
              id: userData.id.toString(),
              name: userData.nickname || userData.name || '사용자',
              email: userData.email,
              imageUrl: userData.profileImgUrl || userData.picture || '',
              provider: userData.provider || 'GOOGLE',
              accessToken: data.result.accessToken,
              refreshToken: data.result.refreshToken,
              tokenType: data.result.tokenType || 'Bearer',
              expiresIn: data.result.expiresIn || 3600,
              refreshExpiresIn: data.result.refreshExpiresIn || 604800
            };
            
            secureLog('OAuth 인증 성공', { userId: userData.id, email: userData.email });
            
            login(frontendUserData);
            setIsCompleted(true);
            
            localStorage.removeItem('oauth_processed_code');
            
            navigate('/mypage');
          } else {
            throw new Error('사용자 데이터를 받지 못했습니다.');
          }
        } else {
          if (data.code === 'COMMON401') {
            throw new Error(`인증이 필요합니다 (COMMON401).

백엔드 응답:
- 코드: ${data.code}
- 메시지: ${data.message}

가능한 원인:
1. OAuth 로그인이 아직 완료되지 않았습니다
2. 인증 토큰이 유효하지 않거나 만료되었습니다
3. 백엔드에서 인증을 확인하지 못했습니다

해결 방법:
- OAuth 로그인을 다시 시도해주세요
- 브라우저 콘솔에서 OAuth 응답 로그를 확인하세요`);
          }
          
          if (data.code === 'AUTH4001') {
            if (data.message && data.message.includes('redirect_uri_mismatch')) {
              const actualRedirectUri = getGoogleOAuthRedirectUri();
              const isLocalDev = import.meta.env.DEV;
              
              const errorMessage = isLocalDev
                ? `리다이렉트 URI 불일치 오류 (로컬 개발 환경)

🔍 현재 상황:
- 프론트엔드에서 사용한 URI: ${actualRedirectUri}
- 프론트엔드가 요청 본문에 redirectUri를 포함했습니다
- 백엔드가 Google과 토큰 교환 시 다른 redirectUri를 사용한 것으로 보입니다

📋 해결 방법:

1. ✅ Google Cloud Console 설정 확인:
   - https://console.cloud.google.com 접속
   - 프로젝트 선택 → API 및 서비스 → 사용자 인증 정보
   - OAuth 2.0 클라이언트 ID 클릭
   - "승인된 리디렉션 URI"에 다음 URI가 등록되어 있는지 확인:
     ${actualRedirectUri}
   - 등록되어 있지 않다면 추가

2. 🔧 백엔드 개발자에게 확인 요청:
   - 백엔드가 POST /api/auth/google 요청 본문에서 redirectUri를 읽는지 확인
   - 현재 프론트엔드는 요청 본문에 redirectUri를 포함했습니다
   - 백엔드가 환경 변수만 사용한다면 로컬 개발 환경 지원을 위해 수정 필요
   - 또는 백엔드가 요청 본문의 redirectUri를 우선 사용하도록 수정 필요

3. 🔄 백엔드 수정 (백엔드 개발자 작업):
   - GoogleLoginRequestDTO에 redirectUri 필드 추가 (optional)
   - 요청 본문에 redirectUri가 있으면 그것을 사용
   - 없으면 환경 변수 GOOGLE_REDIRECT_URI 사용

⚠️ 중요:
- 로컬 개발 환경: 프론트엔드 redirectUri = ${actualRedirectUri}
- 백엔드가 Google과 토큰 교환 시 사용하는 redirectUri도 동일해야 합니다`
                : `리다이렉트 URI 불일치 오류 (프로덕션)

🔍 현재 상황:
- 프론트엔드에서 사용한 URI: ${actualRedirectUri}
- 백엔드는 환경 변수 GOOGLE_REDIRECT_URI를 사용합니다

📋 해결 방법:

1. ✅ Google Cloud Console 설정:
   - https://console.cloud.google.com 접속
   - 프로젝트 선택 → API 및 서비스 → 사용자 인증 정보
   - OAuth 2.0 클라이언트 ID 클릭
   - "승인된 리디렉션 URI"에 다음 URI 추가:
     ${actualRedirectUri}

2. 🔧 백엔드 환경 변수 확인 필요 (백엔드 개발자에게 요청):
   - 배포 서버의 GOOGLE_REDIRECT_URI 환경 변수 값 확인
   - 프론트엔드가 사용하는 URI: ${actualRedirectUri}
   - ⚠️ 이 두 값이 정확히 일치해야 합니다

3. 🔄 백엔드 환경 변수 수정 (백엔드 개발자 작업):
   - GOOGLE_REDIRECT_URI 환경 변수를 ${actualRedirectUri}로 변경
   - 환경 변수 변경 후 서버 재시작

⚠️ 중요 주의사항:
- URL 끝의 슬래시(/) 차이도 불일치로 인식됩니다
- http vs https 차이도 불일치로 인식됩니다
- 포트 번호까지 정확히 일치해야 합니다
- 대소문자도 정확히 일치해야 합니다`;

              throw new Error(errorMessage);
            }
            
            if (data.message && data.message.includes('Duplicate entry')) {
              if (data.message.includes('provider_uid') || data.message.includes('UK423ot3bb0fm0mhtmh1t59my3o')) {
                throw new Error('이미 등록된 Google 계정입니다. 다른 계정으로 로그인하거나 관리자에게 문의하세요.');
              }
              throw new Error('이미 다른 소셜 로그인으로 가입된 이메일입니다.');
            }
            
            if (data.message && (data.message.includes('Client ID') || data.message.includes('Client Secret') || data.message.includes('invalid_client'))) {
              throw new Error('Google OAuth2 설정 오류입니다. 백엔드의 Google Client ID와 Secret 설정을 확인해주세요.');
            }
            
            throw new Error(`Google 로그인 실패: ${data.message || '백엔드 설정을 확인해주세요.'}`);
          }
          
          if (data.code === 'AUTH4002') {
            throw new Error('Google OAuth2 인증 실패입니다. 인증 코드가 유효하지 않습니다.');
          }
          
          if (data.code === 'AUTH4003') {
            throw new Error('JWT 토큰 생성 실패입니다. 백엔드 JWT 설정을 확인해주세요.');
          }
          
          if (data.code === 'AUTH4004') {
            throw new Error('리다이렉트 URI 불일치입니다. Google Console에서 리다이렉트 URI를 확인해주세요.');
          }
          
          if (data.code === 'AUTH4005') {
            throw new Error('사용자 정보 처리 실패입니다. Google 사용자 정보를 가져올 수 없습니다.');
          }
          
          if (data.message && data.message.includes('redirect_uri_mismatch')) {
            const actualRedirectUri = getGoogleOAuthRedirectUri();

            throw new Error(`리다이렉트 URI 불일치 오류 (redirect_uri_mismatch)

🔍 현재 상황:
- 프론트엔드에서 사용한 URI: ${actualRedirectUri}
- 백엔드는 환경 변수 GOOGLE_REDIRECT_URI를 사용합니다

📋 해결 방법:

1. ✅ Google Cloud Console 설정:
   - https://console.cloud.google.com 접속
   - 프로젝트 선택 → API 및 서비스 → 사용자 인증 정보
   - OAuth 2.0 클라이언트 ID 클릭
   - "승인된 리디렉션 URI"에 다음 URI 추가:
     ${actualRedirectUri}

2. 🔧 백엔드 환경 변수 확인 필요 (백엔드 개발자에게 요청):
   - 배포 서버의 GOOGLE_REDIRECT_URI 환경 변수 값 확인
   - 현재 설정된 값: ? (백엔드 개발자에게 확인 필요)
   - 프론트엔드가 사용하는 URI: ${actualRedirectUri}
   - ⚠️ 이 두 값이 정확히 일치해야 합니다

3. 🔄 백엔드 환경 변수 수정 (백엔드 개발자 작업):
   - GOOGLE_REDIRECT_URI 환경 변수를 ${actualRedirectUri}로 변경
   - 환경 변수 변경 후 서버 재시작

⚠️ 중요 주의사항:
- URL 끝의 슬래시(/) 차이도 불일치로 인식됩니다
  예: ${actualRedirectUri} (O) vs ${actualRedirectUri}/ (X)
- http vs https 차이도 불일치로 인식됩니다
- 포트 번호까지 정확히 일치해야 합니다
- 대소문자도 정확히 일치해야 합니다`);
          }
          
          if (!isSuccess && data.message) {
            throw new Error(data.message || '인증 실패');
          }
          
          if (data.message && data.message.includes('invalid_grant')) {
            throw new Error('인증 코드가 만료되었습니다. 다시 로그인해주세요.');
          }
          
          if (data.message && data.message.includes('Duplicate entry')) {
            throw new Error('이미 다른 소셜 로그인으로 가입된 이메일입니다.');
          }
          
          throw new Error(data.message || '인증 실패');
        }
      } catch (err) {
        let errorMessage = '로그인 실패';
        
        const isCorsError = err.message.includes('CORS') || 
                           err.message.includes('Access-Control-Allow-Origin') ||
                           err.message.includes('blocked by CORS policy') ||
                           err.message.includes('Failed to fetch') ||
                           (err.name === 'TypeError' && err.message.includes('fetch'));
        
        if (isCorsError) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '프론트 주소';
          errorMessage = `CORS 에러: 백엔드에서 ${origin}을(를) 허용하도록 CORS 설정이 필요할 수 있습니다. 백엔드 개발자에게 문의하세요.`;
        } else if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
          errorMessage = '서버에 연결할 수 없습니다. 네트워크 연결을 확인하고 다시 시도해주세요.';
        } else {
          errorMessage = `로그인 실패: ${err.message}`;
        }
        
        setError(errorMessage);
      } finally {
        setIsLoading(false);
        setIsProcessing(false);
      }
      } catch (outerError) {
        setError(`처리 실패: ${outerError.message}`);
        setIsLoading(false);
        setIsProcessing(false);
      }
    };

    handleOAuthCallback().catch(err => {
      setError(`초기화 실패: ${err.message}`);
      setIsLoading(false);
    });
  }, []);

  if (isLoading || isProcessing) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #3E4F2F 0%, #586544 50%, #717B59 100%)'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '4px solid rgba(255, 255, 255, 0.2)',
          borderTop: '4px solid #ffffff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: '20px'
        }}></div>
        <h2 style={{ 
          color: '#ffffff', 
          fontSize: '24px', 
          fontWeight: '600',
          marginBottom: '10px',
          textAlign: 'center'
        }}>
          구글 로그인 처리 중
        </h2>
        <p style={{ 
          color: 'rgba(255, 255, 255, 0.9)', 
          fontSize: '16px',
          textAlign: 'center',
          maxWidth: '400px',
          lineHeight: '1.5'
        }}>
          {isCompleted ? '로그인 완료! 잠시만 기다려주세요...' : '구글 인증을 처리하고 있습니다. 잠시만 기다려주세요...'}
        </p>
        <div style={{
          marginTop: '30px',
          padding: '15px 25px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.2)'
        }}>
          <p style={{ 
            color: 'rgba(255, 255, 255, 0.9)', 
            fontSize: '14px',
            margin: 0,
            textAlign: 'center'
          }}>
            백엔드 서버 연결이 느릴 수 있습니다. 잠시만 기다려주세요.
          </p>
        </div>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #3E4F2F 0%, #586544 50%, #717B59 100%)'
      }}>
        <div style={{
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          textAlign: 'center',
          maxWidth: '600px',
          border: '1px solid rgba(239, 68, 68, 0.2)'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            backgroundColor: '#fef2f2',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            border: '2px solid #fecaca'
          }}>
            <span style={{ fontSize: '30px' }}>⚠️</span>
          </div>
          <h2 style={{ 
            color: '#ef4444', 
            marginBottom: '16px',
            fontSize: '24px',
            fontWeight: '600'
          }}>
            로그인 실패
          </h2>
          <p style={{ 
            color: '#666', 
            marginBottom: '24px',
            fontSize: '16px',
            lineHeight: '1.5'
          }}>
            {error}
          </p>
          <div style={{
            marginBottom: '24px',
            padding: '15px',
            backgroundColor: error.includes('CORS') ? '#fee2e2' : 
                          error.includes('이미 등록된 Google 계정') ? '#fee2e2' : '#fef3c7',
            borderRadius: '8px',
            border: `1px solid ${error.includes('CORS') || error.includes('이미 등록된 Google 계정') ? '#fecaca' : '#fde68a'}`
          }}>
            <p style={{ 
              color: error.includes('CORS') || error.includes('이미 등록된 Google 계정') ? '#991b1b' : '#92400e', 
              fontSize: '14px',
              margin: 0,
              fontWeight: '500'
            }}>
              {error.includes('CORS') 
                ? `해결 방법: 백엔드 서버에서 CORS 설정이 필요합니다. 백엔드 개발자에게 ${typeof window !== 'undefined' ? window.location.origin : '현재 프론트 주소'}을(를) 허용하도록 CORS 설정을 요청하세요.`
                : error.includes('이미 등록된 Google 계정')
                ? '해결 방법: 이미 가입된 Google 계정입니다. 다른 Google 계정으로 로그인하거나, 기존 계정의 비밀번호를 찾아 로그인하세요. 문제가 지속되면 관리자에게 문의하세요.'
                : '해결 방법: 백엔드 서버가 실행 중인지 확인하고, Google OAuth 설정을 확인해주세요.'}
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              background: '#3E4F2F',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'background-color 0.2s ease'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#586544'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#3E4F2F'}
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default OAuthCallback;

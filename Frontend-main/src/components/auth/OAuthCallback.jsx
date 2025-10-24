import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { validateUserData, secureLog } from '../../utils/security/oauthSecurity';

// API 기본 URL 설정
const getApiBaseUrl = () => {
  // 개발 환경에서는 로컬 백엔드 서버 사용
  return 'http://localhost:8080';
};

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
      // 이미 처리 완료되었거나 처리 중이면 중복 실행 방지
      if (isProcessing || isCompleted) {
        return;
      }
      
      // URL 파라미터에서 인증 코드 추출
      const code = searchParams.get('code');
      const error = searchParams.get('error');
      const state = searchParams.get('state');
      
      // 인증 코드가 없으면 처리하지 않음
      if (!code) {
        setIsLoading(false);
        return;
      }
      
      // 이미 처리된 코드인지 확인 (localStorage 사용)
      const processedCode = localStorage.getItem('oauth_processed_code');
      if (processedCode === code) {
        setIsLoading(false);
        return;
      }
      
      // 처리할 코드를 localStorage에 저장
      localStorage.setItem('oauth_processed_code', code);
      setIsProcessing(true);
      
      try {
        // URL에서 파라미터 즉시 제거 (보안상 이유 및 중복 처리 방지)
        if (window.history && window.history.replaceState) {
          const cleanUrl = new URL(window.location);
          cleanUrl.searchParams.delete('code');
          cleanUrl.searchParams.delete('state');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        // OAuth 오류 처리
        if (error) {
          let errorMessage = `OAuth 오류: ${error}`;
          
          if (error === 'access_denied') {
            errorMessage = '사용자가 로그인을 취소했습니다.';
          } else if (error === 'redirect_uri_mismatch') {
            errorMessage = 'Google OAuth 리다이렉트 URI가 일치하지 않습니다. Google Console에서 설정을 확인해주세요.';
          }
          
          setError(errorMessage);
          setIsLoading(false);
          setIsProcessing(false);
          return;
        }

        // 백엔드 Google OAuth2 API에 맞춰 요청 (재시도 로직 포함)
        const makeRequest = async (retryCount = 0) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000); // 20초 타임아웃
          
          try {
            // 백엔드 GoogleLoginRequestDTO 형식에 맞춰 JSON 요청
            const response = await fetch(`${getApiBaseUrl()}/api/auth/google`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                code: code
              }),
              credentials: 'include', // 쿠키 포함
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response;
          } catch (error) {
            clearTimeout(timeoutId);
            
            // 백엔드 서버 연결 문제 처리
            if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
              if (retryCount < 3) {
                console.log(`서버 연결 재시도 중... (${retryCount + 1}/3)`);
                await new Promise(resolve => setTimeout(resolve, 3000 * (retryCount + 1)));
                return makeRequest(retryCount + 1);
              } else {
                throw new Error('백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.');
              }
            }
            
            throw error;
          }
        };
        
        const response = await makeRequest();

        if (!response.ok) {
          const errorText = await response.text();
          
          // 401 오류인 경우 대안 방법 시도
          if (response.status === 401) {
            throw new Error('Google OAuth2 인증 실패. 인증 코드가 유효하지 않거나 만료되었습니다.');
          }
          
          // 500 오류인 경우 서버 처리 시간 부족일 수 있음
          if (response.status === 500) {
            throw new Error('서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          }
          
          throw new Error(`서버 응답 오류: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // 응답 데이터 검증
        if (!data || typeof data !== 'object') {
          throw new Error('서버 응답 형식이 올바르지 않습니다.');
        }
        
        // 백엔드 응답 형식에 맞게 수정
        if (data.isSuccess && data.result) {
          // 백엔드 응답 형식에 따라 처리
          if (data.result.user) {
            const userData = data.result.user;
            
            // 사용자 데이터 검증
            const userValidation = validateUserData(userData);
            if (!userValidation.isValid) {
              throw new Error(userValidation.error);
            }
            
            // 백엔드 응답 형식을 프론트엔드 형식으로 변환
            const frontendUserData = {
              id: userData.id.toString(),
              name: userData.nickname || userData.name || '사용자',
              email: userData.email,
              imageUrl: userData.profileImgUrl || userData.picture || '',
              accessToken: data.result.accessToken,
              refreshToken: data.result.refreshToken,
              tokenType: data.result.tokenType || 'Bearer',
              expiresIn: data.result.expiresIn || 3600000, // 1시간 (백엔드 설정에 맞춤)
              refreshExpiresIn: data.result.refreshExpiresIn || 604800000 // 7일 (백엔드 설정에 맞춤)
            };
            
            secureLog('OAuth 인증 성공', { userId: userData.id, email: userData.email });
            login(frontendUserData);
            setIsCompleted(true);
            
            // 성공 시 localStorage 정리 및 즉시 리디렉션 (백엔드 설정에 맞춤)
            localStorage.removeItem('oauth_processed_code');
            navigate('/mypage');
          } else {
            throw new Error('사용자 데이터를 받지 못했습니다.');
          }
        } else {
          // 백엔드 에러 코드 처리 (백엔드 API 분석 결과에 맞춤)
          if (data.code === 'AUTH4001') {
            throw new Error('Google OAuth2 설정 오류입니다. Google Client ID와 Secret을 확인해주세요.');
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
        
        if (err.message.includes('Failed to fetch')) {
          errorMessage = '서버에 연결할 수 없습니다. 네트워크 연결을 확인하고 다시 시도해주세요.';
        } else {
          errorMessage = `로그인 실패: ${err.message}`;
        }
        
        setError(errorMessage);
      } finally {
        setIsLoading(false);
        setIsProcessing(false);
      }
    };

    handleOAuthCallback();
  }, []); // 컴포넌트 마운트 시에만 실행하여 중복 실행 완전 방지

  if (isLoading || isProcessing) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f5f7fa 0%, rgba(92, 111, 92, 0.05) 100%)'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #4285f4',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: '20px'
        }}></div>
        <h2 style={{ 
          color: '#333', 
          fontSize: '24px', 
          fontWeight: '600',
          marginBottom: '10px',
          textAlign: 'center'
        }}>
          구글 로그인 처리 중
        </h2>
        <p style={{ 
          color: '#666', 
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
          backgroundColor: 'rgba(66, 133, 244, 0.1)',
          borderRadius: '8px',
          border: '1px solid rgba(66, 133, 244, 0.2)'
        }}>
          <p style={{ 
            color: '#4285f4', 
            fontSize: '14px',
            margin: 0,
            textAlign: 'center'
          }}>
            💡 백엔드 서버 연결이 느릴 수 있습니다. 잠시만 기다려주세요.
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
        background: 'linear-gradient(135deg, #f5f7fa 0%, rgba(92, 111, 92, 0.05) 100%)'
      }}>
        <div style={{
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          textAlign: 'center',
          maxWidth: '500px',
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
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            border: '1px solid #fde68a'
          }}>
            <p style={{ 
              color: '#92400e', 
              fontSize: '14px',
              margin: 0,
              fontWeight: '500'
            }}>
              💡 해결 방법: 백엔드 서버가 실행 중인지 확인하고, Google OAuth 설정을 확인해주세요.
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              background: '#4285f4',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'background-color 0.2s ease'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#3367d6'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#4285f4'}
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

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
        console.log('OAuth 콜백: 이미 처리 완료되었거나 처리 중이므로 중복 실행 방지');
        return;
      }
      
      setIsProcessing(true);
      
      try {
        // URL 파라미터에서 인증 코드 추출
        const code = searchParams.get('code');
        const error = searchParams.get('error');
        const state = searchParams.get('state');
        
        // URL에서 파라미터 즉시 제거 (보안상 이유 및 중복 처리 방지)
        if (window.history && window.history.replaceState) {
          const cleanUrl = new URL(window.location);
          cleanUrl.searchParams.delete('code');
          cleanUrl.searchParams.delete('state');
          window.history.replaceState({}, document.title, cleanUrl.toString());
          console.log('OAuth 콜백: URL 파라미터 제거 완료');
        }

        // OAuth 오류 처리
        if (error) {
          setError(`OAuth 오류: ${error}`);
          setIsLoading(false);
          return;
        }

        // 인증 코드가 없으면 오류
        if (!code) {
          setError('인증 코드를 받지 못했습니다.');
          setIsLoading(false);
          return;
        }

        // 백엔드로 인증 코드 전송 (재시도 로직 포함)
        console.log('OAuth 콜백: 인증 코드 전송 시작', { code: code.substring(0, 20) + '...' });
        
        const makeRequest = async (retryCount = 0) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃
          
          try {
            const response = await fetch(`${getApiBaseUrl()}/api/auth/google`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                code: code,
                redirectUri: 'http://localhost:5173/login/oauth2/code/google'
              }),
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response;
          } catch (error) {
            clearTimeout(timeoutId);
            
            // 네트워크 오류이고 재시도 횟수가 3번 미만이면 재시도
            if (retryCount < 3 && (error.name === 'AbortError' || error.message.includes('Failed to fetch'))) {
              console.log(`OAuth 콜백: API 요청 재시도 (${retryCount + 1}/3)`);
              await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1))); // 2초, 4초, 6초 대기
              return makeRequest(retryCount + 1);
            }
            
            throw error;
          }
        };
        
        const response = await makeRequest();

        console.log('OAuth 콜백: 서버 응답 상태', { status: response.status, ok: response.ok });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('OAuth 콜백: 서버 오류 응답', { status: response.status, error: errorText });
          
          // 401 오류인 경우 대안 방법 시도
          if (response.status === 401) {
            console.log('OAuth 콜백: 401 오류 발생, 대안 방법 시도');
            throw new Error('백엔드 인증 설정 문제. 백엔드에서 /api/auth/google 엔드포인트를 확인해주세요.');
          }
          
          // 500 오류인 경우 서버 처리 시간 부족일 수 있음
          if (response.status === 500) {
            console.log('OAuth 콜백: 500 오류 발생, 서버 처리 시간 부족일 수 있음');
            throw new Error('서버 처리 시간이 부족합니다. 잠시 후 다시 시도해주세요.');
          }
          
          throw new Error(`서버 응답 오류: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('OAuth 콜백: 서버 응답 데이터', { data });
        
        // 응답 데이터 검증
        if (!data || typeof data !== 'object') {
          throw new Error('서버 응답 형식이 올바르지 않습니다.');
        }
        
        // 백엔드 응답 형식에 맞게 수정
        if (data.isSuccess && data.result) {
          console.log('OAuth 콜백: 백엔드 응답 데이터', { data });
          
          // 백엔드 응답 형식에 따라 처리
          if (data.result.user) {
            const userData = data.result.user;
            console.log('OAuth 콜백: 사용자 데이터 수신', { userData });
            
            // 사용자 데이터 검증
            const userValidation = validateUserData(userData);
            if (!userValidation.isValid) {
              console.error('OAuth 콜백: 사용자 데이터 검증 실패', { error: userValidation.error });
              throw new Error(userValidation.error);
            }
            
            // 백엔드 응답 형식을 프론트엔드 형식으로 변환
            const frontendUserData = {
              id: userData.id.toString(),
              name: userData.nickname || userData.name || '사용자',
              email: userData.email,
              imageUrl: userData.profileImgUrl || userData.picture || '',
              accessToken: data.result.accessToken,
              tokenType: data.result.tokenType || 'Bearer',
              expiresIn: data.result.expiresIn || 3600
            };
            
            console.log('OAuth 콜백: 프론트엔드 사용자 데이터', { frontendUserData });
            secureLog('OAuth 인증 성공', { userId: userData.id, email: userData.email });
            login(frontendUserData);
            setIsCompleted(true);
            
            // 성공 시 즉시 리디렉션하여 중복 요청 완전 차단
            setTimeout(() => {
              navigate('/mypage');
            }, 100);
          } else {
            console.error('OAuth 콜백: 사용자 데이터 없음', { data });
            throw new Error('사용자 데이터를 받지 못했습니다.');
          }
        } else {
          console.error('OAuth 콜백: 인증 실패', { data });
          
          // invalid_grant 오류인 경우 특별 처리
          if (data.message && data.message.includes('invalid_grant')) {
            throw new Error('인증 코드가 만료되었습니다. 다시 로그인해주세요.');
          }
          
          // DB 제약 조건 오류인 경우 (중복 사용자)
          if (data.message && data.message.includes('Duplicate entry')) {
            throw new Error('이미 가입된 사용자입니다. 로그인해주세요.');
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
        secureLog('OAuth 콜백 처리 오류', { error: err.message });
      } finally {
        setIsLoading(false);
        setIsProcessing(false);
      }
    };

    handleOAuthCallback();
  }, [searchParams, login, navigate, isProcessing, isCompleted]);

  if (isLoading || isProcessing) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f5f7fa 0%, rgba(79, 109, 222, 0.05) 100%)'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #4285f4',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p style={{ marginTop: '20px', color: '#666', fontSize: '16px' }}>
          {isCompleted ? '로그인 완료 중...' : '로그인 처리 중...'}
        </p>
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
        background: 'linear-gradient(135deg, #f5f7fa 0%, rgba(79, 109, 222, 0.05) 100%)'
      }}>
        <div style={{
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>로그인 실패</h2>
          <p style={{ color: '#666', marginBottom: '24px' }}>{error}</p>
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
              fontWeight: 500
            }}
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

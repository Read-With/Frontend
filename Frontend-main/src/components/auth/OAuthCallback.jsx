import React, { useEffect, useState, useRef, useMemo } from 'react';
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
  resolveOAuthUrlError,
  resolveOAuthApiBodyError,
  resolveOAuthHttpError,
  normalizeOAuthFetchError,
  getOAuthErrorTip,
  getOAuthErrorTipTone,
} from '../../utils/common/urlUtils';
import { GoogleIcon } from '../common/headerShared';
import './OAuthCallback.css';

const LOADING_PHASES = [
  { title: 'Google 로그인 처리 중', detail: '계정 정보를 확인하고 있어요.' },
  { title: '인증 연결 중', detail: '안전하게 로그인을 마무리하고 있어요.' },
  { title: '조금만 더 기다려주세요', detail: '서버 응답이 느릴 수 있어요.' },
];

function OAuthCallbackShell({ variant = '', role, ariaLive, ariaBusy, children }) {
  return (
    <div className="oauth-callback-page" role={role} aria-live={ariaLive} aria-busy={ariaBusy}>
      <div className={`oauth-callback-content${variant ? ` ${variant}` : ''}`}>
        <p className="oauth-callback-logo" lang="en">
          ReadWith
        </p>
        <div className="oauth-callback-body">{children}</div>
      </div>
    </div>
  );
}

const OAuthCallback = () => {
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!isLoading && !isProcessing) return undefined;

    const intervalId = window.setInterval(() => {
      setLoadingPhase((prev) => Math.min(prev + 1, LOADING_PHASES.length - 1));
    }, 4500);

    return () => window.clearInterval(intervalId);
  }, [isLoading, isProcessing]);

  const loadingCopy = useMemo(() => {
    if (isCompleted) {
      return {
        title: '로그인 완료',
        detail: '마이페이지로 이동하고 있어요.',
      };
    }
    return LOADING_PHASES[loadingPhase];
  }, [isCompleted, loadingPhase]);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      let inflightKey = null;
      try {
        if (handledRef.current || isProcessing || isCompleted) {
          return;
        }

        const code = searchParams.get('code');
        const oauthErrorParam = searchParams.get('error');
        const oauthState = searchParams.get('state');

        if (!code && !oauthErrorParam) {
          setIsLoading(false);
          return;
        }

        inflightKey = code ? `oauth_inflight_${code}` : null;
        if (inflightKey && sessionStorage.getItem(inflightKey) === '1') {
          return;
        }
        if (inflightKey) {
          sessionStorage.setItem(inflightKey, '1');
        }

        handledRef.current = true;

        if (oauthErrorParam && !code) {
          clearGoogleOAuthStateSession();
          setError(resolveOAuthUrlError(oauthErrorParam));
          setIsLoading(false);
          return;
        }

        if (!code) {
          setIsLoading(false);
          return;
        }

        const stateCheck = verifyGoogleOAuthState(oauthState);
        if (!stateCheck.isValid) {
          if (inflightKey) sessionStorage.removeItem(inflightKey);
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
          if (window.history?.replaceState) {
            const cleanUrl = new URL(window.location);
            cleanUrl.searchParams.delete('code');
            cleanUrl.searchParams.delete('state');
            window.history.replaceState({}, document.title, cleanUrl.toString());
          }

          const makeRequest = async (retryCount = 0) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
              const requestUrl = `${getApiBaseUrl()}/api/auth/google`;
              const response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify({
                  code,
                  redirectUri: getGoogleOAuthRedirectUri(),
                }),
                credentials: 'include',
                signal: controller.signal,
              });

              clearTimeout(timeoutId);
              return response;
            } catch (fetchError) {
              clearTimeout(timeoutId);

              if (fetchError.name === 'AbortError' || fetchError.message.includes('Failed to fetch')) {
                if (retryCount < 3) {
                  await new Promise((resolve) => setTimeout(resolve, 3000 * (retryCount + 1)));
                  return makeRequest(retryCount + 1);
                }
                throw new Error('백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.');
              }

              throw fetchError;
            }
          };

          const response = await makeRequest();

          if (!response.ok) {
            await resolveOAuthHttpError(response);
          }

          const data = await response.json();
          resolveOAuthApiBodyError(data);

          if (data.result?.user) {
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
              refreshExpiresIn: data.result.refreshExpiresIn || 604800,
            };

            secureLog('OAuth 인증 성공', { userId: userData.id, email: userData.email });

            login(frontendUserData);
            setIsCompleted(true);

            localStorage.removeItem('oauth_processed_code');
            clearGoogleOAuthStateSession();
            if (inflightKey) sessionStorage.removeItem(inflightKey);

            navigate('/mypage');
          } else {
            throw new Error('사용자 데이터를 받지 못했습니다.');
          }
        } catch (err) {
          setError(normalizeOAuthFetchError(err));
        } finally {
          setIsLoading(false);
          setIsProcessing(false);
        }
      } catch (outerError) {
        if (inflightKey) sessionStorage.removeItem(inflightKey);
        setError(`처리 실패: ${outerError.message}`);
        setIsLoading(false);
        setIsProcessing(false);
      }
    };

    handleOAuthCallback().catch((err) => {
      setError(`초기화 실패: ${err.message}`);
      setIsLoading(false);
    });
  }, [searchParams, isProcessing, isCompleted, login, navigate]);

  if (isLoading || isProcessing) {
    return (
      <OAuthCallbackShell
        variant={isCompleted ? 'oauth-callback-content--success' : ''}
        role="status"
        ariaLive="polite"
        ariaBusy="true"
      >
        <div className="oauth-callback-icon-wrap" aria-hidden="true">
          <div className="oauth-callback-icon-ring" />
          <div className="oauth-callback-google-badge">
            <GoogleIcon className="oauth-callback-google-icon" />
          </div>
        </div>

        <h1 className="oauth-callback-title">{loadingCopy.title}</h1>
        <p className="oauth-callback-detail">{loadingCopy.detail}</p>

        <ol className="oauth-callback-steps" aria-hidden="true">
          {LOADING_PHASES.map((_, index) => {
            const isActive = !isCompleted && index === loadingPhase;
            const isDone = isCompleted || index < loadingPhase;
            return (
              <li
                key={index}
                className={[
                  'oauth-callback-step',
                  isActive ? 'is-active' : '',
                  isDone ? 'is-done' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            );
          })}
        </ol>

        {loadingPhase >= LOADING_PHASES.length - 1 && !isCompleted ? (
          <p className="oauth-callback-hint is-visible">
            첫 로그인이거나 서버가 깨어나는 중이면 10~20초 정도 걸릴 수 있어요.
          </p>
        ) : null}
      </OAuthCallbackShell>
    );
  }

  if (error) {
    const errorTip = getOAuthErrorTip(error);
    const errorTipTone = getOAuthErrorTipTone(error);

    return (
      <OAuthCallbackShell variant="oauth-callback-content--error">
        <div className="oauth-callback-error-icon" aria-hidden="true">
          !
        </div>
        <h1 className="oauth-callback-error-title">로그인에 실패했어요</h1>
        <p className="oauth-callback-error-message">{error}</p>
        {errorTip ? (
          <p className={`oauth-callback-error-tip oauth-callback-error-tip--${errorTipTone}`}>
            {errorTip}
          </p>
        ) : null}
        <button type="button" className="oauth-callback-home-btn" onClick={() => navigate('/')}>
          홈으로 돌아가기
        </button>
      </OAuthCallbackShell>
    );
  }

  return null;
};

export default OAuthCallback;

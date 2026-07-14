import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/auth/useAuth';
import {
  validateUserData,
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
} from '../../utils/common/urlUtils';
import { GoogleIcon } from '../common/headerShared';
import './OAuthCallback.css';

const LOADING_PHASES = [
  { title: 'Google 로그인 처리 중', detail: '계정 정보를 확인하고 있어요.' },
  { title: '인증 연결 중', detail: '안전하게 로그인을 마무리하고 있어요.' },
  { title: '조금만 더 기다려주세요', detail: '서버 응답이 느릴 수 있어요.' },
];

const OAUTH_ERROR_SUMMARY_MAX = 140;

function splitOAuthErrorDisplay(error) {
  const cleaned = String(error || '')
    .replace(/^로그인 실패:\s*/i, '')
    .replace(/<EOL>/g, '\n')
    .trim();

  const looksTechnical =
    cleaned.length > OAUTH_ERROR_SUMMARY_MAX ||
    /\{|invalid_grant|Bad Request|status\s*\d{3}|oauth2\.googleapis/i.test(cleaned);

  if (looksTechnical) {
    return {
      summary: 'Google 계정 연결 중 문제가 발생했습니다.',
      detail: cleaned,
    };
  }

  return { summary: cleaned || '알 수 없는 오류가 발생했습니다.', detail: null };
}

const PROCESSED_CODE_KEY = 'oauth_processed_code';
/** StrictMode 리마운트에서도 같은 code 교환을 공유 */
const oauthExchangeByCode = new Map();

function inflightKeyFor(code) {
  return `oauth_inflight_${code}`;
}

function clearOAuthAttemptArtifacts(code) {
  try {
    localStorage.removeItem(PROCESSED_CODE_KEY);
  } catch {
    /* ignore */
  }
  if (code) {
    try {
      sessionStorage.removeItem(inflightKeyFor(code));
    } catch {
      /* ignore */
    }
  }
  clearGoogleOAuthStateSession();
}

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

async function exchangeGoogleAuthCode(code) {
  const existing = oauthExchangeByCode.get(code);
  if (existing) return existing;

  const run = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/auth/google`, {
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

      if (!response.ok) {
        await resolveOAuthHttpError(response);
      }

      const data = await response.json();
      resolveOAuthApiBodyError(data);

      if (!data.result?.user) {
        throw new Error('사용자 데이터를 받지 못했습니다.');
      }

      const userData = data.result.user;
      const userValidation = validateUserData(userData);
      if (!userValidation.isValid) {
        throw new Error(userValidation.error);
      }

      return {
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
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(
          '백엔드 서버 응답이 지연되고 있습니다. 잠시 후 홈에서 다시 로그인해 주세요.',
        );
      }
      if (typeof err?.message === 'string' && err.message.includes('Failed to fetch')) {
        throw new Error(
          '백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.',
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  oauthExchangeByCode.set(code, run);
  try {
    return await run;
  } finally {
    oauthExchangeByCode.delete(code);
  }
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
    let cancelled = false;

    const finishError = (message, code) => {
      clearOAuthAttemptArtifacts(code);
      if (!cancelled) {
        setError(message);
        setIsLoading(false);
        setIsProcessing(false);
      }
    };

    const handleOAuthCallback = async () => {
      const code = searchParams.get('code');
      const oauthErrorParam = searchParams.get('error');
      const oauthState = searchParams.get('state');

      if (!code && !oauthErrorParam) {
        if (!cancelled) {
          setError('유효한 로그인 정보가 없습니다. 홈에서 Google 로그인을 다시 시도해 주세요.');
          setIsLoading(false);
        }
        return;
      }

      if (oauthErrorParam && !code) {
        clearGoogleOAuthStateSession();
        if (!cancelled) {
          setError(resolveOAuthUrlError(oauthErrorParam));
          setIsLoading(false);
        }
        return;
      }

      if (!code) {
        if (!cancelled) {
          setError('인증 코드를 받지 못했습니다. 홈에서 다시 로그인해 주세요.');
          setIsLoading(false);
        }
        return;
      }

      const stateCheck = verifyGoogleOAuthState(oauthState);
      if (!stateCheck.isValid) {
        finishError(
          stateCheck.error || 'OAuth state 검증에 실패했습니다. 다시 로그인해주세요.',
          code,
        );
        return;
      }

      const joiningExisting = oauthExchangeByCode.has(code);

      if (!joiningExisting) {
        try {
          if (localStorage.getItem(PROCESSED_CODE_KEY) === code) {
            finishError(
              '이미 처리된 로그인 요청입니다. 홈에서 Google 로그인을 다시 시도해 주세요.',
              code,
            );
            return;
          }
        } catch {
          /* ignore */
        }

        try {
          sessionStorage.setItem(inflightKeyFor(code), '1');
          localStorage.setItem(PROCESSED_CODE_KEY, code);
        } catch {
          /* ignore */
        }
      }

      if (!cancelled) setIsProcessing(true);

      try {
        if (window.history?.replaceState) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('code');
          cleanUrl.searchParams.delete('state');
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        const frontendUserData = await exchangeGoogleAuthCode(code);
        if (cancelled) return;

        login(frontendUserData);
        setIsCompleted(true);
        clearOAuthAttemptArtifacts(code);
        setIsLoading(false);
        setIsProcessing(false);
        navigate('/mypage', { replace: true });
      } catch (err) {
        finishError(normalizeOAuthFetchError(err), code);
      }
    };

    handleOAuthCallback().catch((err) => {
      if (!cancelled) {
        setError(`초기화 실패: ${err.message}`);
        setIsLoading(false);
        setIsProcessing(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams, login, navigate]);

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
    const { summary, detail } = splitOAuthErrorDisplay(error);

    return (
      <OAuthCallbackShell variant="oauth-callback-content--error">
        <div className="oauth-callback-error-icon" aria-hidden="true">
          <span className="oauth-callback-error-icon-mark">!</span>
        </div>
        <h1 className="oauth-callback-error-title">로그인에 실패했어요</h1>
        <p className="oauth-callback-error-message">{summary}</p>
        {errorTip ? <p className="oauth-callback-error-tip">{errorTip}</p> : null}
        {detail ? (
          <details className="oauth-callback-error-details">
            <summary>자세한 내용 보기</summary>
            <pre className="oauth-callback-error-detail-body">{detail}</pre>
          </details>
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

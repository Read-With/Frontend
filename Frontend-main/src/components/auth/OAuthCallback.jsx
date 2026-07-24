import { useEffect, useState } from 'react';
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
import './OAuthCallback.css';

function GoogleIcon({ className, ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

const LOADING_PHASES = [
  { title: 'Google 로그인 처리 중', detail: '계정 정보를 확인하고 있어요.' },
  { title: '인증 연결 중', detail: '안전하게 로그인을 마무리하고 있어요.' },
  { title: '조금만 더 기다려주세요', detail: '서버 응답이 느릴 수 있어요.' },
];

const OAUTH_ERROR_SUMMARY_MAX = 140;
const PROCESSED_CODE_KEY = 'oauth_processed_code';

/** StrictMode 리마운트에서도 같은 code 교환을 공유 */
const oauthExchangeByCode = new Map();

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

  const summary = (cleaned || '알 수 없는 오류가 발생했습니다.').replace(/\.\s+/g, '.\n');
  return { summary, detail: null };
}

function clearOAuthAttemptArtifacts() {
  try {
    localStorage.removeItem(PROCESSED_CODE_KEY);
  } catch {
    /* ignore */
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

function stripOAuthCallbackParams() {
  if (!window.history?.replaceState) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('code');
  cleanUrl.searchParams.delete('state');
  cleanUrl.searchParams.delete('error');
  window.history.replaceState({}, document.title, cleanUrl.toString());
}

const OAuthCallback = () => {
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState(0);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    if (!isLoading) return undefined;

    const intervalId = window.setInterval(() => {
      setLoadingPhase((prev) => Math.min(prev + 1, LOADING_PHASES.length - 1));
    }, 4500);

    return () => window.clearInterval(intervalId);
  }, [isLoading]);

  useEffect(() => {
    let cancelled = false;

    const finishError = (message) => {
      clearOAuthAttemptArtifacts();
      if (!cancelled) {
        setError(message);
        setIsLoading(false);
      }
    };

    const handleOAuthCallback = async () => {
      const code = searchParams.get('code');
      const oauthErrorParam = searchParams.get('error');
      const oauthState = searchParams.get('state');

      if (!code && !oauthErrorParam) {
        finishError('유효한 로그인 정보가 없습니다.');
        return;
      }

      if (oauthErrorParam && !code) {
        finishError(resolveOAuthUrlError(oauthErrorParam));
        return;
      }

      const stateCheck = verifyGoogleOAuthState(oauthState);
      if (!stateCheck.isValid) {
        finishError(
          stateCheck.error || 'OAuth state 검증에 실패했습니다. 다시 로그인해주세요.',
        );
        return;
      }

      const joiningExisting = oauthExchangeByCode.has(code);

      if (!joiningExisting) {
        try {
          if (localStorage.getItem(PROCESSED_CODE_KEY) === code) {
            finishError('이미 처리된 로그인 요청입니다.');
            return;
          }
          localStorage.setItem(PROCESSED_CODE_KEY, code);
        } catch {
          /* ignore */
        }
      }

      try {
        stripOAuthCallbackParams();

        const frontendUserData = await exchangeGoogleAuthCode(code);
        if (cancelled) return;

        login(frontendUserData);
        clearOAuthAttemptArtifacts();
        navigate('/mypage', { replace: true });
      } catch (err) {
        finishError(normalizeOAuthFetchError(err));
      }
    };

    handleOAuthCallback().catch((err) => {
      finishError(`초기화 실패: ${err.message}`);
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams, login, navigate]);

  if (isLoading) {
    const { title, detail } = LOADING_PHASES[loadingPhase];

    return (
      <OAuthCallbackShell role="status" ariaLive="polite" ariaBusy="true">
        <div className="oauth-callback-icon-wrap" aria-hidden="true">
          <div className="oauth-callback-icon-ring" />
          <div className="oauth-callback-google-badge">
            <GoogleIcon className="oauth-callback-google-icon" />
          </div>
        </div>

        <h1 className="oauth-callback-title">{title}</h1>
        <p className="oauth-callback-detail">{detail}</p>

        <ol className="oauth-callback-steps" aria-hidden="true">
          {LOADING_PHASES.map((_, index) => (
            <li
              key={index}
              className={[
                'oauth-callback-step',
                index === loadingPhase ? 'is-active' : '',
                index < loadingPhase ? 'is-done' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </ol>

        {loadingPhase >= LOADING_PHASES.length - 1 ? (
          <p className="oauth-callback-hint">
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

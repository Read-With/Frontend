import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import {
  validateUserData,
  verifyGoogleOAuthState,
  clearGoogleOAuthStateSession,
  resolveOAuthUrlError,
  resolveOAuthApiBodyError,
  resolveOAuthHttpError,
  normalizeOAuthFetchError,
  getOAuthErrorTip,
} from '../../utils/api/oauthApi';
import { getApiBaseUrl, getGoogleOAuthRedirectUri, takePostLoginPath } from '../../utils/common/urlUtils';
import { errorUtils, sleep } from '../../utils/common/valueUtils';
import { readRaw, writeRaw, removeKeys } from '../../utils/common/cache/cacheManager';
import { joinClasses } from '../../utils/common/domUtils';
import './OAuthCallback.css';

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

const LOADING_PHASES = [
  { title: 'Google 로그인 처리 중', detail: '계정 정보를 확인하고 있어요.' },
  { title: '인증 연결 중', detail: '안전하게 로그인을 마무리하고 있어요.' },
  { title: '조금만 더 기다려주세요', detail: '서버 응답이 느릴 수 있어요.' },
];

const OAUTH_ERROR_SUMMARY_MAX = 140;
const PROCESSED_CODE_KEY = 'oauth_processed_code';

/** StrictMode 리마운트에서도 같은 code 교환을 공유 */
const oauthExchangeByCode = new Map();

/** 온점(.) 기준으로 문장 분리 — 문장 중간 줄바꿈 없이 문장 단위로만 나눔 */
function splitIntoSentences(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.split(/(?<=\.) /) : [];
}

function SentenceLines({ text, className }) {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return null;

  return (
    <p className={className}>
      {sentences.map((sentence, index) => (
        <span key={`${index}-${sentence}`} className="oauth-callback-sentence">
          {sentence}
        </span>
      ))}
    </p>
  );
}

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

  return {
    summary: cleaned || '알 수 없는 오류가 발생했습니다.',
    detail: null,
  };
}

function clearOAuthAttemptArtifacts() {
  removeKeys('localStorage', PROCESSED_CODE_KEY);
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

function tagOAuthError(error, tags = {}) {
  const err = error instanceof Error ? error : new Error(String(error ?? 'OAuth 오류'));
  Object.assign(err, tags);
  return err;
}

// timeout은 재시도하지 않으므로 콜드 스타트(최대 1분 안팎)를 한 번의 요청 안에 기다림
const EXCHANGE_TIMEOUT_MS = 90000;

/** 서버 응답(user + 토큰) → AuthProvider.login 형식 */
function toFrontendUser(result) {
  const userData = result.user;
  return {
    id: userData.id.toString(),
    name: userData.nickname || userData.name || '사용자',
    email: userData.email,
    imageUrl: userData.profileImgUrl || userData.picture || '',
    provider: userData.provider || 'GOOGLE',
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    tokenType: result.tokenType || 'Bearer',
    expiresIn: result.expiresIn || 3600,
    refreshExpiresIn: result.refreshExpiresIn || 604800,
  };
}

/** 응답 처리 중 분류되지 않은 오류 → phase 태그 (timeout·network·exchange) */
function classifyExchangeError(err, redirectUri) {
  if (err?.phase) return err;
  if (err?.name === 'AbortError') {
    return tagOAuthError(
      '백엔드 서버 응답이 지연되고 있습니다. 잠시 후 홈에서 다시 로그인해 주세요.',
      { phase: 'timeout', redirectUri },
    );
  }
  if (errorUtils.isNetworkError(err)) {
    return tagOAuthError(
      '백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.',
      { phase: 'network', redirectUri, cause: err.message },
    );
  }
  return tagOAuthError(err, { phase: 'exchange', redirectUri, status: err?.status ?? null });
}

async function requestGoogleLogin(code, redirectUri) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
      credentials: 'include',
      signal: controller.signal,
    });

    if (!response.ok) {
      try {
        await resolveOAuthHttpError(response);
      } catch (httpErr) {
        throw tagOAuthError(httpErr, { phase: 'http_error', status: response.status, redirectUri });
      }
    }

    const data = await response.json();
    resolveOAuthApiBodyError(data);

    if (!data.result?.user) {
      throw tagOAuthError('사용자 데이터를 받지 못했습니다.', { phase: 'invalid_payload', redirectUri });
    }
    const userValidation = validateUserData(data.result.user);
    if (!userValidation.isValid) {
      throw tagOAuthError(userValidation.error, { phase: 'invalid_user', redirectUri });
    }
    return toFrontendUser(data.result);
  } catch (err) {
    throw classifyExchangeError(err, redirectUri);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 같은 code의 교환은 진행 중인 요청을 공유 (StrictMode 리마운트) */
async function exchangeGoogleAuthCode(code) {
  const existing = oauthExchangeByCode.get(code);
  if (existing) return existing;

  const run = requestGoogleLogin(code, getGoogleOAuthRedirectUri());
  oauthExchangeByCode.set(code, run);
  try {
    return await run;
  } finally {
    oauthExchangeByCode.delete(code);
  }
}

// timeout·504는 제외: 서버가 요청을 받아 code를 이미 소비했을 수 있음
const isServerNotReady = (err) =>
  err?.phase === 'network' || [502, 503].includes(err?.status);

const MAX_EXCHANGE_ATTEMPTS = 30; // 대기 최대 5초씩 → 콜드 스타트 약 2분까지

/** 서버가 깨어날 때까지 재시도 (code를 서버가 아직 소비하지 않은 실패만). 취소되면 null */
async function exchangeWithRetry(code, isCancelled) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await exchangeGoogleAuthCode(code);
    } catch (err) {
      if (isCancelled() || !isServerNotReady(err) || attempt >= MAX_EXCHANGE_ATTEMPTS) throw err;
      await sleep(Math.min(1000 * attempt, 5000));
      if (isCancelled()) return null;
    }
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

/**
 * 콜백 URL 검사. 진행할 수 없으면 { failure: { message, level, reason } }, 아니면 { code }
 */
function checkCallbackParams(searchParams) {
  const code = searchParams.get('code');
  const oauthErrorParam = searchParams.get('error');

  if (!code) {
    return oauthErrorParam
      ? { failure: { message: resolveOAuthUrlError(oauthErrorParam), level: 'warn', reason: `provider_error:${oauthErrorParam}` } }
      : { failure: { message: '유효한 로그인 정보가 없습니다.', level: 'warn', reason: 'missing_code' } };
  }

  const stateCheck = verifyGoogleOAuthState(searchParams.get('state'));
  if (!stateCheck.isValid) {
    return {
      failure: {
        message: stateCheck.error || 'OAuth state 검증에 실패했습니다. 다시 로그인해주세요.',
        reason: 'invalid_state',
      },
    };
  }

  // 진행 중인 교환에 합류하는 경우가 아니면, 이미 처리한 code는 거부하고 이번 code를 기록
  if (!oauthExchangeByCode.has(code)) {
    if (readRaw(PROCESSED_CODE_KEY) === code) {
      return { failure: { message: '이미 처리된 로그인 요청입니다.', level: 'warn', reason: 'duplicate_code' } };
    }
    if (!writeRaw(PROCESSED_CODE_KEY, code)) {
      errorUtils.logWarning('OAuthCallback', 'processed code 저장 실패', { reason: 'storage_write_failed' });
    }
  }
  return { code };
}

function logOAuthFailure(message, { error = null, level = 'error', reason = null } = {}) {
  const detail = error || new Error(message);
  const meta = {
    reason,
    phase: detail.phase ?? null,
    status: detail.status ?? null,
    redirectUri: detail.redirectUri ?? null,
    uiMessage: message,
  };
  if (level === 'warn') errorUtils.logWarning('OAuthCallback', message, meta);
  else errorUtils.logError('OAuthCallback', detail, meta);
}

/** 로딩 단계 문구를 4.5초마다 다음 단계로 */
function useLoadingPhase(active) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const intervalId = window.setInterval(() => {
      setPhase((prev) => Math.min(prev + 1, LOADING_PHASES.length - 1));
    }, 4500);
    return () => window.clearInterval(intervalId);
  }, [active]);
  return phase;
}

function LoadingView({ phase }) {
  const { title, detail } = LOADING_PHASES[phase];
  return (
    <OAuthCallbackShell role="status" ariaLive="polite" ariaBusy="true">
      <div className="oauth-callback-icon-wrap" aria-hidden="true">
        <div className="oauth-callback-icon-ring" />
        <div className="oauth-callback-google-badge">
          <GoogleIcon className="oauth-callback-google-icon" />
        </div>
      </div>

      <h1 className="oauth-callback-title">{title}</h1>
      <SentenceLines className="oauth-callback-detail" text={detail} />

      <ol className="oauth-callback-steps" aria-hidden="true">
        {LOADING_PHASES.map((_, index) => (
          <li
            key={index}
            className={joinClasses(
              'oauth-callback-step',
              index === phase && 'is-active',
              index < phase && 'is-done',
            )}
          />
        ))}
      </ol>

      {phase >= LOADING_PHASES.length - 1 ? (
        <SentenceLines
          className="oauth-callback-hint"
          text="첫 로그인이거나 서버가 깨어나는 중이면 10~20초 정도 걸릴 수 있어요."
        />
      ) : null}
    </OAuthCallbackShell>
  );
}

function ErrorView({ error, onHome }) {
  const errorTip = getOAuthErrorTip(error);
  const { summary, detail } = splitOAuthErrorDisplay(error);
  return (
    <OAuthCallbackShell variant="oauth-callback-content--error">
      <div className="oauth-callback-error-icon" aria-hidden="true">
        <span className="oauth-callback-error-icon-mark">!</span>
      </div>
      <h1 className="oauth-callback-error-title">로그인에 실패했어요</h1>
      <SentenceLines className="oauth-callback-error-message" text={summary} />
      {errorTip ? <SentenceLines className="oauth-callback-error-tip" text={errorTip} /> : null}
      {detail ? (
        <details className="oauth-callback-error-details">
          <summary>자세한 내용 보기</summary>
          <pre className="oauth-callback-error-detail-body">{detail}</pre>
        </details>
      ) : null}
      <button type="button" className="oauth-callback-home-btn" onClick={onHome}>
        홈으로 돌아가기
      </button>
    </OAuthCallbackShell>
  );
}

const OAuthCallback = () => {
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadingPhase = useLoadingPhase(isLoading);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    const finishError = (message, options) => {
      logOAuthFailure(message, options);
      clearOAuthAttemptArtifacts();
      if (!cancelled) {
        setError(message);
        setIsLoading(false);
      }
    };

    const handleOAuthCallback = async () => {
      const { code, failure } = checkCallbackParams(searchParams);
      if (failure) {
        finishError(failure.message, failure);
        return;
      }

      try {
        stripOAuthCallbackParams();
        const frontendUserData = await exchangeWithRetry(code, isCancelled);
        if (cancelled || !frontendUserData) return;
        login(frontendUserData);
        clearOAuthAttemptArtifacts();
        navigate(takePostLoginPath() || '/mypage', { replace: true });
      } catch (err) {
        finishError(normalizeOAuthFetchError(err), { error: err, reason: 'code_exchange_failed' });
      }
    };

    handleOAuthCallback().catch((err) => {
      finishError(`초기화 실패: ${err.message}`, { error: err, reason: 'init_failed' });
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams, login, navigate]);

  if (isLoading) return <LoadingView phase={loadingPhase} />;
  if (error) return <ErrorView error={error} onHome={() => navigate('/')} />;
  return null;
};

export default OAuthCallback;

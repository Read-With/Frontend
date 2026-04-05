/**
 * Content-Security-Policy 문자열 생성
 * - 개발: Vite HMR·@vite/client용 script-src 에 unsafe-inline / unsafe-eval
 * - 프로덕션 빌드: 동일 도메인 모듈 + OAuth·Speed Insights 등 허용 도메인만 (스크립트는 엄격)
 * - style-src: React 인라인 style 등으로 unsafe-inline 유지
 * - connect-src: VITE_API_BASE_URL (미설정 시 appEnvDefaults), VITE_DEV_PROXY_TARGET, VITE_CSP_CONNECT_EXTRA
 */

import { DEFAULT_API_BASE_URL } from '../src/utils/common/appEnvDefaults.js';

function addConnectOrigins(set, rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return;
  try {
    const u = new URL(rawUrl.trim());
    set.add(`${u.protocol}//${u.host}`);
  } catch {
    /* ignore */
  }
}

/**
 * @param {Record<string, string>} env loadEnv 결과
 * @param {{ dev: boolean }} options
 * @returns {string}
 */
export function buildContentSecurityPolicy(env, { dev }) {
  const scriptSrc = dev
    ? [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'https://accounts.google.com',
        'https://apis.google.com',
        'https://va.vercel-scripts.com',
      ]
    : [
        "'self'",
        'https://accounts.google.com',
        'https://apis.google.com',
        'https://va.vercel-scripts.com',
      ];

  const styleSrc = [
    "'self'",
    "'unsafe-inline'",
    'https://fonts.googleapis.com',
    'https://accounts.google.com',
    'blob:',
  ];

  const fontSrc = ["'self'", 'https://fonts.gstatic.com', 'data:'];
  const imgSrc = ["'self'", 'data:', 'https:', 'blob:'];
  const frameSrc = ["'self'", 'https://accounts.google.com'];

  const connect = new Set([
    "'self'",
    'https://accounts.google.com',
    'https://oauth2.googleapis.com',
    'https://*.s3.ap-northeast-2.amazonaws.com',
    'https://*.s3.amazonaws.com',
  ]);

  const apiOrigin = (env.VITE_API_BASE_URL || '').trim() || DEFAULT_API_BASE_URL;
  if (apiOrigin) connect.add(apiOrigin);

  if (dev) {
    connect.add('ws://localhost:*');
    connect.add('wss://localhost:*');
    connect.add('http://localhost:*');
    connect.add('http://127.0.0.1:*');
    connect.add('https://localhost:*');
    connect.add('ws://127.0.0.1:*');
    connect.add('wss://127.0.0.1:*');
    connect.add('https://va.vercel-scripts.com');
    addConnectOrigins(connect, env.VITE_DEV_PROXY_TARGET);
  } else {
    connect.add('https://va.vercel-scripts.com');
  }

  (env.VITE_CSP_CONNECT_EXTRA || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((origin) => connect.add(origin));

  const connectSrc = [...connect].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${styleSrc.join(' ')}`,
    `font-src ${fontSrc.join(' ')}`,
    `img-src ${imgSrc.join(' ')}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc.join(' ')}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ].join('; ');
}

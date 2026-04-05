/**
 * 환경 변수 미설정 시 사용하는 기본값 (Vite·브라우저 코드 공통)
 *
 * 클라이언트에서 덮어쓰기:
 * - VITE_API_BASE_URL — 프로덕션 API 호스트 (끝 슬래시 없음)
 * - VITE_APP_ORIGIN — 프로덕션 프론트 origin (OAuth 기본 redirect·홈)
 * - VITE_POST_LOGIN_HOME_URL — 로그아웃/만료 후 이동 URL (우선)
 * - VITE_GOOGLE_REDIRECT_URI — OAuth 콜백 전체 URL (최우선)
 * - VITE_DEV_PROXY_TARGET — 개발 시 Vite 프록시 대상 (CSP connect-src·안내 문구)
 */

export const DEFAULT_API_BASE_URL = 'https://dev.readwith.store';

export const DEFAULT_APP_ORIGIN = 'https://dev.readwith.store';

export const DEFAULT_DEV_PROXY_TARGET =
  'http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com';

import { getApiBaseUrl } from './authUtils';

/**
 * 매니페스트 readerArtifacts 등 서버가 준 artifact 경로를 fetch 가능한 URL로 만듭니다.
 * - 절대 http(s) URL은 그대로
 * - / 로 시작하면 API base와 결합 (개발 시 base 빈 문자열이면 상대 경로 유지)
 */
export function resolveApiArtifactUrl(path) {
  if (path == null) return '';
  const s = String(path).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(getApiBaseUrl() ?? '').replace(/\/$/, '');
  if (s.startsWith('/')) {
    return base ? `${base}${s}` : s;
  }
  if (base) {
    return `${base}/${s}`;
  }
  return `/${s}`;
}

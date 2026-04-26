/** 뷰어 경로: 쿼리 없음. 읽기 위치는 `/user/viewer/:id/c/:chapter/p/:page` */

export const USER_VIEWER_PREFIX = '/user/viewer';

const READER_SPLAT_RE = /^c\/(\d+)\/p\/(\d+)$/;

export function parseViewerReaderSplat(splat) {
  if (splat == null || splat === '') return null;
  const s = String(splat).replace(/^\/+|\/+$/g, '');
  if (!s) return null;
  const m = s.match(READER_SPLAT_RE);
  if (!m) return null;
  const chapter = Math.floor(Number(m[1]));
  const page = Math.floor(Number(m[2]));
  if (!Number.isFinite(chapter) || chapter < 1 || !Number.isFinite(page) || page < 1) return null;
  return { chapter, page };
}

export function userViewerReadingPath(bookId, chapter, page) {
  const base = userViewerPath(bookId);
  const c = Math.floor(Number(chapter));
  const p = Math.floor(Number(page));
  if (!Number.isFinite(c) || c < 1 || !Number.isFinite(p) || p < 1) return base;
  return `${base}/c/${c}/p/${p}`;
}

export function userViewerPath(bookId) {
  const id = bookId != null ? String(bookId).replace(/^\//, '').trim() : '';
  if (!id) return USER_VIEWER_PREFIX;
  return `${USER_VIEWER_PREFIX}/${id}`;
}

export function userViewerBookmarksPath(bookId) {
  const id = bookId != null ? String(bookId).replace(/^\//, '').trim() : '';
  if (!id) return `${USER_VIEWER_PREFIX}/bookmarks`;
  return `${USER_VIEWER_PREFIX}/${id}/bookmarks`;
}

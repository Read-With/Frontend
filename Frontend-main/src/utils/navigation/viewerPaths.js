/** 뷰어 경로: 쿼리 없음. 읽기 위치는 `/user/viewer/:id/c/:chapter/p/:page` */

import { toOneBasedChapterIndexOrNull } from '../common/valueUtils';

export const USER_VIEWER_PREFIX = '/user/viewer';

const READER_SPLAT_RE = /^c\/(\d+)\/p\/(\d+)$/;

export function parseViewerReaderSplat(splat) {
  if (splat == null || splat === '') return null;
  const normalizedSplat = String(splat).replace(/^\/+|\/+$/g, '');
  if (!normalizedSplat) return null;
  const match = normalizedSplat.match(READER_SPLAT_RE);
  if (!match) return null;
  const chapter = toOneBasedChapterIndexOrNull(match[1]);
  const page = toOneBasedChapterIndexOrNull(match[2]);
  if (!chapter || !page) return null;
  return { chapter, page };
}

export function userViewerReadingPath(bookId, chapter, page) {
  const base = userViewerPath(bookId);
  const normalizedChapter = toOneBasedChapterIndexOrNull(chapter);
  const normalizedPage = toOneBasedChapterIndexOrNull(page);
  if (!normalizedChapter || !normalizedPage) return base;
  return `${base}/c/${normalizedChapter}/p/${normalizedPage}`;
}

function sanitizeViewerBookId(bookId) {
  return bookId != null ? String(bookId).replace(/^\/+/, '').trim() : '';
}

export function userViewerPath(bookId) {
  const id = sanitizeViewerBookId(bookId);
  if (!id) return USER_VIEWER_PREFIX;
  return `${USER_VIEWER_PREFIX}/${id}`;
}

export function userViewerBookmarksPath(bookId) {
  const id = sanitizeViewerBookId(bookId);
  if (!id) return `${USER_VIEWER_PREFIX}/bookmarks`;
  return `${USER_VIEWER_PREFIX}/${id}/bookmarks`;
}

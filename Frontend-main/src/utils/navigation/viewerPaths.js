/** 뷰어·그래프 경로: 쿼리 없음. 읽기 위치는 `/user/viewer/:id/c/:chapter/p/:page` */

import { toOneBasedChapterIndexOrNull } from '../common/valueUtils';

export const USER_VIEWER_PREFIX = '/user/viewer';
export const USER_GRAPH_PREFIX = '/user/graph';

const DEFAULT_VIEWER_READING_POSITION = Object.freeze({ chapter: 1, page: 1 });

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

/** splat 파싱 결과 → 챕터/페이지. 없거나 불완전하면 기본 위치 */
export function resolveViewerReadingPosition(parsedPath) {
  return {
    chapter: parsedPath?.chapter ?? DEFAULT_VIEWER_READING_POSITION.chapter,
    page: parsedPath?.page ?? DEFAULT_VIEWER_READING_POSITION.page,
  };
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

export function userGraphPath(bookId) {
  const id = sanitizeViewerBookId(bookId);
  if (!id) return USER_GRAPH_PREFIX;
  return `${USER_GRAPH_PREFIX}/${id}`;
}

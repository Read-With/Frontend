/** 북마크 표시·locator·색상 팔레트 (API 호출 없음) */

import { toLocator, locatorsEqual, toViewerResumeAnchor } from '../common/locatorUtils';
import { toPositiveNumberOrNull } from '../common/valueUtils';
import { resolveViewerBookKey } from '../viewer/viewerCoreStateUtils';
import {
  getChapterData,
  locatorToBookAbsoluteOffset,
  normalizeStartEndLocatorsForServer,
  resolveProgressMetricsFromLocator,
} from '../common/cache/manifestCache';

export const clientSortToApiSort = (sortOrder) =>
  sortOrder === 'oldest' ? 'time_asc' : 'time_desc';

export const resolveBookmarkApiBookId = (book, routeBookId = null) =>
  toPositiveNumberOrNull(resolveViewerBookKey(book, routeBookId));

/** 뷰어 locator → 서버 paragraphStarts 축 (비교·생성 공통) */
export const normalizeBookmarkLocators = (bookId, startLocator, endLocator = null) =>
  normalizeStartEndLocatorsForServer(bookId, startLocator, endLocator);

/** 북마크 → 뷰어 resumeAnchor (진도 preferred resume와 동일 헬퍼) */
export const bookmarkToResumeAnchor = (bookmark) =>
  toViewerResumeAnchor({
    startLocator: bookmark?.startLocator,
    endLocator: bookmark?.endLocator,
  });

/** 북마크 추가 전: 해당 챕터 paragraphStarts가 있어야 서버 offset 검증을 통과함 */
export const isBookmarkAxisReady = (bookId, locator) => {
  const loc = toLocator(locator);
  if (!loc || bookId == null || bookId === '') return false;
  const chapter = getChapterData(bookId, loc.chapterIndex);
  return Array.isArray(chapter?.paragraphStarts) && chapter.paragraphStarts.length > 0;
};

const isBookmarkRange = (bookmark, startLoc, endLoc) =>
  !!(
    bookmark?.rangeBookmark ||
    (endLoc && startLoc && !locatorsEqual(startLoc, endLoc))
  );

/** 진도 메트릭과 동일한 축으로 위치 라벨 생성 */
export const parseBookmarkLocation = (bookmark, bookId = null) => {
  if (!bookmark) return '';
  const loc = toLocator(bookmark.startLocator);
  if (!loc) {
    const off = Number(bookmark.startTxtOffset);
    if (!Number.isFinite(off)) return '';
    const isRange =
      bookmark.rangeBookmark ||
      (Number(bookmark.endTxtOffset) > 0 && Number(bookmark.endTxtOffset) !== off);
    return isRange ? `문서 오프셋 ${off} · 범위` : `문서 오프셋 ${off}`;
  }

  const end = toLocator(bookmark.endLocator);
  const metrics =
    bookId != null && bookId !== ''
      ? resolveProgressMetricsFromLocator(bookId, loc)
      : null;

  let base;
  if (metrics?.chapterProgress != null) {
    base = `${loc.chapterIndex}챕터 · ${metrics.chapterProgress}%`;
  } else {
    base = `${loc.chapterIndex}챕터 · 블록 ${loc.blockIndex}`;
  }
  return isBookmarkRange(bookmark, loc, end) ? `${base} · 범위` : base;
};

export const formatBookmarkLocatorDetail = (bookmark, bookId = null) => {
  const loc = toLocator(bookmark?.startLocator);
  if (!loc) return '';
  const metrics =
    bookId != null && bookId !== ''
      ? resolveProgressMetricsFromLocator(bookId, loc)
      : null;
  if (metrics?.readingProgressPercent != null && metrics?.chapterProgress != null) {
    return `전체 ${metrics.readingProgressPercent}% · 챕터 ${metrics.chapterProgress}%`;
  }
  return `챕터 ${loc.chapterIndex} · 블록 ${loc.blockIndex} · 오프셋 ${loc.offset}`;
};

export const isSameBookmarkPosition = (bookmark, ref) => {
  if (!bookmark || !ref) return false;

  const aStart = toLocator(bookmark.startLocator);
  const bStart = toLocator(ref.startLocator);
  if (!aStart || !bStart || !locatorsEqual(aStart, bStart)) return false;
  return locatorsEqual(
    toLocator(bookmark.endLocator) ?? aStart,
    toLocator(ref.endLocator) ?? bStart
  );
};

/** 진도 absolute offset 기준으로 정렬 키 */
function getBookmarkPositionSortKey(bookmark, bookId = null) {
  if (!bookmark) return '';
  const loc = toLocator(bookmark.startLocator);
  if (loc && bookId != null && bookId !== '') {
    const abs = locatorToBookAbsoluteOffset(bookId, loc);
    if (abs != null) return `a_${String(abs).padStart(12, '0')}`;
  }
  if (loc) {
    return `${String(loc.chapterIndex).padStart(6, '0')}_${String(loc.blockIndex).padStart(6, '0')}_${String(loc.offset).padStart(8, '0')}`;
  }
  const o = Number(bookmark.startTxtOffset);
  return Number.isFinite(o) ? `o_${String(o).padStart(12, '0')}` : '';
}

export const sortBookmarks = (bookmarks, sortOrder, bookId = null) => {
  if (!bookmarks?.length) return [];
  if (sortOrder !== 'position') return bookmarks;
  return [...bookmarks].sort((a, b) =>
    getBookmarkPositionSortKey(a, bookId).localeCompare(getBookmarkPositionSortKey(b, bookId))
  );
};

const RELATIVE_DAYS_THRESHOLD = 7;

export const formatRelativeTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMin = Math.floor((Date.now() - date.getTime()) / (1000 * 60));
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < RELATIVE_DAYS_THRESHOLD) return `${diffDay}일 전`;
  return date.toLocaleString('ko-KR', { month: 'short', day: 'numeric' });
};

export const formatAbsoluteTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const bookmarkColors = {
  normal: '#f4f7ff',
  important: '#fff3c2',
  highlight: '#e0e7ff',
};

export const bookmarkBorders = {
  normal: '#e7eaf7',
  important: '#ffd600',
  highlight: '#5C6F5C',
};

const DEFAULT_BOOKMARK_COLOR = bookmarkColors.normal;

export const colorOptions = [
  { key: 'normal', label: '기본', color: bookmarkColors.normal, border: bookmarkBorders.normal },
  { key: 'important', label: '중요', color: bookmarkColors.important, border: bookmarkBorders.important },
  { key: 'highlight', label: '강조', color: bookmarkColors.highlight, border: bookmarkBorders.highlight },
];

export const getColorKey = (color) =>
  colorOptions.find((option) => option.color === color)?.key ?? 'normal';

export const createBookmarkData = (bookId, startLocator, endLocator = null) => {
  const { startLocator: start, endLocator: end } = normalizeBookmarkLocators(
    bookId,
    startLocator,
    endLocator
  );
  const data = { bookId, color: DEFAULT_BOOKMARK_COLOR, memo: '' };
  if (start) data.startLocator = start;
  if (end) data.endLocator = end;
  return data;
};

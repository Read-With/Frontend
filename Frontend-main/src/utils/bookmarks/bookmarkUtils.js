import { toLocator, locatorsEqual } from '../common/locatorUtils';

export const createBookmarkTitle = (pageNum, chapterNum, fallbackIndex = null) => {
  if (pageNum != null && chapterNum != null) return `${pageNum}페이지 (${chapterNum}챕터)`;
  if (pageNum != null) return `${pageNum}페이지`;
  if (chapterNum != null) return `${chapterNum}챕터`;
  return fallbackIndex !== null ? `북마크 ${fallbackIndex}` : '';
};

export const parseBookmarkLocation = (bookmark) => {
  if (!bookmark) return '';
  const rawTitle = bookmark.title;
  if (rawTitle != null && String(rawTitle).trim()) return String(rawTitle).trim();
  const loc = toLocator(bookmark.startLocator);
  if (!loc) {
    const off = Number(bookmark.startTxtOffset);
    if (Number.isFinite(off)) {
      const range =
        bookmark.isRangeBookmark ||
        bookmark.rangeBookmark ||
        (Number(bookmark.endTxtOffset) > 0 && Number(bookmark.endTxtOffset) !== off);
      return range ? `문서 오프셋 ${off} · 범위` : `문서 오프셋 ${off}`;
    }
    return '';
  }
  const base = `${loc.chapterIndex}챕터`;
  if (bookmark.rangeBookmark || bookmark.isRangeBookmark) return `${base} · 범위`;
  const end = toLocator(bookmark.endLocator);
  if (end && !locatorsEqual(loc, end)) return `${base} · 범위`;
  return base;
};

export const isValidLocator = (loc) => toLocator(loc) != null;

export const isSameBookmarkPosition = (bookmark, ref) => {
  if (!bookmark || !ref) return false;
  const ta = Number(bookmark.startTxtOffset);
  const tb = Number(ref.startTxtOffset);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    return ta === tb && Number(bookmark.endTxtOffset || 0) === Number(ref.endTxtOffset || 0);
  }
  const a = toLocator(bookmark.startLocator);
  const b = toLocator(ref.startLocator);
  if (!a || !b) return false;
  return a.chapterIndex === b.chapterIndex && a.blockIndex === b.blockIndex && a.offset === b.offset;
};

export const getLocatorSortKey = (loc) => {
  const n = toLocator(loc);
  if (!n) return '';
  return `${String(n.chapterIndex).padStart(6, '0')}_${String(n.blockIndex).padStart(6, '0')}_${String(n.offset).padStart(8, '0')}`;
};

/** 위치 정렬: locator 우선, 없으면 v2 startTxtOffset */
export const getBookmarkPositionSortKey = (bookmark) => {
  if (!bookmark) return '';
  const locKey = getLocatorSortKey(bookmark.startLocator);
  if (locKey) return locKey;
  const o = Number(bookmark.startTxtOffset);
  if (Number.isFinite(o)) return `o_${String(o).padStart(12, '0')}`;
  return '';
};

const RELATIVE_DAYS_THRESHOLD = 7;

const formatRelativeCore = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { valid: false, date: null };
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return { valid: true, relative: '방금 전', date };
  if (diffMin < 60) return { valid: true, relative: `${diffMin}분 전`, date };
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return { valid: true, relative: `${diffHour}시간 전`, date };
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < RELATIVE_DAYS_THRESHOLD) return { valid: true, relative: `${diffDay}일 전`, date };
  return { valid: true, relative: null, date };
};

const formatBookmarkTime = (value, withTimeForPast) => {
  if (!value) return '';
  const result = formatRelativeCore(value);
  if (!result.valid) return '';
  if (result.relative) return result.relative;
  const opts = withTimeForPast
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  return result.date.toLocaleString('ko-KR', opts);
};

export const formatRelativeTime = (value) => formatBookmarkTime(value, false);

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

export const formatDate = (value) => formatBookmarkTime(value, true);

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

export const colorOptions = [
  { key: 'normal', label: '기본', color: bookmarkColors.normal, border: bookmarkBorders.normal, icon: 'bookmark' },
  { key: 'important', label: '중요', color: bookmarkColors.important, border: bookmarkBorders.important, icon: 'grade' },
  { key: 'highlight', label: '강조', color: bookmarkColors.highlight, border: bookmarkBorders.highlight, icon: 'styler' },
];

export const bookmarkColorPalette = [
  { value: '#28B532', label: '기본', preview: '#28B532' },
  { value: '#FF6B6B', label: '빨강', preview: '#FF6B6B' },
  { value: '#4ECDC4', label: '청록', preview: '#4ECDC4' },
  { value: '#45B7D1', label: '파랑', preview: '#45B7D1' },
  { value: '#96CEB4', label: '연두', preview: '#96CEB4' },
  { value: '#FFEAA7', label: '노랑', preview: '#FFEAA7' },
  { value: '#DDA0DD', label: '보라', preview: '#DDA0DD' },
  { value: '#FFB347', label: '주황', preview: '#FFB347' },
];

export const getColorKey = (color) => {
  if (color === bookmarkColors.important) return 'important';
  if (color === bookmarkColors.highlight) return 'highlight';
  return 'normal';
};

export const createBookmarkData = (bookId, color = '#28B532', memo = '', startLocator = null, endLocator = null) => {
  const data = { bookId, color, memo };
  const start = toLocator(startLocator);
  const end = toLocator(endLocator);
  if (start) data.startLocator = start;
  if (start && end && !locatorsEqual(start, end)) data.endLocator = end;
  return data;
};

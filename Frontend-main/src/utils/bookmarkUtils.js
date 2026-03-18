export const createBookmarkTitle = (pageNum, chapterNum, fallbackIndex = null) => {
  if (pageNum != null && chapterNum != null) return `${pageNum}페이지 (${chapterNum}챕터)`;
  if (pageNum != null) return `${pageNum}페이지`;
  if (chapterNum != null) return `${chapterNum}챕터`;
  return fallbackIndex !== null ? `북마크 ${fallbackIndex}` : '';
};

export const parseBookmarkLocation = (bookmark) => {
  if (!bookmark) return '';
  if (bookmark.title) return bookmark.title;
  const loc = bookmark.startLocator;
  if (isValidLocator(loc)) return `${loc.chapterIndex}챕터`;
  return '';
};

export const isValidLocator = (loc) =>
  loc != null && typeof loc === 'object' && Number.isFinite(loc.chapterIndex);

export const isSameBookmarkPosition = (bookmark, ref) => {
  if (!bookmark || !ref) return false;
  const { startLocator } = ref;
  if (!isValidLocator(startLocator) || !isValidLocator(bookmark.startLocator)) return false;
  const a = bookmark.startLocator;
  return a.chapterIndex === startLocator.chapterIndex
    && (a.blockIndex ?? 0) === (startLocator.blockIndex ?? 0)
    && (a.offset ?? 0) === (startLocator.offset ?? 0);
};

export const getLocatorSortKey = (loc) => {
  if (!isValidLocator(loc)) return '';
  const b = loc.blockIndex ?? 0;
  const o = loc.offset ?? 0;
  return `${String(loc.chapterIndex).padStart(6, '0')}_${String(b).padStart(6, '0')}_${String(o).padStart(8, '0')}`;
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

export const formatRelativeTime = (value) => {
  if (!value) return '';
  const result = formatRelativeCore(value);
  if (!result.valid) return '';
  if (result.relative) return result.relative;
  return result.date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
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

export const formatDate = (dateString) => {
  if (!dateString) return '';
  const result = formatRelativeCore(dateString);
  if (!result.valid) return '';
  if (result.relative) return result.relative;
  return result.date.toLocaleString('ko-KR', {
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

/** normal/important/highlight 3종만 구분. bookmarkColorPalette 색상은 매칭되지 않으면 'normal' 반환 */
export const getColorKey = (color) => {
  if (color === bookmarkColors.important) return 'important';
  if (color === bookmarkColors.highlight) return 'highlight';
  return 'normal';
};

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export const createBookmarkData = (bookId, color = '#28B532', memo = '', title = null, startLocator = null, endLocator = null) => {
  const data = { bookId, color, memo, title, createdAt: new Date().toISOString() };
  if (isPlainObject(startLocator)) data.startLocator = startLocator;
  if (isPlainObject(endLocator)) data.endLocator = endLocator;
  return data;
};

export const parseCfiToChapterPage = (cfi) => {
  if (!cfi) return '';
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? parseInt(chapterMatch[1]) : null;
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  const page = pageMatch ? parseInt(pageMatch[1]) : null;
  if (page && chapter) return `${page}페이지 (${chapter}챕터)`;
  if (page) return `${page}페이지`;
  if (chapter) return `${chapter}챕터`;
  return cfi;
};

export const createBookmarkTitle = (pageNum, chapterNum, cfi = null, fallbackIndex = null) => {
  if (pageNum && chapterNum) return `${pageNum}페이지 (${chapterNum}챕터)`;
  if (pageNum) return `${pageNum}페이지`;
  if (chapterNum) return `${chapterNum}챕터`;
  if (cfi) return parseCfiToChapterPage(cfi);
  return fallbackIndex !== null ? `북마크 ${fallbackIndex}` : '';
};

export const parseBookmarkLocation = (bookmark) => {
  if (!bookmark) return '';
  if (bookmark.title) return bookmark.title;
  return parseCfiToChapterPage(bookmark.startCfi || '');
};

export const formatRelativeTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
};

export const formatAbsoluteTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR', {
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

export const getColorKey = (color) => {
  if (color === bookmarkColors.important) return 'important';
  if (color === bookmarkColors.highlight) return 'highlight';
  return 'normal';
};

export const createBookmarkData = (bookId, startCfi, endCfi = null, color = '#28B532', memo = '', title = null) => ({
  bookId,
  startCfi,
  endCfi,
  color,
  memo,
  title,
  createdAt: new Date().toISOString()
});

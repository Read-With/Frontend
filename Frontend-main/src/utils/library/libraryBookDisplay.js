import { getProgressFromCache } from '../common/cache/progressCache';

export function getLocalProgressPercent(bookIdStr) {
  if (bookIdStr == null) return null;
  try {
    const raw = localStorage.getItem(`progress_${bookIdStr}`);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  } catch {
    return null;
  }
}

/** 마이페이지 BookCard·useBooks와 동일한 진행률(0–100) */
export function resolveLibraryReadingProgressPercent(book) {
  if (book == null) return 0;
  const rawId = book.id ?? book._bookId;
  if (rawId == null) return 0;
  const bookIdStr = String(rawId);
  const cached = getProgressFromCache(bookIdStr);
  const cachePct = cached?.readingProgressPercent;
  if (cachePct != null && Number.isFinite(Number(cachePct))) {
    return Math.round(Math.min(100, Math.max(0, Number(cachePct))));
  }
  const listProgress = book.progress;
  if (listProgress != null && Number.isFinite(Number(listProgress))) {
    return Math.round(Math.min(100, Math.max(0, Number(listProgress))));
  }
  return getLocalProgressPercent(bookIdStr) ?? 0;
}

export function formatLibraryRelativeDate(updatedAt) {
  if (updatedAt == null) return '';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return '오늘';
  if (diffDays === 2) return '어제';
  if (diffDays <= 7) return `${diffDays - 1}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

import { getProgressFromCache } from '../common/cache/progressCache';
import { clampPercent } from '../common/numberUtils';
import { getStoredProgressPercent } from '../common/progressPercentStorage';

function getLocalProgressPercent(bookIdStr) {
  return getStoredProgressPercent(bookIdStr);
}

/** 마이페이지 BookCard·useBooks와 동일한 진행률(0–100) */
export function resolveLibraryReadingProgressPercent(book) {
  if (book == null) return 0;
  const rawId = book.id ?? book._bookId;
  if (rawId == null) return 0;
  const bookIdStr = String(rawId);
  const cached = getProgressFromCache(bookIdStr);
  const cachePct = cached?.readingProgressPercent;
  const normalizedCachePct = clampPercent(cachePct);
  if (normalizedCachePct != null) return Math.round(normalizedCachePct);

  const listProgress = book.progress;
  const normalizedListProgress = clampPercent(listProgress);
  if (normalizedListProgress != null) return Math.round(normalizedListProgress);

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

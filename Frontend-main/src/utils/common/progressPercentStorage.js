import { clampPercent } from './numberUtils';

/**
 * 뷰어 퍼센트 진도 로컬 키: progress_{bookId} (useLocalStorageNumber와 동일 규칙)
 */
export const progressStorageKey = (bookId) => `progress_${bookId}`;

export function getStoredProgressPercent(bookId) {
  const id = bookId != null ? String(bookId).trim() : '';
  if (!id) return null;
  try {
    const raw = localStorage.getItem(progressStorageKey(id));
    if (raw == null) return null;
    return clampPercent(raw);
  } catch {
    return null;
  }
}

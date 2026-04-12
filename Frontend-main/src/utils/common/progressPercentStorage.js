/**
 * 뷰어 퍼센트 진도 로컬 키: progress_{bookId} (useLocalStorageNumber와 동일 규칙)
 */
export function getStoredProgressPercent(bookId) {
  const id = bookId != null ? String(bookId).trim() : '';
  if (!id) return null;
  try {
    const raw = localStorage.getItem(`progress_${id}`);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  } catch {
    return null;
  }
}

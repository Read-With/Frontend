/**
 * meta.json 로더
 * 구조: { chapters: [{ chapterIndex, paragraphStarts, paragraphLengths, totalCodePoints }] }
 *
 * 우선순위: GET /api/books/{bookId}/meta → 실패 시 public /books/{bookId}/meta.json
 */

import { getBookMeta } from '../api/api';
import { errorUtils } from '../common/errorUtils';

const metaCache = new Map();
const CACHE_TTL = 1000 * 60 * 15;

function getCached(bookId) {
  const entry = metaCache.get(String(bookId));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    metaCache.delete(String(bookId));
    return null;
  }
  return entry.data;
}

function setCached(bookId, data) {
  metaCache.set(String(bookId), { data, timestamp: Date.now() });
}

export async function loadBookMeta(bookId, { useCache = true } = {}) {
  if (!bookId) return null;

  const key = String(bookId);
  if (useCache) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  const apiRes = await getBookMeta(bookId);
  if (apiRes?.isSuccess && apiRes?.result) {
    const data = normalizeMeta(apiRes.result);
    setCached(key, data);
    return data;
  }

  const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
  const fallbackUrl = `${base}books/${encodeURIComponent(key)}/meta.json`;
  try {
    const res = await fetch(fallbackUrl);
    if (!res.ok) return null;
    const raw = await res.json();
    const data = normalizeMeta(raw);
    setCached(key, data);
    return data;
  } catch (e) {
    errorUtils.logWarning('loadBookMeta', 'meta.json fallback 실패', { bookId, fallbackUrl });
    return null;
  }
}

function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const chapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  return {
    chapters: chapters.map((ch, i) => ({
      chapterIndex: ch.chapterIndex ?? ch.chapter_index ?? i,
      paragraphStarts: ch.paragraphStarts ?? ch.paragraph_starts ?? [],
      paragraphLengths: ch.paragraphLengths ?? ch.paragraph_lengths ?? [],
      totalCodePoints: ch.totalCodePoints ?? ch.total_code_points ?? 0
    }))
  };
}

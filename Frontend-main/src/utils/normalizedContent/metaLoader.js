/**
 * 정규화 메타 로더(v2 manifest 기반).
 * chapters[].chapterIndex, paragraphStarts, paragraphLengths, totalCodePoints
 */

import { getBookManifest } from '../api/api';

const metaCache = new Map();
const CACHE_TTL = 1000 * 60 * 15;

function isValidMetaShape(data) {
  const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
  if (!chapters.length) return false;
  return chapters.some((ch) => Number(ch?.chapterIndex) > 0);
}

function getCached(bookId) {
  const entry = metaCache.get(String(bookId));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    metaCache.delete(String(bookId));
    return null;
  }
  if (!isValidMetaShape(entry.data)) {
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

  const manifestRes = await getBookManifest(bookId);
  if (manifestRes?.isSuccess && manifestRes?.result) {
    const data = normalizeMetaFromManifest(manifestRes.result);
    if (!isValidMetaShape(data)) {
      return null;
    }
    setCached(key, data);
    return data;
  }
  return null;
}

function toArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function normalizeMetaFromManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const chapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  return {
    chapters: chapters.map((ch) => ({
      chapterIndex:
        ch.chapterIdx ??
        ch.chapterIndex ??
        ch.idx ??
        ch.chapter ??
        ch.number ??
        0,
      paragraphStarts: toArrayValue(ch.paragraphStartsJson),
      paragraphLengths: toArrayValue(ch.paragraphLengthsJson),
      totalCodePoints:
        ch.totalCodePoints ??
        ch.chapterLength ??
        ch.length ??
        0,
    }))
  };
}

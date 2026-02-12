/**
 * public/books/ 목록 로드
 * books.json에서 정규화된 책 목록 조회
 */

const PUBLIC_BOOKS_CACHE_KEY = 'readwith_public_books';
const CACHE_TTL_MS = 60 * 1000;

let cached = null;
let cacheTime = 0;

export async function loadPublicBooks() {
  if (cached && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cached;
  }
  try {
    const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
    const res = await fetch(`${base}books/books.json`);
    if (!res.ok) return [];
    const list = await res.json();
    cached = Array.isArray(list) ? list : [];
    cacheTime = Date.now();
    return cached;
  } catch {
    return [];
  }
}

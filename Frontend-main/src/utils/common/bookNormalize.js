/** 도서 응답 정규화·서버 bookId 해석 — API·캐시 계층 공용 (순환 import 방지용 순수 모듈) */

import { sanitizeAssetUrl } from './urlUtils';
import { stringOrEmpty, toPositiveNumberOrNull } from './valueUtils';

const normalizeBookCore = (book) => {
  const coverImgUrl =
    typeof book.coverImgUrl === 'string' ? sanitizeAssetUrl(book.coverImgUrl) : '';
  return {
    id: book.id,
    title: stringOrEmpty(book.title),
    author: stringOrEmpty(book.author),
    language: book.language != null ? String(book.language) : undefined,
    coverImgUrl,
    epubPath: book.epubPath != null ? String(book.epubPath) : undefined,
    normalizationStatus: book.normalizationStatus ?? null,
    analysisStatus: book.analysisStatus ?? null,
    ruleVersion: book.ruleVersion ?? null,
    locatorVersion: book.locatorVersion ?? null,
    normalizationRunId: book.normalizationRunId ?? null,
    normalizationVersionStatus: book.normalizationVersionStatus ?? null,
    needsRenormalization: !!book.needsRenormalization,
    normalizedArtifactPath: book.normalizedArtifactPath ?? null,
    summary: book.summary === true,
    isDefault: !!book.isDefault,
  };
};

/** 원본 필드 유지 + 공통 코어 정규화 + 응답별 추가 필드. 객체가 아니면 그대로 반환 */
const normalizeBookWith = (book, extraFields) =>
  !book || typeof book !== 'object'
    ? book
    : { ...book, ...normalizeBookCore(book), ...extraFields(book) };

/** manifest result.book 정규화 */
export const normalizeManifestBook = (book) =>
  normalizeBookWith(book, (b) => ({
    summaryUrl: b.summaryUrl != null ? sanitizeAssetUrl(String(b.summaryUrl)) : undefined,
  }));

/** v2 books 응답 정규화 (목록·상세) */
export const normalizeV2Book = (book) =>
  normalizeBookWith(book, (b) => ({
    updatedAt: b.updatedAt ?? null,
    isFavorite: !!b.isFavorite,
  }));

/** 책 제목 비교용 정규화 (대소문자·공백·특수문자 제거) */
export const normalizeTitle = (title) => {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s/g, '');
};

/** 저자 비교용 정규화 */
export const normalizeAuthor = (author) =>
  (author || '').toLowerCase().trim().replace(/\s+/g, ' ');

/** book의 서버 bookId, 없으면 fallback(라우트 id 등)을 양의 정수로 */
export function resolveServerBookId(book, fallback = null) {
  return (
    toPositiveNumberOrNull(book?._bookId) ??
    toPositiveNumberOrNull(book?.id) ??
    toPositiveNumberOrNull(fallback)
  );
}

/** 서버 bookId 우선, 없으면 route·book 필드로 캐시/로더 키 문자열 */
export function resolveViewerBookKey(book, routeBookId = null, { trimRoute = true } = {}) {
  const serverId = resolveServerBookId(book);
  if (serverId) return String(serverId);
  const raw = routeBookId ?? book?.id ?? book?.filename ?? '';
  const str = String(raw);
  return trimRoute ? str.trim() : str;
}

/** 뷰어로 넘길 route state의 book: 원래 book에 서버 id를 덮어씀. 둘 다 없으면 null */
export function withServerBookId(book, serverBookId) {
  if (serverBookId == null) return book ?? null;
  return { ...(book || {}), id: serverBookId, _bookId: serverBookId };
}

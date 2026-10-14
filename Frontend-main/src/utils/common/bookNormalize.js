/** 도서 응답 정규화 — API·캐시 계층 공용 (순환 import 방지용 순수 모듈) */

import { sanitizeAssetUrl } from './urlUtils';
import { stringOrEmpty } from './valueUtils';

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

/** 도서 응답 정규화 — API·캐시 계층 공용 (순환 import 방지용 순수 모듈) */

import { sanitizeAssetUrl } from './urlUtils';

export const normalizeBookCore = (book) => {
  const coverImgUrl =
    typeof book.coverImgUrl === 'string' ? sanitizeAssetUrl(book.coverImgUrl) : '';
  return {
    id: book.id,
    title: typeof book.title === 'string' ? book.title : '',
    author: typeof book.author === 'string' ? book.author : '',
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

/** manifest result.book 정규화 */
export const normalizeManifestBook = (book) => {
  if (!book || typeof book !== 'object') return book;
  return {
    ...book,
    ...normalizeBookCore(book),
    summaryUrl:
      book.summaryUrl != null ? sanitizeAssetUrl(String(book.summaryUrl)) : undefined,
  };
};

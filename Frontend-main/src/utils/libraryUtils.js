/** 라이브러리: 진행률·날짜 표시, EPUB 업로드 검증·메타 추출 */

import { getProgressFromCache } from './common/cache/progressCache';
import { clampPercent, compareKo } from './common/valueUtils';

/** 서재 숨기기 — 카드 메뉴(BookLibrary)와 상세 모달(BookDetailModal) 공용 문구 */
export const HIDE_BOOK_COPY = {
  title: '서재에서 숨기기',
  message: '이 기기의 서재 목록에서 숨깁니다. 같은 책을 다시 업로드하면 다시 표시됩니다.',
  confirmLabel: '숨기기',
  failed: '책을 숨기지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/** 마이페이지 BookCard·useBooks — locator 기반 캐시 진도만 사용 */
export function resolveLibraryReadingProgressPercent(book) {
  if (book == null) return 0;
  const rawId = book.id ?? book._bookId;
  if (rawId == null) return 0;
  const bookIdStr = String(rawId);
  const cached = getProgressFromCache(bookIdStr);
  return clampPercent(cached?.readingProgressPercent, 0);
}

export function dedupeAndSortCharacters(raw) {
  if (!raw?.length) {
    return { unique: [], sortedMain: [], sortedOther: [] };
  }
  const seen = new Set();
  const unique = raw.filter((character) => {
    if (seen.has(character.id)) return false;
    seen.add(character.id);
    return true;
  });
  const main = unique.filter((c) => c.isMainCharacter);
  const other = unique.filter((c) => !c.isMainCharacter);
  const byName = (a, b) => compareKo(String(a.name ?? ''), String(b.name ?? ''));
  return {
    unique,
    sortedMain: main.sort(byName),
    sortedOther: other.sort(byName),
  };
}

export function toLibraryIsoDateOrNull(updatedAt) {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function libraryPanelBodyClass(isOpen) {
  return isOpen
    ? 'book-detail-panel-body book-detail-panel-body--open'
    : 'book-detail-panel-body book-detail-panel-body--closed';
}

const DC_NS = 'http://purl.org/dc/elements/1.1/';

export const EPUB_FILE_CONSTRAINTS = {
  MAX_SIZE: 50 * 1024 * 1024,
  ALLOWED_TYPES: ['application/epub+zip', 'application/epub'],
  ALLOWED_EXTENSIONS: ['.epub'],
  ACCEPT_ATTRIBUTE: '.epub,application/epub+zip,application/epub',
};

function isAllowedEpubFile(file) {
  const name = (file.name || '').toLowerCase();
  if (EPUB_FILE_CONSTRAINTS.ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (file.type && EPUB_FILE_CONSTRAINTS.ALLOWED_TYPES.includes(file.type)) return true;
  return false;
}

export function validateEpubFile(file) {
  if (!isAllowedEpubFile(file)) {
    return { valid: false, error: '.epub 파일만 업로드할 수 있습니다.' };
  }
  if (file.size > EPUB_FILE_CONSTRAINTS.MAX_SIZE) {
    return { valid: false, error: '파일 크기는 50MB를 초과할 수 없습니다.' };
  }
  return { valid: true, error: null };
}

export function epubUploadBasename(filename) {
  return String(filename || '').replace(/\.epub$/i, '').trim() || filename;
}

function findOpfPath(containerDoc) {
  const rootfiles = containerDoc.querySelectorAll('rootfile[full-path]');
  for (const rf of rootfiles) {
    const mt = (rf.getAttribute('media-type') || '').toLowerCase();
    if (mt === 'application/oebps-package+xml' || mt === 'application/xml') {
      return rf.getAttribute('full-path');
    }
  }
  const first = containerDoc.querySelector('rootfile[full-path]');
  return first?.getAttribute('full-path') || null;
}

function getZipFile(zip, path) {
  if (!path) return null;
  const trimmed = path.replace(/^\//, '');
  return zip.file(trimmed) || zip.file(path);
}

export async function extractEpubFileMetadata(file) {
  const fallback = {
    title: epubUploadBasename(file.name),
    author: 'Unknown',
    language: 'ko',
  };
  try {
    const { default: JSZip } = await import('jszip');
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const containerEntry = zip.file('META-INF/container.xml');
    if (!containerEntry) return fallback;

    const containerXml = await containerEntry.async('string');
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    if (containerDoc.getElementsByTagName('parsererror').length) return fallback;

    const opfPath = findOpfPath(containerDoc);
    const opfEntry = getZipFile(zip, opfPath);
    if (!opfEntry) return fallback;

    const opfXml = await opfEntry.async('string');
    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    if (opfDoc.getElementsByTagName('parsererror').length) return fallback;

    const titleEl = opfDoc.getElementsByTagNameNS(DC_NS, 'title')[0];
    const title = (titleEl?.textContent || '').trim() || fallback.title;

    const creatorEl = opfDoc.getElementsByTagNameNS(DC_NS, 'creator')[0];
    const author = (creatorEl?.textContent || '').trim() || 'Unknown';

    const langEl = opfDoc.getElementsByTagNameNS(DC_NS, 'language')[0];
    const rawLang = (langEl?.textContent || '').trim() || 'ko';
    const language = rawLang.split(/[-_]/)[0] || 'ko';

    return { title, author, language };
  } catch {
    return fallback;
  }
}

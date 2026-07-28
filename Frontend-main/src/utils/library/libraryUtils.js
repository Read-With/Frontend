/** 라이브러리: 진행률·날짜 표시, EPUB 업로드 검증·메타 추출 */

import { getProgressFromCache } from '../common/cache/progressCache';
import { clampPercent } from '../common/valueUtils';

/** 마이페이지 BookCard·useBooks — locator 기반 캐시 진도만 사용 */
export function resolveLibraryReadingProgressPercent(book) {
  if (book == null) return 0;
  const rawId = book.id ?? book._bookId;
  if (rawId == null) return 0;
  const bookIdStr = String(rawId);
  const cached = getProgressFromCache(bookIdStr);
  const normalizedCachePct = clampPercent(cached?.readingProgressPercent);
  if (normalizedCachePct != null) return Math.round(normalizedCachePct);
  return 0;
}

export function formatLibraryRelativeDate(updatedAt) {
  if (updatedAt == null) return '';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffDays = Math.ceil(Math.abs(now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return '오늘';
  if (diffDays === 2) return '어제';
  if (diffDays <= 7) return `${diffDays - 1}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

/** Escape 리스너 + body scroll lock. cleanup 함수 반환. */
export function attachLibraryModalChrome({
  onClose,
  isBlocked = () => false,
  onEscape,
} = {}) {
  const handleEscape = (e) => {
    if (e.key !== 'Escape' || isBlocked()) return;
    if (onEscape) onEscape(e);
    else onClose?.();
  };
  document.addEventListener('keydown', handleEscape);
  document.body.style.overflow = 'hidden';
  return () => {
    document.removeEventListener('keydown', handleEscape);
    document.body.style.overflow = 'unset';
  };
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
  const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko');
  return {
    unique,
    sortedMain: [...main].sort(byName),
    sortedOther: [...other].sort(byName),
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

export function makeOpeningTargetKey(bookId, mode) {
  if (bookId == null || !mode) return null;
  return `${bookId}:${mode}`;
}

export function getOpeningMode(openingTarget, bookId) {
  if (!openingTarget || bookId == null) return null;
  const id = Number(bookId);
  if (openingTarget === makeOpeningTargetKey(id, 'viewer')) return 'viewer';
  if (openingTarget === makeOpeningTargetKey(id, 'graph')) return 'graph';
  return null;
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

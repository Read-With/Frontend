/** 챕터 제목 해석·표시 라벨 (서재·그래프·뷰어 공용) */

function collapseWhitespace(value) {
  return String(value ?? '')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toComparable(value) {
  return collapseWhitespace(value).normalize('NFC');
}

function normalizeLabel(value) {
  return toComparable(value).toLowerCase();
}

function firstNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const text = collapseWhitespace(candidate);
    if (text) return text;
  }
  return '';
}


function isFallbackChapterLabel(label) {
  return /^Chapter [\d?]+$/.test(toComparable(label));
}

/** spineHref → 사람이 읽을 수 있는 파일명 기반 제목 */
function titleFromSpineHref(href) {
  const raw = String(href ?? '').trim();
  if (!raw) return '';
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  path = path.split(/[?#]/)[0];
  const segment = path.split(/[/\\]/).filter(Boolean).pop() || '';
  const withoutExt = segment.replace(/\.(xhtml|html|htm|xml)$/i, '');
  const cleaned = collapseWhitespace(
    withoutExt
      .replace(/[_\-+]+/g, ' ')
      .replace(/\s+/g, ' ')
  );
  if (!cleaned) return '';
  // 순수 숫자·코드성 파일명은 제목으로 쓰지 않음
  if (/^(ch|chapter|chap|section|sec|part)?\d+$/i.test(cleaned.replace(/\s+/g, ''))) {
    return '';
  }
  if (/^[a-f0-9]{8,}$/i.test(cleaned.replace(/\s+/g, ''))) return '';
  return cleaned;
}

/**
 * 매니페스트 챕터에서 원제 후보를 고른다.
 * 우선순위: title → chapterTitle → nav/toc → label → spine 파일명
 */
function pickChapterRawTitle(chapter) {
  if (!chapter || typeof chapter !== 'object') {
    return { raw: '', source: null };
  }
  const fromTitle = firstNonEmptyString(chapter.title, chapter.chapterTitle);
  if (fromTitle) return { raw: fromTitle, source: 'title' };

  const fromNav = firstNonEmptyString(
    chapter.navTitle,
    chapter.navLabel,
    chapter.tocTitle,
    chapter.tocLabel
  );
  if (fromNav) return { raw: fromNav, source: 'nav' };

  const fromLabel = firstNonEmptyString(chapter.label, chapter.name);
  if (fromLabel) return { raw: fromLabel, source: 'label' };

  const fromSpine = titleFromSpineHref(chapter.spineHref ?? chapter.href);
  if (fromSpine) return { raw: fromSpine, source: 'spine' };

  return { raw: '', source: null };
}

function stripLeadingSep(text) {
  return collapseWhitespace(text.replace(/^[-–—:|/]+\s*/, ''));
}

/** 목록 라벨용: 책 제목을 전역 제거(prefix만이 아님) */
function stripBookTitleFromText(label, bookTitle) {
  let text = toComparable(label);
  const book = toComparable(bookTitle);
  if (!text) return '';
  if (!book) return text;

  text = collapseWhitespace(text.replace(new RegExp(escapeRegExp(book), 'gi'), ' '));
  text = stripLeadingSep(text.replace(/\s*[-–—:|/]+\s*$/g, ''));

  const textN = normalizeLabel(text);
  const bookN = normalizeLabel(book);
  if (!textN || textN === bookN) return '';
  if (textN.startsWith(bookN)) {
    text = stripLeadingSep(text.slice(book.length));
  }
  return text;
}

/**
 * 목록용 정리. 과도하게 비우지 않음.
 * - chapter 접두·책 제목 제거 후 남으면 사용
 * - 비면 책 제목만 제거한 중간값 → 그래도 비고 raw≠책제목이면 raw 유지
 * - raw가 책 제목과 동일하면 '' (collapsed)
 */
function cleanChapterListLabel(rawTitle, bookTitle) {
  const raw = toComparable(rawTitle);
  if (!raw) return '';

  const bookN = normalizeLabel(bookTitle);
  if (bookN && normalizeLabel(raw) === bookN) return '';

  const withoutChapterWord = collapseWhitespace(
    raw.replace(/(?:chapter|ch\.?|챕터)\s*\d*\s*[:.-]?\s*/gi, ' ')
  );
  const primary = stripBookTitleFromText(withoutChapterWord || raw, bookTitle);
  if (primary && !(bookN && normalizeLabel(primary) === bookN)) return primary;

  const soft = stripBookTitleFromText(raw, bookTitle);
  if (soft && !(bookN && normalizeLabel(soft) === bookN)) return soft;

  return raw;
}

export function stripSharedListPrefix(labels, bookTitle) {
  const usable = labels
    .map((label) => toComparable(label))
    .filter((label) => label && !isFallbackChapterLabel(label));
  if (usable.length < 2) return labels;

  // 대소문자 무시 공통 prefix: 글자 단위로 한 번씩만 비교 (prefix를 한 글자씩 줄이며 startsWith 반복 → O(n·L²) 방지)
  const lower = usable.map((label) => label.toLowerCase());
  let prefixLen = usable[0].length;
  for (let i = 1; i < usable.length && prefixLen > 0; i += 1) {
    let k = 0;
    while (k < prefixLen && k < lower[i].length && lower[i][k] === lower[0][k]) k += 1;
    prefixLen = k;
  }
  let prefix = usable[0].slice(0, prefixLen);
  if (!prefix) return labels;

  prefix = toComparable(prefix.replace(/[-–—:|/]+\s*$/, ''));
  if (prefix.length < 2) return labels;

  const bookN = normalizeLabel(bookTitle);
  const prefixN = normalizeLabel(prefix);
  const matchesBook =
    !!bookN && (prefixN === bookN || prefixN.startsWith(bookN) || bookN.startsWith(prefixN));
  const hasSepAfterPrefix = usable.every((label) => {
    if (normalizeLabel(label) === prefixN) return true;
    return /^[-–—:|/\s]/.test(label.slice(prefix.length));
  });
  if (!matchesBook && !(prefix.length >= 6 && hasSepAfterPrefix)) return labels;

  return labels.map((label) => {
    const text = toComparable(label);
    if (!text || isFallbackChapterLabel(text)) return text;
    if (normalizeLabel(text) === prefixN) return '';
    if (!text.toLowerCase().startsWith(prefix.toLowerCase())) return text;
    return stripLeadingSep(text.slice(prefix.length));
  });
}

export function stripChapterOrdinalPrefix(label, chapter) {
  const text = String(label || '').trim();
  if (!text || !Number.isFinite(chapter) || chapter < 1) return text;
  const n = String(chapter);
  const patterns = [
    new RegExp(`^제\\s*${n}\\s*장\\s*[:.\\-–—]?\\s*`, 'i'),
    new RegExp(`^챕터\\s*${n}\\s*[:.\\-–—]?\\s*`, 'i'),
    new RegExp(`^chapter\\s*${n}\\s*[:.\\-–—]?\\s*`, 'i'),
    new RegExp(`^${n}\\s*[.\\-–—:]\\s+`, 'i'),
  ];
  let out = text;
  for (const re of patterns) {
    const next = out.replace(re, '').trim();
    if (next) out = next;
  }
  return out || text;
}

/**
 * @returns {{
 *   chapter: number|null,
 *   raw: string,
 *   display: string,
 *   status: 'ok'|'collapsed'|'missing',
 *   source: string|null,
 *   tooltip: string,
 * }}
 */
export function resolveChapterTitleMeta(chapter, bookTitle = '', chapterIdx = null) {
  const idxFromChapter = Number(chapter?.idx ?? chapter?.chapterIdx ?? chapter?.chapterIndex);
  const fromArg = Number(chapterIdx);
  const chapterNum =
    chapterIdx != null && Number.isFinite(fromArg) && fromArg >= 1
      ? Math.trunc(fromArg)
      : Number.isFinite(idxFromChapter) && idxFromChapter >= 1
        ? Math.trunc(idxFromChapter)
        : null;
  const fallback = formatChapterOrdinalLabel(chapterNum);
  const idxStr = chapterNum != null ? String(chapterNum) : '—';

  const { raw, source } = pickChapterRawTitle(chapter);
  if (!raw) {
    return {
      chapter: chapterNum,
      raw: '',
      display: fallback,
      status: 'missing',
      source: null,
      tooltip: chapterNum != null ? fallback : idxStr,
    };
  }

  // cleaned가 비면 collapsed: 원문을 약하게만 다듬어 노출
  const cleaned = cleanChapterListLabel(raw, bookTitle);
  const conservative = cleaned ? '' : collapseWhitespace(raw);
  const display = cleaned
    || (conservative && normalizeLabel(conservative) !== normalizeLabel(bookTitle) ? conservative : fallback);
  return {
    chapter: chapterNum,
    raw,
    display,
    status: cleaned ? 'ok' : 'collapsed',
    source,
    tooltip: `${fallback} — ${raw}`,
  };
}

/** 단순 챕터 번호 라벨 (`Chapter 3` / `Chapter ?`) */
export function formatChapterOrdinalLabel(chapter, { unknown = '?' } = {}) {
  const n = Number(chapter);
  if (Number.isFinite(n) && n >= 1) return `Chapter ${Math.trunc(n)}`;
  return `Chapter ${unknown}`;
}

/** 책 제목 prefix만 제거 (뷰어 상단 등). 남는 글자 없으면 원문 유지 */
export function stripRedundantBookTitlePrefix(chapterTitle, bookTitle) {
  const ch = toComparable(chapterTitle);
  const book = toComparable(bookTitle);
  if (!ch || !book) return ch;

  const chL = ch.toLowerCase();
  const bookL = book.toLowerCase();

  if (chL === bookL) return ch;
  if (!chL.startsWith(bookL)) return ch;

  let rest = ch.slice(book.length).trim();
  rest = rest.replace(/^[-–—:|]+\s*/, '').trim();
  if (!rest) return ch;
  return rest;
}

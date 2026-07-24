/** 뷰어 도메인 primitive: eventUtils, book/cache 키, 챕터 제목·라벨 */

import { resolveChapterIndex, toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/valueUtils';

/** graphCore.isGraphEdgeElement와 동일 — graph ↔ viewer 순환 import 방지 */
const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

function nonEmptyId(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s !== '' ? value : null;
}

function normalizeEventIdx(event) {
  if (!event || typeof event !== 'object') return null;
  return (
    toPositiveNumberOrNull(event.eventNum) ??
    toPositiveNumberOrNull(event.eventIdx) ??
    toPositiveNumberOrNull(event.idx) ??
    toPositiveNumberFromId(event.eventId) ??
    toPositiveNumberOrNull(event.resolvedEventIdx) ??
    toPositiveNumberOrNull(event.originalEventIdx) ??
    toPositiveNumberOrNull(event.event?.eventNum) ??
    toPositiveNumberOrNull(event.event?.eventIdx) ??
    toPositiveNumberOrNull(event.event?.idx) ??
    toPositiveNumberFromId(event.event?.eventId)
  );
}

function chapterNumOf(event) {
  return Number(eventUtils.resolveChapterIdx(event));
}

function chapterNumOrZero(event) {
  return Number(eventUtils.resolveChapterIdx(event) ?? 0);
}

function compareByEventNum(a, b) {
  return eventUtils.resolveEventNum(a) - eventUtils.resolveEventNum(b);
}

function compareByChapterThenEvent(a, b) {
  const chapterA = chapterNumOrZero(a);
  const chapterB = chapterNumOrZero(b);
  if (chapterA !== chapterB) return chapterA - chapterB;
  return compareByEventNum(a, b);
}

export const eventUtils = {
  resolveRelationNodeIds: (relation) => {
    if (!relation || typeof relation !== 'object') return { id1: null, id2: null };
    const id1 = relation.id1 ?? relation.source ?? null;
    const id2 = relation.id2 ?? relation.target ?? null;
    return {
      id1: id1 != null ? String(id1) : null,
      id2: id2 != null ? String(id2) : null,
    };
  },

  resolveEventId: (event) => {
    if (!event || typeof event !== 'object') return null;
    const direct = nonEmptyId(event.eventId ?? event.id);
    if (direct != null) return direct;
    const nested = event.event;
    if (!nested || typeof nested !== 'object') return null;
    return nonEmptyId(nested.eventId ?? nested.id);
  },

  resolveChapterIdx: (event) => {
    if (!event || typeof event !== 'object') return null;
    const fromIndex = toPositiveNumberOrNull(resolveChapterIndex(event));
    if (fromIndex) return fromIndex;
    const fromChapter = toPositiveNumberOrNull(event.chapter);
    if (fromChapter) return fromChapter;
    const nested = event.event;
    if (!nested || typeof nested !== 'object') return null;
    return (
      toPositiveNumberOrNull(resolveChapterIndex(nested)) ??
      toPositiveNumberOrNull(nested.chapter)
    );
  },

  resolveEventOrdinal(event) {
    if (!event || typeof event !== 'object') return null;
    const direct = normalizeEventIdx(event);
    if (direct) return direct;

    const inner = event.event;
    if (inner && typeof inner === 'object') {
      const fromInner = normalizeEventIdx(inner) ?? toPositiveNumberFromId(eventUtils.resolveEventId(inner));
      if (fromInner) return fromInner;
    }
    return toPositiveNumberFromId(eventUtils.resolveEventId(event));
  },

  resolveEventNum(event, fallback = 0) {
    if (typeof event === 'number' && Number.isFinite(event) && event > 0) {
      return Math.trunc(event);
    }
    const idx = eventUtils.resolveEventOrdinal(event) ?? 0;
    return idx > 0 ? idx : fallback;
  },

  /** eventOrdinal 오름차순 정렬 (없는 값은 뒤로) */
  sortEventsByIdx(events) {
    if (!Array.isArray(events)) return [];
    return [...events].sort((a, b) => {
      const idxA = eventUtils.resolveEventOrdinal(a);
      const idxB = eventUtils.resolveEventOrdinal(b);
      if (idxA == null && idxB == null) return 0;
      if (idxA == null) return 1;
      if (idxB == null) return -1;
      return idxA - idxB;
    });
  },

  convertElementsToRelations: (elements, options = {}) => {
    if (!Array.isArray(elements) || elements.length === 0) return [];

    const { includeLabel = false, includeCount = true, positivityDefault = null } = options;

    return elements
      .filter(isGraphEdgeElement)
      .map((edge) => {
        const relation = {
          id1: edge.data.source,
          id2: edge.data.target,
          relation: Array.isArray(edge.data.relation) ? [...edge.data.relation] : [],
          positivity:
            typeof edge.data.positivity === 'number' ? edge.data.positivity : positivityDefault,
        };
        if (includeLabel) relation.label = edge.data.label || '';
        if (includeCount) relation.count = edge.data.count || 1;
        return relation;
      });
  },

  filterEdges: (elements) => {
    if (!Array.isArray(elements)) return [];
    return elements.filter(isGraphEdgeElement);
  },

  filterNodes: (elements) => {
    if (!Array.isArray(elements)) return [];
    return elements.filter((el) => el?.data && !isGraphEdgeElement(el));
  },

  findEventInCache: (events, eventIdx) => {
    if (!Array.isArray(events) || !Number.isFinite(eventIdx)) return null;
    return events.find((e) => eventUtils.resolveEventNum(e) === eventIdx) || null;
  },

  updateEventsInState: (prevEvents, newEvent, targetChapter) => {
    const previous = Array.isArray(prevEvents) ? prevEvents : [];
    const otherChapterEvents = previous.filter(
      (evt) => chapterNumOf(evt) !== targetChapter
    );
    const currentChapterEvents = previous.filter(
      (evt) => chapterNumOf(evt) === targetChapter
    );

    const targetIdx = eventUtils.resolveEventNum(newEvent);
    const existingIdx = currentChapterEvents.findIndex(
      (evt) => eventUtils.resolveEventNum(evt) === targetIdx
    );

    const updatedCurrent =
      existingIdx >= 0
        ? currentChapterEvents.map((evt, idx) =>
            idx === existingIdx ? { ...evt, ...newEvent } : evt
          )
        : [...currentChapterEvents, newEvent];

    updatedCurrent.sort(compareByEventNum);
    return [...otherChapterEvents, ...updatedCurrent].sort(compareByChapterThenEvent);
  },
};

export function resolveServerBookId(book) {
  if (!book) return null;
  return toPositiveNumberOrNull(book._bookId) ?? toPositiveNumberOrNull(book.id);
}

/** 서버 bookId 우선, 없으면 route·book 필드로 캐시/로더 키 문자열 */
export function resolveViewerBookKey(book, routeBookId = null, { trimRoute = true } = {}) {
  const serverId = resolveServerBookId(book);
  if (serverId) return String(serverId);
  const raw = routeBookId ?? book?.id ?? book?.filename ?? '';
  const str = String(raw);
  return trimRoute ? str.trim() : str;
}

export function deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }) {
  if (isReloading) return 'reloading';
  if (isEventGraphLoading) return 'event';
  if (isGraphLoading) return 'loading';
  return 'idle';
}

export const cacheKeyUtils = {
  createChapterKey: (bookId, chapter) => `${bookId}-${chapter}`,
  createEventKey: (bookId, chapter, eventIdx) => `${bookId}-${chapter}-${eventIdx}`,
  createCacheKey: (chapter, eventIdx) => `${chapter}-${eventIdx}`,
  macroGraphStorage: (bookId, chapter) => `graph_macro_${Number(bookId)}_upto_${Number(chapter)}`,
  macroSession: (bookId, chapter) => `${Number(bookId)}:${Number(chapter)}`,
};

export const MACRO_GRAPH_STORAGE_KEY_RE = /^graph_macro_(\d+)_upto_(\d+)$/;

const BOOK_PATH_KEYS = ['xhtmlPath', 'filePath', 's3Path', 'fileUrl'];

function bookWithoutStoredPaths(base, overrides = {}) {
  const next = { ...base, ...overrides };
  for (const key of BOOK_PATH_KEYS) next[key] = undefined;
  return next;
}

function makeLoadedBook(base, bookId, resolvedBookId) {
  return bookWithoutStoredPaths(base, {
    filename: String(resolvedBookId ?? bookId),
    _needsLoad: true,
    _bookId: resolvedBookId,
  });
}

export const bookUtils = {
  createBookObject: ({ stateBook, matchedServerBook, serverBook, bookId, loadingServerBook }) => {
    if (matchedServerBook && typeof matchedServerBook.id === 'number') {
      return makeLoadedBook(matchedServerBook, bookId, matchedServerBook.id);
    }

    if (stateBook) {
      if (serverBook && typeof serverBook.id === 'number') {
        return makeLoadedBook({ ...stateBook, ...serverBook }, bookId, serverBook.id);
      }

      const { xhtmlFile: _xf, xhtmlArrayBuffer: _xb, ...stateRest } = stateBook;
      return makeLoadedBook(stateRest, bookId, stateBook._bookId || stateBook.id || bookId);
    }

    if (serverBook) {
      return makeLoadedBook(serverBook, bookId, serverBook.id);
    }

    const numericBookId = toPositiveNumberOrNull(bookId);
    const resolvedId = loadingServerBook ? null : numericBookId;
    return {
      title: loadingServerBook ? '로딩 중...' : `Book ${bookId}`,
      filename: bookId,
      id: resolvedId,
      _needsLoad: true,
      _bookId: resolvedId ?? bookId,
      xhtmlPath: undefined,
    };
  },
};

/* ─── 챕터 제목 해석·표시 (from chapterTitle) ─── */

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

/** 통일 폴백: 제N장 */
export function formatFallbackChapterLabel(idx) {
  const n = Number(idx);
  return Number.isFinite(n) && n >= 1 ? `제${Math.trunc(n)}장` : '제—장';
}

export function isFallbackChapterLabel(label) {
  return /^제[\d—]+장$/.test(toComparable(label));
}

/** spineHref → 사람이 읽을 수 있는 파일명 기반 제목 */
export function titleFromSpineHref(href) {
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
export function pickChapterRawTitle(chapter) {
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
export function stripBookTitleFromText(label, bookTitle) {
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
export function cleanChapterListLabel(rawTitle, bookTitle) {
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

  let prefix = usable[0];
  for (let i = 1; i < usable.length; i += 1) {
    const next = usable[i];
    while (prefix && !next.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) return labels;
  }

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
 *   searchTexts: string[],
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
  const fallback = formatFallbackChapterLabel(chapterNum);
  const idxStr = chapterNum != null ? String(chapterNum) : '—';

  const { raw, source } = pickChapterRawTitle(chapter);
  if (!raw) {
    return {
      chapter: chapterNum,
      raw: '',
      display: fallback,
      status: 'missing',
      source: null,
      searchTexts: uniqueSearchTexts([fallback, `챕터 ${idxStr}`, `chapter ${idxStr}`, idxStr]),
      tooltip: chapterNum != null ? `챕터 ${idxStr}` : idxStr,
    };
  }

  const cleaned = cleanChapterListLabel(raw, bookTitle);
  if (cleaned) {
    return {
      chapter: chapterNum,
      raw,
      display: cleaned,
      status: 'ok',
      source,
      searchTexts: uniqueSearchTexts([
        cleaned,
        raw,
        fallback,
        `챕터 ${idxStr}`,
        `chapter ${idxStr}`,
        idxStr,
      ]),
      tooltip: `챕터 ${idxStr} — ${raw}`,
    };
  }

  // raw는 있으나 정리 후 의미 있는 표시명이 없음 → collapsed: 원문을 약하게만 다듬어 노출
  const conservative = collapseWhitespace(raw);
  const display = conservative && normalizeLabel(conservative) !== normalizeLabel(bookTitle)
    ? conservative
    : fallback;
  return {
    chapter: chapterNum,
    raw,
    display,
    status: 'collapsed',
    source,
    searchTexts: uniqueSearchTexts([
      display,
      raw,
      fallback,
      `챕터 ${idxStr}`,
      `chapter ${idxStr}`,
      idxStr,
    ]),
    tooltip: `챕터 ${idxStr} — ${raw}`,
  };
}

function uniqueSearchTexts(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = collapseWhitespace(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** 상단바: 제N장 · 이름 (이름 없으면 제N장) */
export function formatChapterOrderAndName(orderOneBased, chapterTitle) {
  const fallback = formatFallbackChapterLabel(orderOneBased);
  const name = collapseWhitespace(String(chapterTitle ?? ''));
  if (!name || isFallbackChapterLabel(name) || normalizeLabel(name) === normalizeLabel(fallback)) {
    return fallback;
  }
  return `${fallback} · ${name}`;
}

/** 책 제목 prefix만 제거 (뷰어 상단 등). 남는 글자 없으면 원문 유지 */
export function stripRedundantBookTitlePrefix(chapterTitle, bookTitle) {
  const ch = collapseWhitespace(String(chapterTitle ?? '')).normalize('NFC');
  const book = collapseWhitespace(String(bookTitle ?? '')).normalize('NFC');
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

/** 뷰어 도메인 primitive: eventUtils, book/cache 키, 챕터 라벨 */

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

function collapseWhitespace(s) {
  return String(s).trim().replace(/\s+/g, ' ');
}

/** 챕터 제목 앞이 책 제목과 같으면 나머지만 반환 (MS/한컴 NFC·NFD 정규화) */
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

/** 상단바: "chapter {순서} : {이름}" */
export function formatChapterOrderAndName(orderOneBased, chapterTitle) {
  const ord = Number(orderOneBased);
  const o = Number.isFinite(ord) && ord >= 1 ? String(Math.trunc(ord)) : '—';
  const name = collapseWhitespace(String(chapterTitle ?? ''));
  if (!name) return `chapter ${o}`;
  return `chapter ${o} : ${name}`;
}

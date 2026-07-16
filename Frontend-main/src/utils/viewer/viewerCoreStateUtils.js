/** 뷰어 코어 유틸 (book·mode·cache key·event 필드·전환·async) */

import {
  loadSettings,
} from '../common/settingsUtils';
import { resolveChapterIndex, toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/valueUtils';

/** graphUtils.isGraphEdgeElement와 동일 — graphUtils import 순환 방지용 로컬 판별 */
const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

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
    const direct = event.eventId ?? event.id;
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return direct;
    const nested = event.event;
    if (!nested || typeof nested !== 'object') return null;
    const nestedId = nested.eventId ?? nested.id;
    if (nestedId !== undefined && nestedId !== null && String(nestedId).trim() !== '') return nestedId;
    return null;
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
    return (
      events.find((e) => eventUtils.resolveEventNum(e) === eventIdx) || null
    );
  },

  updateEventsInState: (prevEvents, newEvent, targetChapter) => {
    const previous = Array.isArray(prevEvents) ? prevEvents : [];
    const otherChapterEvents = previous.filter(
      (evt) => Number(eventUtils.resolveChapterIdx(evt)) !== targetChapter
    );
    const currentChapterEvents = previous.filter(
      (evt) => Number(eventUtils.resolveChapterIdx(evt)) === targetChapter
    );

    const targetIdx = eventUtils.resolveEventNum(newEvent);
    const existingIdx = currentChapterEvents.findIndex(
      (evt) => eventUtils.resolveEventNum(evt) === targetIdx
    );

    let updatedCurrent = [];
    if (existingIdx >= 0) {
      updatedCurrent = currentChapterEvents.map((evt, idx) =>
        idx === existingIdx ? { ...evt, ...newEvent } : evt
      );
    } else {
      updatedCurrent = [...currentChapterEvents, newEvent];
    }

    updatedCurrent.sort((a, b) => eventUtils.resolveEventNum(a) - eventUtils.resolveEventNum(b));
    return [...otherChapterEvents, ...updatedCurrent].sort((a, b) => {
      const chapterA = Number(eventUtils.resolveChapterIdx(a) ?? 0);
      const chapterB = Number(eventUtils.resolveChapterIdx(b) ?? 0);
      if (chapterA !== chapterB) return chapterA - chapterB;
      return eventUtils.resolveEventNum(a) - eventUtils.resolveEventNum(b);
    });
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

export function saveViewerMode(mode) {
  try {
    if (!mode || typeof mode !== 'string') return;
    localStorage.setItem('viewer_mode', mode);
  } catch {
    return;
  }
}

function loadViewerMode() {
  try {
    return localStorage.getItem('viewer_mode');
  } catch {
    return null;
  }
}

/** showGraph는 settings SSOT. viewer_mode는 전체화면(graph) 여부만 복원. */
export function resolveInitialGraphFullScreen(showGraph = loadSettings().showGraph) {
  return Boolean(showGraph) && loadViewerMode() === 'graph';
}

export function buildViewerActionError(message, details, retry) {
  return { message, details, retry };
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

export function waitForViewerMethod(viewerRef, methodName, timeoutMs = 3000) {
  if (viewerRef.current?.[methodName]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      if (viewerRef.current?.[methodName]) {
        clearInterval(id);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(id);
        resolve(false);
      }
    }, 100);
  });
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

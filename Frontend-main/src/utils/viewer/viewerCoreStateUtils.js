/** 뷰어 코어 유틸 (book·mode·cache key·event 필드·전환·async) */

import { errorUtils } from '../common/errorUtils';
import {
  loadSettings,
} from '../common/settingsUtils';
import { isGraphEdgeElement } from '../graph/graphUtils';
import { toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/numberUtils';

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
    return (
      toPositiveNumberOrNull(event.chapterIdx) ??
      toPositiveNumberOrNull(event.chapter) ??
      toPositiveNumberOrNull(event.event?.chapterIdx) ??
      toPositiveNumberOrNull(event.event?.chapter)
    );
  },

  normalizeEventIdx: (event) => {
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
  },

  resolveEventOrdinal(event) {
    if (!event || typeof event !== 'object') return null;
    const direct = this.normalizeEventIdx(event);
    if (direct) return direct;

    const inner = event.event;
    if (inner && typeof inner === 'object') {
      const fromInner = this.normalizeEventIdx(inner) ?? toPositiveNumberFromId(this.resolveEventId(inner));
      if (fromInner) return fromInner;
    }
    return toPositiveNumberFromId(this.resolveEventId(event));
  },

  extractRawEventIdx: (event) => eventUtils.resolveEventOrdinal(event) ?? 0,

  convertElementsToRelations: (elements, options = {}) => {
    if (!Array.isArray(elements) || elements.length === 0) return [];

    const { includeLabel = false, includeCount = true, positivityDefault = null } = options;

    return elements
      .filter((el) => el?.data?.source && el?.data?.target)
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
      events.find((e) => eventUtils.extractRawEventIdx(e) === eventIdx) || null
    );
  },

  updateEventsInState: (prevEvents, newEvent, targetChapter, shouldSkip = false) => {
    if (shouldSkip) {
      const previous = Array.isArray(prevEvents) ? prevEvents : [];
      return previous.filter((evt) => Number(eventUtils.resolveChapterIdx(evt)) !== targetChapter);
    }

    const previous = Array.isArray(prevEvents) ? prevEvents : [];
    const otherChapterEvents = previous.filter(
      (evt) => Number(eventUtils.resolveChapterIdx(evt)) !== targetChapter
    );
    const currentChapterEvents = previous.filter(
      (evt) => Number(eventUtils.resolveChapterIdx(evt)) === targetChapter
    );

    const targetIdx = eventUtils.extractRawEventIdx(newEvent);
    const existingIdx = currentChapterEvents.findIndex(
      (evt) => eventUtils.extractRawEventIdx(evt) === targetIdx
    );

    let updatedCurrent = [];
    if (existingIdx >= 0) {
      updatedCurrent = currentChapterEvents.map((evt, idx) =>
        idx === existingIdx ? { ...evt, ...newEvent } : evt
      );
    } else {
      updatedCurrent = [...currentChapterEvents, newEvent];
    }

    updatedCurrent.sort((a, b) => eventUtils.extractRawEventIdx(a) - eventUtils.extractRawEventIdx(b));
    return [...otherChapterEvents, ...updatedCurrent].sort((a, b) => {
      const chapterA = Number(eventUtils.resolveChapterIdx(a) ?? 0);
      const chapterB = Number(eventUtils.resolveChapterIdx(b) ?? 0);
      if (chapterA !== chapterB) return chapterA - chapterB;
      return eventUtils.extractRawEventIdx(a) - eventUtils.extractRawEventIdx(b);
    });
  },
};

export const INITIAL_TRANSITION_STATE = {
  type: null,
  inProgress: false,
  error: false,
  direction: null,
};

export const transitionUtils = {
  getInitialState: () => ({ ...INITIAL_TRANSITION_STATE }),
  reset: (setTransitionState) => {
    setTransitionState((prev) => (
      prev.type == null && !prev.inProgress && !prev.error && prev.direction == null
        ? prev
        : { ...INITIAL_TRANSITION_STATE }
    ));
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

/** 이벤트 객체·숫자에서 eventIdx 추출, 없으면 fallback */
export function resolveEventIdxOrFallback(currentEvent, fallback = null) {
  if (typeof currentEvent === 'number' && Number.isFinite(currentEvent) && currentEvent > 0) {
    return currentEvent;
  }
  const idx = eventUtils.extractRawEventIdx(currentEvent);
  if (idx > 0) return idx;
  return fallback;
}

export function extractEventNodesAndEdges(event) {
  if (!event || typeof event !== 'object') {
    errorUtils.logWarning('extractEventNodesAndEdges', '유효하지 않은 이벤트 객체입니다', {
      event,
      type: typeof event,
    });
    return { nodes: new Set(), edges: new Set() };
  }

  try {
    const nodes = new Set();
    const edges = new Set();

    if (Array.isArray(event.relations)) {
      for (const rel of event.relations) {
        if (!rel || typeof rel !== 'object') {
          errorUtils.logWarning('extractEventNodesAndEdges', '유효하지 않은 관계 객체입니다', { rel });
          continue;
        }

        const { id1, id2 } = eventUtils.resolveRelationNodeIds(rel);

        if (id1) nodes.add(String(id1));
        if (id2) nodes.add(String(id2));
        if (id1 && id2) edges.add(`${id1}-${id2}`);
      }
    }

    if (event.importance && typeof event.importance === 'object') {
      for (const id of Object.keys(event.importance)) {
        if (id) nodes.add(String(id));
      }
    }

    if (Array.isArray(event.new_appearances)) {
      for (const id of event.new_appearances) {
        if (id) nodes.add(String(id));
      }
    }

    return { nodes, edges };
  } catch (error) {
    return errorUtils.handleError(
      'extractEventNodesAndEdges',
      error,
      { nodes: new Set(), edges: new Set() },
      { event }
    );
  }
}

export function saveViewerMode(mode) {
  try {
    if (!mode || typeof mode !== 'string') return;
    localStorage.setItem('viewer_mode', mode);
  } catch (_error) {
    return;
  }
}

export function loadViewerMode() {
  try {
    return localStorage.getItem('viewer_mode');
  } catch (_error) {
    return null;
  }
}

function flagsFromGraphMode(mode) {
  if (mode === 'graph') return { fullScreen: true, show: true };
  if (mode === 'split') return { fullScreen: false, show: true };
  if (mode === 'viewer') return { fullScreen: false, show: false };
  return null;
}

export function resolveInitialGraphMode() {
  return (
    flagsFromGraphMode(loadViewerMode()) ?? {
      fullScreen: false,
      show: loadSettings().showGraph,
    }
  );
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
  fineGraphStorage: (bookId, chapter, eventIdx) =>
    `graph_fine_${Number(bookId)}_${Number(chapter)}_${Number(eventIdx)}`,
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

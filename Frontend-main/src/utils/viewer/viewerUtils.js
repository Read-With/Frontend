
import { errorUtils as commonErrorUtils } from '../common/errorUtils';
import { storageUtils as commonStorageUtils } from '../common/cache/storageUtils';
import { settingsUtils as commonSettingsUtils, defaultSettings as commonDefaultSettings, loadSettings as commonLoadSettings } from '../common/settingsUtils';
export const errorUtils = commonErrorUtils;
export const storageUtils = commonStorageUtils;
export const defaultSettings = commonDefaultSettings;
export const loadSettings = commonLoadSettings;

/**
 * 서버 bookId를 가져옵니다.
 * book.id 또는 book._bookId 중 숫자인 값을 우선 사용합니다.
 * @param {Object} book - 책 객체
 * @returns {number|null} 서버 bookId (없으면 null)
 */
export function getServerBookId(book) {
  if (!book) return null;
  const numId = (v) => (v !== undefined && v !== null && Number.isFinite(Number(v))) ? Number(v) : null;
  if (book.id !== undefined && book.id !== null) {
    const n = typeof book.id === 'number' ? book.id : numId(book.id);
    if (n != null && n > 0) return n;
  }
  if (book._bookId !== undefined && book._bookId !== null) {
    const n = typeof book._bookId === 'number' ? book._bookId : numId(book._bookId);
    if (n != null && n > 0) return n;
  }
  return null;
}

export function extractEventNodesAndEdges(event) {
  if (!event || typeof event !== 'object') {
    errorUtils.logWarning('extractEventNodesAndEdges', '유효하지 않은 이벤트 객체입니다', { event, type: typeof event });
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
        
        const id1 = rel.id1 || rel.source;
        const id2 = rel.id2 || rel.target;
        
        if (id1) nodes.add(String(id1));
        if (id2) nodes.add(String(id2));
        if (id1 && id2) {
          edges.add(`${id1}-${id2}`);
        }
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
    return errorUtils.handleError('extractEventNodesAndEdges', error, { nodes: new Set(), edges: new Set() }, { event });
  }
}

export function saveViewerMode(mode) {
  try {
    if (!mode || typeof mode !== 'string') {
      return;
    }
    localStorage.setItem("viewer_mode", mode);
  } catch (_error) {
    return;
  }
}

export function loadViewerMode() {
  try {
    return localStorage.getItem("viewer_mode");
  } catch (_error) {
    return null;
  }
}

function approxCharsFromLocator(startLocator, totalChars) {
  if (!startLocator || !Number.isFinite(startLocator.chapterIndex)) return 0;
  const b = Number(startLocator.blockIndex) || 0;
  const o = Number(startLocator.offset) || 0;
  const est = b * 3000 + o;
  return totalChars > 0 ? Math.min(est, totalChars) : est;
}

export function calculateChapterProgressFromLocator(startLocator, chapterNum, events) {
  if (!chapterNum || chapterNum < 1 || !events?.length) {
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
  if (!startLocator || Number(startLocator.chapterIndex) !== Number(chapterNum)) {
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
  const totalChars = events[events.length - 1]?.endTxtOffset || 0;
  const currentChars = approxCharsFromLocator(startLocator, totalChars);
  const progress = totalChars > 0 ? (currentChars / totalChars) * 100 : 0;
  let eventIndex = -1;
  for (let i = 0; i < events.length; i++) {
    if (currentChars >= events[i].startTxtOffset && currentChars < events[i].endTxtOffset) {
      eventIndex = i;
      break;
    }
  }
  if (eventIndex < 0 && currentChars >= totalChars) eventIndex = events.length - 1;
  return {
    currentChars: Math.round(currentChars),
    totalChars,
    progress: Math.round(progress * 100) / 100,
    eventIndex,
  };
}

export function findClosestEventFromLocator(startLocator, chapterNum, events) {
  if (!events?.length || !chapterNum) return null;
  const { currentChars } = calculateChapterProgressFromLocator(startLocator, chapterNum, events);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const start = Number(event.startTxtOffset);
    const end = Number(event.endTxtOffset);
    if (currentChars >= start && currentChars < end) {
      return {
        ...event,
        eventNum: event.eventId ?? 0,
        chapter: chapterNum,
        progress: ((currentChars - start) / (end - start)) * 100,
      };
    }
  }
  if (currentChars < Number(events[0].startTxtOffset)) {
    return { ...events[0], eventNum: events[0].eventId ?? 0, chapter: chapterNum, progress: 0 };
  }
  const last = events[events.length - 1];
  return { ...last, eventNum: last.eventId ?? 0, chapter: chapterNum, progress: 100 };
}

export function getRefs(xhtmlBookRef, xhtmlViewerRef) {
  return {
    xhtmlBook: xhtmlBookRef?.current,
    xhtmlViewer: xhtmlViewerRef?.current,
  };
}

export function withRefs(xhtmlBookRef, xhtmlViewerRef, callback) {
  const { xhtmlBook, xhtmlViewer } = getRefs(xhtmlBookRef, xhtmlViewerRef);
  if (!xhtmlBook || !xhtmlViewer) return null;
  return callback(xhtmlBook, xhtmlViewer);
}

export function cleanupNavigation(setIsNavigating, xhtmlViewer, handler) {
  setIsNavigating(false);
  if (xhtmlViewer && handler && typeof xhtmlViewer.off === 'function') {
    xhtmlViewer.off('relocated', handler);
  }
}

export const navigationUtils = {
  async safeNavigate(xhtmlBook, xhtmlViewer, action, _direction = 'next', setIsNavigating, setNavigationError, _storageKeys) {
    if (!xhtmlBook || !xhtmlViewer) {
      errorUtils.logWarning('safeNavigate', '책 또는 XHTML 뷰어가 없습니다', {
        hasXhtmlBook: !!xhtmlBook,
        hasXhtmlViewer: !!xhtmlViewer,
      });
      setNavigationError('뷰어가 준비되지 않았습니다.');
      return { success: false, error: '책 또는 XHTML 뷰어 없음' };
    }
    
    setIsNavigating(true);
    setNavigationError(null);

    try {
      const result = await action();
      
      if (!result || !result.success) {
        const errorMsg = result?.error || '페이지 이동에 실패했습니다.';
        setNavigationError(errorMsg);
        return result || { success: false, error: errorMsg };
      }
      
      return result;
      
    } catch (error) {
      errorUtils.logError('safeNavigate', error);
      const errorMsg = '페이지 이동 중 오류가 발생했습니다.';
      setNavigationError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsNavigating(false);
    }
  }
};

// settingsUtils는 commonSettingsUtils 사용 (이미 import됨)
export const settingsUtils = commonSettingsUtils;

export const textUtils = {
  countCharacters: (text, element) => {
    if (!text) return 0;
    
    if (element) {
      const excludedClasses = ['.pg-boilerplate', '.pgheader', '.toc', '.dedication', '.epigraph'];
      if (excludedClasses.some(cls => element.closest(cls))) {
        return 0;
      }
    }

    return text
      .replace(/[\s\n\r\t]/g, '')
      .replace(/[^a-zA-Z가-힣]/g, '')
      .length;
  },

  // 단락별 글자 수 계산
  calculateParagraphChars: (paragraph, element) => {
    return textUtils.countCharacters(paragraph.textContent, element);
  },

  // 이전 단락들의 누적 글자 수 계산
  calculatePreviousParagraphsChars: (paragraphs, currentParagraphNum) => {
    let charCount = 0;
    for (let i = 0; i < currentParagraphNum - 1; i++) {
      const paragraph = paragraphs[i];
      if (paragraph) {
        charCount += textUtils.calculateParagraphChars(paragraph, paragraph);
      }
    }
    return charCount;
  },

  // 현재 단락의 부분 글자 수 계산
  calculateCurrentParagraphChars: (paragraphs, currentParagraphNum, charOffset) => {
    if (currentParagraphNum > 0 && paragraphs[currentParagraphNum - 1]) {
      const currentParagraph = paragraphs[currentParagraphNum - 1];
      const currentParagraphChars = textUtils.calculateParagraphChars(currentParagraph, currentParagraph);
      return Math.min(charOffset, currentParagraphChars);
    }
    return 0;
  }
};

export const eventUtils = {
  normalizeEventIdx: (event) => {
    if (!event || typeof event !== 'object') {
      return null;
    }
    
    const candidates = [
      event.resolvedEventIdx,
      event.eventIdx,
      event.eventNum,
      event.event_id,
      event.eventId,
      event.idx,
      event.id
    ];
    
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
    
    if (event?.event?.eventIdx) {
      const nestedIdx = Number(event.event.eventIdx);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }
    
    if (event?.event?.idx) {
      const nestedIdx = Number(event.event.idx);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }

    if (event?.event?.event_id !== undefined && event?.event?.event_id !== null) {
      const nestedIdx = Number(event.event.event_id);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }
    
    if (event?.originalEventIdx) {
      const originalIdx = Number(event.originalEventIdx);
      if (Number.isFinite(originalIdx) && originalIdx > 0) {
        return originalIdx;
      }
    }
    
    return null;
  },

  extractRawEventIdx: (event) => {
    if (!event || typeof event !== 'object') {
      return 0;
    }
    
    const idx = eventUtils.normalizeEventIdx(event);
    return idx !== null ? idx : 0;
  },

  convertElementsToRelations: (elements, options = {}) => {
    if (!Array.isArray(elements) || elements.length === 0) {
      return [];
    }
    
    const {
      includeLabel = false,
      includeCount = true,
      positivityDefault = null
    } = options;
    
    return elements
      .filter((el) => el?.data?.source && el?.data?.target)
      .map((edge) => {
        const relation = {
          id1: edge.data.source,
          id2: edge.data.target,
          relation: Array.isArray(edge.data.relation) ? [...edge.data.relation] : [],
          positivity: typeof edge.data.positivity === 'number' 
            ? edge.data.positivity 
            : positivityDefault,
        };
        
        if (includeLabel) {
          relation.label = edge.data.label || '';
        }
        
        if (includeCount) {
          relation.count = edge.data.count || 1;
        }
        
        return relation;
      });
  },

  filterEdges: (elements) => {
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements.filter(el => el?.data && el.data.source && el.data.target);
  },

  filterNodes: (elements) => {
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements.filter(el => el?.data && !el.data.source && !el.data.target);
  },

  findEventInCache: (events, eventIdx) => {
    if (!Array.isArray(events) || !Number.isFinite(eventIdx)) {
      return null;
    }
    return events.find(e => 
      Number(e.eventIdx) === eventIdx ||
      Number(e.idx) === eventIdx ||
      Number(e.event_id) === eventIdx
    ) || null;
  },

  getMaxEventIdx: (chapterCache) => {
    if (!chapterCache) {
      return 0;
    }
    
    const maxEventIdx = Number(chapterCache?.maxEventIdx);
    if (Number.isFinite(maxEventIdx) && maxEventIdx > 0) {
      return maxEventIdx;
    }
    
    if (Array.isArray(chapterCache?.events)) {
      return chapterCache.events.length;
    }
    
    return 0;
  },

  createEmptyEvent: (currentChapter, eventIdx, eventData = null) => {
    return {
      chapter: currentChapter,
      chapterIdx: currentChapter,
      eventNum: eventIdx,
      eventIdx: eventIdx,
      eventId: eventData?.eventId ?? eventIdx,
      relations: [],
      characters: [],
      startTxtOffset: eventData?.startTxtOffset ?? null,
      endTxtOffset: eventData?.endTxtOffset ?? null,
      ...(eventData || {})
    };
  },

  updateGraphDataRef: (ref, elements, eventIdx, chapterIdx) => {
    if (!ref || !ref.current) {
      return;
    }
    
    ref.current = {
      elements: Array.isArray(elements) ? elements : [],
      eventIdx: Number.isFinite(eventIdx) ? eventIdx : 0,
      chapterIdx: Number.isFinite(chapterIdx) ? chapterIdx : 0
    };
  },

  updateEventsInState: (prevEvents, newEvent, targetChapter, shouldSkip = false) => {
    if (shouldSkip) {
      const previous = Array.isArray(prevEvents) ? prevEvents : [];
      return previous.filter(evt => Number(evt?.chapter ?? evt?.chapterIdx) !== targetChapter);
    }

    const previous = Array.isArray(prevEvents) ? prevEvents : [];
    const otherChapterEvents = previous.filter(
      (evt) => Number(evt?.chapter ?? evt?.chapterIdx) !== targetChapter
    );
    const currentChapterEvents = previous.filter(
      (evt) => Number(evt?.chapter ?? evt?.chapterIdx) === targetChapter
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
    return [...otherChapterEvents, ...updatedCurrent];
  }
};

export const cacheKeyUtils = {
  createChapterKey: (bookId, chapter) => {
    return `${bookId}-${chapter}`;
  },

  createEventKey: (bookId, chapter, eventIdx) => {
    return `${bookId}-${chapter}-${eventIdx}`;
  },

  createCacheKey: (chapter, eventIdx) => {
    return `${chapter}-${eventIdx}`;
  }
};

export const transitionUtils = {
  getInitialState: () => ({
    type: null,
    inProgress: false,
    error: false,
    direction: null
  }),

  reset: (setTransitionState) => {
    setTransitionState(transitionUtils.getInitialState());
  }
};

export const bookUtils = {
  isApiBook: (book, bookId = null) => {
    if (book && (typeof book.id === 'number' || book.isFromAPI === true)) {
      return true;
    }
    if (bookId && (typeof bookId === 'number' || !isNaN(parseInt(bookId, 10)))) {
      return true;
    }
    return false;
  },

  /**
   * 뷰어 페이지에서 사용할 책 객체를 생성합니다.
   * @param {Object} params - 파라미터 객체
   * @param {Object|null} params.stateBook - location.state에서 전달된 책 객체
   * @param {Object|null} params.matchedServerBook - 서버에서 매칭된 책 객체
   * @param {Object|null} params.serverBook - 서버에서 직접 가져온 책 객체
   * @param {string} params.bookId - URL 파라미터의 bookId
   * @param {boolean} params.loadingServerBook - 서버 책 로딩 중 여부
   * @returns {Object} 생성된 책 객체
   */
  createBookObject: ({ stateBook, matchedServerBook, serverBook, bookId, loadingServerBook }) => {
    if (!stateBook && matchedServerBook && typeof matchedServerBook.id === 'number') {
      const indexedDbKey =
        bookId != null && String(bookId).trim() !== ''
          ? String(bookId)
          : String(matchedServerBook.id);

      return {
        ...matchedServerBook,
        filename: String(matchedServerBook.id ?? bookId),
        _indexedDbId: indexedDbKey,
        _needsLoad: true,
        _bookId: matchedServerBook.id,
        xhtmlPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }

    if (stateBook) {
      if (matchedServerBook && typeof matchedServerBook.id === 'number') {
        const indexedDbKey = String(
          stateBook._indexedDbId ?? stateBook.id ?? stateBook._bookId ?? matchedServerBook.id
        );

        return {
          ...matchedServerBook,
          filename: String(matchedServerBook.id ?? bookId),
          _indexedDbId: indexedDbKey,
          _needsLoad: true,
          _bookId: matchedServerBook.id,
          xhtmlPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined
        };
      }

      if (serverBook && typeof serverBook.id === 'number') {
        const indexedDbKey = String(
          stateBook._indexedDbId ?? stateBook.id ?? stateBook._bookId ?? serverBook.id
        );

        return {
          ...stateBook,
          ...serverBook,
          filename: String(serverBook.id ?? bookId),
          _indexedDbId: indexedDbKey,
          _needsLoad: true,
          _bookId: serverBook.id,
          xhtmlPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined
        };
      }

      const stateBookId = stateBook.id || stateBook._bookId || bookId;
      const indexedDbKey = stateBookId ? String(stateBookId) : null;
      const { xhtmlFile: _xf, xhtmlArrayBuffer: _xb, ...stateRest } = stateBook;

      return {
        ...stateRest,
        filename: bookId,
        _indexedDbId: indexedDbKey,
        _needsLoad: true,
        _bookId: stateBook.id || stateBook._bookId || bookId,
        xhtmlPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }
    
    if (serverBook) {
      const indexedDbKey = serverBook.id ? String(serverBook.id) : null;
      
      return {
        ...serverBook,
        filename: bookId,
        _needsLoad: true,
        _indexedDbId: indexedDbKey,
        _bookId: serverBook.id,
        xhtmlPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }
    
    const numericBookId = parseInt(bookId, 10);
    const indexedDbKey = !isNaN(numericBookId) ? String(numericBookId) : bookId;
    const resolvedId = loadingServerBook ? null : (!isNaN(numericBookId) ? numericBookId : null);
    
    return {
      title: loadingServerBook ? '로딩 중...' : `Book ${bookId}`,
      filename: bookId,
      id: resolvedId,
      _needsLoad: true,
      _indexedDbId: indexedDbKey,
      _bookId: resolvedId ?? bookId,
      xhtmlPath: undefined
    };
  }
};

export const eventIdxUtils = {
  calculateEventIdxForTransition: (currentEvent, isChapterTransition, forcedChapterEventIdxRef, chapterTransitionDirectionRef, bookId, currentChapter, getCachedChapterEvents, eventUtils) => {
    let eventIdx = currentEvent?.eventNum || currentEvent?.eventIdx || 1;
    
    if (!isChapterTransition) {
      return eventIdx;
    }
    
    let forced = forcedChapterEventIdxRef.current;
    
    if (forced === 'max') {
      const chapterCache = getCachedChapterEvents(bookId, currentChapter);
      const maxEventIdx = eventUtils.getMaxEventIdx(chapterCache);
      forced = maxEventIdx > 0 ? maxEventIdx : 1;
      forcedChapterEventIdxRef.current = forced;
    }
    
    if (forced && forced !== 'max' && Number.isFinite(Number(forced))) {
      eventIdx = Number(forced);
    } else if (!forced || forced === 'max') {
      const direction = chapterTransitionDirectionRef.current;
      if (direction === 'backward') {
        const chapterCache = getCachedChapterEvents(bookId, currentChapter);
        const maxEventIdx = eventUtils.getMaxEventIdx(chapterCache);
        eventIdx = maxEventIdx > 0 ? maxEventIdx : 1;
        forcedChapterEventIdxRef.current = eventIdx;
      } else if (direction === 'forward') {
        eventIdx = 1;
        forcedChapterEventIdxRef.current = 1;
      }
    }
    
    return eventIdx;
  },

  shouldBlockApiCall: (isChapterTransition, forcedChapterEventIdxRef, apiEventIdx) => {
    if (!isChapterTransition) {
      return false;
    }
    
    const forced = forcedChapterEventIdxRef.current;
    return forced && forced !== 'max' && Number.isFinite(Number(forced)) && apiEventIdx !== Number(forced);
  }
};

export const graphDataCacheUtils = {
  getGraphDataWithFallback: (bookId, chapter, eventIdx, getGraphEventState, eventUtils) => {
    if (!bookId || !chapter || eventIdx < 1) {
      return { resultData: null, usedCache: false };
    }

    const cached = getGraphEventState(bookId, chapter, eventIdx);
    if (cached) {
      const hasElements = Array.isArray(cached.elements) && cached.elements.length > 0;
      return {
        resultData: {
          characters: cached.characters || [],
          relations: hasElements ? [] : eventUtils.convertElementsToRelations(cached.elements || []),
          event: cached.eventMeta || null,
          elements: cached.elements || []
        },
        usedCache: true
      };
    }

    return { resultData: null, usedCache: false };
  },

  getGraphDataFromApiOrCache: async (
    bookId,
    chapter,
    eventIdx,
    getFineGraph,
    getGraphEventState,
    eventUtils,
    apiEventCacheRef,
    hasCalledApi,
    atLocator = null
  ) => {
    if (!bookId || !chapter || eventIdx < 1) {
      return { resultData: null, usedCache: false };
    }

    let resultData = null;
    let usedCache = true;

    if (!hasCalledApi) {
      const cachedBeforeApi = getGraphEventState(bookId, chapter, eventIdx);
      if (!cachedBeforeApi) {
        try {
          const apiResponse = await getFineGraph(bookId, chapter, eventIdx, atLocator);
          
          if (apiResponse && (apiResponse.isSuccess !== false)) {
            const apiResult = apiResponse?.result ?? apiResponse?.data ?? null;
            if (apiResult) {
              resultData = {
                characters: Array.isArray(apiResult.characters) ? apiResult.characters : [],
                relations: Array.isArray(apiResult.relations) ? apiResult.relations : [],
                event: apiResult.event ?? null,
                elements: null
              };
              usedCache = false;
              
              const cacheKey = `${chapter}-${eventIdx}`;
              if (apiEventCacheRef?.current) {
                apiEventCacheRef.current.set(cacheKey, resultData);
              }
            }
          }
        } catch (apiError) {
          const status = apiError?.status;
          if (status !== 404 && status !== 403) {
            errorUtils.logWarning('[graphDataCacheUtils] 그래프 데이터 API 호출 실패', apiError?.message || '알 수 없는 오류', {
              bookId,
              chapter,
              eventIdx
            });
          }
        }
      }
    }

    if (!resultData) {
      const cached = getGraphEventState(bookId, chapter, eventIdx);
      if (cached) {
        const hasElements = Array.isArray(cached.elements) && cached.elements.length > 0;
        resultData = {
          characters: cached.characters || [],
          relations: hasElements ? [] : eventUtils.convertElementsToRelations(cached.elements || []),
          event: cached.eventMeta || null,
          elements: cached.elements || []
        };
        usedCache = true;
      }
    }

    if (resultData && !usedCache) {
      const hasValidData = 
        (Array.isArray(resultData.characters) && resultData.characters.length > 0) ||
        (Array.isArray(resultData.relations) && resultData.relations.length > 0) ||
        (Array.isArray(resultData.elements) && resultData.elements.length > 0);
        
      if (!hasValidData) {
        const cached = getGraphEventState(bookId, chapter, eventIdx);
        if (cached) {
          const hasElements = Array.isArray(cached.elements) && cached.elements.length > 0;
          resultData = {
            characters: cached.characters || [],
            relations: hasElements ? [] : eventUtils.convertElementsToRelations(cached.elements || []),
            event: cached.eventMeta || null,
            elements: cached.elements || []
          };
          usedCache = true;
        }
      }
    }

    return { resultData, usedCache };
  }
};

export const graphDataTransformUtils = {
  /** GET /api/v2/graph/fine 의 result.event — chapterIdx, event_id, eventId, startTxtOffset, endTxtOffset */
  normalizeApiEvent: (apiEvent) => {
    if (!apiEvent || typeof apiEvent !== 'object') return null;
    const eventIdx = Number(apiEvent.event_id);
    const chapterIdx = Number(apiEvent.chapterIdx);
    if (!Number.isFinite(eventIdx) || eventIdx < 1) return null;
    if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
    return {
      ...apiEvent,
      chapter: chapterIdx,
      chapterIdx,
      eventNum: eventIdx,
      eventIdx: eventIdx,
      eventId: apiEvent.eventId,
      startTxtOffset: apiEvent.startTxtOffset ?? null,
      endTxtOffset: apiEvent.endTxtOffset ?? null,
    };
  },

  convertToElements: (resultData, usedCache, normalizedEvent, createCharacterMaps, buildNodeWeights, convertRelationsToElements) => {
    if (usedCache && Array.isArray(resultData.elements) && resultData.elements.length > 0) {
      return resultData.elements;
    }
    
    if (!resultData.characters || !resultData.relations) {
      return [];
    }
    
    const hasCharacters = Array.isArray(resultData.characters) && resultData.characters.length > 0;
    const hasRelations = Array.isArray(resultData.relations) && resultData.relations.length > 0;
    
    if (!hasCharacters || !hasRelations) {
      return [];
    }
    
    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = createCharacterMaps(resultData.characters);
    const nodeWeights = buildNodeWeights(resultData.characters);
    
    return convertRelationsToElements(
      resultData.relations,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      'api',
      Object.keys(nodeWeights).length > 0 ? nodeWeights : null,
      null,
      normalizedEvent,
      idToProfileImage
    );
  },

  mergeElementsWithPrevious: (convertedElements, prevData, currentChapter, apiEventIdx) => {
    if (prevData.chapterIdx !== currentChapter) {
      return convertedElements;
    }
    
    if (apiEventIdx > prevData.eventIdx) {
      const existingNodeIds = new Set(
        prevData.elements
          .filter(e => e.data && !e.data.source)
          .map(e => e.data.id)
      );
      
      const newNodes = convertedElements.filter(e => 
        e.data && !e.data.source && !existingNodeIds.has(e.data.id)
      );
      
      const allEdges = convertedElements.filter(e => e.data && e.data.source);
      
      return [
        ...prevData.elements.filter(e => e.data && !e.data.source),
        ...newNodes,
        ...allEdges
      ];
    }
    
    return convertedElements;
  },

  createNextEventData: (normalizedEvent, currentChapter, apiEventIdx, resultData, eventUtils) => {
    const resolvedEventIdx = apiEventIdx;
    const originalEventIdx = normalizedEvent ? eventUtils.extractRawEventIdx(normalizedEvent) : resolvedEventIdx;
    
    if (normalizedEvent) {
      return {
        ...normalizedEvent,
        chapter: normalizedEvent.chapter ?? currentChapter,
        chapterIdx: normalizedEvent.chapterIdx ?? currentChapter,
        eventNum: resolvedEventIdx,
        eventIdx: resolvedEventIdx,
        eventId: resolvedEventIdx,
        resolvedEventIdx,
        originalEventIdx,
        relations: resultData.relations || [],
        characters: resultData.characters || []
      };
    }
    
    return {
      chapter: currentChapter,
      chapterIdx: currentChapter,
      eventNum: resolvedEventIdx,
      eventIdx: resolvedEventIdx,
      eventId: resolvedEventIdx,
      resolvedEventIdx,
      originalEventIdx: resolvedEventIdx,
      relations: resultData.relations || [],
      characters: resultData.characters || []
    };
  }
};
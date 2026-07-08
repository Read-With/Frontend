/** 뷰어: bookId·이벤트·그래프 캐시·설정 re-export */

import { processRelations, directedEdgeElementId } from '../graph/relationUtils';
import { isGraphEdgeElement, uniqueStrings } from '../graph/graphUtils';
import { errorUtils } from '../common/errorUtils';
import { settingsUtils as commonSettingsUtils, defaultSettings as commonDefaultSettings, loadSettings as commonLoadSettings } from '../common/settingsUtils';
import { toPositiveNumberFromId, toPositiveNumberOrNull } from '../common/numberUtils';
export const defaultSettings = commonDefaultSettings;
export const loadSettings = commonLoadSettings;

/** 서버 bookId (_bookId 우선, 없으면 book.id) */
export function getServerBookId(book) {
  if (!book) return null;
  return toPositiveNumberOrNull(book._bookId) ?? toPositiveNumberOrNull(book.id);
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

function getRefs(xhtmlBookRef, xhtmlViewerRef) {
  return {
    xhtmlBook: xhtmlBookRef?.current,
    xhtmlViewer: xhtmlViewerRef?.current,
  };
}

function _withRefs(xhtmlBookRef, xhtmlViewerRef, callback) {
  const { xhtmlBook, xhtmlViewer } = getRefs(xhtmlBookRef, xhtmlViewerRef);
  if (!xhtmlBook || !xhtmlViewer) return null;
  return callback(xhtmlBook, xhtmlViewer);
}

export const settingsUtils = commonSettingsUtils;

export const eventUtils = {
  normalizeEventIdx: (event) => {
    if (!event || typeof event !== 'object') {
      return null;
    }
    return (
      toPositiveNumberOrNull(event.eventNum) ??
      toPositiveNumberOrNull(event.event_id) ??
      toPositiveNumberOrNull(event.eventIdx) ??
      toPositiveNumberOrNull(event.idx) ??
      toPositiveNumberOrNull(event.resolvedEventIdx) ??
      toPositiveNumberOrNull(event.originalEventIdx) ??
      toPositiveNumberOrNull(event.event?.eventNum) ??
      toPositiveNumberOrNull(event.event?.event_id) ??
      toPositiveNumberOrNull(event.event?.eventIdx) ??
      toPositiveNumberOrNull(event.event?.idx) ??
      toPositiveNumberOrNull(event.event?.event_idx)
    );
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
    return elements.filter(isGraphEdgeElement);
  },

  filterNodes: (elements) => {
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements.filter((el) => el?.data && !isGraphEdgeElement(el));
  },

  findEventInCache: (events, eventIdx) => {
    if (!Array.isArray(events) || !Number.isFinite(eventIdx)) {
      return null;
    }
    return (
      events.find((e) => {
        const eventNum = toPositiveNumberOrNull(e.eventNum);
        const cachedEventIdx = toPositiveNumberOrNull(e.eventIdx);
        return (
          eventNum === eventIdx ||
          cachedEventIdx === eventIdx
        );
      }) || null
    );
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
    return [...otherChapterEvents, ...updatedCurrent].sort((a, b) => {
      const chapterA = Number(a?.chapter ?? a?.chapterIdx ?? 0);
      const chapterB = Number(b?.chapter ?? b?.chapterIdx ?? 0);
      if (chapterA !== chapterB) return chapterA - chapterB;
      return eventUtils.extractRawEventIdx(a) - eventUtils.extractRawEventIdx(b);
    });
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
  /** 뷰어용 책 객체 생성 (state·서버 매칭·URL bookId 우선순위) */
  createBookObject: ({ stateBook, matchedServerBook, serverBook, bookId, loadingServerBook }) => {
    if (matchedServerBook && typeof matchedServerBook.id === 'number') {
      return {
        ...matchedServerBook,
        filename: String(matchedServerBook.id ?? bookId),
        _needsLoad: true,
        _bookId: matchedServerBook.id,
        xhtmlPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }

    if (stateBook) {
      if (serverBook && typeof serverBook.id === 'number') {
        return {
          ...stateBook,
          ...serverBook,
          filename: String(serverBook.id ?? bookId),
          _needsLoad: true,
          _bookId: serverBook.id,
          xhtmlPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined
        };
      }

      const { xhtmlFile: _xf, xhtmlArrayBuffer: _xb, ...stateRest } = stateBook;

      return {
        ...stateRest,
        filename: bookId,
        _needsLoad: true,
        _bookId: stateBook._bookId || stateBook.id || bookId,
        xhtmlPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }
    
    if (serverBook) {
      return {
        ...serverBook,
        filename: bookId,
        _needsLoad: true,
        _bookId: serverBook.id,
        xhtmlPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }
    
    const numericBookId = parseInt(bookId, 10);
    const resolvedId = loadingServerBook ? null : (!isNaN(numericBookId) ? numericBookId : null);
    
    return {
      title: loadingServerBook ? '로딩 중...' : `Book ${bookId}`,
      filename: bookId,
      id: resolvedId,
      _needsLoad: true,
      _bookId: resolvedId ?? bookId,
      xhtmlPath: undefined
    };
  }
};

/** 캐시 행 → fine API result 형태 변환 */
function buildFromCache(cached, convertFn) {
  const hasElements = Array.isArray(cached.elements) && cached.elements.length > 0;
  return {
    characters: cached.characters || [],
    relations: hasElements ? [] : convertFn(cached.elements || []),
    event: cached.eventMeta || null,
    elements: cached.elements || []
  };
}

/** fine graph API 또는 챕터 캐시에서 그래프 데이터 조회 */
export const graphDataCacheUtils = {
  getGraphDataFromApiOrCache: async (
    bookId,
    chapter,
    eventIdx,
    getFineGraph,
    getGraphEventState,
    eventUtils,
    apiEventCacheRef,
    hasCalledApi,
    atLocator = null,
    fineOpts = undefined
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
          const apiResponse = await getFineGraph(bookId, chapter, eventIdx, atLocator, fineOpts);

          if (apiResponse && (apiResponse.isSuccess !== false)) {
            const apiResult = apiResponse?.result ?? apiResponse?.data ?? null;
            if (!apiResult) {
              console.warn('[FineGraph API] 서버 응답 성공이나 result/data 본문 없음 — 해당 이벤트 페이로드 없을 수 있음', {
                bookId,
                chapter,
                eventIdx,
                code: apiResponse?.code,
              });
            } else {
              resultData = {
                characters: Array.isArray(apiResult.characters) ? apiResult.characters : [],
                relations: Array.isArray(apiResult.relations) ? apiResult.relations : [],
                event: apiResult.event ?? null,
                elements: null
              };
              usedCache = false;

              const relN = resultData.relations.length;
              const charN = resultData.characters.length;
              const hasEventMeta = resultData.event != null && typeof resultData.event === 'object';
              if (relN === 0 && charN === 0 && !hasEventMeta) {
                console.warn('[FineGraph API] 서버가 빈 그래프 반환(관계·인물·event 메타 없음) — 이벤트 데이터 미비 가능', {
                  bookId,
                  chapter,
                  eventIdx,
                });
              }

              const cacheKey = `${chapter}-${eventIdx}`;
              if (apiEventCacheRef?.current) {
                apiEventCacheRef.current.set(cacheKey, resultData);
              }
            }
          } else if (apiResponse) {
            console.warn('[FineGraph API] 서버가 실패 응답', {
              bookId,
              chapter,
              eventIdx,
              isSuccess: apiResponse?.isSuccess,
              code: apiResponse?.code,
              message: apiResponse?.message,
            });
          }
        } catch (apiError) {
          const status = apiError?.status;
          if (status === 404) {
            console.warn('[FineGraph API] 서버에 해당 이벤트 Fine 그래프 리소스 없음(404)', {
              bookId,
              chapter,
              eventIdx,
            });
          } else if (status === 403) {
            console.warn('[FineGraph API] Fine 그래프 접근 거부(403)', { bookId, chapter, eventIdx });
          } else {
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
        resultData = buildFromCache(cached, eventUtils.convertElementsToRelations);
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
          resultData = buildFromCache(cached, eventUtils.convertElementsToRelations);
          usedCache = true;
        }
      }
    }

    return { resultData, usedCache };
  }
};

/** fine graph result.event에서 이벤트 순번 추출 (eventNum·event_id·eventId 등) */
export function resolveFineGraphEventOrdinal(apiEvent) {
  if (!apiEvent || typeof apiEvent !== 'object') return null;
  return (
    toPositiveNumberOrNull(apiEvent.eventNum) ??
    toPositiveNumberOrNull(apiEvent.event_id) ??
    toPositiveNumberOrNull(apiEvent.eventIdx ?? apiEvent.idx ?? apiEvent.event_idx) ??
    toPositiveNumberFromId(apiEvent.eventId ?? apiEvent.id)
  );
}

export const graphDataTransformUtils = {
  /** fine graph result.event 정규화 */
  normalizeApiEvent: (apiEvent) => {
    if (!apiEvent || typeof apiEvent !== 'object') return null;
    const chapterIdx = Number(apiEvent.chapterIdx);
    if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
    const eventNum = resolveFineGraphEventOrdinal(apiEvent);
    if (!eventNum) return null;
    return {
      ...apiEvent,
      chapter: chapterIdx,
      chapterIdx,
      eventNum,
      eventIdx: eventNum,
      startTxtOffset: apiEvent.startTxtOffset ?? null,
      endTxtOffset: apiEvent.endTxtOffset ?? null,
    };
  },

  /** relations → Cytoscape elements (캐시에 elements 있으면 그대로 사용) */
  convertToElements: (resultData, usedCache, normalizedEvent, createCharacterMaps, buildNodeWeights, convertRelationsToElements) => {
    if (usedCache && Array.isArray(resultData.elements) && resultData.elements.length > 0) {
      return resultData.elements;
    }

    const chars = Array.isArray(resultData.characters) ? resultData.characters : [];
    const rawRels = Array.isArray(resultData.relations) ? resultData.relations : [];
    const rels = processRelations(rawRels);
    if (chars.length === 0 && rels.length === 0) {
      return [];
    }

    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = createCharacterMaps(chars);
    const nodeWeights = buildNodeWeights(chars);

    return convertRelationsToElements(
      rels,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      'api',
      Object.keys(nodeWeights).length > 0 ? nodeWeights : null,
      null,
      normalizedEvent,
      idToProfileImage,
      chars.length > 0 ? chars : null
    );
  },

  /** 읽기 진행에 따라 그래프 누적 병합 (뒤로 이동 시 이후 이벤트 제외) */
  mergeElementsWithPrevious: (convertedElements, prevData, currentChapter, apiEventIdx) => {
    const prevChapter = Number(prevData.chapterIdx);
    const curChapter = Number(currentChapter);

    const edgeDedupKey = (el) => {
      const d = el?.data;
      if (!d) return null;
      if (d.id != null && String(d.id).trim() !== '') {
        return String(d.id);
      }
      if (d.source != null && d.target != null) {
        return directedEdgeElementId(d.source, d.target);
      }
      return null;
    };

    const mergeRelationArrays = (a, b) => {
      const toArr = (v) => {
        if (Array.isArray(v)) return v;
        if (v === undefined || v === null || v === '') return [];
        return [v];
      };
      return uniqueStrings([...toArr(a), ...toArr(b)]);
    };

    const conv = Array.isArray(convertedElements) ? convertedElements : [];
    const prevEls = Array.isArray(prevData.elements) ? prevData.elements : [];
    const prevIdx = Number(prevData.eventIdx) || 0;
    const apiIdx = Number(apiEventIdx) || 0;
    const hasComparableChapter = Number.isFinite(prevChapter) && Number.isFinite(curChapter);
    const isEarlierThanPrevious =
      hasComparableChapter &&
      (curChapter < prevChapter || (curChapter === prevChapter && apiIdx > 0 && apiIdx < prevIdx));

    if (isEarlierThanPrevious) {
      return conv;
    }

    if (conv.length === 0 && prevEls.length > 0) {
      return prevEls;
    }

    if (prevEls.length === 0 || prevIdx === 0) {
      return conv;
    }

    const prevNodes = prevEls.filter((e) => e.data && !isGraphEdgeElement(e));
    const existingNodeIds = new Set(prevNodes.map((e) => e.data.id));

    const newNodes = conv.filter(
      (e) => e.data && !isGraphEdgeElement(e) && !existingNodeIds.has(e.data.id)
    );

    const prevEdges = prevEls.filter(isGraphEdgeElement);
    const newEdges = conv.filter(isGraphEdgeElement);

    const edgeByKey = new Map();
    for (const el of prevEdges) {
      const key = edgeDedupKey(el);
      if (key) {
        edgeByKey.set(key, el);
      }
    }
    for (const el of newEdges) {
      const key = edgeDedupKey(el);
      if (!key) {
        continue;
      }
      const prevEl = edgeByKey.get(key);
      if (!prevEl) {
        edgeByKey.set(key, el);
        continue;
      }
      const previousData = prevEl.data || {};
      const nextData = el.data || {};
      const nextPos = Number(nextData.positivity);
      const prevPos = Number(previousData.positivity);
      const positivity = Number.isFinite(nextPos)
        ? nextPos
        : Number.isFinite(prevPos)
          ? prevPos
          : 0;

      edgeByKey.set(key, {
        ...prevEl,
        ...el,
        data: {
          ...previousData,
          ...nextData,
          relation: mergeRelationArrays(previousData.relation, nextData.relation),
          label: nextData.label != null && String(nextData.label).trim() !== '' ? nextData.label : previousData.label || '',
          positivity,
        },
      });
    }

    const mergedEdges = Array.from(edgeByKey.values());

    return [...prevNodes, ...newNodes, ...mergedEdges];
  },

  createNextEventData: (normalizedEvent, currentChapter, apiEventIdx, resultData, eventUtils) => {
    const resolvedEventIdx = apiEventIdx;
    const originalEventIdx = normalizedEvent ? eventUtils.extractRawEventIdx(normalizedEvent) : resolvedEventIdx;
    const apiEventNum = normalizedEvent ? Number(normalizedEvent.eventNum) : NaN;
    const eventNum =
      Number.isFinite(apiEventNum) && apiEventNum > 0 ? apiEventNum : resolvedEventIdx;

    const apiEventIdFromPayload = (ev) => {
      if (!ev || typeof ev !== 'object') return null;
      if (ev.eventId != null) return ev.eventId;
      if (ev.event_id != null) return ev.event_id;
      return null;
    };

    if (normalizedEvent) {
      const rawId = apiEventIdFromPayload(normalizedEvent);
      const numericEventId = Number(normalizedEvent.event_id);
      return {
        ...normalizedEvent,
        chapter: normalizedEvent.chapter ?? currentChapter,
        chapterIdx: normalizedEvent.chapterIdx ?? currentChapter,
        eventNum,
        eventIdx: eventNum,
        event_id: Number.isFinite(numericEventId) && numericEventId > 0 ? numericEventId : eventNum,
        eventId: rawId != null ? rawId : eventNum,
        resolvedEventIdx,
        originalEventIdx,
        relations: resultData.relations || [],
        characters: resultData.characters || []
      };
    }

    const raw = resultData?.event;
    const parsed = raw ? graphDataTransformUtils.normalizeApiEvent(raw) : null;
    const rid = apiEventIdFromPayload(raw);
    const neid = Number(raw?.event_id);

    return {
      chapter: currentChapter,
      chapterIdx: currentChapter,
      eventNum,
      eventIdx: eventNum,
      event_id: Number.isFinite(neid) && neid > 0 ? neid : eventNum,
      eventId: rid != null ? rid : (parsed ? apiEventIdFromPayload(parsed) : null) ?? eventNum,
      resolvedEventIdx,
      originalEventIdx: resolvedEventIdx,
      relations: resultData.relations || [],
      characters: resultData.characters || []
    };
  }
};

/** 현재 읽기 이벤트·lastGood 기준 그래프 타깃 챕터·이벤트 */
export function resolveViewerGraphTarget({ currentChapter, currentEvent, lastGood = null }) {
  const ch = Number(currentChapter);
  const fallbackChapter = Number.isFinite(ch) && ch >= 1 ? ch : 1;

  if (currentEvent && typeof currentEvent === 'object') {
    const eventChapter = Number(currentEvent.chapter ?? currentEvent.chapterIdx ?? fallbackChapter);
    const eventIdx = Number(currentEvent.eventNum ?? currentEvent.eventIdx);
    if (Number.isFinite(eventChapter) && eventChapter >= 1 && Number.isFinite(eventIdx) && eventIdx >= 1) {
      return { chapter: eventChapter, eventIdx };
    }
  }

  const savedChapter = Number(lastGood?.chapter);
  const savedEventIdx = Number(lastGood?.eventNum ?? lastGood?.eventIdx);
  if (savedChapter === fallbackChapter && Number.isFinite(savedEventIdx) && savedEventIdx >= 1) {
    return { chapter: fallbackChapter, eventIdx: savedEventIdx };
  }

  return { chapter: fallbackChapter, eventIdx: 1 };
}

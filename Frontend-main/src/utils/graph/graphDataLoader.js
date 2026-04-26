/** 뷰어·로컬 스토리지 보조. 챕터 이벤트 본문은 fine API 집계 캐시와 동일 스키마다. */
import { loadFromStorage, saveToStorage, removeFromStorage } from '../common/cache/cacheManager';
import { getCachedChapterEvents, getChapterEventFallbackData } from '../common/cache/chapterEventCache';
import { eventUtils } from '../viewer/viewerUtils';
import { errorUtils } from '../common/errorUtils';

const GRAPH_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// 세션 내 메모리 캐시 — localStorage JSON.parse 없이 즉시 응답
const macroSessionCache = new Map();
const macroSessionKey = (bookId, chapter) => `${Number(bookId)}:${Number(chapter)}`;

// 진행 중인 API 요청 dedup — 동일 cacheKey의 중복 호출을 단일 Promise로 합침
const inflightRequests = new Map();

export const hasMacroSessionCache = (bookId, chapter) =>
  macroSessionCache.has(macroSessionKey(bookId, chapter));

const getMacroFromSessionCache = (bookId, chapter) =>
  macroSessionCache.get(macroSessionKey(bookId, chapter));

const saveMacroToSessionCache = (bookId, chapter, data) =>
  macroSessionCache.set(macroSessionKey(bookId, chapter), data);

export const checkLocalStorageCache = (cacheKey) => {
  const data = loadFromStorage(cacheKey, 'localStorage');
  if (!data) return null;
  if (data._savedAt && (Date.now() - data._savedAt) > GRAPH_CACHE_TTL_MS) {
    removeFromStorage(cacheKey, 'localStorage');
    return null;
  }
  return data;
};

export const saveToLocalStorageCache = (cacheKey, data) => {
  saveToStorage(cacheKey, { ...data, _savedAt: Date.now() }, 'localStorage');
};

export const checkChapterEventsCache = (bookId, chapter, eventIdx) => {
  const chapterCache = getCachedChapterEvents(bookId, chapter);
  if (!chapterCache?.events || !Array.isArray(chapterCache.events)) {
    return null;
  }

  const targetEvent = eventUtils.findEventInCache(chapterCache.events, eventIdx);
  if (!targetEvent || (!targetEvent.characters && !targetEvent.relations)) {
    return null;
  }

  return {
    characters: Array.isArray(targetEvent.characters) ? targetEvent.characters : [],
    relations: Array.isArray(targetEvent.relations) ? targetEvent.relations : [],
    event: targetEvent.event || null,
  };
};

export const getFallbackData = (bookId, chapter, eventIdx, macroData) => {
  const fallbackEventData = getChapterEventFallbackData(bookId, chapter, eventIdx);
  if (fallbackEventData) {
    return fallbackEventData;
  }

  if (macroData) {
    return macroData;
  }

  return null;
};

const hasGraphPayload = (data) => {
  if (!data || typeof data !== 'object') return false;
  const chars = Array.isArray(data.characters) ? data.characters.length : 0;
  const rels = Array.isArray(data.relations) ? data.relations.length : 0;
  return chars > 0 || rels > 0;
};

/** `loadGraphDataWithCache` 매크로 분기와 동일 키·조건의 동기 조회(로딩 스피너 지연용) */
export const hasMacroGraphStorageCache = (bookId, chapter) => {
  const b = Number(bookId);
  const ch = Number(chapter);
  if (!Number.isFinite(b) || b < 1 || !Number.isFinite(ch) || ch < 1) return false;
  if (macroSessionCache.has(macroSessionKey(b, ch))) return true;
  const cacheKey = `graph_macro_${b}_upto_${ch}`;
  return hasGraphPayload(checkLocalStorageCache(cacheKey));
};

const MACRO_KEY_RE = /^graph_macro_(\d+)_upto_(\d+)$/;

const handleSuccess = (data, onSuccess, cacheKey) => {
  if (cacheKey && hasGraphPayload(data)) {
    saveToLocalStorageCache(cacheKey, data);
    const m = MACRO_KEY_RE.exec(cacheKey);
    if (m) saveMacroToSessionCache(m[1], m[2], data);
  }
  if (onSuccess) {
    onSuccess(data);
  }
};

const handleFallback = (bookId, chapter, eventIdx, macroData, onSuccess, logMessage) => {
  const fallbackData = getFallbackData(bookId, chapter, eventIdx, macroData);
  if (fallbackData) {
    errorUtils.logInfo('GraphDataLoader', logMessage, {
      bookId,
      chapter,
      eventIdx,
      source: 'fallback',
    });
    if (onSuccess) {
      onSuccess(fallbackData);
    }
    return { data: fallbackData, source: 'fallback' };
  }
  return null;
};

const processApiResponse = (response, cacheKey, onSuccess, bookId, chapter, eventIdx, macroData, onError) => {
  if (response?.isSuccess && response?.result) {
    handleSuccess(response.result, onSuccess, cacheKey);
    return { data: response.result, source: 'api' };
  }

  const apiError = new Error(response?.message || 'API 응답이 실패했습니다');
  apiError.status = response?.code || null;
  errorUtils.logWarning('GraphDataLoader', 'API 응답 실패', {
    bookId,
    chapter,
    eventIdx,
    response,
  });

  const fallbackResult = handleFallback(bookId, chapter, eventIdx, macroData, onSuccess, '폴백 데이터 사용');
  if (fallbackResult) {
    return fallbackResult;
  }

  if (onError) {
    onError(apiError);
  }
  return { data: null, source: 'none' };
};

export const prefetchMacroGraphToCache = async (bookId, chapter, apiCall) => {
  const b = Number(bookId);
  const ch = Number(chapter);
  if (!Number.isFinite(b) || b < 1 || !Number.isFinite(ch) || ch < 1) return;
  if (macroSessionCache.has(macroSessionKey(b, ch))) return;
  const cacheKey = `graph_macro_${b}_upto_${ch}`;
  if (hasGraphPayload(checkLocalStorageCache(cacheKey))) return;
  try {
    const response = await apiCall();
    if (response?.isSuccess && response?.result && hasGraphPayload(response.result)) {
      saveToLocalStorageCache(cacheKey, response.result);
      saveMacroToSessionCache(b, ch, response.result);
    }
  } catch {
    // 프리페치 실패는 조용히 무시
  }
};

export const loadGraphDataWithCache = async ({
  bookId,
  chapter,
  eventIdx,
  cacheKey,
  apiCall,
  macroData = null,
  onSuccess,
  onError,
}) => {
  // 1순위: 세션 메모리 캐시 (JSON.parse 없이 즉시)
  const macroMatch = cacheKey && MACRO_KEY_RE.exec(cacheKey);
  if (macroMatch) {
    const sessionData = getMacroFromSessionCache(macroMatch[1], macroMatch[2]);
    if (hasGraphPayload(sessionData)) {
      if (onSuccess) onSuccess(sessionData);
      return { data: sessionData, source: 'session' };
    }
  }

  // 2순위: localStorage 캐시
  const localStorageData = checkLocalStorageCache(cacheKey);
  if (hasGraphPayload(localStorageData)) {
    if (macroMatch) saveMacroToSessionCache(macroMatch[1], macroMatch[2], localStorageData);
    if (onSuccess) onSuccess(localStorageData);
    return { data: localStorageData, source: 'localStorage' };
  }

  if (eventIdx !== undefined && eventIdx !== null) {
    const chapterEventsData = checkChapterEventsCache(bookId, chapter, eventIdx);
    if (chapterEventsData) {
      handleSuccess(chapterEventsData, onSuccess, cacheKey);
      return { data: chapterEventsData, source: 'chapterEvents' };
    }
  }

  try {
    let requestPromise = cacheKey ? inflightRequests.get(cacheKey) : null;
    if (!requestPromise) {
      requestPromise = apiCall();
      if (cacheKey) {
        inflightRequests.set(cacheKey, requestPromise);
        requestPromise.finally(() => inflightRequests.delete(cacheKey));
      }
    }
    const response = await requestPromise;
    return processApiResponse(response, cacheKey, onSuccess, bookId, chapter, eventIdx, macroData, onError);
  } catch (error) {
    if (cacheKey) inflightRequests.delete(cacheKey);
    errorUtils.logError('GraphDataLoader', error, {
      bookId,
      chapter,
      eventIdx,
      cacheKey,
    });

    const fallbackResult = handleFallback(bookId, chapter, eventIdx, macroData, onSuccess, '에러 후 폴백 데이터 사용');
    if (fallbackResult) {
      return fallbackResult;
    }

    if (onError) {
      onError(error);
    }
    return { data: null, source: 'error' };
  }
};

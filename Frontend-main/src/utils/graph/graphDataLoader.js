import { loadFromStorage, saveToStorage } from '../common/cache/cacheManager';
import { getCachedChapterEvents, getChapterEventFallbackData } from '../common/cache/chapterEventCache';
import { eventUtils } from '../viewerUtils';
import { errorUtils } from '../common/errorUtils';

export const checkLocalStorageCache = (cacheKey) => {
  return loadFromStorage(cacheKey, 'localStorage');
};

export const saveToLocalStorageCache = (cacheKey, data) => {
  saveToStorage(cacheKey, data, 'localStorage');
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
    userCurrentChapter: 0,
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

const handleSuccess = (data, onSuccess, cacheKey) => {
  if (cacheKey && data) {
    saveToLocalStorageCache(cacheKey, data);
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
  const localStorageData = checkLocalStorageCache(cacheKey);
  if (localStorageData?.characters && localStorageData?.relations) {
    handleSuccess(localStorageData, onSuccess);
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
    const response = await apiCall();
    return processApiResponse(response, cacheKey, onSuccess, bookId, chapter, eventIdx, macroData, onError);
  } catch (error) {
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

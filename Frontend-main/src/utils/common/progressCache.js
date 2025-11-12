// 진도 로컬 캐시 관리
const PROGRESS_CACHE_KEY = 'readwith_progress_cache';
const PROGRESS_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24시간

const memoryCache = new Map();

/**
 * 로컬 스토리지에서 진도 캐시 가져오기
 */
const getProgressCacheFromStorage = () => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const cached = localStorage.getItem(PROGRESS_CACHE_KEY);
    if (!cached) {
      return null;
    }

    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed !== 'object') {
      localStorage.removeItem(PROGRESS_CACHE_KEY);
      return null;
    }

    // TTL 확인
    if (parsed.timestamp && Date.now() - parsed.timestamp > PROGRESS_CACHE_TTL_MS) {
      localStorage.removeItem(PROGRESS_CACHE_KEY);
      return null;
    }

    return parsed.data || {};
  } catch (error) {
    console.error('진도 캐시 로드 실패:', error);
    localStorage.removeItem(PROGRESS_CACHE_KEY);
    return null;
  }
};

/**
 * 로컬 스토리지에 진도 캐시 저장
 */
const saveProgressCacheToStorage = (progressMap) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    const cacheData = {
      timestamp: Date.now(),
      data: progressMap
    };
    localStorage.setItem(PROGRESS_CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('진도 캐시 저장 실패:', error);
  }
};

/**
 * 모든 진도를 로컬 캐시에 저장
 * @param {Array} progressList - 진도 배열 [{bookId, chapterIdx, eventIdx, cfi}, ...]
 */
export const setAllProgress = (progressList) => {
  if (!Array.isArray(progressList)) {
    return;
  }

  const progressMap = {};
  progressList.forEach(progress => {
    if (progress && progress.bookId !== undefined && progress.bookId !== null) {
      progressMap[String(progress.bookId)] = {
        bookId: progress.bookId,
        chapterIdx: progress.chapterIdx ?? null,
        eventIdx: progress.eventIdx ?? null,
        cfi: progress.cfi ?? null
      };
    }
  });

  // 메모리 캐시 업데이트
  Object.entries(progressMap).forEach(([bookId, progress]) => {
    memoryCache.set(bookId, progress);
  });

  // 로컬 스토리지 저장
  saveProgressCacheToStorage(progressMap);
};

/**
 * 특정 책의 진도를 로컬 캐시에 저장
 * @param {Object} progressData - 진도 정보 {bookId, chapterIdx, eventIdx, cfi}
 * bookId는 숫자 또는 문자열 모두 가능 (로컬 책과 서버 책 모두 지원)
 */
export const setProgressToCache = (progressData) => {
  if (!progressData || progressData.bookId === undefined || progressData.bookId === null) {
    return;
  }

  const bookIdStr = String(progressData.bookId);
  const progress = {
    bookId: progressData.bookId,
    chapterIdx: progressData.chapterIdx ?? null,
    eventIdx: progressData.eventIdx ?? null,
    cfi: progressData.cfi ?? null
  };

  // 메모리 캐시 업데이트
  memoryCache.set(bookIdStr, progress);

  // 로컬 스토리지 업데이트
  const cached = getProgressCacheFromStorage() || {};
  cached[bookIdStr] = progress;
  saveProgressCacheToStorage(cached);
};

/**
 * 특정 책의 진도를 로컬 캐시에서 가져오기
 * @param {number|string} bookId - 책 ID
 * @returns {Object|null} 진도 정보 또는 null
 */
export const getProgressFromCache = (bookId) => {
  if (!bookId) {
    return null;
  }

  const bookIdStr = String(bookId);

  // 메모리 캐시 확인
  if (memoryCache.has(bookIdStr)) {
    return memoryCache.get(bookIdStr);
  }

  // 로컬 스토리지에서 로드
  const cached = getProgressCacheFromStorage();
  if (cached && cached[bookIdStr]) {
    const progress = cached[bookIdStr];
    memoryCache.set(bookIdStr, progress);
    return progress;
  }

  return null;
};

/**
 * 특정 책의 진도를 로컬 캐시에서 삭제
 * @param {number|string} bookId - 책 ID
 */
export const removeProgressFromCache = (bookId) => {
  if (!bookId) {
    return;
  }

  const bookIdStr = String(bookId);
  memoryCache.delete(bookIdStr);

  const cached = getProgressCacheFromStorage();
  if (cached && cached[bookIdStr]) {
    delete cached[bookIdStr];
    saveProgressCacheToStorage(cached);
  }
};

/**
 * 모든 진도 가져오기 (로컬 캐시에서)
 * @returns {Array} 진도 배열
 */
export const getAllProgressFromCache = () => {
  const cached = getProgressCacheFromStorage();
  if (!cached) {
    return [];
  }
  
  // 메모리 캐시와 스토리지 캐시 병합
  const allProgress = [];
  const processedBookIds = new Set();
  
  // 메모리 캐시에서 가져오기
  memoryCache.forEach((progress, bookId) => {
    if (progress && !processedBookIds.has(bookId)) {
      allProgress.push(progress);
      processedBookIds.add(bookId);
    }
  });
  
  // 스토리지 캐시에서 가져오기
  Object.entries(cached).forEach(([bookId, progress]) => {
    if (progress && !processedBookIds.has(bookId)) {
      allProgress.push(progress);
      processedBookIds.add(bookId);
    }
  });
  
  return allProgress;
};

/**
 * 진도 캐시 초기화
 */
export const clearProgressCache = () => {
  memoryCache.clear();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(PROGRESS_CACHE_KEY);
  }
};


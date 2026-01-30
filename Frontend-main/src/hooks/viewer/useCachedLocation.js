import { useState, useEffect, useCallback } from 'react';
import { getCachedReaderProgress, setCachedReaderProgress } from '../../utils/common/cache/chapterEventCache';
import { errorUtils } from '../../utils/common/errorUtils';

/**
 * 캐시된 위치 관리 훅
 * @param {string|null} bookKey - 책 키 (bookId)
 * @returns {Object} 캐시된 위치 상태 및 관리 함수
 */
export function useCachedLocation(bookKey) {
  const [cachedLocation, setCachedLocation] = useState(null);

  useEffect(() => {
    if (!bookKey) {
      setCachedLocation(null);
      return;
    }
    
    try {
      const cached = getCachedReaderProgress(bookKey);
      setCachedLocation(cached);
    } catch (error) {
      errorUtils.logWarning('[useCachedLocation] 캐시된 위치 정보를 불러오는데 실패했습니다', error.message);
      setCachedLocation(null);
    }
  }, [bookKey]);

  const saveLocation = useCallback((progressData) => {
    if (!bookKey) {
      return null;
    }

    try {
      const stored = setCachedReaderProgress(bookKey, progressData);
      if (stored) {
        setCachedLocation(stored);
      }
      return stored;
    } catch (error) {
      errorUtils.logWarning('[useCachedLocation] 캐시된 위치 정보를 저장하는데 실패했습니다', error.message);
      return null;
    }
  }, [bookKey]);

  return {
    cachedLocation,
    setCachedLocation,
    saveLocation
  };
}

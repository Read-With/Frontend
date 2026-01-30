/**
 * useProgressAutoSave.js : 진도 자동 저장 훅
 * 
 * [주요 기능]
 * 1. 현재 읽기 위치를 자동으로 캐시에 저장
 * 2. 챕터, 이벤트, CFI 변경 시 자동 저장
 * 3. 디바운싱을 통한 성능 최적화
 * 
 * [사용처]
 * - ViewerPage: 읽기 진도 자동 저장
 */

import { useEffect, useRef } from 'react';
import { setProgressToCache } from '../../utils/common/cache/progressCache';
import { errorUtils } from '../../utils/common/errorUtils';

/**
 * 진도 자동 저장 훅
 * @param {Object} params - 파라미터 객체
 * @param {string} params.bookKey - 책 키 (bookId)
 * @param {number} params.currentChapter - 현재 챕터 번호
 * @param {Object} params.currentEvent - 현재 이벤트 객체
 * @param {number} params.delay - 저장 딜레이 시간 (ms, 기본값: 2000)
 * @returns {void}
 */
export function useProgressAutoSave({ bookKey, currentChapter, currentEvent, delay = 2000 }) {
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!currentChapter || !bookKey) {
      return;
    }

    const currentEventNum = currentEvent?.eventNum;
    const currentEventCfi = currentEvent?.cfi;

    const autoSaveProgress = async () => {
      try {
        const progressData = {
          bookId: bookKey,
          chapterIdx: currentChapter || 1,
          eventIdx: currentEventNum || 0,
          cfi: currentEventCfi || null
        };
        
        setProgressToCache(progressData);
      } catch (error) {
        errorUtils.logWarning('[useProgressAutoSave] 진도 자동 저장 실패', error.message);
      }
    };

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(autoSaveProgress, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [bookKey, currentChapter, currentEvent?.eventNum, currentEvent?.cfi, delay]);
}

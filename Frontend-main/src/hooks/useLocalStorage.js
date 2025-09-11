import { useState, useEffect, useCallback } from 'react';

export const STORAGE_KEYS = {
  CHAPTER_NODE_POSITIONS: (chapter) => `chapter_node_positions_${chapter}`,
  GRAPH_EVENT_LAYOUT: (chapter, eventNum) => `graph_event_layout_chapter_${chapter}_event_${eventNum}`,
  GRAPH_PARTIAL_LAYOUT: (chapter) => `graph_partial_layout_chapter_${chapter}`,
  LAST_CFI: (filename) => `readwith_${filename}_lastCFI`,
  PREV_CHAPTER: (filename) => `readwith_${filename}_prevChapter`,
  NEXT_PAGE: (filename) => `readwith_${filename}_nextPage`,
  PREV_PAGE: (filename) => `readwith_${filename}_prevPage`,
  TOTAL_LENGTH: (bookId) => `totalLength_${bookId}`,
  CHAPTER_LENGTHS: (bookId) => `chapterLengths_${bookId}`,
  CHAPTER: (filename) => `readwith_${filename}_chapter`,
};

export const createStorageKey = {
  chapterNodePositions: (chapter) => STORAGE_KEYS.CHAPTER_NODE_POSITIONS(chapter),
  
  // 이벤트별 레이아웃 키 생성
  graphEventLayout: (chapter, eventNum) => STORAGE_KEYS.GRAPH_EVENT_LAYOUT(chapter, eventNum),
  
  // 챕터별 부분 레이아웃 키 생성
  graphPartialLayout: (chapter) => STORAGE_KEYS.GRAPH_PARTIAL_LAYOUT(chapter),
  
  // CFI 관련 키 생성
  lastCFI: (filename) => STORAGE_KEYS.LAST_CFI(filename),
  prevChapter: (filename) => STORAGE_KEYS.PREV_CHAPTER(filename),
  nextPage: (filename) => STORAGE_KEYS.NEXT_PAGE(filename),
  prevPage: (filename) => STORAGE_KEYS.PREV_PAGE(filename),
  
  // 책 관련 키 생성
  totalLength: (bookId) => STORAGE_KEYS.TOTAL_LENGTH(bookId),
  chapterLengths: (bookId) => STORAGE_KEYS.CHAPTER_LENGTHS(bookId),
  chapter: (filename) => STORAGE_KEYS.CHAPTER(filename),
};

/**
 * localStorage와 연동되는 상태 관리 훅
 * @param {string} key - localStorage 키
 * @param {any} initialValue - 초기값
 * @returns {[any, function]} 상태값과 설정 함수
 */
export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return initialValue;
      
      // CFI 관련 키들은 JSON 파싱하지 않고 문자열로 처리
      if (key.includes('_lastCFI') || key.includes('_prevChapter') || key.includes('_nextPage') || key.includes('_prevPage')) {
        return item;
      }
      
      return JSON.parse(item);
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      
      // CFI 관련 키들은 JSON.stringify하지 않고 문자열로 저장
      if (key.includes('_lastCFI') || key.includes('_prevChapter') || key.includes('_nextPage') || key.includes('_prevPage')) {
        localStorage.setItem(key, valueToStore);
      } else {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      // 에러 발생 시 상태는 업데이트하되 localStorage는 건드리지 않음
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
    }
  }, [key, storedValue]);

  // localStorage 변경 감지 (다른 탭에서의 변경)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          // CFI 관련 키들은 JSON 파싱하지 않고 문자열로 처리
          if (key.includes('_lastCFI') || key.includes('_prevChapter') || key.includes('_nextPage') || key.includes('_prevPage')) {
            setStoredValue(e.newValue);
          } else {
            setStoredValue(JSON.parse(e.newValue));
          }
        } catch (error) {
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue];
}

/**
 * 숫자 타입 localStorage 훅
 * @param {string} key - localStorage 키
 * @param {number} initialValue - 초기값
 * @returns {[number, function]} 상태값과 설정 함수
 */
export function useLocalStorageNumber(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      const parsedValue = item ? Number(item) : initialValue;
      return isNaN(parsedValue) ? initialValue : parsedValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      const numericValue = Number(valueToStore);
      
      if (isNaN(numericValue)) {
        return;
      }
      
      setStoredValue(numericValue);
      localStorage.setItem(key, numericValue.toString());
    } catch (error) {
      // 에러 발생 시 상태는 업데이트하되 localStorage는 건드리지 않음
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      const numericValue = Number(valueToStore);
      if (!isNaN(numericValue)) {
        setStoredValue(numericValue);
      }
    }
  }, [key, storedValue]);

  // localStorage 변경 감지 (다른 탭에서의 변경)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          const parsedValue = Number(e.newValue);
          if (!isNaN(parsedValue)) {
            setStoredValue(parsedValue);
          }
        } catch (error) {
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue];
}

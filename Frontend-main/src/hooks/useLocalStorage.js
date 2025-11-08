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

export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return initialValue;
      
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
      
      if (key.includes('_lastCFI') || key.includes('_prevChapter') || key.includes('_nextPage') || key.includes('_prevPage')) {
        localStorage.setItem(key, valueToStore);
      } else {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
    }
  }, [key, storedValue]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
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

export function useLocalStorageNumber(key, initialValue, options = {}) {
  const { forceInitialValue = false } = options;

  const [storedValue, setStoredValue] = useState(() => {
    const numericInitial = Number(initialValue);
    const sanitizedInitial = isNaN(numericInitial) ? initialValue : numericInitial;

    if (forceInitialValue) {
      try {
        localStorage.setItem(key, sanitizedInitial.toString());
      } catch (error) {
      }
      return sanitizedInitial;
    }

    try {
      const item = localStorage.getItem(key);
      const parsedValue = item ? Number(item) : sanitizedInitial;
      return isNaN(parsedValue) ? sanitizedInitial : parsedValue;
    } catch (error) {
      return sanitizedInitial;
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
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      const numericValue = Number(valueToStore);
      if (!isNaN(numericValue)) {
        setStoredValue(numericValue);
      }
    }
  }, [key, storedValue]);

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

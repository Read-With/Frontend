import { useState, useEffect, useCallback } from 'react';

const normalizeKeySegment = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
};

const STRING_STORAGE_KEY_SUFFIXES = ['_lastCFI', '_prevChapter', '_nextPage', '_prevPage'];

const isStringStorageKey = (key) => {
  return STRING_STORAGE_KEY_SUFFIXES.some(suffix => key.includes(suffix));
};

export const STORAGE_KEYS = {
  CHAPTER_NODE_POSITIONS: (bookKey, chapter) => {
    const bookSegment = normalizeKeySegment(bookKey);
    const chapterSegment = normalizeKeySegment(chapter) ?? 'unknown';
    return bookSegment
      ? `chapter_node_positions_${bookSegment}_${chapterSegment}`
      : `chapter_node_positions_${chapterSegment}`;
  },
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
  chapterNodePositions: (bookKey, chapter) => STORAGE_KEYS.CHAPTER_NODE_POSITIONS(bookKey, chapter),
  
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
  const isStringKey = isStringStorageKey(key);
  
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return initialValue;
      
      if (isStringKey) {
        return item;
      }
      
      return JSON.parse(item);
    } catch (error) {
      console.error(`[useLocalStorage] 초기값 로드 실패 (key: ${key}):`, error);
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    const previousValue = storedValue;
    
    try {
      if (isStringKey) {
        localStorage.setItem(key, valueToStore);
      } else {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      }
      
      setStoredValue(valueToStore);
      
      window.dispatchEvent(new CustomEvent('localStorageChange', {
        detail: { key, newValue: isStringKey ? valueToStore : JSON.stringify(valueToStore) }
      }));
    } catch (error) {
      console.error(`[useLocalStorage] 저장 실패 (key: ${key}):`, error);
      setStoredValue(previousValue);
    }
  }, [key, storedValue, isStringKey]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          if (isStringKey) {
            setStoredValue(e.newValue);
          } else {
            setStoredValue(JSON.parse(e.newValue));
          }
        } catch (error) {
          console.error(`[useLocalStorage] storage 이벤트 처리 실패 (key: ${key}):`, error);
        }
      }
    };

    const handleCustomStorageChange = (e) => {
      if (e.detail?.key === key && e.detail?.newValue !== null) {
        handleStorageChange({ key: e.detail.key, newValue: e.detail.newValue });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageChange', handleCustomStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageChange', handleCustomStorageChange);
    };
  }, [key, isStringKey]);

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
        console.error(`[useLocalStorageNumber] 초기값 강제 저장 실패 (key: ${key}):`, error);
      }
      return sanitizedInitial;
    }

    try {
      const item = localStorage.getItem(key);
      const parsedValue = item ? Number(item) : sanitizedInitial;
      return isNaN(parsedValue) ? sanitizedInitial : parsedValue;
    } catch (error) {
      console.error(`[useLocalStorageNumber] 초기값 로드 실패 (key: ${key}):`, error);
      return sanitizedInitial;
    }
  });

  const setValue = useCallback((value) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    const numericValue = Number(valueToStore);
    const previousValue = storedValue;
    
    if (isNaN(numericValue)) {
      return;
    }
    
    try {
      localStorage.setItem(key, numericValue.toString());
      setStoredValue(numericValue);
      
      window.dispatchEvent(new CustomEvent('localStorageChange', {
        detail: { key, newValue: numericValue.toString() }
      }));
    } catch (error) {
      console.error(`[useLocalStorageNumber] 저장 실패 (key: ${key}):`, error);
      setStoredValue(previousValue);
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
          console.error(`[useLocalStorageNumber] storage 이벤트 처리 실패 (key: ${key}):`, error);
        }
      }
    };

    const handleCustomStorageChange = (e) => {
      if (e.detail?.key === key && e.detail?.newValue !== null) {
        handleStorageChange({ key: e.detail.key, newValue: e.detail.newValue });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageChange', handleCustomStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageChange', handleCustomStorageChange);
    };
  }, [key]);

  return [storedValue, setValue];
}

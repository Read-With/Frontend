/** localStorage 동기화 훅 + 그래프·뷰어 storage key */

import { useState, useEffect, useCallback } from 'react';

const STRING_STORAGE_KEY_SUFFIXES = ['_prevChapter', '_nextPage', '_prevPage'];

const isStringStorageKey = (key) => {
  return STRING_STORAGE_KEY_SUFFIXES.some(suffix => key.includes(suffix));
};

export const STORAGE_KEYS = {
  prevChapter: (filename) => `readwith_${filename}_prevChapter`,
  nextPage: (filename) => `readwith_${filename}_nextPage`,
  prevPage: (filename) => `readwith_${filename}_prevPage`,
  totalLength: (bookId) => `totalLength_${bookId}`,
  chapterLengths: (bookId) => `chapterLengths_${bookId}`,
  chapter: (filename) => `readwith_${filename}_chapter`,
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

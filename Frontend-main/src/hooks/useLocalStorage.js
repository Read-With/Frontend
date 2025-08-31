import { useState, useEffect, useCallback } from 'react';

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
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
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
          setStoredValue(JSON.parse(e.newValue));
        } catch (error) {
          console.error(`Error parsing localStorage value for key "${key}":`, error);
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
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      const numericValue = Number(valueToStore);
      
      if (isNaN(numericValue)) {
        console.warn(`Invalid number value for localStorage key "${key}":`, valueToStore);
        return;
      }
      
      setStoredValue(numericValue);
      localStorage.setItem(key, numericValue.toString());
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
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
          console.error(`Error parsing localStorage value for key "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue];
}

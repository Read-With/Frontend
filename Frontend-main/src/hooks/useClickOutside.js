import { useEffect, useRef } from 'react';

/**
 * 외부 클릭 감지 훅
 * @param {Function} callback - 외부 클릭 시 실행할 콜백 함수
 * @param {boolean} enabled - 훅 활성화 여부 (기본값: true)
 * @returns {React.RefObject} ref 객체
 */
export function useClickOutside(callback, enabled = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        callback(event);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [callback, enabled]);

  return ref;
}

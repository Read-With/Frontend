import { useEffect, useRef } from 'react';

export function useClickOutside(callback, enabled = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        callback(event);
      }
    };

    // mousedown 대신 click 이벤트 사용하여 Cytoscape tap 이벤트와 충돌 방지
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [callback, enabled]);

  return ref;
}

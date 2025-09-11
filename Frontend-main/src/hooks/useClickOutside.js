import { useEffect, useRef } from 'react';

// 전역 드래그 상태 관리
let globalDragState = {
  isDragging: false,
  dragEndTime: 0,
  ignoreNextClick: false
};

export function useClickOutside(callback, enabled = true, ignoreDrag = false) {
  const ref = useRef(null);
  const lastClickTime = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    // 전역 드래그 상태 업데이트
    const updateDragState = (isDragging) => {
      globalDragState.isDragging = isDragging;
      if (!isDragging) {
        globalDragState.dragEndTime = Date.now();
        globalDragState.ignoreNextClick = true;
        // 500ms 후에 클릭 무시 해제
        setTimeout(() => {
          globalDragState.ignoreNextClick = false;
        }, 500);
      }
    };

    // 마우스 다운 감지
    const handleMouseDown = (event) => {
      // Cytoscape 그래프 영역에서 드래그 시작 감지
      const graphContainer = event.target.closest('#cy') || 
                            event.target.closest('.graph-canvas-area') ||
                            event.target.closest('[data-cy]');
      
      if (graphContainer) {
        globalDragState.isDragging = true;
      }
    };

    // 마우스 업 감지
    const handleMouseUp = () => {
      if (globalDragState.isDragging) {
        updateDragState(false);
      }
    };

    // 그래프 드래그 종료 이벤트 감지
    const handleGraphDragEnd = () => {
      updateDragState(false);
    };

    // 클릭 이벤트 처리
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        const now = Date.now();
        
        // 드래그 무시 모드가 활성화된 경우
        if (ignoreDrag) {
          // 최근에 드래그가 끝났고, 클릭 무시 상태인 경우
          if (globalDragState.ignoreNextClick) {
            return;
          }
          
          // 드래그 종료 후 500ms 이내의 클릭은 무시
          if (now - globalDragState.dragEndTime < 500) {
            return;
          }
        }
        
        // 연속 클릭 방지 (50ms 이내)
        if (now - lastClickTime.current < 50) {
          return;
        }
        
        lastClickTime.current = now;
        callback(event);
      }
    };

    // 이벤트 리스너 등록
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('graphDragEnd', handleGraphDragEnd);
    document.addEventListener('click', handleClickOutside, true);
    
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
      document.removeEventListener('graphDragEnd', handleGraphDragEnd);
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [callback, enabled, ignoreDrag]);

  return ref;
}

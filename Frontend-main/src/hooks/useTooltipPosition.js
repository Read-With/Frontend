import { useState, useEffect, useRef, useCallback } from 'react';

// 상수 정의
const GRAPH_CONTAINER_SELECTOR = '.graph-canvas-area';

/**
 * 위치 계산 및 툴팁 드래그를 담당하는 통합 커스텀 훅
 * @param {number} initialX - 초기 X 좌표
 * @param {number} initialY - 초기 Y 좌표
 * @returns {object} 위치 상태와 드래그 관련 핸들러들
 */
export function useTooltipPosition(initialX, initialY) {
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const tooltipRef = useRef(null);

  useEffect(() => {
    setShowContent(true);
  }, []);

  // 그래프 컨테이너 정보 가져오기
  const getContainerInfo = useCallback(() => {
    try {
      const container = document.querySelector(GRAPH_CONTAINER_SELECTOR);
      const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
      return { container, containerRect };
    } catch (error) {
      console.error('컨테이너 정보 가져오기 실패:', error);
      return { container: null, containerRect: { left: 0, top: 0 } };
    }
  }, []);

  // 뷰포트 정보 가져오기
  const getViewportInfo = useCallback(() => {
    const viewportWidth = Math.min(
      document.documentElement.clientWidth,
      window.innerWidth
    );
    const viewportHeight = Math.min(
      document.documentElement.clientHeight,
      window.innerHeight
    );
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    return { viewportWidth, viewportHeight, scrollX, scrollY };
  }, []);

  // Cytoscape 위치를 절대 위치로 변환
  const calculateCytoscapePosition = useCallback((pos, cyRef) => {
    try {
      if (!cyRef?.current) return { x: 0, y: 0 };
      
      const pan = cyRef.current.pan();
      const zoom = cyRef.current.zoom();
      const { containerRect } = getContainerInfo();
      
      return {
        x: pos.x * zoom + pan.x + containerRect.left,
        y: pos.y * zoom + pan.y + containerRect.top,
      };
    } catch (error) {
      console.error('Cytoscape 위치 계산 실패:', error);
      return { x: 0, y: 0 };
    }
  }, [getContainerInfo]);

  // 뷰포트 경계 내로 위치 제한
  const constrainToViewport = useCallback((x, y, elementWidth = 0, elementHeight = 0) => {
    const { viewportWidth, viewportHeight, scrollX, scrollY } = getViewportInfo();
    
    const constrainedX = Math.max(
      scrollX,
      Math.min(x, viewportWidth + scrollX - elementWidth)
    );
    const constrainedY = Math.max(
      scrollY,
      Math.min(y, viewportHeight + scrollY - elementHeight)
    );
    
    return { x: constrainedX, y: constrainedY };
  }, [getViewportInfo]);

  const handleMouseDown = (e) => {
    if (e.target.closest(".tooltip-close-btn")) return;
    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    
    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    const constrained = constrainToViewport(newX, newY, tooltipRect.width, tooltipRect.height);
    setPosition(constrained);
    setHasDragged(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 드래그 이벤트 리스너 등록
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    } else {
      document.body.style.userSelect = "";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // 초기 위치 설정
  useEffect(() => {
    if (
      initialX !== undefined &&
      initialY !== undefined &&
      tooltipRef.current &&
      !isDragging &&
      !hasDragged
    ) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const constrained = constrainToViewport(initialX, initialY, tooltipRect.width, tooltipRect.height);
      setPosition(constrained);
    }
  }, [initialX, initialY, isDragging, hasDragged, constrainToViewport]);

  return {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
    // 공통 위치 계산 함수들
    getContainerInfo,
    getViewportInfo,
    calculateCytoscapePosition,
    constrainToViewport,
  };
}

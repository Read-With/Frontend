const GRAPH_CONTAINER_SELECTOR = '.graph-canvas-area';

export const getContainerInfo = () => {
  try {
    const container = document.querySelector(GRAPH_CONTAINER_SELECTOR);
    const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
    return { container, containerRect };
  } catch (error) {
    console.error('컨테이너 정보 가져오기 실패:', error);
    return { container: null, containerRect: { left: 0, top: 0 } };
  }
};

/**
 * 뷰포트 정보를 가져오는 함수
 * @returns {Object} 뷰포트 크기와 스크롤 정보
 */
export const getViewportInfo = () => {
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
};

/**
 * Cytoscape 위치를 절대 위치로 변환하는 함수
 * @param {Object} pos - Cytoscape 위치 객체 {x, y}
 * @param {Object} cyRef - Cytoscape 인스턴스 참조
 * @returns {Object} 절대 위치 {x, y}
 */
export const calculateCytoscapePosition = (pos, cyRef) => {
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
    console.error('위치 계산 실패:', error);
    return { x: 0, y: 0 };
  }
};

/**
 * 뷰포트 경계 내로 위치를 제한하는 함수
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} elementWidth - 요소 너비 (기본값: 0)
 * @param {number} elementHeight - 요소 높이 (기본값: 0)
 * @returns {Object} 제한된 위치 {x, y}
 */
export const constrainToViewport = (x, y, elementWidth = 0, elementHeight = 0) => {
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
};

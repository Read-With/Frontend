/**
 * 그래프 관련 유틸리티 함수들
 * Cytoscape 그래프와 DOM 요소 간의 좌표 변환 및 뷰포트 관리
 */

const GRAPH_CONTAINER_SELECTOR = '.graph-canvas-area';

// 성능 최적화를 위한 캐시
let containerCache = null;
let viewportCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 100; // 100ms 캐시 유지

/**
 * 그래프 컨테이너 정보를 가져오는 함수 (캐시 포함)
 * @returns {Object} 컨테이너 요소와 위치 정보
 * @returns {Element|null} returns.container - 그래프 컨테이너 DOM 요소
 * @returns {DOMRect} returns.containerRect - 컨테이너의 위치 정보
 */
export const getContainerInfo = () => {
  try {
    const now = Date.now();
    
    // 캐시가 유효한지 확인
    if (containerCache && (now - cacheTimestamp) < CACHE_DURATION) {
      return containerCache;
    }
    
    const container = document.querySelector(GRAPH_CONTAINER_SELECTOR);
    if (!container) {
      console.warn(`getContainerInfo: 그래프 컨테이너를 찾을 수 없습니다 (${GRAPH_CONTAINER_SELECTOR})`);
      const result = { container: null, containerRect: { left: 0, top: 0 } };
      containerCache = result;
      cacheTimestamp = now;
      return result;
    }
    
    const containerRect = container.getBoundingClientRect();
    if (!containerRect) {
      console.warn('getContainerInfo: 컨테이너의 getBoundingClientRect()가 실패했습니다');
      const result = { container, containerRect: { left: 0, top: 0 } };
      containerCache = result;
      cacheTimestamp = now;
      return result;
    }
    
    const result = { container, containerRect };
    containerCache = result;
    cacheTimestamp = now;
    return result;
  } catch (error) {
    console.error('getContainerInfo 실패:', error, { selector: GRAPH_CONTAINER_SELECTOR });
    const result = { container: null, containerRect: { left: 0, top: 0 } };
    containerCache = result;
    cacheTimestamp = Date.now();
    return result;
  }
};

/**
 * 뷰포트 정보를 가져오는 함수 (캐시 포함)
 * @returns {Object} 뷰포트 크기와 스크롤 정보
 * @returns {number} returns.viewportWidth - 뷰포트 너비
 * @returns {number} returns.viewportHeight - 뷰포트 높이
 * @returns {number} returns.scrollX - 수평 스크롤 위치
 * @returns {number} returns.scrollY - 수직 스크롤 위치
 */
export const getViewportInfo = () => {
  try {
    const now = Date.now();
    
    // 캐시가 유효한지 확인
    if (viewportCache && (now - cacheTimestamp) < CACHE_DURATION) {
      return viewportCache;
    }
    
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
    
    const result = { viewportWidth, viewportHeight, scrollX, scrollY };
    viewportCache = result;
    cacheTimestamp = now;
    return result;
  } catch (error) {
    console.error('getViewportInfo 실패:', error);
    const result = { viewportWidth: 0, viewportHeight: 0, scrollX: 0, scrollY: 0 };
    viewportCache = result;
    cacheTimestamp = Date.now();
    return result;
  }
};

/**
 * Cytoscape 위치를 절대 위치로 변환하는 함수
 * @param {Object} pos - Cytoscape 위치 객체
 * @param {number} pos.x - Cytoscape X 좌표
 * @param {number} pos.y - Cytoscape Y 좌표
 * @param {Object} cyRef - Cytoscape 인스턴스 참조
 * @param {Object} cyRef.current - Cytoscape 인스턴스
 * @returns {Object} 절대 위치
 * @returns {number} returns.x - DOM X 좌표
 * @returns {number} returns.y - DOM Y 좌표
 */
export const calculateCytoscapePosition = (pos, cyRef) => {
  try {
    if (!cyRef?.current) {
      console.warn('calculateCytoscapePosition: cyRef.current가 없습니다');
      return { x: 0, y: 0 };
    }
    
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      console.warn('calculateCytoscapePosition: 유효하지 않은 pos 객체입니다', pos);
      return { x: 0, y: 0 };
    }
    
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const { containerRect } = getContainerInfo();
    
    if (!pan || typeof pan.x !== 'number' || typeof pan.y !== 'number') {
      console.warn('calculateCytoscapePosition: 유효하지 않은 pan 값입니다', pan);
      return { x: 0, y: 0 };
    }
    
    if (typeof zoom !== 'number' || zoom <= 0) {
      console.warn('calculateCytoscapePosition: 유효하지 않은 zoom 값입니다', zoom);
      return { x: 0, y: 0 };
    }
    
    // Cytoscape 좌표를 DOM 좌표로 정확히 변환
    const domX = pos.x * zoom + pan.x + containerRect.left;
    const domY = pos.y * zoom + pan.y + containerRect.top;
    
    return { x: domX, y: domY };
  } catch (error) {
    console.error('calculateCytoscapePosition 실패:', error, { pos, cyRef: !!cyRef?.current });
    return { x: 0, y: 0 };
  }
};

/**
 * 마우스 이벤트 위치를 Cytoscape 좌표로 변환하는 함수
 * @param {Object} evt - 마우스 이벤트 객체
 * @param {number} evt.clientX - 마우스 X 좌표
 * @param {number} evt.clientY - 마우스 Y 좌표
 * @param {Object} cyRef - Cytoscape 인스턴스 참조
 * @param {Object} cyRef.current - Cytoscape 인스턴스
 * @returns {Object} Cytoscape 좌표
 * @returns {number} returns.x - Cytoscape X 좌표
 * @returns {number} returns.y - Cytoscape Y 좌표
 */
export const convertMouseToCytoscapePosition = (evt, cyRef) => {
  try {
    if (!cyRef?.current) {
      console.warn('convertMouseToCytoscapePosition: cyRef.current가 없습니다');
      return { x: 0, y: 0 };
    }
    
    if (!evt || typeof evt.clientX !== 'number' || typeof evt.clientY !== 'number') {
      console.warn('convertMouseToCytoscapePosition: 유효하지 않은 이벤트 객체입니다', evt);
      return { x: 0, y: 0 };
    }
    
    const cy = cyRef.current;
    const { container, containerRect } = getContainerInfo();
    
    if (!container) {
      console.warn('convertMouseToCytoscapePosition: 그래프 컨테이너를 찾을 수 없습니다');
      return { x: 0, y: 0 };
    }
    
    // 마우스 위치를 컨테이너 기준으로 변환
    const clientX = evt.clientX - containerRect.left;
    const clientY = evt.clientY - containerRect.top;
    
    // pan과 zoom을 고려하여 Cytoscape 좌표로 변환
    const pan = cy.pan();
    const zoom = cy.zoom();
    
    if (!pan || typeof pan.x !== 'number' || typeof pan.y !== 'number') {
      console.warn('convertMouseToCytoscapePosition: 유효하지 않은 pan 값입니다', pan);
      return { x: 0, y: 0 };
    }
    
    if (typeof zoom !== 'number' || zoom <= 0) {
      console.warn('convertMouseToCytoscapePosition: 유효하지 않은 zoom 값입니다', zoom);
      return { x: 0, y: 0 };
    }
    
    const cyX = (clientX - pan.x) / zoom;
    const cyY = (clientY - pan.y) / zoom;
    
    return { x: cyX, y: cyY };
  } catch (error) {
    console.error('convertMouseToCytoscapePosition 실패:', error, { evt: !!evt, cyRef: !!cyRef?.current });
    return { x: 0, y: 0 };
  }
};

/**
 * 뷰포트 경계 내로 위치를 제한하는 함수
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} [elementWidth=0] - 요소 너비
 * @param {number} [elementHeight=0] - 요소 높이
 * @returns {Object} 제한된 위치
 * @returns {number} returns.x - 제한된 X 좌표
 * @returns {number} returns.y - 제한된 Y 좌표
 */
export const constrainToViewport = (x, y, elementWidth = 0, elementHeight = 0) => {
  try {
    if (typeof x !== 'number' || typeof y !== 'number') {
      console.warn('constrainToViewport: 유효하지 않은 좌표입니다', { x, y });
      return { x: 0, y: 0 };
    }
    
    if (typeof elementWidth !== 'number' || typeof elementHeight !== 'number') {
      console.warn('constrainToViewport: 유효하지 않은 요소 크기입니다', { elementWidth, elementHeight });
      return { x: 0, y: 0 };
    }
    
    const { viewportWidth, viewportHeight, scrollX, scrollY } = getViewportInfo();
    
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      console.warn('constrainToViewport: 유효하지 않은 뷰포트 크기입니다', { viewportWidth, viewportHeight });
      return { x: 0, y: 0 };
    }
    
    const constrainedX = Math.max(
      scrollX,
      Math.min(x, viewportWidth + scrollX - elementWidth)
    );
    const constrainedY = Math.max(
      scrollY,
      Math.min(y, viewportHeight + scrollY - elementHeight)
    );
    
    return { x: constrainedX, y: constrainedY };
  } catch (error) {
    console.error('constrainToViewport 실패:', error, { x, y, elementWidth, elementHeight });
    return { x: 0, y: 0 };
  }
};

/**
 * 캐시를 무효화하는 함수 (윈도우 리사이즈 등에서 호출)
 * @description 컨테이너와 뷰포트 캐시를 초기화하여 다음 호출 시 새로운 값을 가져오도록 함
 */
export const invalidateCache = () => {
  containerCache = null;
  viewportCache = null;
  cacheTimestamp = 0;
};

/**
 * 캐시 상태를 확인하는 함수 (디버깅용)
 * @returns {Object} 캐시 상태 정보
 * @returns {boolean} returns.containerCache - 컨테이너 캐시 존재 여부
 * @returns {boolean} returns.viewportCache - 뷰포트 캐시 존재 여부
 * @returns {number} returns.cacheAge - 캐시 생성 후 경과 시간 (ms)
 * @returns {boolean} returns.isValid - 캐시 유효성 여부
 */
export const getCacheStatus = () => {
  const now = Date.now();
  return {
    containerCache: !!containerCache,
    viewportCache: !!viewportCache,
    cacheAge: now - cacheTimestamp,
    isValid: (now - cacheTimestamp) < CACHE_DURATION
  };
};

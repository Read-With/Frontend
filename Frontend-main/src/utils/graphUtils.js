/**
 * graphUtils.js : Cytoscape 그래프 관련 유틸리티 함수 모음
 * 
 * [주요 기능]
 * 1. 좌표 변환: Cytoscape 좌표 ↔ DOM 좌표 상호 변환
 * 2. 뷰포트 관리: 컨테이너 및 뷰포트 정보 캐싱 (100ms)
 * 3. 위치 제약: 요소를 화면 경계 내로 제한
 * 4. 이벤트 처리: 마우스 이벤트 핸들러 생성 및 관리
 * 5. UI 효과: 리플 애니메이션 생성
 * 6. 데이터 처리: 툴팁 데이터 정규화 (API 응답 → 컴포넌트)
 * 
 * [성능 최적화]
 * - DOM 조회 결과를 100ms 동안 캐싱하여 불필요한 재계산 방지
 * - 리사이즈 이벤트 디바운싱으로 과도한 재계산 방지
 * - 노드 수 제한으로 대규모 그래프 성능 보장
 * 
 * [사용처]
 * - CytoscapeGraphUnified: 그래프 렌더링 및 상호작용
 * - RelationGraphWrapper: 관계 그래프 툴팁 처리
 * - ViewerPage: 뷰어 페이지 툴팁 처리
 * - useTooltipPosition: 툴팁 위치 계산
 * - useGraphInteractions: 그래프 상호작용 로직
 */

const GRAPH_CONTAINER_SELECTOR = '.graph-canvas-area';

// 성능 최적화를 위한 캐시 (단일 객체로 관리)
const cache = {
  container: { data: null, timestamp: 0 },
  viewport: { data: null, timestamp: 0 }
};
const CACHE_DURATION = 100;

export const getContainerInfo = () => {
  try {
    const now = Date.now();
    
    // 캐시가 유효한지 확인
    if (cache.container.data && (now - cache.container.timestamp) < CACHE_DURATION) {
      return cache.container.data;
    }
    
    const container = document.querySelector(GRAPH_CONTAINER_SELECTOR);
    if (!container) {
      console.warn(`getContainerInfo: 그래프 컨테이너를 찾을 수 없습니다 (${GRAPH_CONTAINER_SELECTOR})`);
      const result = { container: null, containerRect: { left: 0, top: 0 } };
      cache.container.data = result;
      cache.container.timestamp = now;
      return result;
    }
    
    const containerRect = container.getBoundingClientRect();
    if (!containerRect) {
      console.warn('getContainerInfo: 컨테이너의 getBoundingClientRect()가 실패했습니다');
      const result = { container, containerRect: { left: 0, top: 0 } };
      cache.container.data = result;
      cache.container.timestamp = now;
      return result;
    }
    
    const result = { container, containerRect };
    cache.container.data = result;
    cache.container.timestamp = now;
    return result;
  } catch (error) {
    console.error('getContainerInfo 실패:', error, { selector: GRAPH_CONTAINER_SELECTOR });
    const result = { container: null, containerRect: { left: 0, top: 0 } };
    cache.container.data = result;
    cache.container.timestamp = Date.now();
    return result;
  }
};

export const getViewportInfo = () => {
  try {
    const now = Date.now();
    
    // 캐시가 유효한지 확인
    if (cache.viewport.data && (now - cache.viewport.timestamp) < CACHE_DURATION) {
      return cache.viewport.data;
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
    cache.viewport.data = result;
    cache.viewport.timestamp = now;
    return result;
  } catch (error) {
    console.error('getViewportInfo 실패:', error);
    const result = { viewportWidth: 0, viewportHeight: 0, scrollX: 0, scrollY: 0 };
    cache.viewport.data = result;
    cache.viewport.timestamp = Date.now();
    return result;
  }
};

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

export const invalidateCache = () => {
  cache.container.data = null;
  cache.container.timestamp = 0;
  cache.viewport.data = null;
  cache.viewport.timestamp = 0;
};

// 윈도우 리사이즈 시 캐시 자동 무효화
if (typeof window !== 'undefined') {
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      invalidateCache();
    }, 100);
  });
}

export const getCacheStatus = () => {
  const now = Date.now();
  return {
    hasContainerCache: !!cache.container.data,
    hasViewportCache: !!cache.viewport.data,
    containerCacheAge: now - cache.container.timestamp,
    viewportCacheAge: now - cache.viewport.timestamp,
    isContainerCacheValid: (now - cache.container.timestamp) < CACHE_DURATION,
    isViewportCacheValid: (now - cache.viewport.timestamp) < CACHE_DURATION
  };
};

export const createRippleEffect = (container, x, y, cyRef, duration = 500) => {
  if (!container) {
    console.warn('createRippleEffect: 컨테이너가 없습니다');
    return () => {};
  }
  
  if (typeof x !== 'number' || typeof y !== 'number') {
    console.warn('createRippleEffect: 유효하지 않은 좌표입니다', { x, y });
    return () => {};
  }
  
  const ripple = document.createElement('div');
  ripple.className = 'ripple-effect';
  ripple.style.position = 'absolute';
  
  let domX, domY;
  if (cyRef?.current) {
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    
    // Cytoscape 좌표를 DOM 좌표로 정확히 변환
    domX = x * zoom + pan.x;
    domY = y * zoom + pan.y;
  } else {
    domX = x;
    domY = y;
  }
  
  ripple.style.left = `${domX - 50}px`;
  ripple.style.top = `${domY - 50}px`;
  ripple.style.pointerEvents = 'none';
  ripple.style.zIndex = '1000';
  
  container.appendChild(ripple);

  let timeoutId = null;
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    if (ripple.parentNode) {
      ripple.parentNode.removeChild(ripple);
    }
  };

  timeoutId = setTimeout(cleanup, duration);
  
  return cleanup;
};

export const ensureElementsInBounds = (cy, container, maxNodes = 1000) => {
  if (!cy || !container) return;
  
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const padding = 100;
  
  const bounds = {
    left: -containerWidth / 2 + padding,
    right: containerWidth / 2 - padding,
    top: -containerHeight / 2 + padding,
    bottom: containerHeight / 2 - padding
  };
  
  let needsAdjustment = false;
  const nodes = cy.nodes();
  const nodeCount = nodes.length;
  
  // 성능 최적화: 노드가 많을 경우 처리 제한
  if (nodeCount > maxNodes) {
    console.warn(`ensureElementsInBounds: 노드 수(${nodeCount}개)가 많아 상위 ${maxNodes}개만 처리합니다`);
  }
  
  // 배치 처리로 성능 최적화
  cy.batch(() => {
    const nodesToProcess = nodeCount > maxNodes ? nodes.slice(0, maxNodes) : nodes;
    
    nodesToProcess.forEach(node => {
      const pos = node.position();
      let newX = pos.x;
      let newY = pos.y;
      
      if (pos.x < bounds.left) {
        newX = bounds.left;
        needsAdjustment = true;
      } else if (pos.x > bounds.right) {
        newX = bounds.right;
        needsAdjustment = true;
      }
      
      if (pos.y < bounds.top) {
        newY = bounds.top;
        needsAdjustment = true;
      } else if (pos.y > bounds.bottom) {
        newY = bounds.bottom;
        needsAdjustment = true;
      }
      
      if (newX !== pos.x || newY !== pos.y) {
        node.position({ x: newX, y: newY });
      }
    });
  });
  
  // 조정이 필요한 경우 레이아웃을 다시 실행
  if (needsAdjustment) {
    cy.layout({ name: 'preset' }).run();
  }
};

export const createMouseEventHandlers = (cy, container) => {
  const CLICK_THRESHOLD = 200;
  const MOVE_THRESHOLD = 3;
  
  const isDraggingRef = { current: false };
  const prevMouseDownPositionRef = { current: { x: 0, y: 0 } };
  const mouseDownTimeRef = { current: 0 };
  const hasMovedRef = { current: false };
  const isMouseDownRef = { current: false };
  
  const handleMouseDown = (evt) => {
    if (evt.target !== evt.currentTarget) return;
    
    isMouseDownRef.current = true;
    mouseDownTimeRef.current = Date.now();
    prevMouseDownPositionRef.current = { x: evt.clientX, y: evt.clientY };
    hasMovedRef.current = false;
    isDraggingRef.current = false;
  };
  
  const handleMouseMove = (evt) => {
    if (!isMouseDownRef.current) return;
    
    const deltaX = Math.abs(evt.clientX - prevMouseDownPositionRef.current.x);
    const deltaY = Math.abs(evt.clientY - prevMouseDownPositionRef.current.y);
    
    if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
      hasMovedRef.current = true;
      isDraggingRef.current = true;
    }
  };
  
  const handleMouseUp = (evt) => {
    if (!isMouseDownRef.current) return;
    
    const clickDuration = Date.now() - mouseDownTimeRef.current;
    const isClick = clickDuration < CLICK_THRESHOLD && !hasMovedRef.current;
    
    if (isDraggingRef.current) {
      isMouseDownRef.current = false;
      mouseDownTimeRef.current = 0;
      hasMovedRef.current = false;
      isDraggingRef.current = false;
      return;
    }
    
    isMouseDownRef.current = false;
    mouseDownTimeRef.current = 0;
    hasMovedRef.current = false;
    isDraggingRef.current = false;
  };
  
  const cleanup = () => {
    isDraggingRef.current = false;
    prevMouseDownPositionRef.current = { x: 0, y: 0 };
    mouseDownTimeRef.current = 0;
    hasMovedRef.current = false;
    isMouseDownRef.current = false;
  };
  
  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isDraggingRef,
    isMouseDownRef,
    cleanup
  };
};

export const processTooltipData = (tooltipData, type) => {
  if (!tooltipData) return null;
  
  try {
    if (type === 'node') {
      const nodeData = tooltipData;
      
      // API 데이터의 names 필드 처리
      let names = nodeData.names;
      if (typeof names === "string") {
        try { 
          names = JSON.parse(names); 
        } catch { 
          names = [names]; 
        }
      }
      
      // main_character 필드 처리 (boolean으로 정규화)
      let mainCharacter = nodeData.main_character ?? nodeData.main;
      if (typeof mainCharacter === "string") {
        mainCharacter = mainCharacter === "true";
      }
      mainCharacter = !!mainCharacter;
      
      return {
        ...tooltipData,
        names: names,
        main_character: mainCharacter,
        common_name: nodeData.common_name || nodeData.label,
        description: nodeData.description || '',
        description_ko: nodeData.description_ko || '',
        image: nodeData.image || '',
        weight: nodeData.weight || 1
      };
      
    } else if (type === 'edge') {
      const edgeData = tooltipData;
      
      // API 데이터의 relation 필드 처리
      let relation = edgeData.data?.relation;
      if (typeof relation === "string") {
        try { 
          relation = JSON.parse(relation); 
        } catch { 
          relation = [relation]; 
        }
      }
      
      // 기본값 설정
      const defaultLabel = Array.isArray(relation) && relation.length > 0 
        ? relation[0] 
        : (typeof relation === 'string' ? relation : '');
      
      return {
        ...tooltipData,
        data: {
          ...edgeData.data,
          relation: relation,
          label: edgeData.data?.label || defaultLabel,
          positivity: edgeData.data?.positivity ?? 0,
          count: edgeData.data?.count ?? 1
        }
      };
      
    } else {
      return tooltipData;
    }
  } catch (error) {
    console.error('processTooltipData 실패:', error);
    return tooltipData;
  }
};
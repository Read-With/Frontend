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

/**
 * Ripple 효과 생성 함수 - 확대/축소 상태 고려
 * @param {Element} container - 컨테이너 DOM 요소
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {Object} cyRef - Cytoscape 인스턴스 참조
 * @returns {Function} 정리 함수 (메모리 누수 방지)
 */
export const createRippleEffect = (container, x, y, cyRef) => {
  if (!container) return () => {};
  
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

  const cleanup = () => {
    if (ripple.parentNode) {
      ripple.parentNode.removeChild(ripple);
    }
  };

  setTimeout(cleanup, 500);
  
  return cleanup;
};

/**
 * 요소들이 화면 경계 내에 있는지 확인하고 조정하는 함수
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Element} container - 컨테이너 DOM 요소
 * @param {number} [maxNodes=1000] - 최대 처리할 노드 수 (성능 최적화)
 */
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
  
  // 성능 최적화: 노드가 많을 경우 배치 처리
  if (nodeCount > maxNodes) {
    console.warn(`ensureElementsInBounds: 노드 수가 많아 성능에 영향을 줄 수 있습니다 (${nodeCount}개)`);
  }
  
  // 배치 처리로 성능 최적화
  cy.batch(() => {
    nodes.forEach(node => {
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

/**
 * 마우스 이벤트 핸들러 생성 함수
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Element} container - 컨테이너 DOM 요소
 * @returns {Object} 마우스 이벤트 핸들러들
 */
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
  
  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isDraggingRef,
    isMouseDownRef
  };
};

/**
 * 툴팁 데이터 처리 함수 (RelationGraphWrapper와 ViewerPage에서 공통 사용)
 * @param {Object} tooltipData - 원본 툴팁 데이터
 * @param {string} type - 툴팁 타입 ('node' 또는 'edge')
 * @returns {Object} 처리된 툴팁 데이터
 */
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
      
      // main_character 필드 처리
      let main = nodeData.main_character;
      if (typeof main === "string") {
        main = main === "true";
      }
      
      return {
        ...tooltipData,
        names: names,
        main_character: main,
        // 기존 필드명과 호환성을 위한 매핑
        main: main,
        common_name: nodeData.common_name || nodeData.label,
        description: nodeData.description || '',
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
      
      return {
        ...tooltipData,
        data: {
          ...edgeData.data,
          relation: relation,
          // 기존 필드명과 호환성을 위한 매핑
          label: edgeData.data?.label || (Array.isArray(relation) ? relation[0] : relation),
          positivity: edgeData.data?.positivity || 0,
          count: edgeData.data?.count || 1
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

/**
 * 기본 스타일시트 생성 함수 (간단한 그래프용)
 * @param {Object} edgeStyle - 엣지 스타일 객체
 * @param {string} edgeStyle.lineColor - 선 색상
 * @param {string} edgeStyle.arrowColor - 화살표 색상  
 * @param {string} edgeStyle.arrowShape - 화살표 모양
 * @param {boolean} edgeLabelVisible - 엣지 라벨 표시 여부
 * @returns {Array} Cytoscape 스타일시트 배열
 */
export const createBasicStylesheet = (edgeStyle = {}, edgeLabelVisible = true) => {
  const defaultEdgeStyle = {
    lineColor: '#666',
    arrowColor: '#666', 
    arrowShape: 'triangle',
    ...edgeStyle
  };

  return [
    {
      selector: 'node',
      style: {
        'width': 'mapData(weight, 0, 5, 20, 60)',
        'height': 'mapData(weight, 0, 5, 20, 60)',
        'content': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'color': '#333',
        'background-color': '#fff',
        'border-width': '2px',
        'border-color': '#666',
        'border-style': 'solid',
        'text-outline-width': '1px',
        'text-outline-color': '#fff'
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 'mapData(weight, 0, 5, 1, 8)',
        'line-color': defaultEdgeStyle.lineColor,
        'target-arrow-color': defaultEdgeStyle.arrowColor,
        'target-arrow-shape': defaultEdgeStyle.arrowShape,
        'curve-style': 'bezier',
        'label': edgeLabelVisible ? 'data(label)' : '',
        'font-size': '10px',
        'font-weight': 'normal',
        'color': '#666',
        'text-outline-width': '1px',
        'text-outline-color': '#fff',
        'text-rotation': 'autorotate',
        'text-margin-y': '-10px'
      }
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': '#ff6b6b',
        'border-color': '#ff5252',
        'border-width': '3px'
      }
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': '#ff6b6b',
        'target-arrow-color': '#ff6b6b',
        'width': 'mapData(weight, 0, 5, 2, 10)'
      }
    }
  ];
};

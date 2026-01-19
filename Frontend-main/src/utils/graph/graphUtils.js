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

const validateCytoscapeRef = (cyRef) => {
  if (!cyRef?.current) {
    return { valid: false, cy: null };
  }
  return { valid: true, cy: cyRef.current };
};

const validatePan = (pan) => {
  if (!pan || typeof pan.x !== 'number' || typeof pan.y !== 'number') {
    return false;
  }
  return true;
};

const validateZoom = (zoom) => {
  if (typeof zoom !== 'number' || zoom <= 0) {
    return false;
  }
  return true;
};

const validatePosition = (pos) => {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
    return false;
  }
  return true;
};

const parseJsonSafely = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return [value];
  }
};

const resetMouseState = (refs) => {
  if (refs.isMouseDownRef) refs.isMouseDownRef.current = false;
  if (refs.mouseDownTimeRef) refs.mouseDownTimeRef.current = 0;
  if (refs.hasMovedRef) refs.hasMovedRef.current = false;
  if (refs.isDraggingRef) refs.isDraggingRef.current = false;
};

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
    const { valid, cy } = validateCytoscapeRef(cyRef);
    if (!valid) {
      console.warn('calculateCytoscapePosition: cyRef.current가 없습니다');
      return { x: 0, y: 0 };
    }
    
    if (!validatePosition(pos)) {
      console.warn('calculateCytoscapePosition: 유효하지 않은 pos 객체입니다', pos);
      return { x: 0, y: 0 };
    }
    
    const pan = cy.pan();
    const zoom = cy.zoom();
    const { containerRect } = getContainerInfo();
    
    if (!validatePan(pan)) {
      console.warn('calculateCytoscapePosition: 유효하지 않은 pan 값입니다', pan);
      return { x: 0, y: 0 };
    }
    
    if (!validateZoom(zoom)) {
      console.warn('calculateCytoscapePosition: 유효하지 않은 zoom 값입니다', zoom);
      return { x: 0, y: 0 };
    }
    
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
    const { valid, cy } = validateCytoscapeRef(cyRef);
    if (!valid) {
      console.warn('convertMouseToCytoscapePosition: cyRef.current가 없습니다');
      return { x: 0, y: 0 };
    }
    
    if (!evt || typeof evt.clientX !== 'number' || typeof evt.clientY !== 'number') {
      console.warn('convertMouseToCytoscapePosition: 유효하지 않은 이벤트 객체입니다', evt);
      return { x: 0, y: 0 };
    }
    
    const { container, containerRect } = getContainerInfo();
    
    if (!container) {
      console.warn('convertMouseToCytoscapePosition: 그래프 컨테이너를 찾을 수 없습니다');
      return { x: 0, y: 0 };
    }
    
    const clientX = evt.clientX - containerRect.left;
    const clientY = evt.clientY - containerRect.top;
    
    const pan = cy.pan();
    const zoom = cy.zoom();
    
    if (!validatePan(pan)) {
      console.warn('convertMouseToCytoscapePosition: 유효하지 않은 pan 값입니다', pan);
      return { x: 0, y: 0 };
    }
    
    if (!validateZoom(zoom)) {
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
      const constrainedX = Math.max(bounds.left, Math.min(pos.x, bounds.right));
      const constrainedY = Math.max(bounds.top, Math.min(pos.y, bounds.bottom));
      
      if (constrainedX !== pos.x || constrainedY !== pos.y) {
        needsAdjustment = true;
        node.position({ x: constrainedX, y: constrainedY });
      }
    });
  });
  
  // 조정이 필요한 경우 레이아웃을 다시 실행
  if (needsAdjustment) {
    cy.layout({ name: 'preset' }).run();
  }
};

export const createMouseEventHandlers = (cy, container) => {
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
    
    if (isDraggingRef.current) {
      resetMouseState({
        isMouseDownRef,
        mouseDownTimeRef,
        hasMovedRef,
        isDraggingRef
      });
      return;
    }
    
    resetMouseState({
      isMouseDownRef,
      mouseDownTimeRef,
      hasMovedRef,
      isDraggingRef
    });
  };
  
  const cleanup = () => {
    resetMouseState({
      isMouseDownRef,
      mouseDownTimeRef,
      hasMovedRef,
      isDraggingRef
    });
    prevMouseDownPositionRef.current = { x: 0, y: 0 };
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
      
      const names = parseJsonSafely(nodeData.names);
      
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
      
      const relation = parseJsonSafely(edgeData.data?.relation);
      
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

/**
 * 챕터의 마지막 이벤트 번호를 계산합니다.
 * @param {Object} options - 계산 옵션
 * @param {boolean} options.isApiBook - API 책 여부
 * @param {Array} options.manifestChapters - Manifest 챕터 목록
 * @param {number} options.chapter - 챕터 번호
 * @param {string} options.filename - 파일명
 * @returns {number} 마지막 이벤트 번호 (기본값: 1)
 */
export const calculateLastEventForChapter = ({ 
  isApiBook, 
  manifestChapters, 
  chapter, 
  filename,
  getFolderKeyFromFilename,
  getLastEventIndexForChapter
}) => {
  if (isApiBook) {
    if (!manifestChapters) return 1;
    
    const chapterInfo = manifestChapters.find(ch => 
      ch.chapterIdx === chapter || 
      ch.chapter === chapter || 
      ch.index === chapter || 
      ch.number === chapter
    );
    
    if (!chapterInfo) return 1;
    
    let eventCount = chapterInfo.eventCount || chapterInfo.events || chapterInfo.event_count || 0;
    if (Array.isArray(eventCount)) {
      eventCount = eventCount.length;
    } else if (typeof eventCount !== 'number' || isNaN(eventCount)) {
      eventCount = 0;
    }
    
    return eventCount > 0 ? eventCount : 1;
  } else {
    if (!getFolderKeyFromFilename || !getLastEventIndexForChapter) {
      console.warn('calculateLastEventForChapter: 로컬 책 처리를 위한 함수가 제공되지 않았습니다');
      return 1;
    }
    
    const folderKey = getFolderKeyFromFilename(filename);
    if (!folderKey) return 1;
    
    const lastEventIndex = getLastEventIndexForChapter(folderKey, chapter);
    return lastEventIndex > 0 ? lastEventIndex : 1;
  }
};

/**
 * API 이벤트 객체를 정규화합니다.
 * @param {Object} apiEvent - API 이벤트 객체
 * @param {number} currentChapter - 현재 챕터
 * @param {number} currentEvent - 현재 이벤트
 * @returns {Object|null} 정규화된 이벤트 객체
 */
export const normalizeApiEvent = (apiEvent, currentChapter, currentEvent) => {
  if (!apiEvent) return null;
  
  return {
    chapter: apiEvent.chapterIdx ?? currentChapter,
    chapterIdx: apiEvent.chapterIdx ?? currentChapter,
    eventNum: apiEvent.event_id ?? (currentEvent - 1),
    event_id: apiEvent.event_id ?? (currentEvent - 1),
    start: apiEvent.start,
    end: apiEvent.end,
    ...apiEvent
  };
};

/**
 * API 캐릭터 데이터로부터 노드 가중치 맵을 생성합니다.
 * @param {Array} characters - 캐릭터 배열
 * @returns {Object} 노드 ID를 키로 하는 가중치 맵
 */
export const buildNodeWeights = (characters) => {
  if (!characters || !Array.isArray(characters)) return {};
  
  const nodeWeights = {};
  characters.forEach(char => {
    if (char.id !== undefined && char.weight !== undefined && char.weight > 0) {
      const nodeId = String(char.id);
      nodeWeights[nodeId] = {
        weight: char.weight,
        count: char.count || 1
      };
    }
  });
  
  return nodeWeights;
};

/**
 * 검색 파라미터를 포맷팅합니다.
 * @param {string} retainedSearch - 보존된 검색 파라미터
 * @returns {string} 포맷팅된 검색 파라미터
 */
export const formatSearchParams = (retainedSearch) => {
  if (!retainedSearch) return '';
  
  return retainedSearch.startsWith('?') ? retainedSearch : `?${retainedSearch}`;
};

/**
 * 이벤트가 사이드바 요소 내부인지 확인합니다.
 * @param {Event} event - DOM 이벤트
 * @returns {boolean} 사이드바 요소 내부 여부
 */
export const isSidebarElement = (event) => {
  const sidebarElement = document.querySelector('[data-testid="graph-sidebar"]') || 
                        document.querySelector('.graph-sidebar') ||
                        event.target.closest('[data-testid="graph-sidebar"]') ||
                        event.target.closest('.graph-sidebar');
  
  return sidebarElement && sidebarElement.contains(event.target);
};

/**
 * 서버 bookId를 해결합니다.
 * @param {Object} options - 해결 옵션
 * @param {Object} options.book - 책 객체
 * @param {number} options.bookId - 책 ID
 * @returns {number|null} 서버 bookId
 */
export const resolveServerBookId = ({ book, bookId }) => {
  if (book?.id && typeof book.id === 'number') {
    return book.id;
  }
  if (book?._bookId && typeof book._bookId === 'number') {
    return book._bookId;
  }
  if (Number.isFinite(bookId) && bookId > 0) {
    return bookId;
  }
  return null;
};

/**
 * 이벤트가 드래그 종료 이벤트인지 확인합니다.
 * @param {Event} event - DOM 이벤트
 * @returns {boolean} 드래그 종료 이벤트 여부
 */
export const isDragEndEvent = (event) => {
  return event.detail && event.detail.type === 'dragend';
};

export const sortElementsById = (elements) => {
  if (!elements || !Array.isArray(elements)) return [];
  return [...elements].sort((a, b) => {
    const aId = a.data?.id || '';
    const bId = b.data?.id || '';
    return aId.localeCompare(bId);
  });
};

export const calculateNodeCount = (elements, filterStage, filteredMainCharacters) => {
  if (filterStage > 0) {
    return filteredMainCharacters.filter(el => el.data && el.data.id && !el.data.source).length;
  }
  return elements.filter(el => el.data && el.data.id && !el.data.source).length;
};

export const calculateRelationCount = (elements, filterStage, filteredMainCharacters, eventUtils) => {
  if (filterStage > 0) {
    return eventUtils.filterEdges(filteredMainCharacters).length;
  }
  return eventUtils.filterEdges(elements).length;
};

export const determineFinalElements = (isSearchActive, filteredElements, sortedElements, filterStage, filteredMainCharacters) => {
  if (isSearchActive && filteredElements && filteredElements.length > 0) {
    return filteredElements;
  }
  if (filterStage > 0) {
    return filteredMainCharacters;
  }
  return sortedElements;
};
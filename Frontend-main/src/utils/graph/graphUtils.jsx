/** 그래프 요소 정규화·Cytoscape 좌표·뷰포트·툴팁 */

import {
  resolveLastEventIdxForFineGraph,
  getLastFineGraphEventIdxFromChapterData,
} from '../common/cache/manifestCache.js';
import {
  toFiniteNumber,
  toPositiveInt,
  toPositiveNumberOrNull,
} from '../common/numberUtils';

const API_PREFIX = 'api:';

export { toFiniteNumber, toPositiveInt };
export const toPositiveNumber = toPositiveNumberOrNull;

export const extractApiBookId = (folderKeyOrFilename) => {
  if (!folderKeyOrFilename) return null;
  if (typeof folderKeyOrFilename === 'number') {
    return toPositiveNumber(folderKeyOrFilename);
  }
  const key = String(folderKeyOrFilename).trim();
  if (!key) return null;
  return toPositiveNumber(key.startsWith(API_PREFIX) ? key.slice(API_PREFIX.length) : key);
};

export const toApiFolderKey = (folderKeyOrFilename) => {
  const bookId = extractApiBookId(folderKeyOrFilename);
  return bookId ? `${API_PREFIX}${bookId}` : null;
};

export const normalizeElementId = (element) => element?.id ?? element?.data?.id ?? null;

export const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

export const isGraphNodeElement = (element) =>
  Boolean(element?.data && element.data.id !== undefined && !isGraphEdgeElement(element));

export const sortElementsByDataId = (elements) => {
  if (!Array.isArray(elements)) return [];
  return [...elements].sort((a, b) =>
    String(a?.data?.id ?? '').localeCompare(String(b?.data?.id ?? ''))
  );
};

export const uniqueStrings = (values, { caseInsensitive = false } = {}) => {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const str = String(value ?? '').trim();
    const key = caseInsensitive ? str.toLowerCase() : str;
    if (!str || seen.has(key)) continue;
    seen.add(key);
    result.push(str);
  }
  return result;
};

const GRAPH_CONTAINER_SELECTOR = '.graph-canvas-area';

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
    const parsed = JSON.parse(value);
    return parsed;
  } catch {
    return value;
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
let resizeTimeout = null;

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      invalidateCache();
    }, 100);
  });
}

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
    const { containerRect } = getContainerInfo();
    
    // Cytoscape 좌표를 DOM 좌표로 정확히 변환 (calculateCytoscapePosition과 일관성 유지)
    domX = x * zoom + pan.x + containerRect.left;
    domY = y * zoom + pan.y + containerRect.top;
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
  
  if (containerWidth <= 0 || containerHeight <= 0) return;
  
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

export const isGraphContainerSizeReady = (container) => {
  if (!container) return false;
  const w = Number(container.clientWidth ?? 0);
  const h = Number(container.clientHeight ?? 0);
  return w > 0 && h > 0;
};

export const createMouseEventHandlers = (_cy, _container) => {
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
  
  const handleMouseUp = (_evt) => {
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
      const nodeFields = tooltipData.data ?? tooltipData;

      const names = parseJsonSafely(nodeFields.names);

      return {
        ...tooltipData,
        ...nodeFields,
        names,
        isMainCharacter: !!nodeFields.isMainCharacter,
        common_name: nodeFields.common_name || nodeFields.name || nodeFields.label,
        description: nodeFields.description || '',
        personalityText: nodeFields.personalityText || '',
        image: nodeFields.image || '',
        weight: nodeFields.weight || 1,
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

/** 챕터 마지막 이벤트 인덱스 (manifest 힌트, UI·범위용) */
export const calculateLastEventForChapter = ({
  manifestChapters,
  manifestBookId,
  chapter,
}) => {
  if (manifestBookId != null && Number.isFinite(Number(manifestBookId)) && Number(manifestBookId) > 0) {
    const manifestHint =
      Array.isArray(manifestChapters) && manifestChapters.length > 0
        ? { chapters: manifestChapters }
        : undefined;
    const fromManifest = resolveLastEventIdxForFineGraph(manifestBookId, chapter, manifestHint);
    if (fromManifest != null) {
      return fromManifest;
    }
  }

  if (!manifestChapters?.length) return 1;

  const chapterNum = Number(chapter);
  const chapterInfo = manifestChapters.find(
    (ch) => ch && typeof ch === 'object' && Number(ch.idx) === chapterNum
  );

  if (!chapterInfo) return 1;

  const resolved = getLastFineGraphEventIdxFromChapterData(chapterInfo);
  return resolved != null && resolved >= 1 ? resolved : 1;
};

export const isSidebarElement = (event) => {
  if (!event || !event.target) {
    return false;
  }
  
  const sidebarElement =
    document.querySelector('[data-testid="graph-sidebar"]') ||
    document.querySelector('[data-testid="chapter-sidebar"]') ||
    document.querySelector('.graph-sidebar') ||
    event.target.closest('[data-testid="graph-sidebar"]') ||
    event.target.closest('[data-testid="chapter-sidebar"]') ||
    event.target.closest('.graph-sidebar');
  
  return sidebarElement && sidebarElement.contains(event.target);
};

export const calculateNodeCount = (elements, filterStage, filteredMainCharacters) => {
  if (filterStage > 0) {
    return filteredMainCharacters.filter(isGraphNodeElement).length;
  }
  return elements.filter(isGraphNodeElement).length;
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

/** reciprocalPair 간선 쌍의 junction 오프셋(_rjOx/_rjOy) 동기화 */
export function syncReciprocalPairJunctionOffsets(cy) {
  if (!cy || typeof cy.edges !== 'function') return;
  let edges;
  try {
    edges = cy.edges('[?reciprocalPair]');
  } catch {
    return;
  }
  if (!edges || edges.length === 0) return;

  const pairMap = new Map();
  edges.forEach((e) => {
    const sid = String(e.data('source'));
    const tid = String(e.data('target'));
    const key = sid < tid ? `${sid}\t${tid}` : `${tid}\t${sid}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key).push(e);
  });

  cy.batch(() => {
    pairMap.forEach((list) => {
      if (list.length !== 2) {
        list.forEach((edge) => {
          edge.removeData('_rjOx');
          edge.removeData('_rjOy');
        });
        return;
      }
      const e0 = list[0];
      const s = e0.source();
      const t = e0.target();
      if (!s || !t || s.empty?.() || t.empty?.()) return;
      const sx = s.position('x');
      const sy = s.position('y');
      const tx = t.position('x');
      const ty = t.position('y');
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      list.forEach((edge) => {
        const tgt = edge.target();
        if (!tgt || tgt.empty?.()) return;
        edge.data('_rjOx', mx - tgt.position('x'));
        edge.data('_rjOy', my - tgt.position('y'));
      });
    });
  });
}

export function clearHighlightClassesOn(cy) {
  if (!cy) return;
  try {
    const touched = cy
      .collection()
      .union(cy.nodes(".highlighted"))
      .union(cy.nodes(".faded"))
      .union(cy.edges(".highlighted"))
      .union(cy.edges(".faded"));
    if (touched.length === 0) return;
    cy.batch(() => {
      touched.removeClass("highlighted faded");
      touched.nodes().forEach((node) => {
        node.removeStyle("opacity");
        node.removeStyle("text-opacity");
        node.removeStyle("border-color");
        node.removeStyle("border-width");
        node.removeStyle("border-opacity");
        node.removeStyle("border-style");
      });
      touched.edges().forEach((edge) => {
        edge.removeStyle("opacity");
        edge.removeStyle("text-opacity");
        edge.removeStyle("width");
      });
    });
  } catch {
    /* ignore */
  }
}

const PLACEMENT_NODE_SIZE = 40;
const PLACEMENT_MIN_DISTANCE = PLACEMENT_NODE_SIZE * 3.2;
const PLACEMENT_PADDING = 80;
const PLACEMENT_MIN_DIST_SQ = PLACEMENT_MIN_DISTANCE * PLACEMENT_MIN_DISTANCE;

const hasEnoughPlacementDistance = (candidate, positions) =>
  positions.every((pos) => {
    const dx = candidate.x - pos.x;
    const dy = candidate.y - pos.y;
    return dx * dx + dy * dy > PLACEMENT_MIN_DIST_SQ;
  });

const isWithinPlacementBounds = ({ x, y }, containerWidth, containerHeight) =>
  Math.abs(x) < containerWidth / 2 - PLACEMENT_PADDING &&
  Math.abs(y) < containerHeight / 2 - PLACEMENT_PADDING;

/** 신규 노드 스파이럴 배치 */
export function calculateSpiralPlacement(newNodes, placedPositions, containerWidth, containerHeight) {
  if (!newNodes?.length) return newNodes;

  const maxRadius = Math.min(containerWidth, containerHeight) / 2 - PLACEMENT_PADDING;
  const updatedPositions = [...placedPositions];

  newNodes.forEach((node) => {
    let found = false;
    let x;
    let y;
    let attempts = 0;
    const maxAttempts = 200;

    while (!found && attempts < maxAttempts) {
      const angle = (attempts * 0.5) % (2 * Math.PI);
      const radius = Math.min(50 + attempts * 2, maxRadius);
      const candidate = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      x = candidate.x;
      y = candidate.y;

      if (isWithinPlacementBounds(candidate, containerWidth, containerHeight)) {
        found = hasEnoughPlacementDistance(candidate, updatedPositions);
      }
      attempts += 1;
    }

    if (!found) {
      x = (Math.random() - 0.5) * 100;
      y = (Math.random() - 0.5) * 100;
    }

    node.position = { x, y };
    updatedPositions.push({ x, y });
  });

  return newNodes;
}

export function getContainerDimensions(container) {
  const width = container?.clientWidth || 800;
  const height = container?.clientHeight || 600;
  return { width, height, maxRadius: Math.min(width, height) / 2 - PLACEMENT_PADDING };
}

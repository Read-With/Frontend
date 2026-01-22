import React, { useEffect, useRef, useState, useCallback, createContext, useMemo } from "react";
import PropTypes from "prop-types";
import cytoscape from "cytoscape";
import "./RelationGraph.css";
import { detectAndResolveOverlap, calcGraphDiff } from "../../utils/graph/graphDataUtils.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../utils/searchUtils.jsx";
import { createRippleEffect, ensureElementsInBounds, createMouseEventHandlers } from "../../utils/graph/graphUtils.js";
import { calculateSpiralPlacement, getContainerDimensions } from "../../utils/graph/nodePlacementUtils.js";
import { calculateNodeSize } from "../../utils/styles/graphStyles.js";
import useGraphInteractions from "../../hooks/graph/useGraphInteractions.js";
import { useGraphLayout } from "../../hooks/graph/useGraphLayout.js";
import { eventUtils } from "../../utils/viewerUtils";

export const CytoscapeGraphContext = createContext();

// 정적 스타일 상수
const NO_RESULTS_CONTAINER_STYLE = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'rgba(255, 255, 255, 0.95)',
  padding: '20px 30px',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
  border: '1px solid #e3e6ef',
  zIndex: 1000,
  textAlign: 'center',
  maxWidth: '300px'
};

const NO_RESULTS_TITLE_STYLE = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#64748b',
  marginBottom: '8px'
};

const NO_RESULTS_DESCRIPTION_STYLE = {
  fontSize: '14px',
  color: '#94a3b8',
  lineHeight: '1.4'
};

const CytoscapeGraphUnified = ({
  elements,
  stylesheet,
  layout,
  tapNodeHandler,  
  tapEdgeHandler,
  tapBackgroundHandler,
  fitNodeIds, 
  style = {},
  cyRef: externalCyRef,
  newNodeIds = [],
  onLayoutComplete,
  searchTerm = "",
  isSearchActive = false,
  filteredElements = [],
  isResetFromSearch = false,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
  showRippleEffect = true,
  isDropdownSelection = false,
  isDataRefreshing = false,
  currentChapter,
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const previousElementsRef = useRef([]);
  const prevChapterRef = useRef(currentChapter ?? window.currentChapter);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const addedNodeIdsRef = useRef(new Set());
  
  // cy 인스턴스 가져오기 (통합)
  const getCyInstance = useCallback(() => {
    const cy = externalCyRef?.current;
    if (!cy || typeof cy.container !== 'function') return null;
    return cy;
  }, [externalCyRef]);

  // 안전한 Cytoscape 작업 실행 헬퍼
  const safeCyOperation = useCallback((operation, errorMessage) => {
    try {
      return operation();
    } catch (error) {
      console.error(errorMessage, error);
      return null;
    }
  }, []);

  // 유틸리티 함수 (useCallback 불필요)
  const isEmpty = (arr) => !arr || arr.length === 0;
  const isEmptyElements = () => previousElementsRef.current.length === 0;
  const resetPreviousElements = () => {
    previousElementsRef.current = [];
    addedNodeIdsRef.current = new Set();
  };

  // 스타일시트 업데이트 헬퍼
  const updateStylesheet = useCallback((cy) => {
    if (!cy || !stylesheet) return;
    
    return safeCyOperation(() => {
      cy.style(stylesheet);
      cy.style().update();
      requestAnimationFrame(() => {
        safeCyOperation(() => {
          cy.style().update();
        }, '❌ 스타일시트 업데이트 실패');
      });
      return true;
    }, '❌ 스타일시트 적용 실패');
  }, [stylesheet, safeCyOperation]);

  // 노드 크기 적용 헬퍼
  const applyNodeSizes = useCallback((cy, nodes, scale = 1) => {
    if (!cy || !nodes) return;
    nodes.forEach(node => {
      const weight = node.data('weight');
      const size = calculateNodeSize(8, weight) * scale;
      node.style({
        'width': size,
        'height': size
      });
    });
  }, []);

  // 추가된 노드에 대한 ripple 효과 트리거
  const triggerRippleForAddedNodes = useCallback(() => {
    const cy = getCyInstance();
    if (!cy) return;

    if (isInitialLoad || isResetFromSearch) {
      return;
    }

    const recentlyAddedIds = addedNodeIdsRef.current;
    if (!recentlyAddedIds || recentlyAddedIds.size === 0) {
      return;
    }

    recentlyAddedIds.forEach(nodeId => {
      const cyNode = cy.getElementById(nodeId);
      if (cyNode && cyNode.length > 0) {
        const position = cyNode.renderedPosition();
        if (position && typeof position.x === 'number' && typeof position.y === 'number') {
          createRippleEffect(containerRef.current, position.x, position.y, null);
        }
      }
    });

    addedNodeIdsRef.current = new Set();
  }, [getCyInstance, isInitialLoad, isResetFromSearch]);

  // ripple 효과 래퍼 생성
  const createRippleWrapper = useCallback((originalHandler) => {
    return (evt) => {
      const cy = getCyInstance();
      if (showRippleEffect && !isDropdownSelection && containerRef.current && cy) {
        let x, y;
        
        if (evt.renderedPosition) {
          x = evt.renderedPosition.x;
          y = evt.renderedPosition.y;
        } else if (evt.originalEvent) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const clientX = evt.originalEvent.clientX - containerRect.left;
          const clientY = evt.originalEvent.clientY - containerRect.top;
          
          const pan = cy.pan();
          const zoom = cy.zoom();
          x = (clientX - pan.x) / zoom;
          y = (clientY - pan.y) / zoom;
        }
        
        if (x !== undefined && y !== undefined) {
          createRippleEffect(containerRef.current, x, y, cy);
        }
      }
      
      if (originalHandler) {
        originalHandler(evt);
      }
    };
  }, [getCyInstance, showRippleEffect, isDropdownSelection]);
  
  // 마우스 이벤트 상태는 createMouseEventHandlers에서 관리

  const {
    tapNodeHandler: hookTapNodeHandler,
    tapEdgeHandler: hookTapEdgeHandler,
    tapBackgroundHandler: hookTapBackgroundHandler,
  } = useGraphInteractions({
    cyRef: externalCyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear,
    isSearchActive,
    filteredElements,
  });

  // 챕터 변경 감지 및 요소 diff 계산
  useEffect(() => {
    if (isEmpty(elements)) {
      if (!isDataRefreshing) {
        resetPreviousElements();
      }
      return;
    }

    const cy = getCyInstance();
    if (!cy) return;

    // 챕터 변경 확인
    const chapter = currentChapter ?? window.currentChapter;
    if (chapter !== undefined && chapter !== prevChapterRef.current) {
      setIsInitialLoad(true);
      resetPreviousElements();
      prevChapterRef.current = chapter;
    }

    // 초기 로드 시 요소 저장만 수행
    if (isEmptyElements()) {
      previousElementsRef.current = elements;
      addedNodeIdsRef.current = new Set();
      return;
    }

    // 요소 diff 계산
    const diff = safeCyOperation(
      () => calcGraphDiff(previousElementsRef.current, elements),
      '❌ 그래프 diff 계산 실패'
    );

    if (diff) {
      const addedNodeIds = diff.added
        ? eventUtils.filterNodes(diff.added).map(element => element.data.id).filter(Boolean)
        : [];

      addedNodeIdsRef.current = new Set(addedNodeIds);
      previousElementsRef.current = elements;
    }
  }, [elements, isDataRefreshing, currentChapter, safeCyOperation]);

  // Cytoscape 인스턴스 생성
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    
    let cyInstance;
    
    try {
      cyInstance = externalCyRef?.current;
      if (!cyInstance || typeof cyInstance.container !== 'function') {
        cyInstance = cytoscape({
          container: containerRef.current,
          elements: [],
          style: stylesheet,
          layout: { name: "preset" },
          userZoomingEnabled: true,
          userPanningEnabled: true,
          minZoom: 0.2,
          maxZoom: 2.4,
          wheelSensitivity: 0.4,
          autoungrabify: false,
          autolock: false,
          autounselectify: false,
          selectionType: 'single',
          touchTapThreshold: 8,
          desktopTapThreshold: 4,
        });
        if (externalCyRef) externalCyRef.current = cyInstance;
      } else {
        if (cyInstance.container() !== containerRef.current) {
          cyInstance.mount(containerRef.current);
        }
      }
    } catch (error) {
      console.error('❌ Cytoscape 인스턴스 생성 실패:', error);
      return;
    }
    
    if (!cyInstance) {
      console.error('❌ Cytoscape 인스턴스가 생성되지 않음');
      return;
    }
    
    const cy = cyInstance;
    
    if (!cy || !cy.container()) {
      console.error('❌ Cytoscape 인스턴스 마운트 실패');
      return;
    }
    
    // 공통 마우스 이벤트 핸들러 생성
    const container = containerRef.current;
    const mouseHandlers = createMouseEventHandlers(cy, container);
    const { handleMouseDown, handleMouseMove, handleMouseUp, isDraggingRef } = mouseHandlers;
    
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    
    const handleDragFreeOn = () => {
      setTimeout(() => {
        detectAndResolveOverlap(cy);
      }, 50);
    };

    const handleDrag = (evt) => {
      const node = evt.target;
      node.style('transition-property', 'none');
      isDraggingRef.current = true;
    };

    const handleDragFree = (evt) => {
      const node = evt.target;
      node.style('transition-property', 'position');
      
      // 드래그 완료 이벤트 발생
      const dragEndEvent = new CustomEvent('graphDragEnd', {
        detail: { type: 'graphDragEnd', timestamp: Date.now() }
      });
      document.dispatchEvent(dragEndEvent);
      
      isDraggingRef.current = false;
    };

    cy.on('dragfreeon', 'node', handleDragFreeOn);
    cy.on('drag', 'node', handleDrag);
    cy.on('dragfree', 'node', handleDragFree);
    
    return () => {
      cy.removeListener('dragfreeon', 'node', handleDragFreeOn);
      cy.removeListener('drag', 'node', handleDrag);
      cy.removeListener('dragfree', 'node', handleDragFree);
      
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
    };
  }, [externalCyRef]);

  // 배경 탭 핸들러
  const handleBackgroundTap = useCallback((evt) => {
    const cy = getCyInstance();
    if (!cy || evt.target !== cy) return;
    
    const bgHandler = tapBackgroundHandler || hookTapBackgroundHandler;
    if (bgHandler) {
      createRippleWrapper(bgHandler)(evt);
    }
  }, [getCyInstance, tapBackgroundHandler, hookTapBackgroundHandler, createRippleWrapper]);

  // 이벤트 핸들러 등록
  useEffect(() => {
    const cy = getCyInstance();
    if (!cy) return;
    
    const nodeHandler = tapNodeHandler || hookTapNodeHandler;
    const edgeHandler = tapEdgeHandler || hookTapEdgeHandler;
    
    // 기존 리스너 제거
    cy.off('tap');
    
    // 새 리스너 등록
    if (nodeHandler) {
      cy.on("tap", "node", createRippleWrapper(nodeHandler));
    }
    if (edgeHandler) {
      cy.on("tap", "edge", createRippleWrapper(edgeHandler));
    }
    cy.on("tap", handleBackgroundTap);
    
    return () => {
      cy.off('tap');
    };
  }, [getCyInstance, tapNodeHandler, tapEdgeHandler, hookTapNodeHandler, hookTapEdgeHandler, createRippleWrapper, handleBackgroundTap]);

  // 요소 업데이트 및 노드 배치
  const elementsUpdateRef = useRef({ nodesToAdd: [], edgesToAdd: [], hasChanges: false });

  useEffect(() => {
    const cy = getCyInstance();
    if (!cy) return;

    if (isEmpty(elements)) {
      if (!isDataRefreshing) {
        cy.elements().remove();
        setIsGraphVisible(false);
      }
      elementsUpdateRef.current = { nodesToAdd: [], edgesToAdd: [], hasChanges: false };
      return;
    }

    if (isEmptyElements()) {
      previousElementsRef.current = elements;
    }

    cy.batch(() => {
      const prevNodeIds = new Set(cy.nodes().map(n => n.id()));
      const prevEdgeIds = new Set(cy.edges().map(e => e.id()));
      const nextNodeIds = new Set(elements.filter(e => !e.data.source).map(e => e.data.id));
      const nextEdgeIds = new Set(elements.filter(e => e.data.source).map(e => e.data.id));
      
      cy.nodes().forEach(n => { if (!nextNodeIds.has(n.id())) n.remove(); });
      cy.edges().forEach(e => { if (!nextEdgeIds.has(e.id())) e.remove(); });
      
      const nodes = eventUtils.filterNodes(elements);
      const edges = eventUtils.filterEdges(elements);
      
      const placedPositions = nodes
        .filter(node => prevNodeIds.has(node.data.id) && node.position)
        .map(node => node.position);
      const nodesToAdd = nodes.filter(node => !prevNodeIds.has(node.data.id));
      const edgesToAdd = edges.filter(edge => !prevEdgeIds.has(edge.data.id));
      
      const { width: containerWidth, height: containerHeight } = getContainerDimensions(containerRef.current);
      if (nodesToAdd.length > 0) {
        calculateSpiralPlacement(nodesToAdd, placedPositions, containerWidth, containerHeight);
      }
      
      if (nodesToAdd.length > 0) {
        cy.add(nodesToAdd);
      }
      if (edgesToAdd.length > 0) {
        cy.add(edgesToAdd);
      }
      
      elementsUpdateRef.current = {
        nodesToAdd,
        edgesToAdd,
        hasChanges: nodesToAdd.length > 0 || edgesToAdd.length > 0
      };
    });

    setIsGraphVisible(true);
  }, [elements, isDataRefreshing]);

  // 레이아웃 및 스타일 적용 (커스텀 훅으로 분리)
  const cy = getCyInstance();
  useGraphLayout({
    cy,
    elements,
    stylesheet,
    layout,
    elementsUpdateRef,
    updateStylesheet,
    applyNodeSizes,
    triggerRippleForAddedNodes,
    onLayoutComplete,
    isInitialLoad,
    setIsInitialLoad,
    containerRef,
  });

  // 검색 fit 처리
  useEffect(() => {
    const cy = getCyInstance();
    if (!cy || isEmpty(elements)) return;

    cy.batch(() => {
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) {
          cy.fit(nodes, 60);
          cy.nodes().removeClass('search-highlight');
          nodes.addClass('search-highlight');
          applyNodeSizes(cy, nodes, 1.2);
        }
      } else if (!isSearchActive) {
        cy.nodes().removeClass('search-highlight');
      }
    });
  }, [fitNodeIds, isSearchActive, applyNodeSizes]);

  // 검색 상태 변경 시에만 초기 fade 효과 적용
  const filteredElementIdsStr = useMemo(() => {
    if (!filteredElements || filteredElements.length === 0) return '';
    return filteredElements.map(e => e.data?.id).filter(Boolean).sort().join(',');
  }, [filteredElements]);
  
  useEffect(() => {
    const cy = getCyInstance();
    if (!cy) return;
    
    if (isSearchActive && filteredElements.length > 0) {
      applySearchFadeEffect(cy, filteredElements, isSearchActive);
    } else if (!isSearchActive) {
      cy.elements().forEach(element => {
        element.removeClass("faded highlighted");
        element.style('opacity', '');
        element.style('text-opacity', '');
      });
    }
  }, [isSearchActive, filteredElementIdsStr]);

  // 크기 반응형
  useEffect(() => {
    const handleResize = () => {
      const cy = getCyInstance();
      if (!cy) return;
      
      safeCyOperation(() => {
        cy.resize();
        setTimeout(() => {
          safeCyOperation(() => {
            ensureElementsInBounds(cy, containerRef.current);
          }, '❌ 요소 경계 조정 실패');
        }, 100);
      }, '❌ 그래프 리사이즈 실패');
    };
    
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [safeCyOperation]);

  // 컨테이너 스타일 메모이제이션
  const containerStyle = useMemo(() => ({
    width: "100%",
    height: "100%",
    background: "#ffffff",
    ...style,
    position: "relative",
    overflow: "hidden",
    zIndex: 1,
    visibility: isGraphVisible ? "visible" : "hidden",
    minHeight: "400px",
    minWidth: "450px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  }), [style, isGraphVisible]);

  // 검색 결과 없음 메시지 (조건부 렌더링 최적화)
  const shouldShowNoResults = shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds);
  const noResultsMessage = shouldShowNoResults ? (() => {
    const message = getNoSearchResultsMessage(searchTerm);
    return (
      <div style={NO_RESULTS_CONTAINER_STYLE}>
        <div style={NO_RESULTS_TITLE_STYLE}>
          {message.title}
        </div>
        <div style={NO_RESULTS_DESCRIPTION_STYLE}>
          {message.description}
        </div>
      </div>
    );
  })() : null;

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className="graph-canvas-area"
    >
      {noResultsMessage}
    </div>
  );
};

// Element shape 정의
const elementShape = PropTypes.shape({
  data: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    source: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    target: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    label: PropTypes.string,
    weight: PropTypes.number,
  }),
  position: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  classes: PropTypes.string,
});

// Layout shape 정의
const layoutShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  animationDuration: PropTypes.number,
  animationEasing: PropTypes.string,
  fit: PropTypes.bool,
  padding: PropTypes.number,
});

// CytoscapeGraphUnified PropTypes
CytoscapeGraphUnified.propTypes = {
  elements: PropTypes.arrayOf(elementShape).isRequired,
  stylesheet: PropTypes.arrayOf(PropTypes.object),
  layout: layoutShape,
  tapNodeHandler: PropTypes.func,
  tapEdgeHandler: PropTypes.func,
  tapBackgroundHandler: PropTypes.func,
  fitNodeIds: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])),
  style: PropTypes.object,
  cyRef: PropTypes.shape({
    current: PropTypes.object,
  }).isRequired,
  newNodeIds: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])),
  onLayoutComplete: PropTypes.func,
  searchTerm: PropTypes.string,
  isSearchActive: PropTypes.bool,
  filteredElements: PropTypes.arrayOf(elementShape),
  isResetFromSearch: PropTypes.bool,
  onShowNodeTooltip: PropTypes.func,
  onShowEdgeTooltip: PropTypes.func,
  onClearTooltip: PropTypes.func,
  selectedNodeIdRef: PropTypes.shape({
    current: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  selectedEdgeIdRef: PropTypes.shape({
    current: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  strictBackgroundClear: PropTypes.bool,
  showRippleEffect: PropTypes.bool,
  isDropdownSelection: PropTypes.bool,
  isDataRefreshing: PropTypes.bool,
  currentChapter: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

// 기본값 (isRequired가 아닌 props만)
CytoscapeGraphUnified.defaultProps = {
  stylesheet: [],
  layout: { name: "preset" },
  style: {},
  newNodeIds: [],
  searchTerm: "",
  isSearchActive: false,
  filteredElements: [],
  isResetFromSearch: false,
  strictBackgroundClear: false,
  showRippleEffect: true,
  isDropdownSelection: false,
  isDataRefreshing: false,
};

export default CytoscapeGraphUnified; 

export function CytoscapeGraphPortalProvider({ children }) {
  const [graphProps, setGraphProps] = useState({
    elements: [],
    stylesheet: [],
    layout: { name: "preset" },
    tapNodeHandler: undefined,
    tapEdgeHandler: undefined,
    tapBackgroundHandler: undefined,
    fitNodeIds: undefined,
    style: {},
    newNodeIds: [],
  });

  const updateGraph = useCallback((newProps) => {
    setGraphProps((prev) => ({ ...prev, ...newProps }));
  }, []);

  return (
    <CytoscapeGraphContext.Provider value={{ graphProps, updateGraph }}>
      {children}
      <CytoscapeGraphUnified {...graphProps} />
    </CytoscapeGraphContext.Provider>
  );
}

CytoscapeGraphPortalProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
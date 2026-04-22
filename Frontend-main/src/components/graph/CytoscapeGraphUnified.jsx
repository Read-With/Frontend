import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import cytoscape from "cytoscape";
import "./RelationGraph.css";
import {
  detectAndResolveOverlap,
  calcGraphDiff,
  buildElementsGraphFingerprint,
  buildElementsStructureFingerprint,
  visualElementSignature,
} from "../../utils/graph/graphDataUtils.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../utils/graph/searchUtils.jsx";
import {
  createRippleEffect,
  ensureElementsInBounds,
  createMouseEventHandlers,
  syncReciprocalPairJunctionOffsets,
} from "../../utils/graph/graphUtils.js";
import { calculateSpiralPlacement, getContainerDimensions } from "../../utils/graph/nodePlacementUtils.js";
import { calculateNodeSize } from "../../utils/styles/graphStyles.js";
import useGraphInteractions from "../../hooks/graph/useGraphInteractions.js";
import { useGraphLayout } from "../../hooks/graph/useGraphLayout.js";
import { useCyInstance } from "../../hooks/graph/useCyInstance.js";
import { eventUtils } from "../../utils/viewer/viewerUtils";

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

const DEFAULT_LAYOUT = { name: "preset" };

const EMPTY_ELEMENTS_UPDATE = {
  nodesToAdd: [],
  edgesToAdd: [],
  hasChanges: false,
  dataChangedIds: [],
  incrementalLayoutScope: false,
};

const isEmpty = (arr) => !arr || arr.length === 0;

const CytoscapeGraphUnified = ({
  elements,
  stylesheet = [],
  layout = DEFAULT_LAYOUT,
  tapNodeHandler,
  tapEdgeHandler,
  tapBackgroundHandler,
  fitNodeIds,
  style = {},
  cyRef: externalCyRef,
  newNodeIds: _newNodeIds = [],
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
  showRippleEffect = false,
  isDropdownSelection = false,
  isDataRefreshing = false,
  currentChapter,
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const [cyReady, setCyReady] = useState(false);
  const previousElementsRef = useRef([]);
  const elementsVisualSigRef = useRef(new Map());
  const lastElementsGraphFingerprintRef = useRef("");
  const prevStructureFingerprintRef = useRef("");
  const prevChapterRef = useRef(currentChapter);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const addedNodeIdsRef = useRef(new Set());

  const cy = useCyInstance(externalCyRef, cyReady);

  const elementsGraphFingerprint = useMemo(
    () => (isEmpty(elements) ? "" : buildElementsGraphFingerprint(elements)),
    [elements]
  );
  const elementsLength = Array.isArray(elements) ? elements.length : 0;

  const fitNodeIdsKey = useMemo(() => {
    if (!fitNodeIds?.length) return "";
    return [...fitNodeIds].map(String).sort().join("\x1f");
  }, [fitNodeIds]);

  const safeCyOperation = useCallback((operation, errorMessage) => {
    try {
      return operation();
    } catch {
      return null;
    }
  }, []);

  const resetPreviousElements = () => {
    previousElementsRef.current = [];
    addedNodeIdsRef.current = new Set();
    elementsVisualSigRef.current = new Map();
    lastElementsGraphFingerprintRef.current = "";
    prevStructureFingerprintRef.current = "";
  };

  const updateStylesheet = useCallback((cy) => {
    if (!cy || !stylesheet) return;
    
    return safeCyOperation(() => {
      cy.style(stylesheet);
      cy.style().update();
      return true;
    }, '❌ 스타일시트 적용 실패');
  }, [stylesheet, safeCyOperation]);

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

  const triggerRippleForAddedNodes = useCallback(() => {
    if (!cy) return;
    if (!showRippleEffect) {
      addedNodeIdsRef.current = new Set();
      return;
    }
    if (isResetFromSearch) {
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
  }, [cy, isResetFromSearch, showRippleEffect]);

  const reapplySearchFade = useCallback(() => {
    if (!cy || !isSearchActive || !filteredElements || filteredElements.length === 0) return;
    applySearchFadeEffect(cy, filteredElements, isSearchActive);
  }, [cy, isSearchActive, filteredElements]);

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
    onAfterReset: reapplySearchFade,
  });

  useEffect(() => {
    if (isEmpty(elements)) return;

    if (!cy) return;

    const chapter = currentChapter;
    if (chapter !== undefined && chapter !== prevChapterRef.current) {
      setIsInitialLoad(true);
      resetPreviousElements();
      prevChapterRef.current = chapter;
    }

    if (isEmpty(previousElementsRef.current)) {
      previousElementsRef.current = elements;
      const firstIds = eventUtils
        .filterNodes(elements)
        .map((el) => el?.data?.id)
        .filter((id) => id != null && id !== "");
      addedNodeIdsRef.current = new Set(firstIds.map(String));
      return;
    }

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
  }, [elements, isDataRefreshing, currentChapter, safeCyOperation, cy]);

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
          layout: DEFAULT_LAYOUT,
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
    } catch {
      return;
    }
    
    if (!cyInstance) {
      return;
    }
    
    const cy = cyInstance;
    
    if (!cy || !cy.container()) {
      return;
    }
    
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
      syncReciprocalPairJunctionOffsets(cy);
    };

    const handleDragFree = (evt) => {
      const node = evt.target;
      node.style('transition-property', 'position');
      syncReciprocalPairJunctionOffsets(cy);

      const dragEndEvent = new CustomEvent('graphDragEnd', {
        detail: { type: 'graphDragEnd', timestamp: Date.now() }
      });
      document.dispatchEvent(dragEndEvent);
      
      isDraggingRef.current = false;
    };

    const handleReciprocalJunction = () => {
      syncReciprocalPairJunctionOffsets(cy);
    };

    cy.on('dragfreeon', 'node', handleDragFreeOn);
    cy.on('drag', 'node', handleDrag);
    cy.on('dragfree', 'node', handleDragFree);
    cy.on('position', 'node', handleReciprocalJunction);

    setCyReady(true);
    handleReciprocalJunction();

    return () => {
      setCyReady(false);
      cy.removeListener('dragfreeon', 'node', handleDragFreeOn);
      cy.removeListener('drag', 'node', handleDrag);
      cy.removeListener('dragfree', 'node', handleDragFree);
      cy.removeListener('position', 'node', handleReciprocalJunction);
      
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
    };
  }, [externalCyRef]);

  const handleBackgroundTap = useCallback((evt) => {
    if (!cy || evt.target !== cy) return;
    const bgHandler = tapBackgroundHandler || hookTapBackgroundHandler;
    if (bgHandler) bgHandler(evt);
  }, [cy, tapBackgroundHandler, hookTapBackgroundHandler]);

  useEffect(() => {
    if (!cy) return;

    const nodeHandler = tapNodeHandler || hookTapNodeHandler;
    const edgeHandler = tapEdgeHandler || hookTapEdgeHandler;

    cy.off('tap');

    if (nodeHandler) {
      cy.on("tap", "node", nodeHandler);
    }
    if (edgeHandler) {
      cy.on("tap", "edge", edgeHandler);
    }
    cy.on("tap", handleBackgroundTap);

    return () => {
      cy.off('tap');
    };
  }, [cy, tapNodeHandler, tapEdgeHandler, hookTapNodeHandler, hookTapEdgeHandler, handleBackgroundTap]);

  const elementsUpdateRef = useRef(EMPTY_ELEMENTS_UPDATE);

  useEffect(() => {
    if (!cy) return;

    if (isEmpty(elements)) {
      elementsUpdateRef.current = EMPTY_ELEMENTS_UPDATE;
      lastElementsGraphFingerprintRef.current = "";
      prevStructureFingerprintRef.current = "";
      if (!isDataRefreshing) {
        resetPreviousElements();
        cy.elements().remove();
        setIsGraphVisible(false);
      } else {
        elementsVisualSigRef.current = new Map();
      }
      return;
    }

    const graphFp = elementsGraphFingerprint;
    if (
      graphFp &&
      graphFp === lastElementsGraphFingerprintRef.current &&
      cy.elements().length > 0
    ) {
      elementsUpdateRef.current = { ...EMPTY_ELEMENTS_UPDATE };
      return;
    }

    cy.batch(() => {
      const nodes = eventUtils.filterNodes(elements);
      const edges = eventUtils.filterEdges(elements);
      const prevNodeIds = new Set(cy.nodes().map((n) => String(n.id())));
      const prevEdgeIds = new Set(cy.edges().map((e) => String(e.id())));
      const hadExistingGraph = prevNodeIds.size > 0;
      const nextNodeIds = new Set(
        nodes.map((n) => (n?.data?.id != null ? String(n.data.id) : "")).filter(Boolean)
      );
      const nextEdgeIds = new Set(
        edges.map((e) => (e?.data?.id != null ? String(e.data.id) : "")).filter(Boolean)
      );

      // 이미 그려진 id가 다음 props에도 모두 있으면 "순증가"만 → 제거 루프 생략(전체 깜빡임·불필요한 재구성 방지)
      const pureAdditive =
        prevNodeIds.size > 0 &&
        [...prevNodeIds].every((id) => nextNodeIds.has(id)) &&
        [...prevEdgeIds].every((id) => nextEdgeIds.has(id));

      if (!pureAdditive) {
        cy.nodes().forEach((n) => {
          if (!nextNodeIds.has(String(n.id()))) n.remove();
        });
        cy.edges().forEach((e) => {
          if (!nextEdgeIds.has(String(e.id()))) e.remove();
        });
      }

      // 유지되는 요소는 data만 동기화. 좌표는 Cytoscape에 유지(이벤트 전환 시 기존 배치 보존)
      nodes.forEach((nodeDef) => {
        const rawId = nodeDef?.data?.id;
        if (rawId == null || rawId === "") return;
        const el = cy.getElementById(String(rawId));
        if (el.length > 0) {
          try {
            el.data(nodeDef.data);
          } catch {
            /* ignore */
          }
        }
      });
      edges.forEach((edgeDef) => {
        const rawId = edgeDef?.data?.id;
        if (rawId == null || rawId === "") return;
        const el = cy.getElementById(String(rawId));
        if (el.length > 0) {
          try {
            el.data(edgeDef.data);
          } catch {
            /* ignore */
          }
        }
      });

      const placedPositions = [];
      prevNodeIds.forEach((id) => {
        if (!nextNodeIds.has(id)) return;
        const n = cy.getElementById(id);
        if (n.length > 0) {
          try {
            placedPositions.push(n.position());
          } catch {
            /* ignore */
          }
        }
      });
      const nodesToAdd = nodes.filter(
        (node) => node?.data?.id != null && !prevNodeIds.has(String(node.data.id))
      );
      const edgesToAdd = edges.filter(
        (edge) => edge?.data?.id != null && !prevEdgeIds.has(String(edge.data.id))
      );
      
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

      const newIds = [
        ...nodesToAdd.map((n) => n?.data?.id),
        ...edgesToAdd.map((e) => e?.data?.id),
      ].filter((id) => id != null && id !== "");

      const prevSig = elementsVisualSigRef.current;
      const nextSig = new Map();
      const dataChangedRaw = [];
      for (const el of elements) {
        const rawId = el?.data?.id;
        if (rawId == null || rawId === "") continue;
        const sid = String(rawId);
        const sig = visualElementSignature(el);
        nextSig.set(sid, sig);
        if (prevSig.size > 0 && prevSig.has(sid) && prevSig.get(sid) !== sig) {
          dataChangedRaw.push(sid);
        }
      }
      elementsVisualSigRef.current = nextSig;

      const newIdSet = new Set(newIds.map((id) => String(id)));
      let dataChangedIds = dataChangedRaw.filter((sid) => !newIdSet.has(sid));

      const structureFp = buildElementsStructureFingerprint(elements);
      if (
        structureFp &&
        structureFp === prevStructureFingerprintRef.current &&
        nodesToAdd.length === 0 &&
        edgesToAdd.length === 0
      ) {
        dataChangedIds = [];
      }
      prevStructureFingerprintRef.current = structureFp || "";

      elementsUpdateRef.current = {
        nodesToAdd,
        edgesToAdd,
        hasChanges: nodesToAdd.length > 0 || edgesToAdd.length > 0,
        dataChangedIds,
        incrementalLayoutScope: hadExistingGraph && nodesToAdd.length > 0,
      };
      syncReciprocalPairJunctionOffsets(cy);
    });

    lastElementsGraphFingerprintRef.current = graphFp;
    setIsGraphVisible(true);
  }, [elementsGraphFingerprint, elementsLength, isDataRefreshing, cy]);

  useGraphLayout({
    cy,
    elementsFingerprint: elementsGraphFingerprint,
    elementsLength,
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

  useEffect(() => {
    if (!cy || elementsLength === 0) return;

    cy.batch(() => {
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodes = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodes.length > 0) {
          cy.fit(nodes, 60);
          const prevHl = cy.nodes(".search-highlight");
          if (prevHl.length > 0) prevHl.removeClass("search-highlight");
          nodes.addClass("search-highlight");
          applyNodeSizes(cy, nodes, 1.2);
        }
      } else if (!isSearchActive) {
        const hl = cy.nodes(".search-highlight");
        if (hl.length > 0) hl.removeClass("search-highlight");
      }
    });
  }, [cy, elementsGraphFingerprint, elementsLength, fitNodeIdsKey, isSearchActive, applyNodeSizes]);

  const filteredElementIdsStr = useMemo(() => {
    if (!filteredElements || filteredElements.length === 0) return '';
    return filteredElements.map(e => e.data?.id).filter(Boolean).sort().join(',');
  }, [filteredElements]);
  
  useEffect(() => {
    if (!cy) return;

    if (isSearchActive && filteredElements.length > 0) {
      applySearchFadeEffect(cy, filteredElements, isSearchActive);
    } else if (!isSearchActive) {
      cy.batch(() => {
        const faded = cy.collection().union(cy.nodes(".faded")).union(cy.edges(".faded"));
        if (faded.length > 0) {
          faded.removeClass("faded");
          faded.forEach((element) => {
            element.style("opacity", "");
            element.style("text-opacity", "");
          });
        }
      });
    }
  }, [cy, isSearchActive, filteredElementIdsStr]);

  useEffect(() => {
    const handleResize = () => {
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
  }, [cy, safeCyOperation]);

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

const layoutShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  animationDuration: PropTypes.number,
  animationEasing: PropTypes.string,
  fit: PropTypes.bool,
  padding: PropTypes.number,
});

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

export default CytoscapeGraphUnified;
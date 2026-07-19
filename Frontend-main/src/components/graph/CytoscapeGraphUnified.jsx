import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import cytoscape from "cytoscape";
import {
  detectAndResolveOverlap,
  buildElementsGraphFingerprint,
  buildElementsStructureFingerprint,
  visualElementSignature,
} from "../../utils/graph/graphDataUtils.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../utils/graph/searchUtils.js";
import {
  createRippleEffect,
  ensureElementsInBounds,
  isGraphContainerSizeReady,
  syncReciprocalPairJunctionOffsets,
  clearHighlightClassesOn,
  calculateSpiralPlacement,
  fitGraphToNodes,
  zoomGraphByFactor,
  GRAPH_ZOOM,
} from "../../utils/graph/graphUtils";
import {
  applyNormalizedNodeSizes,
  PRESET_LAYOUT,
} from "../../utils/styles/graphStyles.js";
import useGraphInteractions from "../../hooks/graph/useGraphInteractions.js";
import { useGraphLayout, useCyInstance } from "../../hooks/graph/useGraphLayout";
import { eventUtils } from "../../utils/viewer/viewerCoreStateUtils";

function GraphZoomControls({ cy }) {
  const handleZoom = useCallback((e, factor) => {
    e.stopPropagation();
    zoomGraphByFactor(cy, factor);
  }, [cy]);

  if (!cy) return null;

  return (
    <div
      className="graph-zoom-controls"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="graph-zoom-btn"
        onClick={(e) => handleZoom(e, GRAPH_ZOOM.STEP)}
        aria-label="그래프 확대"
        title="확대"
      >
        +
      </button>
      <button
        type="button"
        className="graph-zoom-btn"
        onClick={(e) => handleZoom(e, 1 / GRAPH_ZOOM.STEP)}
        aria-label="그래프 축소"
        title="축소"
      >
        −
      </button>
    </div>
  );
}

GraphZoomControls.propTypes = {
  cy: PropTypes.object,
};

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
  fitNodeIds,
  cyRef: externalCyRef,
  searchTerm = "",
  isSearchActive = false,
  filteredElements = [],
  isResetFromSearch = false,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedElementRef,
  graphClearRef = null,
  showRippleEffect = false,
  isDataRefreshing = false,
  currentChapter,
  /** 변경 시 fit 재실행. 없으면 currentChapter만 사용 */
  viewportRefitKey,
  /** true면 viewportRefitKey 변경으로 fit하지 않음 (이벤트 전환 중 등) */
  skipViewportRefit = false,
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const [cyReady, setCyReady] = useState(false);
  const elementsVisualSigRef = useRef(new Map());
  const lastElementsGraphFingerprintRef = useRef("");
  const prevStructureFingerprintRef = useRef("");
  const resolvedRefitKey =
    viewportRefitKey != null && String(viewportRefitKey) !== ""
      ? String(viewportRefitKey)
      : currentChapter != null && currentChapter !== ""
        ? String(currentChapter)
        : "";
  const prevRefitKeyRef = useRef(resolvedRefitKey);
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

  const safeCyOperation = useCallback((operation) => {
    try {
      return operation();
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn("[CytoscapeGraphUnified] cy operation failed:", err);
      }
      return null;
    }
  }, []);

  const resetGraphTrackingState = () => {
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
    });
  }, [stylesheet, safeCyOperation]);

  const applyNodeSizes = useCallback((cy, nodes, scale = 1) => {
    applyNormalizedNodeSizes(cy, { scaledNodes: nodes, scale });
  }, []);

  const triggerRippleForAddedNodes = useCallback(() => {
    if (!cy) return;
    if (!showRippleEffect) {
      addedNodeIdsRef.current = new Set();
      return;
    }
    if (isResetFromSearch) {
      addedNodeIdsRef.current = new Set();
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
          createRippleEffect(containerRef.current, position.x, position.y);
        }
      }
    });

    addedNodeIdsRef.current = new Set();
  }, [cy, isResetFromSearch, showRippleEffect]);

  const reapplySearchFade = useCallback(() => {
    if (!cy || !isSearchActive) return;
    applySearchFadeEffect(cy, filteredElements || []);
  }, [cy, isSearchActive, filteredElements]);

  const {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
    reapplySelectionHighlight,
  } = useGraphInteractions({
    cyRef: externalCyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedElementRef,
    onAfterReset: reapplySearchFade,
  });

  useEffect(() => {
    if (!graphClearRef) return undefined;
    graphClearRef.current = clearSelection;
    return () => {
      graphClearRef.current = null;
    };
  }, [graphClearRef, clearSelection]);

  // viewport/챕터 키가 바뀌면 초기 fit·추적 상태만 리셋. ripple용 addedNodeIds는 elements update의 nodesToAdd가 설정
  useEffect(() => {
    if (!cy || isEmpty(elements)) return;

    if (
      !skipViewportRefit &&
      resolvedRefitKey !== "" &&
      resolvedRefitKey !== prevRefitKeyRef.current
    ) {
      setIsInitialLoad(true);
      resetGraphTrackingState();
      prevRefitKeyRef.current = resolvedRefitKey;
    }
  }, [elements, resolvedRefitKey, skipViewportRefit, cy]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cyInstance;
    let didCreateInstance = false;
    let overlapTimeoutId = 0;

    try {
      cyInstance = externalCyRef?.current;
      const isLive =
        cyInstance &&
        typeof cyInstance.container === "function" &&
        !cyInstance.destroyed?.();
      if (!isLive) {
        cyInstance = cytoscape({
          container: containerRef.current,
          elements: [],
          style: stylesheet,
          layout: PRESET_LAYOUT,
          userZoomingEnabled: true,
          userPanningEnabled: true,
          wheelSensitivity: 1,
          minZoom: GRAPH_ZOOM.MIN,
          maxZoom: GRAPH_ZOOM.MAX,
          autoungrabify: false,
          autolock: false,
          autounselectify: false,
          selectionType: "single",
          touchTapThreshold: 8,
          desktopTapThreshold: 4,
        });
        didCreateInstance = true;
        if (externalCyRef) externalCyRef.current = cyInstance;
      } else if (cyInstance.container() !== containerRef.current) {
        cyInstance.mount(containerRef.current);
      }
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn("[CytoscapeGraphUnified] cy init failed:", err);
      }
      return;
    }

    if (!cyInstance || !cyInstance.container()) {
      return;
    }

    const handleDragFreeOn = () => {
      if (overlapTimeoutId) window.clearTimeout(overlapTimeoutId);
      overlapTimeoutId = window.setTimeout(() => {
        overlapTimeoutId = 0;
        detectAndResolveOverlap(cyInstance);
        syncReciprocalPairJunctionOffsets(cyInstance, { immediate: true });
      }, 50);
    };

    const handleDrag = (evt) => {
      evt.target.style("transition-property", "none");
    };

    const handleDragFree = (evt) => {
      evt.target.style("transition-property", "none");
      document.dispatchEvent(
        new CustomEvent("graphDragEnd", {
          detail: { type: "graphDragEnd", timestamp: Date.now() },
        })
      );
    };

    const handlePosition = (evt) => {
      const node = evt.target;
      try {
        if (node.connectedEdges("[?reciprocalPair]").length === 0) return;
      } catch {
        return;
      }
      syncReciprocalPairJunctionOffsets(cyInstance, {
        nodes: node,
        immediate: true,
      });
    };

    cyInstance.on("position", "node", handlePosition);
    cyInstance.on("dragfreeon", "node", handleDragFreeOn);
    cyInstance.on("drag", "node", handleDrag);
    cyInstance.on("dragfree", "node", handleDragFree);

    setCyReady(true);

    return () => {
      setCyReady(false);
      if (overlapTimeoutId) window.clearTimeout(overlapTimeoutId);
      cyInstance.removeListener("position", "node", handlePosition);
      cyInstance.removeListener("dragfreeon", "node", handleDragFreeOn);
      cyInstance.removeListener("drag", "node", handleDrag);
      cyInstance.removeListener("dragfree", "node", handleDragFree);
      // 이 effect가 생성한 인스턴스만 destroy (외부 재사용 인스턴스는 보존)
      if (didCreateInstance) {
        try {
          cyInstance.destroy();
        } catch {
          /* ignore */
        }
        if (externalCyRef?.current === cyInstance) {
          externalCyRef.current = null;
        }
      }
    };
  }, [externalCyRef]);

  useEffect(() => {
    if (!cy) return;

    cy.on("tap", "node", tapNodeHandler);
    cy.on("tap", "edge", tapEdgeHandler);
    cy.on("tap", tapBackgroundHandler);

    return () => {
      cy.removeListener("tap", "node", tapNodeHandler);
      cy.removeListener("tap", "edge", tapEdgeHandler);
      cy.removeListener("tap", tapBackgroundHandler);
    };
  }, [cy, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  const elementsUpdateRef = useRef(EMPTY_ELEMENTS_UPDATE);

  useEffect(() => {
    if (!cy) return;

    if (isEmpty(elements)) {
      elementsUpdateRef.current = EMPTY_ELEMENTS_UPDATE;
      lastElementsGraphFingerprintRef.current = "";
      prevStructureFingerprintRef.current = "";
      if (!isDataRefreshing) {
        resetGraphTrackingState();
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
      
      const containerWidth = containerRef.current?.clientWidth || 800;
      const containerHeight = containerRef.current?.clientHeight || 600;
      if (nodesToAdd.length > 0) {
        calculateSpiralPlacement(nodesToAdd, placedPositions, containerWidth, containerHeight);
        cy.add(nodesToAdd);
      }
      if (edgesToAdd.length > 0) {
        cy.add(edgesToAdd);
      }

      // cy에 실제로 추가된 노드만 ripple 대상으로 (props diff와 이중 추적하지 않음)
      addedNodeIdsRef.current = new Set(
        nodesToAdd
          .map((n) => n?.data?.id)
          .filter((id) => id != null && id !== "")
          .map(String)
      );

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
      // junction sync는 useGraphLayout handleLayoutComplete에서 1회만
    });

    lastElementsGraphFingerprintRef.current = graphFp;
    setIsGraphVisible(true);
  }, [elementsGraphFingerprint, elementsLength, isDataRefreshing, cy]);

  useGraphLayout({
    cy,
    elementsFingerprint: elementsGraphFingerprint,
    elementsLength,
    stylesheet,
    elementsUpdateRef,
    updateStylesheet,
    applyNodeSizes,
    triggerRippleForAddedNodes,
    isInitialLoad,
    setIsInitialLoad,
    containerRef,
  });

  useEffect(() => {
    if (!cy || elementsLength === 0) return;

    cy.batch(() => {
      if (fitNodeIds && fitNodeIds.length > 0) {
        const fitIdSet = new Set(fitNodeIds.map(String));
        const nodes = cy.nodes().filter((n) => fitIdSet.has(n.id()));
        if (nodes.length > 0) {
          fitGraphToNodes(cy, { eles: nodes });
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

  const prevIsSearchActiveRef = useRef(isSearchActive);

  useEffect(() => {
    if (!cy) return;

    const wasSearchActive = prevIsSearchActiveRef.current;
    prevIsSearchActiveRef.current = isSearchActive;

    if (isSearchActive) {
      applySearchFadeEffect(cy, filteredElements || []);
    } else if (wasSearchActive) {
      clearHighlightClassesOn(cy);
    }
    // 검색 fade가 selection highlight를 덮어쓰지 않도록 선택 상태를 다시 적용
    reapplySelectionHighlight();
  }, [cy, isSearchActive, filteredElementIdsStr, reapplySelectionHighlight]);

  useEffect(() => {
    let resizeTimeoutId = 0;

    const handleResize = () => {
      if (!cy) return;

      safeCyOperation(() => {
        cy.resize();
        if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
        resizeTimeoutId = window.setTimeout(() => {
          resizeTimeoutId = 0;
          if (!isGraphContainerSizeReady(containerRef.current)) return;
          safeCyOperation(() => {
            ensureElementsInBounds(cy, containerRef.current);
          });
        }, 100);
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
    };
  }, [cy, safeCyOperation]);

  const containerStyle = useMemo(() => ({
    width: "100%",
    height: "100%",
    background: "#ffffff",
    position: "relative",
    overflow: "hidden",
    zIndex: 1,
    visibility: isGraphVisible ? "visible" : "hidden",
    minWidth: 0,
    minHeight: 0,
    boxSizing: "border-box",
  }), [isGraphVisible]);

  const shouldShowNoResults = shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds);
  const noResultsMessage = shouldShowNoResults
    ? getNoSearchResultsMessage(searchTerm)
    : null;

  return (
    <div className="graph-cy-shell">
      <div
        ref={containerRef}
        style={containerStyle}
        className="graph-cy-container"
      />
      {noResultsMessage && (
        <div className="graph-no-results">
          <div className="graph-no-results-title">
            {noResultsMessage.title}
          </div>
          <div className="graph-no-results-description">
            {noResultsMessage.description}
          </div>
        </div>
      )}
      <GraphZoomControls cy={cy} />
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

CytoscapeGraphUnified.propTypes = {
  elements: PropTypes.arrayOf(elementShape).isRequired,
  stylesheet: PropTypes.arrayOf(PropTypes.object),
  fitNodeIds: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])),
  cyRef: PropTypes.shape({
    current: PropTypes.object,
  }).isRequired,
  searchTerm: PropTypes.string,
  isSearchActive: PropTypes.bool,
  filteredElements: PropTypes.arrayOf(elementShape),
  isResetFromSearch: PropTypes.bool,
  onShowNodeTooltip: PropTypes.func,
  onShowEdgeTooltip: PropTypes.func,
  onClearTooltip: PropTypes.func,
  selectedElementRef: PropTypes.shape({
    current: PropTypes.oneOfType([
      PropTypes.oneOf([null]),
      PropTypes.shape({
        kind: PropTypes.oneOf(['node', 'edge']),
        id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      }),
    ]),
  }),
  graphClearRef: PropTypes.shape({
    current: PropTypes.func,
  }),
  showRippleEffect: PropTypes.bool,
  isDataRefreshing: PropTypes.bool,
  currentChapter: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  viewportRefitKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  skipViewportRefit: PropTypes.bool,
};

export default CytoscapeGraphUnified;

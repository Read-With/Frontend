import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import cytoscape from "cytoscape";
import { UserSearch } from "lucide-react";
import {
  detectAndResolveOverlap,
  OVERLAP_RESOLVE,
  OVERLAP_PROFILES,
  readNodeRadius,
  buildElementsGraphFingerprint,
  buildElementsStructureFingerprint,
  visualElementSignature,
  visualSignatureImagePart,
} from "../../utils/graph/graphModel.js";
import {
  applySearchFadeEffect,
  shouldShowNoSearchResults,
  getNoSearchResultsMessage,
  ensureElementsInBounds,
  isGraphContainerSizeReady,
  syncReciprocalPairJunctionOffsets,
  clearHighlightClassesOn,
  calculateAnchorAwarePlacement,
  zoomGraphByFactor,
  fitGraphToNodes,
  safeCyCall,
  syncCyElementData,
  elementDefIdSet,
  collectContinuingNodeLayoutSeed,
  stableIdListKey,
} from "../../utils/graph/graphCy.js";
import { GRAPH_ZOOM } from "../../utils/graph/graphCore.js";
import {
  applyNormalizedNodeSizes,
  getResponsiveNodeSizeRange,
  PRESET_LAYOUT,
} from "../../utils/styles/graphStyles.js";
import {
  useGraphInteractions,
  useGraphLayout,
  useCyInstance,
} from '../../hooks/graph/useGraphCy.js';
import { useRefSlot } from '../../hooks/common/hooksShared.js';
import { eventUtils } from "../../utils/viewer/viewerCore";
import { errorUtils } from "../../utils/common/urlUtils";

const ZOOM_CONTROL_BUTTONS = [
  { factor: GRAPH_ZOOM.STEP, label: '그래프 확대', title: '확대', text: '+' },
  { factor: 1 / GRAPH_ZOOM.STEP, label: '그래프 축소', title: '축소', text: '−' },
];

function GraphZoomControls({ cy, className = 'graph-zoom-controls' }) {
  const handleZoom = useCallback((e, factor) => {
    e.stopPropagation();
    zoomGraphByFactor(cy, factor);
  }, [cy]);

  if (!cy) return null;

  return (
    <div
      className={className}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ZOOM_CONTROL_BUTTONS.map(({ factor, label, title, text }) => (
        <button
          key={label}
          type="button"
          className="graph-zoom-btn"
          onClick={(e) => handleZoom(e, factor)}
          aria-label={label}
          title={title}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

GraphZoomControls.propTypes = {
  cy: PropTypes.object,
  className: PropTypes.string,
};

export { GraphZoomControls };

const EMPTY_ELEMENTS_UPDATE = {
  nodesToAdd: [],
  edgesToAdd: [],
  hasChanges: false,
  dataChangedIds: [],
  incrementalLayoutScope: false,
  needsLocalReorder: false,
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
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedElementRef,
  graphClearRef = null,
  graphSelectNodeRef = null,
  graphSelectElementRef = null,
  isDataRefreshing = false,
  showZoomControls = true,
  onCyReady = null,
}) => {
  const containerRef = useRef(null);
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const [cyReady, setCyReady] = useState(false);
  const elementsVisualSigRef = useRef(new Map());
  const lastElementsGraphFingerprintRef = useRef("");
  const prevStructureFingerprintRef = useRef("");
  const initialStylesheetRef = useRef(stylesheet);
  initialStylesheetRef.current = stylesheet;
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const pendingInitialFitRef = useRef(false);
  const cy = useCyInstance(externalCyRef, cyReady);

  useEffect(() => {
    if (!onCyReady) return undefined;
    if (cyReady && cy) {
      onCyReady(cy);
      return () => onCyReady(null);
    }
    onCyReady(null);
    return undefined;
  }, [cy, cyReady, onCyReady]);

  const elementsGraphFingerprint = useMemo(
    () => (isEmpty(elements) ? "" : buildElementsGraphFingerprint(elements)),
    [elements]
  );
  const elementsLength = Array.isArray(elements) ? elements.length : 0;

  const fitNodeIdsKey = useMemo(
    () => stableIdListKey(fitNodeIds),
    [fitNodeIds],
  );

  const updateStylesheet = useCallback((cyInst) => {
    if (!cyInst || !stylesheet) return;
    return safeCyCall(cyInst, () => {
      cyInst.style(stylesheet);
      cyInst.style().update();
      return true;
    }, 'CytoscapeGraphUnified:style');
  }, [stylesheet]);

  const applyNodeSizes = useCallback((cyInst, nodes, scale = 1) => {
    applyNormalizedNodeSizes(cyInst, {
      scaledNodes: nodes,
      scale,
      containerWidth: containerRef.current?.clientWidth,
    });
  }, []);

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
    selectNodeByIdOrName,
    selectElementById,
  } = useGraphInteractions({
    cyRef: externalCyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedElementRef,
    onAfterReset: reapplySearchFade,
  });

  useRefSlot(graphClearRef, clearSelection);
  useRefSlot(graphSelectNodeRef, selectNodeByIdOrName);
  useRefSlot(graphSelectElementRef, selectElementById);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cyInstance;
    let didCreateInstance = false;
    let overlapRafId = 0;
    let activeDragNode = null;

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
          style: initialStylesheetRef.current,
          layout: PRESET_LAYOUT,
          userZoomingEnabled: true,
          userPanningEnabled: true,
          wheelSensitivity: GRAPH_ZOOM.WHEEL_SENSITIVITY,
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
      errorUtils.logDebug('CytoscapeGraphUnified', 'cy init failed', {
        message: err?.message,
      });
      return;
    }

    if (!cyInstance || !cyInstance.container()) {
      return;
    }

    /** 드래그 노드 좌표는 고정, 겹친 주변만 밀어냄 (앵커 배치 로직 미적용) */
    const resolveUserDragCollisions = (draggedNode, { clampBounds = false } = {}) => {
      if (!draggedNode || draggedNode.length === 0) return;
      if (clampBounds && isGraphContainerSizeReady(containerRef.current)) {
        ensureElementsInBounds(cyInstance, containerRef.current, { nodes: draggedNode });
      }
      const profile = OVERLAP_PROFILES.USER_DRAG;
      const draggedPos = draggedNode.position();
      const draggedRadius = readNodeRadius(draggedNode, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
      const proximity = Math.max(0, (profile.padding ?? 0) - (profile.tolerance ?? 0));
      const movableIds = [];
      cyInstance.nodes(':visible').forEach((node) => {
        if (node.id() === draggedNode.id()) return;
        const pos = node.position();
        const radius = readNodeRadius(node, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
        const activationDistance = draggedRadius + radius + proximity;
        if (Math.hypot(pos.x - draggedPos.x, pos.y - draggedPos.y) < activationDistance) {
          movableIds.push(node.id());
        }
      });
      if (movableIds.length === 0) return;
      detectAndResolveOverlap(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
        ...profile,
        movableIds,
      });
      syncReciprocalPairJunctionOffsets(cyInstance, { immediate: true });
    };

    const handleDragFreeOn = (evt) => {
      activeDragNode = null;
      if (overlapRafId) {
        window.cancelAnimationFrame(overlapRafId);
        overlapRafId = 0;
      }
      resolveUserDragCollisions(evt?.target, { clampBounds: true });
    };

    const handleDrag = (evt) => {
      evt.target.style("transition-property", "none");
      activeDragNode = evt.target;
      if (overlapRafId) return;
      overlapRafId = window.requestAnimationFrame(() => {
        overlapRafId = 0;
        if (!activeDragNode) return;
        resolveUserDragCollisions(activeDragNode, { clampBounds: false });
      });
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
      activeDragNode = null;
      if (overlapRafId) window.cancelAnimationFrame(overlapRafId);
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

    const resetGraphTrackingState = () => {
      elementsVisualSigRef.current = new Map();
      lastElementsGraphFingerprintRef.current = "";
      prevStructureFingerprintRef.current = "";
    };

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

    if (
      elementsGraphFingerprint &&
      elementsGraphFingerprint === lastElementsGraphFingerprintRef.current &&
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
      const nextNodeIds = elementDefIdSet(nodes);
      const nextEdgeIds = elementDefIdSet(edges);

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
      syncCyElementData(cy, nodes);
      syncCyElementData(cy, edges);

      const { placedPositions, placedWeights } = collectContinuingNodeLayoutSeed(
        cy,
        prevNodeIds,
        nextNodeIds,
      );
      const nodesToAdd = nodes.filter(
        (node) => node?.data?.id != null && !prevNodeIds.has(String(node.data.id))
      );
      const edgesToAdd = edges.filter(
        (edge) => edge?.data?.id != null && !prevEdgeIds.has(String(edge.data.id))
      );

      const containerWidth = containerRef.current?.clientWidth || 800;
      const containerHeight = containerRef.current?.clientHeight || 600;
      let needsLocalReorder = false;
      // 유지되는 기존 노드가 있을 때만 증분 앵커 배치. 전부 교체면 cose 시드 유지
      const canIncrementalPlace = hadExistingGraph && placedPositions.length > 0;
      if (nodesToAdd.length > 0) {
        if (canIncrementalPlace) {
          const placed = calculateAnchorAwarePlacement(
            nodesToAdd,
            placedPositions,
            edges,
            containerWidth,
            containerHeight,
            {
              padding: OVERLAP_RESOLVE.PADDING,
              weightsForRange: placedWeights,
            },
          );
          needsLocalReorder = Boolean(placed?.needsLocalReorder);
        }
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
        // 골격 동일 시 라벨 등 변경은 펄스 생략. 이미지만 blob resolve된 노드는 style 갱신 유지
        dataChangedIds = dataChangedIds.filter((sid) => {
          const prev = prevSig.get(sid);
          const next = nextSig.get(sid);
          return visualSignatureImagePart(prev) !== visualSignatureImagePart(next);
        });
      }
      prevStructureFingerprintRef.current = structureFp || "";

      elementsUpdateRef.current = {
        nodesToAdd,
        edgesToAdd,
        hasChanges: nodesToAdd.length > 0 || edgesToAdd.length > 0,
        dataChangedIds,
        incrementalLayoutScope: canIncrementalPlace && nodesToAdd.length > 0,
        needsLocalReorder,
      };
      // junction sync는 useGraphLayout handleLayoutComplete에서 1회만
    });

    lastElementsGraphFingerprintRef.current = elementsGraphFingerprint;
    setIsGraphVisible(true);
  }, [elements, elementsGraphFingerprint, elementsLength, isDataRefreshing, cy]);

  useGraphLayout({
    cy,
    elementsFingerprint: elementsGraphFingerprint,
    elementsLength,
    stylesheet,
    elementsUpdateRef,
    updateStylesheet,
    applyNodeSizes,
    isInitialLoad,
    setIsInitialLoad,
    containerRef,
    pendingInitialFitRef,
  });

  useEffect(() => {
    if (!cy || elementsLength === 0) return;

    cy.batch(() => {
      if (fitNodeIds && fitNodeIds.length > 0) {
        const fitIdSet = new Set(fitNodeIds.map(String));
        const nodes = cy.nodes().filter((n) => fitIdSet.has(n.id()));
        if (nodes.length > 0) {
          // 검색 결과 이동도 사용자가 설정한 배율은 유지하고 중심만 이동한다.
          cy.center(nodes);
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
  }, [cy, elementsGraphFingerprint, elementsLength, fitNodeIds, fitNodeIdsKey, isSearchActive, applyNodeSizes]);

  const filteredElementIdsStr = useMemo(() => {
    if (!filteredElements?.length) return '';
    return stableIdListKey(filteredElements.map((e) => e.data?.id).filter(Boolean));
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
  }, [cy, isSearchActive, filteredElements, filteredElementIdsStr, reapplySelectionHighlight]);

  useEffect(() => {
    if (!cy || !containerRef.current) return undefined;

    let resizeTimeoutId = 0;
    let lastNodeSizeRangeKey = "";

    const handleSize = () => {
      if (!cy || cy.destroyed?.()) return;

      safeCyCall(cy, () => {
        cy.resize();
        if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
        resizeTimeoutId = window.setTimeout(() => {
          resizeTimeoutId = 0;
          const el = containerRef.current;
          if (!isGraphContainerSizeReady(el)) {
            lastNodeSizeRangeKey = "";
            return;
          }

          const w = el.clientWidth;
          const nodeSizeRange = getResponsiveNodeSizeRange(w);
          const nodeSizeRangeKey = `${nodeSizeRange.min}:${nodeSizeRange.max}`;
          const nodeSizeRangeChanged =
            lastNodeSizeRangeKey !== "" && lastNodeSizeRangeKey !== nodeSizeRangeKey;
          lastNodeSizeRangeKey = nodeSizeRangeKey;

          safeCyCall(cy, () => {
            const highlightedNodes = cy.nodes(".search-highlight");
            const hasHighlightedNodes = highlightedNodes.length > 0;
            applyNodeSizes(
              cy,
              hasHighlightedNodes ? highlightedNodes : null,
              hasHighlightedNodes ? 1.2 : 1,
            );
            if (nodeSizeRangeChanged) {
              detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
                ...OVERLAP_PROFILES.RESIZE,
              });
            }
            // 리사이즈 때 전체 노드를 뷰포트로 끌어오면 줌·팬된 배치가 깨지므로 하지 않음
            if (pendingInitialFitRef.current) {
              if (fitGraphToNodes(cy, { duration: 0 })) {
                pendingInitialFitRef.current = false;
              }
            }
          }, 'CytoscapeGraphUnified:resizeInner');
        }, 120);
      }, 'CytoscapeGraphUnified:resize');
    };

    const observer = new ResizeObserver(handleSize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", handleSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleSize);
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
    };
  }, [cy, applyNodeSizes]);

  const noResultsMessage = shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds)
    ? getNoSearchResultsMessage(searchTerm)
    : null;

  return (
    <div className="graph-cy-shell">
      <div
        ref={containerRef}
        className={`graph-cy-container${isGraphVisible ? '' : ' is-pending'}`}
        aria-hidden="true"
      />
      {noResultsMessage && (
        <div className="graph-no-results" role="status">
          <div className="graph-no-results-icon" aria-hidden>
            <UserSearch size={28} aria-hidden />
          </div>
          <div className="graph-no-results-title">
            {noResultsMessage.title}
          </div>
          <div className="graph-no-results-description">
            {noResultsMessage.description}
          </div>
        </div>
      )}
      <GraphZoomControls cy={showZoomControls ? cy : null} />
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
  graphSelectNodeRef: PropTypes.shape({
    current: PropTypes.func,
  }),
  graphSelectElementRef: PropTypes.shape({
    current: PropTypes.func,
  }),
  isDataRefreshing: PropTypes.bool,
  showZoomControls: PropTypes.bool,
  onCyReady: PropTypes.func,
};

export default CytoscapeGraphUnified;

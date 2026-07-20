/** Cytoscape 탭·선택·레이아웃·인스턴스·툴팁 dismiss */

import { useCallback, useMemo, useEffect, useRef } from "react";
import {
  clearHighlightClassesOn,
  clearReciprocalEndpointBypass,
  ensureElementsInBounds,
  fitGraphToNodes,
  getSelectionFocusElements,
  isGraphContainerSizeReady,
  isSidebarElement,
  openTooltipFromTap,
  placeTooltipInCanvasAwayFromFocus,
  syncReciprocalPairJunctionOffsets,
} from '../../utils/graph/graphUtils';
import { detectAndResolveOverlap } from '../../utils/graph/graphDataUtils';
import { PRESET_LAYOUT } from '../../utils/styles/graphStyles';
import { useLatestRef } from '../common/hooksShared';

function isCyNode(element) {
  return typeof element?.isNode === 'function' ? element.isNode() : false;
}

function isFinitePoint(point) {
  return (
    point &&
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function applySelectionFade(cy, keepNodes, keepEdges, highlightedNodes = keepNodes, highlightedEdges = keepEdges) {
  if (!cy) return;
  clearHighlightClassesOn(cy);
  const fadedNodes = cy.nodes().difference(keepNodes);
  const fadedEdges = cy.edges().difference(keepEdges);
  cy.batch(() => {
    highlightedNodes.addClass("highlighted");
    highlightedEdges.addClass("highlighted");
    fadedNodes.addClass("faded");
    fadedEdges.addClass("faded");
    highlightedEdges.forEach((edge) => {
      if (edge.data("reciprocalPair")) clearReciprocalEndpointBypass(edge);
    });
  });
}

function applySelectionHighlight(cy, element) {
  if (!cy || !element || element.length === 0) return;
  const focus = getSelectionFocusElements(cy, element);
  if (!focus?.length) return;

  if (isCyNode(element)) {
    applySelectionFade(cy, focus.nodes(), focus.edges(), element, focus.edges());
    return;
  }
  applySelectionFade(cy, focus.nodes(), focus.edges());
}

function formatTapShowArgs(kind, element, evt, center, mouseX, mouseY) {
  if (kind === 'node') {
    return { node: element, evt, nodeCenter: center, mouseX, mouseY };
  }
  return { edge: element, evt, edgeCenter: center, mouseX, mouseY };
}

function getEdgeRenderedCenter(element) {
  try {
    const midpoint = typeof element.midpoint === 'function' ? element.midpoint() : null;
    if (isFinitePoint(midpoint)) return midpoint;
  } catch {
    /* fall through */
  }

  const source = element.source?.();
  const target = element.target?.();
  if (!source?.length || !target?.length) return null;

  const sourcePos = source.renderedPosition();
  const targetPos = target.renderedPosition();
  if (!isFinitePoint(sourcePos) || !isFinitePoint(targetPos)) return null;

  return {
    x: (sourcePos.x + targetPos.x) / 2,
    y: (sourcePos.y + targetPos.y) / 2,
  };
}

function getCyContainerOrigin(cy) {
  try {
    const cyRect = cy.container()?.getBoundingClientRect?.();
    if (cyRect) return { left: cyRect.left, top: cyRect.top };
  } catch {
    /* ignore */
  }
  return { left: 0, top: 0 };
}

/**
 * 노드: 클릭/렌더 좌표 + bbox offset (사이드바와 겹침 완화)
 * 엣지: focus 집합 기준 캔버스 내 배치
 */
function resolveTooltipAnchor(cy, kind, element, evt, calculateTooltipPosition) {
  if (kind === 'edge') {
    const focus = getSelectionFocusElements(cy, element);
    return placeTooltipInCanvasAwayFromFocus({ cy, focusEles: focus });
  }
  const bbox = element.renderedBoundingBox?.();
  const offsetX = (bbox?.w ?? 50) + 200;
  return calculateTooltipPosition(element, evt, offsetX);
}

/**
 * @param {object} options
 * @param {{ current: null | { kind: 'node'|'edge', id: string } }} options.selectedElementRef
 */
export function useGraphInteractions({
  cyRef,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedElementRef,
  onAfterReset,
}) {
  const onShowNodeTooltipRef = useLatestRef(onShowNodeTooltip);
  const onShowEdgeTooltipRef = useLatestRef(onShowEdgeTooltip);
  const onClearTooltipRef = useLatestRef(onClearTooltip);
  const onAfterResetRef = useLatestRef(onAfterReset);

  const clearSelectionRefs = useCallback(() => {
    if (selectedElementRef) selectedElementRef.current = null;
  }, [selectedElementRef]);

  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    clearHighlightClassesOn(cyRef.current);
    onAfterResetRef.current?.();
  }, [cyRef, onAfterResetRef]);

  const dismissSelection = useCallback(() => {
    resetAllStyles();
    onClearTooltipRef.current?.();
    clearSelectionRefs();
  }, [resetAllStyles, clearSelectionRefs, onClearTooltipRef]);

  const reapplySelectionHighlight = useCallback(() => {
    const cy = cyRef?.current;
    const selected = selectedElementRef?.current;
    if (!cy || !selected?.id) return;

    const el = cy.getElementById(String(selected.id));
    if (el.length > 0) applySelectionHighlight(cy, el);
  }, [cyRef, selectedElementRef]);

  const calculateTooltipPosition = useCallback((element, evt, offset = 0) => {
    try {
      const cy = cyRef?.current;
      if (!cy) return { x: 0, y: 0 };

      if (evt?.originalEvent) {
        return {
          x: evt.originalEvent.clientX + offset,
          y: evt.originalEvent.clientY,
        };
      }

      const basePos = isCyNode(element)
        ? element.renderedPosition()
        : getEdgeRenderedCenter(element);
      if (!isFinitePoint(basePos)) return { x: 0, y: 0 };

      const { left, top } = getCyContainerOrigin(cy);
      return {
        x: left + basePos.x + offset,
        y: top + basePos.y,
      };
    } catch {
      return { x: 0, y: 0 };
    }
  }, [cyRef]);

  const selectElement = useCallback((kind, element) => {
    const cy = cyRef?.current;
    if (!cy) return false;
    try {
      applySelectionHighlight(cy, element);
    } catch {
      return false;
    }
    if (selectedElementRef) {
      selectedElementRef.current = { kind, id: String(element.id()) };
    }
    return true;
  }, [cyRef, selectedElementRef]);

  const showElementTooltip = useCallback((kind, element, evt) => {
    const cy = cyRef?.current;
    if (!cy) return;
    const onShowTooltipRef = kind === 'node' ? onShowNodeTooltipRef : onShowEdgeTooltipRef;
    const center = calculateTooltipPosition(element, null, 0);
    const anchor = resolveTooltipAnchor(cy, kind, element, evt, calculateTooltipPosition);
    onShowTooltipRef.current?.(
      formatTapShowArgs(kind, element, evt, center, anchor.x, anchor.y),
    );
  }, [cyRef, onShowNodeTooltipRef, onShowEdgeTooltipRef, calculateTooltipPosition]);

  const selectAndShowTooltip = useCallback((kind, element, evt) => {
    if (!selectElement(kind, element)) return false;
    try {
      showElementTooltip(kind, element, evt);
    } catch {
      /* focus는 유지, 툴팁만 실패 */
    }
    return true;
  }, [selectElement, showElementTooltip]);

  const createTapHandler = useCallback((kind) => (evt) => {
    if (!cyRef?.current) return;

    const element = evt.target;
    if (!element || typeof element.data !== 'function' || !element.data()) return;

    const elementId = String(element.id());
    const prev = selectedElementRef?.current;
    if (prev?.kind === kind && String(prev.id) === elementId) {
      dismissSelection();
      return;
    }

    selectAndShowTooltip(kind, element, evt);
  }, [cyRef, selectedElementRef, dismissSelection, selectAndShowTooltip]);

  const tapNodeHandler = useMemo(() => createTapHandler('node'), [createTapHandler]);
  const tapEdgeHandler = useMemo(() => createTapHandler('edge'), [createTapHandler]);

  const tapBackgroundHandler = useCallback((evt) => {
    if (evt.target !== cyRef?.current) return;
    if (!selectedElementRef?.current) return;
    dismissSelection();
  }, [cyRef, selectedElementRef, dismissSelection]);

  /**
   * @param {{ fitViewport?: boolean }} [options]
   * fitViewport 기본 true — 챕터/이벤트 전환 등에서는 false
   */
  const clearSelection = useCallback((options = {}) => {
    const fitViewport = options?.fitViewport !== false;
    resetAllStyles();
    clearSelectionRefs();
    if (fitViewport) fitGraphToNodes(cyRef?.current, { duration: 500 });
  }, [cyRef, resetAllStyles, clearSelectionRefs]);

  const selectNodeByIdOrName = useCallback((idOrName) => {
    const cy = cyRef?.current;
    if (!cy || idOrName == null || idOrName === '') return false;

    let element = cy.getElementById(String(idOrName));
    if (!element?.length) {
      const key = String(idOrName);
      element = cy.nodes().filter((ele) => {
        const d = ele.data() || {};
        return (
          String(d.id) === key ||
          d.common_name === key ||
          d.label === key ||
          d.name === key
        );
      });
    }
    if (!element?.length) return false;

    return selectAndShowTooltip('node', element, null);
  }, [cyRef, selectAndShowTooltip]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
    reapplySelectionHighlight,
    selectNodeByIdOrName,
  };
}

/**
 * cyRef.current는 ref라 memo deps에 잡히지 않음.
 * 호출부가 인스턴스 생성 직후 isReady(cyReady)를 true로 올려야 이 훅이 cy를 반환한다.
 */
export function useCyInstance(cyRef, isReady = true) {
  return useMemo(() => {
    if (!isReady) return null;
    const cy = cyRef?.current;
    if (!cy || typeof cy.container !== "function") return null;
    return cy;
  }, [cyRef, isReady]);
}

function runPresetLayout(cy, eles) {
  if (eles?.length > 0) {
    try {
      cy.layout({ ...PRESET_LAYOUT, eles }).run();
      return;
    } catch {
      /* fall through to full preset */
    }
  }
  try {
    cy.layout({ ...PRESET_LAYOUT }).run();
  } catch {
    /* ignore */
  }
}

function scheduleRippleWhenPositionsPainted(cy, triggerRippleForAddedNodes) {
  let done = false;
  let fallbackId = 0;

  const clearFallback = () => {
    if (!fallbackId) return;
    window.clearTimeout(fallbackId);
    fallbackId = 0;
  };

  const run = () => {
    if (done) return;
    done = true;
    clearFallback();
    try {
      triggerRippleForAddedNodes();
    } catch {
      /* ignore */
    }
  };

  const cancel = () => {
    done = true;
    clearFallback();
  };

  fallbackId = window.setTimeout(run, 180);

  try {
    cy.one("render", () => {
      if (done) return;
      requestAnimationFrame(run);
    });
    cy.resize();
  } catch {
    requestAnimationFrame(run);
  }

  return cancel;
}

/**
 * elementsUpdateRef 소비 후 분기:
 * 1) hasChanges          → layout(+scoped) → styles → rAF(complete: bounds/overlap/fit/junction + ripple)
 * 2) dataChanged only    → sizes refresh
 * 3) stylesheet|initial  → sizes refresh; initial이면 complete(fit+junction 포함)
 */
export function useGraphLayout({
  cy,
  elementsFingerprint,
  elementsLength,
  stylesheet,
  elementsUpdateRef,
  updateStylesheet,
  applyNodeSizes,
  triggerRippleForAddedNodes,
  isInitialLoad,
  setIsInitialLoad,
  containerRef,
}) {
  const prevStylesheetRef = useRef(stylesheet);

  const handleLayoutComplete = useCallback(
    (cyInstance, shouldFitOnInitialLoad, options = {}) => {
      const { skipOverlap = false, skipEnsureBounds = false } = options;
      if (!cyInstance) return;

      if (!skipEnsureBounds && isGraphContainerSizeReady(containerRef.current)) {
        ensureElementsInBounds(cyInstance, containerRef.current);
      }
      if (!skipOverlap) {
        detectAndResolveOverlap(cyInstance);
      }
      if (shouldFitOnInitialLoad) {
        fitGraphToNodes(cyInstance);
      }
      syncReciprocalPairJunctionOffsets(cyInstance);
    },
    [containerRef]
  );

  useEffect(() => {
    if (!cy || !elementsLength) return;

    let cancelRipple = () => {};

    const {
      nodesToAdd = [],
      edgesToAdd = [],
      hasChanges = false,
      dataChangedIds = [],
      incrementalLayoutScope = false,
    } = elementsUpdateRef.current || {};

    // 소비 후 비워 isInitialLoad 등으로 effect가 다시 돌아도 layout/style을 재실행하지 않음
    elementsUpdateRef.current = {
      nodesToAdd: [],
      edgesToAdd: [],
      hasChanges: false,
      dataChangedIds: [],
      incrementalLayoutScope: false,
    };

    const stylesheetChanged = prevStylesheetRef.current !== stylesheet;
    prevStylesheetRef.current = stylesheet;

    const edgesOnlyIncremental =
      hasChanges && nodesToAdd.length === 0 && edgesToAdd.length > 0;
    const styleOnlyIncremental =
      hasChanges && !isInitialLoad && !stylesheetChanged;
    const hasDataOnlyVisualChange = !hasChanges && dataChangedIds.length > 0;

    const refreshStyles = ({
      forceSheet = false,
      forceSizes = false,
      lightUpdate = false,
    } = {}) => {
      if (forceSheet || stylesheetChanged) {
        updateStylesheet(cy);
      } else if (lightUpdate) {
        try {
          cy.style().update();
        } catch {
          /* ignore */
        }
      }
      if (stylesheet && (forceSizes || stylesheetChanged)) {
        applyNodeSizes(cy);
      }
    };

    const finishInitialLoad = () => {
      if (isInitialLoad) setIsInitialLoad(false);
    };

    if (hasChanges) {
      if (!edgesOnlyIncremental) {
        if (incrementalLayoutScope && nodesToAdd.length > 0) {
          let newColl = cy.collection();
          nodesToAdd.forEach((n) => {
            const id = n?.data?.id;
            if (id == null || id === "") return;
            const el = cy.getElementById(String(id));
            if (el.length > 0) newColl = newColl.union(el);
          });
          runPresetLayout(cy, newColl);
        } else {
          runPresetLayout(cy);
        }
      }

      if (!styleOnlyIncremental) {
        refreshStyles({ forceSheet: true, forceSizes: true });
      } else if (!edgesOnlyIncremental) {
        refreshStyles({ forceSizes: true, lightUpdate: true });
      } else if (stylesheet) {
        applyNodeSizes(cy);
      }

      const preserveUnchangedPositions =
        edgesOnlyIncremental || incrementalLayoutScope;

      requestAnimationFrame(() => {
        handleLayoutComplete(cy, isInitialLoad, {
          skipOverlap: preserveUnchangedPositions,
          skipEnsureBounds:
            preserveUnchangedPositions ||
            (styleOnlyIncremental && !incrementalLayoutScope),
        });
        if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
          cancelRipple();
          cancelRipple = scheduleRippleWhenPositionsPainted(
            cy,
            triggerRippleForAddedNodes
          );
        }
        finishInitialLoad();
      });
    } else if (hasDataOnlyVisualChange) {
      refreshStyles({ forceSizes: true });
      finishInitialLoad();
    } else if (stylesheetChanged || isInitialLoad) {
      refreshStyles({ forceSizes: true });
      if (isInitialLoad) {
        handleLayoutComplete(cy, true);
      }
      finishInitialLoad();
    }

    return () => {
      cancelRipple();
    };
    // elementsUpdateRef는 안정 ref — current만 소비하므로 deps 제외
  }, [
    cy,
    elementsFingerprint,
    elementsLength,
    stylesheet,
    updateStylesheet,
    applyNodeSizes,
    handleLayoutComplete,
    triggerRippleForAddedNodes,
    isInitialLoad,
    setIsInitialLoad,
  ]);
}

/** 툴팁 연 직후 같은 클릭으로 dismiss 되는 것 방지 */
const GRAPH_OUTSIDE_DISMISS_ATTACH_DELAY_MS = 10;

export function isGraphDragEndEvent(event) {
  const type = event?.detail?.type;
  return type === 'graphDragEnd' || type === 'dragend';
}

function eventClosest(event, selector) {
  return Boolean(event.target.closest?.(selector));
}

function shouldIgnoreCanvasOrDragEnd(event) {
  return eventClosest(event, '.graph-canvas-area') || isGraphDragEndEvent(event);
}

export function shouldIgnoreGraphPageOutsideClick(event) {
  if (isSidebarElement(event)) return true;
  if (eventClosest(event, '.modal-overlay')) return true;
  return shouldIgnoreCanvasOrDragEnd(event);
}

export function shouldIgnoreViewerOutsideClick(event) {
  if (eventClosest(event, '.graph-node-tooltip')) return true;
  if (eventClosest(event, '.edge-tooltip-container')) return true;
  if (eventClosest(event, '.modal-overlay')) return true;
  return shouldIgnoreCanvasOrDragEnd(event);
}

/**
 * 반환값 없는 fire-and-forget 훅.
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {(event: Event) => void} options.onDismiss
 * @param {(event: Event) => boolean} options.shouldIgnoreClick
 * @param {number} [options.attachDelayMs]
 * @param {boolean} [options.blockDragEndEvents=false]
 */
function useGraphOutsideDismiss({
  enabled,
  onDismiss,
  shouldIgnoreClick,
  attachDelayMs = GRAPH_OUTSIDE_DISMISS_ATTACH_DELAY_MS,
  blockDragEndEvents = false,
}) {
  const shouldIgnoreRef = useLatestRef(shouldIgnoreClick);
  const onDismissRef = useLatestRef(onDismiss);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleOutsideClick = (event) => {
      if (shouldIgnoreRef.current(event)) return;
      onDismissRef.current?.(event);
    };

    const handleDragEnd = (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
    };

    let dragEndBound = false;

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleOutsideClick, true);
      if (blockDragEndEvents) {
        document.addEventListener('graphDragEnd', handleDragEnd, true);
        document.addEventListener('dragend', handleDragEnd, true);
        dragEndBound = true;
      }
    }, attachDelayMs);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleOutsideClick, true);
      if (dragEndBound) {
        document.removeEventListener('graphDragEnd', handleDragEnd, true);
        document.removeEventListener('dragend', handleDragEnd, true);
      }
    };
  }, [enabled, shouldIgnoreRef, onDismissRef, attachDelayMs, blockDragEndEvents]);
}

/**
 * @param {object} options
 * @param {object|null} options.activeTooltip
 * @param {(tooltip: object) => void} [options.onSetActiveTooltip]
 * @param {() => void} [options.onBeforeOpen]
 * @param {(elementId: string) => void} options.centerSelection id만 전달
 * @param {number} options.focusDelayMs
 * @param {boolean} [options.tooltipOpen=false] 포커스·outside dismiss 공통 활성 플래그
 * @param {() => void} options.onDismiss
 * @param {(event: Event) => boolean} options.shouldIgnoreClick
 * @param {number} [options.attachDelayMs]
 * @param {boolean} [options.blockDragEndEvents]
 */
export function useGraphTooltipSelection({
  activeTooltip,
  onSetActiveTooltip,
  onBeforeOpen,
  centerSelection,
  focusDelayMs,
  tooltipOpen = false,
  onDismiss,
  shouldIgnoreClick,
  attachDelayMs,
  blockDragEndEvents = false,
}) {
  const centerSelectionRef = useLatestRef(centerSelection);
  const focusTooltipId =
    activeTooltip?.id != null && activeTooltip.id !== ''
      ? String(activeTooltip.id)
      : '';

  const openElementTooltip = useCallback((tapPayload, type) => {
    if (!onSetActiveTooltip) return;
    onBeforeOpen?.();
    onSetActiveTooltip(openTooltipFromTap(tapPayload, type));
  }, [onBeforeOpen, onSetActiveTooltip]);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useMemo(
    () => ({
      onShowNodeTooltip: (tapPayload) => openElementTooltip(tapPayload, 'node'),
      onShowEdgeTooltip: (tapPayload) => openElementTooltip(tapPayload, 'edge'),
    }),
    [openElementTooltip],
  );

  useEffect(() => {
    if (!tooltipOpen || !focusTooltipId) return undefined;
    const timeoutId = setTimeout(() => {
      centerSelectionRef.current?.(focusTooltipId);
    }, focusDelayMs);
    return () => clearTimeout(timeoutId);
  }, [focusTooltipId, focusDelayMs, tooltipOpen, centerSelectionRef]);

  useGraphOutsideDismiss({
    enabled: tooltipOpen,
    onDismiss,
    shouldIgnoreClick,
    attachDelayMs,
    blockDragEndEvents,
  });

  return { onShowNodeTooltip, onShowEdgeTooltip };
}

export default useGraphInteractions;

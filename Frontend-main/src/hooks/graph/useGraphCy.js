/** Cytoscape 런타임: tap·선택·layout·instance·tooltip dismiss */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  applySelectionHighlight,
  buildTapShowArgs,
  calculateGraphTooltipPosition,
  clearHighlightClassesOn,
  ensureElementsInBounds,
  fitGraphToNodes,
  isGraphDragEndEvent,
  isGraphContainerSizeReady,
  isSidebarElement,
  openTooltipFromTap,
  resolveGraphTooltipAnchor,
  syncReciprocalPairJunctionOffsets,
} from '../../utils/graph/graphCy';
import { detectAndResolveOverlap } from '../../utils/graph/graphModel';
import { PRESET_LAYOUT } from '../../utils/styles/graphStyles';
import { GRAPH_ZOOM } from '../../utils/graph/graphCore.js';
import { useLatestRef } from '../common/hooksShared';

function toCyId(value) {
  return String(value);
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

  const clearHighlightAndSelectionRef = useCallback(() => {
    resetAllStyles();
    clearSelectionRefs();
  }, [resetAllStyles, clearSelectionRefs]);

  const dismissSelection = useCallback(() => {
    clearHighlightAndSelectionRef();
    onClearTooltipRef.current?.();
  }, [clearHighlightAndSelectionRef, onClearTooltipRef]);

  const reapplySelectionHighlight = useCallback(() => {
    const cy = cyRef?.current;
    const selected = selectedElementRef?.current;
    if (!cy || !selected?.id) return;

    const el = cy.getElementById(toCyId(selected.id));
    if (el.length > 0) applySelectionHighlight(cy, el);
  }, [cyRef, selectedElementRef]);

  const selectElement = useCallback((kind, element) => {
    const cy = cyRef?.current;
    if (!cy) return false;
    try {
      applySelectionHighlight(cy, element);
    } catch {
      return false;
    }
    if (selectedElementRef) {
      selectedElementRef.current = { kind, id: toCyId(element.id()) };
    }
    return true;
  }, [cyRef, selectedElementRef]);

  const showElementTooltip = useCallback((kind, element, evt) => {
    const cy = cyRef?.current;
    if (!cy) return;
    const onShowTooltipRef = kind === 'node' ? onShowNodeTooltipRef : onShowEdgeTooltipRef;
    const center = calculateGraphTooltipPosition(cy, element, null, 0);
    const anchor = resolveGraphTooltipAnchor(cy, kind, element, evt);
    onShowTooltipRef.current?.(
      buildTapShowArgs(kind, element, evt, center, anchor.x, anchor.y),
    );
  }, [cyRef, onShowNodeTooltipRef, onShowEdgeTooltipRef]);

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

    const elementId = toCyId(element.id());
    const prev = selectedElementRef?.current;
    if (prev?.kind === kind && toCyId(prev.id) === elementId) {
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
    clearHighlightAndSelectionRef();
    if (fitViewport) fitGraphToNodes(cyRef?.current, { duration: 500 });
  }, [cyRef, clearHighlightAndSelectionRef]);

  const selectNodeByIdOrName = useCallback((idOrName) => {
    const cy = cyRef?.current;
    if (!cy || idOrName == null || idOrName === '') return false;

    const key = toCyId(idOrName);
    let element = cy.getElementById(key);
    if (!element?.length) {
      element = cy.nodes().filter((ele) => {
        const d = ele.data() || {};
        return (
          toCyId(d.id) === key ||
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
    if (!cy || typeof cy.container !== 'function') return null;
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
    cy.one('render', () => {
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
        fitGraphToNodes(cyInstance, { duration: GRAPH_ZOOM.FIT_DURATION_MS });
      }
      syncReciprocalPairJunctionOffsets(cyInstance);
    },
    [containerRef],
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
            if (id == null || id === '') return;
            const el = cy.getElementById(toCyId(id));
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
            triggerRippleForAddedNodes,
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

const GRAPH_OUTSIDE_DISMISS_ATTACH_DELAY_MS = 10;

const VIEWER_OUTSIDE_IGNORE_SELECTORS = [
  '.graph-node-tooltip',
  '.edge-tooltip-container',
];

function eventClosest(event, selector) {
  return Boolean(event.target.closest?.(selector));
}

function shouldIgnoreCanvasOrDragEnd(event) {
  return eventClosest(event, '.graph-canvas-area') || isGraphDragEndEvent(event);
}

function shouldIgnoreOutsideClick(event, { ignoreSidebar = false, extraSelectors = [] } = {}) {
  if (ignoreSidebar && isSidebarElement(event)) return true;
  if (eventClosest(event, '.modal-overlay')) return true;
  for (const selector of extraSelectors) {
    if (eventClosest(event, selector)) return true;
  }
  return shouldIgnoreCanvasOrDragEnd(event);
}

export function shouldIgnoreGraphPageOutsideClick(event) {
  return shouldIgnoreOutsideClick(event, { ignoreSidebar: true });
}

export function shouldIgnoreViewerOutsideClick(event) {
  return shouldIgnoreOutsideClick(event, { extraSelectors: VIEWER_OUTSIDE_IGNORE_SELECTORS });
}

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
      ? toCyId(activeTooltip.id)
      : '';

  const openElementTooltip = useCallback((tapPayload, type) => {
    if (!onSetActiveTooltip) return;
    onBeforeOpen?.();
    onSetActiveTooltip(openTooltipFromTap(tapPayload, type));
  }, [onBeforeOpen, onSetActiveTooltip]);

  const onShowNodeTooltip = useCallback(
    (tapPayload) => openElementTooltip(tapPayload, 'node'),
    [openElementTooltip],
  );
  const onShowEdgeTooltip = useCallback(
    (tapPayload) => openElementTooltip(tapPayload, 'edge'),
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

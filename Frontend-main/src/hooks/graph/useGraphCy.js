/** Cytoscape 런타임: tap·선택·layout·instance·tooltip dismiss + 캔버스 a11y */

import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import PropTypes from 'prop-types';
import {
  applySelectionHighlight,
  buildTapShowArgs,
  calculateGraphTooltipPosition,
  captureCyViewport,
  centerSelectionOnElementId,
  clearHighlightClassesOn,
  ensureElementsInBounds,
  fitGraphToNodes,
  fitGraphViewportInContainer,
  handleGraphCanvasHotkeys,
  isGraphDragEndEvent,
  isGraphContainerSizeReady,
  isSidebarElement,
  openTooltipFromTap,
  resolveGraphTooltipAnchor,
  restoreCyViewport,
  syncReciprocalPairJunctionOffsets,
  runPresetLayout,
  runCoseBilkentLayout,
} from '../../utils/graph/graphCy';
import {
  detectAndResolveOverlap,
  hasOverlappingNodes,
  collectNeighborhoodNodeIds,
  OVERLAP_RESOLVE,
  OVERLAP_PROFILES,
} from '../../utils/graph/graphModel';
import {
  GRAPH_LAYOUT_CONSTANTS,
  GRAPH_ZOOM,
  GRAPH_CHARACTER_FILTER_STAGE_OPTIONS,
} from '../../utils/graph/graphCore.js';
import { errorUtils } from '../../utils/common/urlUtils';
import { useLatestRef } from '../common/hooksShared';

function toCyId(value) {
  return String(value);
}

function elementDataIds(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((el) => el?.data?.id)
    .filter((id) => id != null && id !== '')
    .map(String);
}

function collectCyElementsByIds(cy, ids) {
  let coll = cy.collection();
  ids.forEach((id) => {
    const el = cy.getElementById(toCyId(id));
    if (el.length > 0) coll = coll.union(el);
  });
  return coll;
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

  /** 하이라이트 + 선택 ref 해제 (툴팁·fit은 호출부 옵션) */
  const clearHighlightAndSelection = useCallback(() => {
    if (cyRef?.current) clearHighlightClassesOn(cyRef.current);
    onAfterResetRef.current?.();
    clearSelectionRefs();
  }, [cyRef, onAfterResetRef, clearSelectionRefs]);

  const dismissSelection = useCallback(() => {
    clearHighlightAndSelection();
    onClearTooltipRef.current?.();
  }, [clearHighlightAndSelection, onClearTooltipRef]);

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
    } catch (err) {
      errorUtils.logDebug('useGraphCy', '선택 하이라이트 실패', {
        message: err?.message,
        kind,
      });
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
    const center = calculateGraphTooltipPosition(cy, element);
    const anchor = resolveGraphTooltipAnchor(cy, element);
    onShowTooltipRef.current?.(
      buildTapShowArgs(kind, element, evt, center, anchor.x, anchor.y),
    );
  }, [cyRef, onShowNodeTooltipRef, onShowEdgeTooltipRef]);

  const selectAndShowTooltip = useCallback((kind, element, evt) => {
    if (!selectElement(kind, element)) return false;
    try {
      showElementTooltip(kind, element, evt);
    } catch (err) {
      errorUtils.logDebug('useGraphCy', '툴팁 표시 실패', {
        message: err?.message,
        kind,
      });
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
   * 사용자 배율 보존이 기본이며, 명시적으로 요청한 경우에만 viewport를 fit한다.
   */
  const clearSelection = useCallback((options = {}) => {
    const fitViewport = options?.fitViewport === true;
    clearHighlightAndSelection();
    if (fitViewport) fitGraphToNodes(cyRef?.current, { duration: GRAPH_ZOOM.FIT_DURATION_MS });
  }, [cyRef, clearHighlightAndSelection]);

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

  const selectElementById = useCallback((kind, id) => {
    if (kind === 'node') return selectNodeByIdOrName(id);
    const cy = cyRef?.current;
    if (!cy || id == null || id === '') return false;
    const element = cy.getElementById(toCyId(id));
    if (!element?.length || !element.isEdge?.()) return false;
    return selectAndShowTooltip('edge', element, null);
  }, [cyRef, selectNodeByIdOrName, selectAndShowTooltip]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
    reapplySelectionHighlight,
    selectNodeByIdOrName,
    selectElementById,
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

/**
 * elementsUpdateRef 소비 후 분기:
 * 1) hasChanges          → layout(incremental preset | cose) → styles → rAF(complete: bounds/overlap/fit/junction)
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
  isInitialLoad,
  setIsInitialLoad,
  containerRef,
  pendingInitialFitRef = null,
  canApplyPendingViewportFit = null,
  clearPendingViewportFitBlock = null,
}) {
  const prevStylesheetRef = useRef(stylesheet);

  const handleLayoutComplete = useCallback(
    (cyInstance, shouldFitOnInitialLoad, options = {}) => {
      const {
        skipOverlap = false,
        skipEnsureBounds = false,
        movableIds = null,
      } = options;
      if (!cyInstance) return;

      const runBounds = () => {
        if (!skipEnsureBounds && isGraphContainerSizeReady(containerRef.current)) {
          ensureElementsInBounds(cyInstance, containerRef.current);
        }
      };

      runBounds();
      if (!skipOverlap) {
        const profile = shouldFitOnInitialLoad
          ? OVERLAP_PROFILES.INITIAL
          : OVERLAP_PROFILES.INCREMENTAL;
        detectAndResolveOverlap(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
          ...(movableIds ? { movableIds } : {}),
          ...profile,
        });
        // 밀어내기 후 화면 밖 노드 재제약 → 경계에서 생긴 겹침 경량 재해결
        runBounds();
        if (!skipEnsureBounds && isGraphContainerSizeReady(containerRef.current)) {
          detectAndResolveOverlap(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            ...(movableIds ? { movableIds } : {}),
            ...OVERLAP_PROFILES.RESIZE,
          });
        }
        // 최초 로딩: bounds/resize 후에도 본체 겹침이 남으면 제거
        if (
          shouldFitOnInitialLoad &&
          hasOverlappingNodes(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            ...OVERLAP_PROFILES.APPEAR,
          })
        ) {
          detectAndResolveOverlap(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            ...OVERLAP_PROFILES.APPEAR,
          });
          runBounds();
        }
      }
      if (shouldFitOnInitialLoad) {
        // 컨테이너 미준비 시 pending 유지 → resize에서 재시도
        if (pendingInitialFitRef) pendingInitialFitRef.current = true;
        if (
          (typeof canApplyPendingViewportFit !== 'function' || canApplyPendingViewportFit()) &&
          fitGraphViewportInContainer(cyInstance, containerRef.current)
        ) {
          if (pendingInitialFitRef) pendingInitialFitRef.current = false;
          clearPendingViewportFitBlock?.();
        }
      }
      syncReciprocalPairJunctionOffsets(cyInstance);
    },
    [containerRef, pendingInitialFitRef, canApplyPendingViewportFit, clearPendingViewportFitBlock],
  );

  useEffect(() => {
    if (!cy || !elementsLength) return;


    const {
      nodesToAdd = [],
      edgesToAdd = [],
      hasChanges = false,
      dataChangedIds = [],
      incrementalLayoutScope = false,
      needsLocalReorder = false,
    } = elementsUpdateRef.current || {};

    elementsUpdateRef.current = {
      nodesToAdd: [],
      edgesToAdd: [],
      hasChanges: false,
      dataChangedIds: [],
      incrementalLayoutScope: false,
      needsLocalReorder: false,
    };

    const stylesheetChanged = prevStylesheetRef.current !== stylesheet;
    prevStylesheetRef.current = stylesheet;

    const pendingFit = pendingInitialFitRef?.current === true;
    const pendingFitAllowed =
      !pendingFit ||
      typeof canApplyPendingViewportFit !== 'function' ||
      canApplyPendingViewportFit();
    const shouldFitViewport =
      Boolean(isInitialLoad) || (pendingFit && pendingFitAllowed);

    const edgesOnlyIncremental =
      hasChanges && nodesToAdd.length === 0 && edgesToAdd.length > 0;
    const hasDataOnlyVisualChange = !hasChanges && dataChangedIds.length > 0;
    const addedNodeIds = elementDataIds(nodesToAdd);

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
        } catch (err) {
          errorUtils.logDebug('useGraphCy', 'style update 실패', {
            message: err?.message,
          });
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
      const useIncrementalPreset =
        incrementalLayoutScope &&
        addedNodeIds.length > 0 &&
        !shouldFitViewport;

      const resolveOverlapCascade = (seedIds, forceExpand = false) => {
        const appearOpts = { ...OVERLAP_PROFILES.APPEAR };
        const incrementalOpts = { ...OVERLAP_PROFILES.INCREMENTAL };

        const stillAppearsOverlapping = (movableIds) =>
          hasOverlappingNodes(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            movableIds,
            ...appearOpts,
          });

        const resolveAppear = (movableIds) => {
          detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            ...appearOpts,
            movableIds,
          });
          return stillAppearsOverlapping(movableIds);
        };

        const resolveIncremental = (movableIds) => {
          detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            ...incrementalOpts,
            movableIds,
          });
          return hasOverlappingNodes(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
            movableIds,
            ...incrementalOpts,
          });
        };

        // 1) 신규 등장 노드끼리: tolerance 0으로 본체 겹침 제거
        if (seedIds.length >= 2) {
          let remain = resolveAppear(seedIds);
          for (let i = 0; remain && i < 2; i += 1) {
            remain = resolveAppear(seedIds);
          }
        }

        // 2) 기존과의 겹침: 신규만 → 필요 시 1·2-hop
        if (!forceExpand && seedIds.length > 0 && !resolveIncremental(seedIds)) return;

        const hop1 = [...collectNeighborhoodNodeIds(cy, seedIds, 1)];
        if (!resolveIncremental(hop1)) return;

        const hop2 = [...collectNeighborhoodNodeIds(cy, seedIds, 2)];
        resolveIncremental(hop2);

        // 신규끼리 잔여가 있으면 마지막으로 한 번 더 분리 (이웃 이동 후 재겹침 방지)
        if (seedIds.length >= 2 && stillAppearsOverlapping(seedIds)) {
          resolveAppear(seedIds);
        }
        // 중간 갱신에서는 사용자가 기억한 전체 배치를 보존한다.
        // 잔여 경미 겹침 때문에 전체 그래프 또는 cose로 확대하지 않는다.
      };

      if (edgesOnlyIncremental) {
        if (stylesheet) applyNodeSizes(cy);
      } else if (useIncrementalPreset) {
        runPresetLayout(cy, collectCyElementsByIds(cy, addedNodeIds));
        refreshStyles({
          forceSheet: stylesheetChanged,
          forceSizes: true,
          lightUpdate: !stylesheetChanged,
        });
      } else {
        refreshStyles({ forceSheet: true, forceSizes: true });
        runCoseBilkentLayout(cy);
      }

      requestAnimationFrame(() => {
        if (useIncrementalPreset) {
          resolveOverlapCascade(addedNodeIds, needsLocalReorder);
          handleLayoutComplete(cy, shouldFitViewport, {
            skipOverlap: true,
            skipEnsureBounds: !shouldFitViewport,
          });
        } else {
          handleLayoutComplete(cy, shouldFitViewport, {
            skipOverlap: edgesOnlyIncremental,
            movableIds: null,
            skipEnsureBounds: !shouldFitViewport && edgesOnlyIncremental,
          });
        }
        finishInitialLoad();
      });
    } else if (hasDataOnlyVisualChange) {
      // 이미지 blob resolve 등 data-only 변경: background-image 반영을 위해 style update
      refreshStyles({ forceSizes: true, lightUpdate: true });
      finishInitialLoad();
    } else if (stylesheetChanged || isInitialLoad) {
      refreshStyles({ forceSizes: true });
      if (isInitialLoad) {
        handleLayoutComplete(cy, true);
        finishInitialLoad();
      }
    }

    return undefined;
  }, [
    cy,
    elementsFingerprint,
    elementsLength,
    stylesheet,
    updateStylesheet,
    applyNodeSizes,
    handleLayoutComplete,
    isInitialLoad,
    setIsInitialLoad,
    elementsUpdateRef,
    pendingInitialFitRef,
    canApplyPendingViewportFit,
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

/** @param {'page' | 'viewer'} surface */
export function shouldIgnoreGraphOutsideClick(event, surface = 'page') {
  if (surface === 'viewer') {
    return shouldIgnoreOutsideClick(event, { extraSelectors: VIEWER_OUTSIDE_IGNORE_SELECTORS });
  }
  return shouldIgnoreOutsideClick(event, { ignoreSidebar: true });
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

/** 상단바 오른쪽 도구 너비 → CSS 변수 (--graph-split-tools-reserve) */
export function useGraphTopbarToolsReserve(topbarRef, toolsRef, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const topbar = topbarRef?.current;
    const tools = toolsRef?.current;
    if (!topbar || !tools) return undefined;

    const applyReserve = () => {
      const width = Math.ceil(tools.getBoundingClientRect().width);
      topbar.style.setProperty(
        '--graph-split-tools-reserve',
        `${Math.max(width, 1)}px`,
      );
    };

    applyReserve();
    const ro = new ResizeObserver(applyReserve);
    ro.observe(tools);
    return () => ro.disconnect();
  }, [enabled, topbarRef, toolsRef]);
}

/**
 * 그래프 캔버스의 뷰포트 포커스 저장/복원과 선택·툴팁 해제 로직을 한데 묶은 훅.
 * 노드/간선 선택 시 현재 뷰포트를 저장해뒀다가, 선택 해제(사이드바 닫힘, 챕터 전환 등) 시 복원한다.
 */
export function useGraphViewportFocus({
  cyRef,
  graphClearRef,
  isNarrow,
  isSidebarOpen,
  closeSidebar,
  startClosing,
  cancelClosing,
}) {
  const preFocusViewportRef = useRef(null);

  const clearGraphSelection = useCallback((options = {}) => {
    graphClearRef.current?.(options);
    if (options.restoreViewport === false) {
      preFocusViewportRef.current = null;
      return;
    }
    const snapshot = preFocusViewportRef.current;
    preFocusViewportRef.current = null;
    restoreCyViewport(cyRef.current, snapshot, {
      duration: GRAPH_LAYOUT_CONSTANTS.FOCUS_PAN_MS,
    });
  }, [cyRef, graphClearRef]);

  // 좌(챕터 레일)는 캔버스 offset으로 이미 제외. 우(정보 슬라이드바)는 오버레이라 예약.
  const centerSelection = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy || elementId == null || elementId === '') return;

    if (!preFocusViewportRef.current) {
      preFocusViewportRef.current = captureCyViewport(cy);
    }

    const reserveLeft = isNarrow && isSidebarOpen
      ? GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH
      : 0;

    centerSelectionOnElementId(cy, elementId, {
      duration: GRAPH_LAYOUT_CONSTANTS.FOCUS_PAN_MS,
      reserveRight: GRAPH_LAYOUT_CONSTANTS.TOOLTIP_SIDEBAR_WIDTH,
      reserveLeft,
      padding: 40,
    });
  }, [cyRef, isNarrow, isSidebarOpen]);

  const onClearTooltip = useCallback(() => {
    closeSidebar();
    const snapshot = preFocusViewportRef.current;
    preFocusViewportRef.current = null;
    restoreCyViewport(cyRef.current, snapshot, {
      duration: GRAPH_LAYOUT_CONSTANTS.FOCUS_PAN_MS,
    });
  }, [cyRef, closeSidebar]);

  const dismissTooltip = useCallback(() => {
    clearGraphSelection({ fitViewport: false });
    startClosing();
  }, [clearGraphSelection, startClosing]);

  const onBeforeOpenTooltip = useCallback(() => {
    cancelClosing();
  }, [cancelClosing]);

  return {
    clearGraphSelection,
    centerSelection,
    onClearTooltip,
    dismissTooltip,
    onBeforeOpenTooltip,
  };
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

export const GRAPH_CANVAS_ARIA_LABEL =
  '관계 그래프. 화살표로 인물 이동, Enter로 상세, 선택 후 좌우로 관계, 더하기 빼기 영으로 확대 축소 맞춤, Escape로 해제';

/**
 * 그래프 캔버스 region 키보드·live 안내.
 * selectElementRef.current(kind, id) → boolean
 */
export function useGraphCanvasKeyboard({
  cyRef,
  graphClearRef = null,
  selectElementRef,
  activeTooltip = null,
  onClearTooltip = null,
}) {
  const keyboardFocusRef = useRef(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const clearGraphSelection = useCallback(() => {
    if (typeof graphClearRef?.current === 'function') {
      graphClearRef.current();
      return;
    }
    onClearTooltip?.();
  }, [graphClearRef, onClearTooltip]);

  const onKeyDown = useCallback(
    (event) => {
      handleGraphCanvasHotkeys(event, {
        cy: cyRef?.current,
        onClearSelection: clearGraphSelection,
        keyboardFocusRef,
        onSelectById: (kind, id) => selectElementRef?.current?.(kind, id) ?? false,
        onAnnounce: setLiveAnnouncement,
        selectedKind: activeTooltip?.type || null,
        selectedId: activeTooltip?.id ?? null,
      });
    },
    [cyRef, clearGraphSelection, selectElementRef, activeTooltip],
  );

  return {
    onKeyDown,
    liveAnnouncement,
    ariaLabel: GRAPH_CANVAS_ARIA_LABEL,
  };
}

function countGraphElements(elements) {
  let nodeCount = 0;
  let edgeCount = 0;
  if (!Array.isArray(elements)) return { nodeCount, edgeCount };

  for (const el of elements) {
    const group = el?.group;
    const hasEdgeEnds = el?.data?.source != null && el?.data?.target != null;
    if (group === 'edges' || (!group && hasEdgeEnds)) {
      edgeCount += 1;
    } else {
      nodeCount += 1;
    }
  }
  return { nodeCount, edgeCount };
}

function resolveFilterStageLabel(filterStage) {
  return (
    GRAPH_CHARACTER_FILTER_STAGE_OPTIONS.find((o) => o.value === filterStage)?.label
    ?? '전체'
  );
}

function describeGraphSelection(activeTooltip) {
  if (!activeTooltip) return '';

  if (activeTooltip.type === 'node') {
    const name =
      activeTooltip.common_name
      || activeTooltip.name
      || activeTooltip.label
      || activeTooltip.data?.common_name
      || activeTooltip.data?.name
      || activeTooltip.data?.label
      || '이름 없음';
    return `인물 ${name} 상세가 열렸습니다.`;
  }

  if (activeTooltip.type === 'edge') {
    const src =
      activeTooltip.sourceEndpoint?.label
      || activeTooltip.sourceEndpoint?.common_name
      || '인물';
    const tgt =
      activeTooltip.targetEndpoint?.label
      || activeTooltip.targetEndpoint?.common_name
      || '인물';
    return `${src}와 ${tgt}의 관계 상세가 열렸습니다.`;
  }

  return '';
}

function buildGraphA11ySummary({
  chapterLabel,
  eventNum,
  nodeCount = 0,
  edgeCount = 0,
  filterLabel,
  isSearchActive = false,
  searchTerm = '',
  selectionText = '',
  isLoading = false,
}) {
  const parts = [];

  if (isLoading) {
    parts.push('그래프를 불러오는 중입니다.');
  }

  const chapter = chapterLabel || '챕터';
  const eventLabel =
    Number.isFinite(Number(eventNum)) && Number(eventNum) > 0
      ? `이벤트 ${Number(eventNum)}`
      : '이벤트 미확정';
  parts.push(`${chapter}, ${eventLabel}.`);
  parts.push(`인물 ${nodeCount}명, 관계 ${edgeCount}개.`);

  if (filterLabel) {
    parts.push(`표시 범위 ${filterLabel}.`);
  }

  const term = typeof searchTerm === 'string' ? searchTerm.trim() : '';
  if (isSearchActive && term) {
    parts.push(
      nodeCount === 0
        ? `"${term}" 검색 결과가 없습니다.`
        : `"${term}" 검색이 적용되었습니다.`,
    );
  }

  if (selectionText) {
    parts.push(selectionText);
  } else {
    parts.push('화살표·Enter로 탐색. Escape로 해제.');
  }

  return parts.join(' ');
}

/**
 * 그래프 캔버스용 스크린리더 요약 (시각적으로 숨김, aria-live)
 * 부모 region에 aria-describedby={statusId} 연결
 */
export function GraphA11yStatus({
  id: idProp = null,
  chapterLabel,
  eventNum,
  elements = [],
  filterStage = 0,
  isSearchActive = false,
  searchTerm = '',
  activeTooltip = null,
  isLoading = false,
  liveAnnouncement = '',
}) {
  const generatedId = useId();
  const statusId = idProp || generatedId;

  const summary = useMemo(() => {
    const { nodeCount, edgeCount } = countGraphElements(elements);
    return buildGraphA11ySummary({
      chapterLabel,
      eventNum,
      nodeCount,
      edgeCount,
      filterLabel: resolveFilterStageLabel(filterStage),
      isSearchActive,
      searchTerm,
      selectionText: describeGraphSelection(activeTooltip),
      isLoading,
    });
  }, [
    chapterLabel,
    eventNum,
    elements,
    filterStage,
    isSearchActive,
    searchTerm,
    activeTooltip,
    isLoading,
  ]);

  return createElement(
    Fragment,
    null,
    createElement(
      'p',
      {
        id: statusId,
        className: 'sr-only',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      },
      summary,
    ),
    createElement(
      'p',
      {
        className: 'sr-only',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      },
      liveAnnouncement,
    ),
  );
}

GraphA11yStatus.propTypes = {
  id: PropTypes.string,
  chapterLabel: PropTypes.string,
  eventNum: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  elements: PropTypes.array,
  filterStage: PropTypes.number,
  isSearchActive: PropTypes.bool,
  searchTerm: PropTypes.string,
  activeTooltip: PropTypes.object,
  isLoading: PropTypes.bool,
  liveAnnouncement: PropTypes.string,
};

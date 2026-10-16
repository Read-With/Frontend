/** Cytoscape 런타임: tap·선택·instance·tooltip dismiss·캔버스 키보드 (마운트·동기화·레이아웃은 useCyLifecycle) */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  isSidebarElement,
  openTooltipFromTap,
  handleGraphCanvasHotkeys,
  applySelectionHighlight,
  buildTapShowArgs,
  calculateGraphTooltipPosition,
  clearHighlightClassesOn,
  resolveGraphTooltipAnchor,
} from '../../utils/graph/graphCy';
import { captureCyViewport, centerSelectionOnElementId, restoreCyViewport } from '../../utils/graph/graphLayout';
import { GRAPH_LAYOUT_CONSTANTS } from '../../utils/graph/graphCore.js';
import { errorUtils } from '../../utils/common/valueUtils';
import { useLatestRef } from '../common/hooksShared';

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

    const el = cy.getElementById(String(selected.id));
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
      selectedElementRef.current = { kind, id: String(element.id()) };
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

  const selectNodeByIdOrName = useCallback((idOrName) => {
    const cy = cyRef?.current;
    if (!cy || idOrName == null || idOrName === '') return false;

    const key = String(idOrName);
    let element = cy.getElementById(key);
    if (!element?.length) {
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

  const selectElementById = useCallback((kind, id) => {
    if (kind === 'node') return selectNodeByIdOrName(id);
    const cy = cyRef?.current;
    if (!cy || id == null || id === '') return false;
    const element = cy.getElementById(String(id));
    if (!element?.length || !element.isEdge?.()) return false;
    return selectAndShowTooltip('edge', element, null);
  }, [cyRef, selectNodeByIdOrName, selectAndShowTooltip]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection: clearHighlightAndSelection,
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


const GRAPH_OUTSIDE_DISMISS_ATTACH_DELAY_MS = 10;

const VIEWER_OUTSIDE_IGNORE_SELECTORS = [
  '.graph-node-tooltip',
  '.edge-tooltip-container',
];

function eventClosest(event, selector) {
  return Boolean(event.target.closest?.(selector));
}

function shouldIgnoreOutsideClick(event, { ignoreSidebar = false, extraSelectors = [] } = {}) {
  if (ignoreSidebar && isSidebarElement(event)) return true;
  if (eventClosest(event, '.modal-overlay')) return true;
  for (const selector of extraSelectors) {
    if (eventClosest(event, selector)) return true;
  }
  return eventClosest(event, '.graph-canvas-area');
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
}) {
  const shouldIgnoreRef = useLatestRef(shouldIgnoreClick);
  const onDismissRef = useLatestRef(onDismiss);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleOutsideClick = (event) => {
      if (shouldIgnoreRef.current(event)) return;
      onDismissRef.current?.(event);
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleOutsideClick, true);
    }, attachDelayMs);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleOutsideClick, true);
    };
  }, [enabled, shouldIgnoreRef, onDismissRef, attachDelayMs]);
}

/** 상단바 오른쪽 도구 너비 → CSS 변수 (--graph-split-tools-reserve) */
export function useGraphTopbarToolsReserve(topbarRef, toolsRef) {
  useEffect(() => {
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
  }, [topbarRef, toolsRef]);
}

/**
 * 선택 포커스 전 뷰포트 저장/복원. 첫 centerSelection 직전 뷰포트를 저장해두고 release 시 복원.
 * @param {object} centerOptions centerSelectionOnElementId 옵션 (duration은 복원에도 사용). 매 렌더 최신값 사용
 */
export function usePreFocusViewport(cyRef, centerOptions) {
  const preFocusViewportRef = useRef(null);
  const optionsRef = useLatestRef(centerOptions);

  /** 저장된 뷰포트를 비우고, restore면 복원 */
  const releasePreFocusViewport = useCallback((restore = true) => {
    const snapshot = preFocusViewportRef.current;
    preFocusViewportRef.current = null;
    if (!restore) return;
    restoreCyViewport(cyRef.current, snapshot, { duration: optionsRef.current.duration });
  }, [cyRef, optionsRef]);

  const centerSelection = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy || elementId == null || elementId === '') return;
    if (!preFocusViewportRef.current) {
      preFocusViewportRef.current = captureCyViewport(cy);
    }
    centerSelectionOnElementId(cy, elementId, optionsRef.current);
  }, [cyRef, optionsRef]);

  return { centerSelection, releasePreFocusViewport };
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
  // 좌(챕터 레일)는 캔버스 offset으로 이미 제외. 우(정보 슬라이드바)는 오버레이라 예약.
  const { centerSelection, releasePreFocusViewport } = usePreFocusViewport(cyRef, {
    duration: GRAPH_LAYOUT_CONSTANTS.FOCUS_PAN_MS,
    reserveRight: GRAPH_LAYOUT_CONSTANTS.TOOLTIP_SIDEBAR_WIDTH,
    reserveLeft: isNarrow && isSidebarOpen ? GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH : 0,
    padding: 40,
  });

  /** @param {{ restoreViewport?: boolean }} [options] */
  const clearGraphSelection = useCallback(({ restoreViewport = true } = {}) => {
    graphClearRef.current?.();
    releasePreFocusViewport(restoreViewport);
  }, [graphClearRef, releasePreFocusViewport]);

  const onClearTooltip = useCallback(() => {
    closeSidebar();
    releasePreFocusViewport();
  }, [closeSidebar, releasePreFocusViewport]);

  const dismissTooltip = useCallback(() => {
    clearGraphSelection();
    startClosing();
  }, [clearGraphSelection, startClosing]);

  return {
    clearGraphSelection,
    centerSelection,
    onClearTooltip,
    dismissTooltip,
    onBeforeOpenTooltip: cancelClosing,
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
  });

  return { onShowNodeTooltip, onShowEdgeTooltip };
}

const GRAPH_CANVAS_ARIA_LABEL =
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

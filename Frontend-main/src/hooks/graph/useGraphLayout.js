/** Cytoscape 레이아웃·인스턴스 (preset/ripple/경계 보정) */

import { useEffect, useCallback, useRef, useMemo } from "react";
import {
  ensureElementsInBounds,
  isGraphContainerSizeReady,
  syncReciprocalPairJunctionOffsets,
  fitGraphToNodes,
} from "../../utils/graph/graphUtils";
import { detectAndResolveOverlap } from "../../utils/graph/graphDataUtils";
import { PRESET_LAYOUT } from "../../utils/styles/graphStyles";

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

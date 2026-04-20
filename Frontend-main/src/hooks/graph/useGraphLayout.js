import { useEffect, useCallback, useRef } from "react";
import { ensureElementsInBounds, syncReciprocalPairJunctionOffsets } from "../../utils/graph/graphUtils";
import { detectAndResolveOverlap } from "../../utils/graph/graphDataUtils";

function scheduleRippleWhenPositionsPainted(cy, triggerRippleForAddedNodes) {
  let cancelled = false;
  let fired = false;
  let fallbackId = 0;

  const run = () => {
    if (cancelled || fired) return;
    fired = true;
    if (fallbackId) {
      window.clearTimeout(fallbackId);
      fallbackId = 0;
    }
    try {
      triggerRippleForAddedNodes();
    } catch {
      /* ignore */
    }
  };

  const cancel = () => {
    cancelled = true;
    if (fallbackId) {
      window.clearTimeout(fallbackId);
      fallbackId = 0;
    }
  };

  fallbackId = window.setTimeout(run, 180);

  const arm = () => {
    if (cancelled) return;
    try {
      cy.one("render", () => {
        if (cancelled) return;
        if (fallbackId) {
          window.clearTimeout(fallbackId);
          fallbackId = 0;
        }
        requestAnimationFrame(() => {
          if (cancelled) return;
          requestAnimationFrame(run);
        });
      });
      cy.resize();
    } catch {
      if (fallbackId) {
        window.clearTimeout(fallbackId);
        fallbackId = 0;
      }
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(run);
      });
    }
  };

  requestAnimationFrame(() => {
    if (cancelled) return;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(arm);
    });
  });

  return cancel;
}

function fadeInNewElements(cy, elementsUpdateRef, onComplete, _skipAnimation, addSnapshot = null) {
  const snap = addSnapshot ?? elementsUpdateRef?.current;
  if (!cy || !snap) {
    onComplete?.();
    return;
  }
  const { nodesToAdd = [], edgesToAdd = [] } = snap;
  const ids = [...nodesToAdd, ...edgesToAdd]
    .map((x) => x?.data?.id)
    .filter((id) => id != null && id !== "");
  if (ids.length === 0) {
    onComplete?.();
    return;
  }

  let coll = cy.collection();
  ids.forEach((id) => {
    const e = cy.getElementById(String(id));
    if (e.length > 0) {
      coll = coll.union(e);
    }
  });
  if (coll.length === 0) {
    onComplete?.();
    return;
  }

  try {
    coll.style("opacity", 1);
  } catch {
    /* ignore */
  }
  onComplete?.();
}

function pulseDataChangedElements(cy, ids, onComplete) {
  if (!cy || !ids?.length) {
    onComplete?.();
    return;
  }
  let coll = cy.collection();
  ids.forEach((id) => {
    const e = cy.getElementById(String(id));
    if (e.length > 0) coll = coll.union(e);
  });
  if (coll.length === 0) {
    onComplete?.();
    return;
  }
  try {
    coll.style("opacity", 1);
  } catch {
    /* ignore */
  }
  onComplete?.();
}

export function useGraphLayout({
  cy,
  elementsFingerprint,
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
}) {
  const prevStylesheetRef = useRef(stylesheet);
  const layoutName =
    layout && typeof layout === "object" && layout.name != null ? String(layout.name) : "preset";

  const fitGraphOnInitialLoad = useCallback((cy) => {
    if (!cy) return;
    const nodes = cy.nodes();
    if (nodes && nodes.length > 0) {
      try {
        cy.fit(nodes, 80);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleLayoutComplete = useCallback(
    (cy, shouldFitOnInitialLoad, options = {}) => {
      const { skipOverlap = false, skipEnsureBounds = false } = options;
      if (!cy) return;

      if (!skipEnsureBounds) {
        ensureElementsInBounds(cy, containerRef.current);
      }
      if (!skipOverlap) {
        detectAndResolveOverlap(cy);
      }

      if (shouldFitOnInitialLoad) {
        fitGraphOnInitialLoad(cy);
      }

      syncReciprocalPairJunctionOffsets(cy);
      if (onLayoutComplete) onLayoutComplete();
    },
    [onLayoutComplete, containerRef, fitGraphOnInitialLoad]
  );

  useEffect(() => {
    if (!cy || !elementsLength) {
      return;
    }

    let cancelRipple = () => {};

    const {
      nodesToAdd = [],
      edgesToAdd = [],
      hasChanges = false,
      dataChangedIds = [],
      incrementalLayoutScope = false,
    } = elementsUpdateRef.current || {};
    const stylesheetChanged = prevStylesheetRef.current !== stylesheet;
    prevStylesheetRef.current = stylesheet;

    const edgesOnlyIncremental =
      hasChanges && nodesToAdd.length === 0 && edgesToAdd.length > 0;

    // 이미 그려진 그래프 위에만 얹는 경우: 전체 스타일시트 재적용·뷰 보정을 줄여 전체 깜빡임 방지
    const styleOnlyIncremental =
      hasChanges &&
      !isInitialLoad &&
      !stylesheetChanged;

    const hasDataOnlyVisualChange = !hasChanges && dataChangedIds.length > 0;

    if (hasChanges) {
      // 새 노드 좌표가 있을 때만 preset 재적용 (간선만 추가면 기존 노드 유지로 깜빡임 감소)
      if (!edgesOnlyIncremental) {
        if (incrementalLayoutScope && nodesToAdd.length > 0) {
          let newColl = cy.collection();
          nodesToAdd.forEach((n) => {
            const id = n?.data?.id;
            if (id == null || id === "") return;
            const el = cy.getElementById(String(id));
            if (el.length > 0) newColl = newColl.union(el);
          });
          if (newColl.length > 0) {
            try {
              cy.layout({ name: "preset", eles: newColl, fit: false, animate: false }).run();
            } catch {
              try {
                cy.layout({ name: "preset" }).run();
              } catch {
                /* ignore */
              }
            }
          }
        } else {
          cy.layout({ name: "preset" }).run();
        }
      }

      if (!styleOnlyIncremental) {
        updateStylesheet(cy);
      } else if (!edgesOnlyIncremental) {
        // 새 노드만 있을 때: 전체 시트 재주입은 피하고 규칙만 한 번 갱신
        try {
          cy.style().update();
        } catch {
          /* ignore */
        }
      }

      if (stylesheet && nodesToAdd && nodesToAdd.length > 0) {
        let newNodes = cy.collection();
        nodesToAdd.forEach((n) => {
          const id = n?.data?.id;
          if (id == null || id === "") return;
          const el = cy.getElementById(String(id));
          if (el.length > 0) {
            newNodes = newNodes.union(el);
          }
        });
        applyNodeSizes(cy, newNodes.length > 0 ? newNodes : cy.nodes());
      }

      const preserveUnchangedPositions =
        edgesOnlyIncremental || incrementalLayoutScope;

      const fadeSnapshot = {
        nodesToAdd: nodesToAdd.slice(),
        edgesToAdd: edgesToAdd.slice(),
      };

      const completeCallback = () => {
        handleLayoutComplete(cy, isInitialLoad, {
          skipOverlap: preserveUnchangedPositions,
          skipEnsureBounds:
            preserveUnchangedPositions || (styleOnlyIncremental && !incrementalLayoutScope),
        });
        fadeInNewElements(
          cy,
          elementsUpdateRef,
          () => {
            if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
              cancelRipple();
              cancelRipple = scheduleRippleWhenPositionsPainted(
                cy,
                triggerRippleForAddedNodes
              );
            }
            if (isInitialLoad) {
              setIsInitialLoad(false);
            }
          },
          true,
          fadeSnapshot
        );
      };

      if (layout && layoutName !== "preset") {
        const layoutInstance = cy.layout({
          ...layout,
          animationDuration: 800,
          animationEasing: "ease-out",
        });
        layoutInstance.on("layoutstop", () => {
          setTimeout(completeCallback, 200);
        });
        layoutInstance.run();
      } else {
        requestAnimationFrame(() => {
          completeCallback();
        });
      }
    } else if (hasDataOnlyVisualChange) {
      if (stylesheetChanged) {
        updateStylesheet(cy);
      }
      pulseDataChangedElements(cy, dataChangedIds, () => {
        handleLayoutComplete(cy, false, {
          skipOverlap: true,
          skipEnsureBounds: true,
        });
      });
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    } else {
      // 토폴로지·데이터 변경 없음: 스타일시트·초기 fit만 (동일 이벤트 페이지 전환 등에서 불필요한 리플로우 방지)
      if (stylesheetChanged) {
        updateStylesheet(cy);
      }
      if (stylesheetChanged || isInitialLoad) {
        if (isInitialLoad) {
          fitGraphOnInitialLoad(cy);
          setIsInitialLoad(false);
        }
      }
    }

    return () => {
      cancelRipple();
    };
  }, [
    cy,
    elementsFingerprint,
    elementsLength,
    stylesheet,
    layoutName,
    elementsUpdateRef,
    updateStylesheet,
    applyNodeSizes,
    handleLayoutComplete,
    triggerRippleForAddedNodes,
    isInitialLoad,
    setIsInitialLoad,
    fitGraphOnInitialLoad,
  ]);
}

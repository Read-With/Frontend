/** CytoscapeGraph 전용 생명주기 훅: 마운트·탭·elements 동기화·레이아웃·뷰포트 fit·검색 하이라이트·resize */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  detectAndResolveOverlap,
  hasOverlappingNodes,
  collectNeighborhoodNodeIds,
  OVERLAP_RESOLVE,
  OVERLAP_PROFILES,
} from "../../utils/graph/graphLayout.js";
import { GRAPH_ZOOM } from "../../utils/graph/graphCore.js";
import { errorUtils } from "../../utils/common/valueUtils";
import {
  safeCyCall,
  stableIdListKey,
  resolveUserDragCollisions,
  mountCytoscape,
  syncElementsIntoCy,
  runPresetLayout,
  runCoseBilkentLayout,
} from "../../utils/graph/graphCy.js";
import {
  isGraphContainerSizeReady,
  fitGraphViewportInContainer,
  ensureElementsInBounds,
  isElementsFitInViewport,
} from "../../utils/graph/graphViewport.js";
import { applySearchFadeEffect, syncReciprocalPairJunctionOffsets, clearHighlightClassesOn } from "../../utils/graph/graphHighlight.js";
import { getResponsiveNodeSizeRange } from "../../utils/styles/graphStyles.js";
import { useLatestRef } from "../common/hooksShared.js";

const EMPTY_ELEMENTS_UPDATE = {
  nodesToAdd: [],
  edgesToAdd: [],
  hasChanges: false,
  dataChangedIds: [],
  incrementalLayoutScope: false,
  needsLocalReorder: false,
};

const isEmpty = (arr) => !arr || arr.length === 0;

function elementDataIds(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((el) => el?.data?.id)
    .filter((id) => id != null && id !== '')
    .map(String);
}

function collectCyElementsByIds(cy, ids) {
  let coll = cy.collection();
  ids.forEach((id) => {
    const el = cy.getElementById(String(id));
    if (el.length > 0) coll = coll.union(el);
  });
  return coll;
}

/** 인스턴스 생성·드래그 충돌 해소·reciprocal junction 동기화. 이 effect가 생성한 인스턴스만 destroy */
export function useCytoscapeMount({ containerRef, externalCyRef, initialStylesheetRef, setCyReady }) {
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const mounted = mountCytoscape(containerRef.current, externalCyRef, initialStylesheetRef.current);
    if (!mounted) return undefined;
    const { cyInstance, didCreateInstance } = mounted;
    if (!cyInstance || !cyInstance.container()) return undefined;

    let overlapRafId = 0;
    let activeDragNode = null;

    const handleDragFreeOn = (evt) => {
      activeDragNode = null;
      if (overlapRafId) {
        window.cancelAnimationFrame(overlapRafId);
        overlapRafId = 0;
      }
      resolveUserDragCollisions(cyInstance, containerRef.current, evt?.target, { clampBounds: true });
    };

    const handleDrag = (evt) => {
      // 드래그 시작 시 1회만 transition 해제 (drag 이벤트마다 스타일 쓰기 방지)
      if (activeDragNode !== evt.target) evt.target.style("transition-property", "none");
      activeDragNode = evt.target;
      if (overlapRafId) return;
      overlapRafId = window.requestAnimationFrame(() => {
        overlapRafId = 0;
        if (!activeDragNode) return;
        resolveUserDragCollisions(cyInstance, containerRef.current, activeDragNode, { clampBounds: false });
      });
    };

    const handlePosition = (evt) => {
      const node = evt.target;
      try {
        if (node.connectedEdges("[?reciprocalPair]").length === 0) return;
      } catch {
        return;
      }
      // 드래그 중인 노드만 즉시 동기화. 레이아웃·겹침 해소처럼 여러 노드가 한꺼번에 움직이면
      // 노드마다 동기화하지 않고 다음 프레임에 전체 1회로 합침
      if (node.grabbed()) {
        syncReciprocalPairJunctionOffsets(cyInstance, { nodes: node, immediate: true });
      } else {
        syncReciprocalPairJunctionOffsets(cyInstance);
      }
    };

    cyInstance.on("position", "node", handlePosition);
    cyInstance.on("dragfreeon", "node", handleDragFreeOn);
    cyInstance.on("drag", "node", handleDrag);

    setCyReady(true);

    return () => {
      setCyReady(false);
      activeDragNode = null;
      if (overlapRafId) window.cancelAnimationFrame(overlapRafId);
      cyInstance.removeListener("position", "node", handlePosition);
      cyInstance.removeListener("dragfreeon", "node", handleDragFreeOn);
      cyInstance.removeListener("drag", "node", handleDrag);
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
  }, [externalCyRef, containerRef, initialStylesheetRef, setCyReady]);
}

export function useCyTapHandlers(cy, { tapNodeHandler, tapEdgeHandler, tapBackgroundHandler }) {
  useEffect(() => {
    if (!cy) return undefined;

    cy.on("tap", "node", tapNodeHandler);
    cy.on("tap", "edge", tapEdgeHandler);
    cy.on("tap", tapBackgroundHandler);

    return () => {
      cy.removeListener("tap", "node", tapNodeHandler);
      cy.removeListener("tap", "edge", tapEdgeHandler);
      cy.removeListener("tap", tapBackgroundHandler);
    };
  }, [cy, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);
}

/** elements → cy 동기화. elementsUpdateRef는 useGraphLayout이 소비 (junction sync도 그쪽에서 1회) */
export function useCyElementSync({ cy, elements, elementsGraphFingerprint, isDataRefreshing, containerRef }) {
  const [isGraphVisible, setIsGraphVisible] = useState(false);
  const elementsUpdateRef = useRef(EMPTY_ELEMENTS_UPDATE);
  const elementsVisualSigRef = useRef(new Map());
  const lastElementsGraphFingerprintRef = useRef("");
  const prevStructureFingerprintRef = useRef("");

  useEffect(() => {
    if (!cy) return;

    if (isEmpty(elements)) {
      elementsUpdateRef.current = EMPTY_ELEMENTS_UPDATE;
      lastElementsGraphFingerprintRef.current = "";
      prevStructureFingerprintRef.current = "";
      elementsVisualSigRef.current = new Map();
      // 데이터 갱신 중이면 기존 그래프를 지우지 않고 유지 (깜빡임 방지)
      if (!isDataRefreshing) {
        cy.elements().remove();
        setIsGraphVisible(false);
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

    let synced = null;
    cy.batch(() => {
      synced = syncElementsIntoCy(cy, elements, {
        prevSig: elementsVisualSigRef.current,
        prevStructureFp: prevStructureFingerprintRef.current,
        containerWidth: containerRef.current?.clientWidth || 800,
        containerHeight: containerRef.current?.clientHeight || 600,
      });
    });
    elementsVisualSigRef.current = synced.nextSig;
    prevStructureFingerprintRef.current = synced.structureFp;
    elementsUpdateRef.current = synced.update;

    lastElementsGraphFingerprintRef.current = elementsGraphFingerprint;
    setIsGraphVisible(true);
  }, [elements, elementsGraphFingerprint, isDataRefreshing, cy, containerRef]);

  return { isGraphVisible, elementsUpdateRef };
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

      // 전체 재배치(초기·챕터 전환)가 아닌 증분 갱신(이벤트 확정 등)에서는 기존 배치를
      // 흔들지 않는 게 원칙이지만, 늘어난 노드·간선(라벨 포함)이 현재 팬·줌 뷰포트를
      // 벗어나면 좁은 화면 안으로 욱여넣어(cramping) 겹치는 대신 카메라를 재조정한다.
      if (!shouldFitOnInitialLoad && isGraphContainerSizeReady(containerRef.current)) {
        const visible = cyInstance.elements(':visible');
        if (
          visible.length > 0 &&
          !isElementsFitInViewport(cyInstance, visible, GRAPH_ZOOM.FIT_PADDING)
        ) {
          // fitGraphViewportInContainer는 fit 직후 동기적으로 ensureElementsInBounds를
          // 돌리므로(애니메이션 중 팬·줌 값을 기준으로 하면 어긋남) duration 0(즉시)을 유지한다.
          const refit = fitGraphViewportInContainer(cyInstance, containerRef.current, {
            eles: visible,
          });
          if (refit) {
            syncReciprocalPairJunctionOffsets(cyInstance);
            return;
          }
        }
      }

      const runBounds = () => {
        if (skipEnsureBounds || !isGraphContainerSizeReady(containerRef.current)) return;
        if (!movableIds) {
          ensureElementsInBounds(cyInstance, containerRef.current);
          return;
        }
        // 전체 fit이 없는 증분 추가: 새로 들어온 노드만 캔버스 안으로 제약하고
        // 기존 노드는 사용자가 기억한 배치를 그대로 유지한다.
        const idSet = movableIds instanceof Set ? movableIds : new Set([...movableIds].map(String));
        if (idSet.size === 0) return;
        const scopedNodes = cyInstance.nodes().filter((n) => idSet.has(String(n.id())));
        if (scopedNodes.length > 0) {
          ensureElementsInBounds(cyInstance, containerRef.current, { nodes: scopedNodes });
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

    elementsUpdateRef.current = EMPTY_ELEMENTS_UPDATE;

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
          // 전체 fit이 없는 경로라도, 새로 추가된 노드는 항상 캔버스 안으로 제약해
          // 이벤트 이동 시 잘려 보이지 않게 한다(기존 노드 배치는 movableIds 범위로 보존).
          handleLayoutComplete(cy, shouldFitViewport, {
            skipOverlap: true,
            skipEnsureBounds: false,
            movableIds: addedNodeIds,
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

/**
 * 챕터 전환 등 viewportFitKey가 바뀌면 다음 레이아웃/resize에서 전체 fit.
 * 전환 직후 이전 fingerprint와 같은 elements(이전 챕터 잔여)면 fit 보류.
 */
export function usePendingViewportFit(viewportFitKey, elementsGraphFingerprint) {
  const pendingInitialFitRef = useRef(false);
  const blockFitWhileFingerprintRef = useRef(null);
  const lastViewportFitKeyRef = useRef(viewportFitKey);
  const elementsGraphFingerprintRef = useLatestRef(elementsGraphFingerprint);

  useEffect(() => {
    if (viewportFitKey == null || viewportFitKey === '') return;
    if (lastViewportFitKeyRef.current === viewportFitKey) return;
    lastViewportFitKeyRef.current = viewportFitKey;
    pendingInitialFitRef.current = true;
    blockFitWhileFingerprintRef.current = elementsGraphFingerprintRef.current || "";
  }, [viewportFitKey, elementsGraphFingerprintRef]);

  const canApplyPendingViewportFit = useCallback(() => {
    const blocked = blockFitWhileFingerprintRef.current;
    if (blocked == null) return true;
    return elementsGraphFingerprintRef.current !== blocked;
  }, [elementsGraphFingerprintRef]);

  const clearPendingViewportFitBlock = useCallback(() => {
    blockFitWhileFingerprintRef.current = null;
  }, []);

  return { pendingInitialFitRef, canApplyPendingViewportFit, clearPendingViewportFitBlock };
}

/** 검색 결과 중심 이동·하이라이트 + 검색 fade (선택 하이라이트는 fade 뒤에 재적용) */
export function useCySearchHighlight({
  cy,
  elementsGraphFingerprint,
  elementsLength,
  fitNodeIds,
  isSearchActive,
  filteredElements,
  applyNodeSizes,
  reapplySelectionHighlight,
}) {
  const fitNodeIdsKey = useMemo(
    () => stableIdListKey(fitNodeIds),
    [fitNodeIds],
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitNodeIdsKey is the stable identity of fitNodeIds
  }, [cy, elementsGraphFingerprint, elementsLength, fitNodeIdsKey, isSearchActive, applyNodeSizes]);

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
  }, [cy, isSearchActive, filteredElements, reapplySelectionHighlight]);
}

/** 컨테이너 크기 변화: cy.resize → (120ms 디바운스) 노드 크기 재계산·필요 시 겹침 해소·대기 중 fit */
export function useCyResize({
  cy,
  containerRef,
  applyNodeSizes,
  pendingInitialFitRef,
  canApplyPendingViewportFit,
  clearPendingViewportFitBlock,
}) {
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
            // pending(최초/챕터 fit)일 때만 — 이전 챕터 잔여 데이터면 보류
            if (
              pendingInitialFitRef.current &&
              canApplyPendingViewportFit() &&
              fitGraphViewportInContainer(cy, el)
            ) {
              pendingInitialFitRef.current = false;
              clearPendingViewportFitBlock();
            }
          }, 'useCyResize:inner');
        }, 120);
      }, 'useCyResize');
    };

    const observer = new ResizeObserver(handleSize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
    };
  }, [cy, containerRef, applyNodeSizes, pendingInitialFitRef, canApplyPendingViewportFit, clearPendingViewportFitBlock]);
}

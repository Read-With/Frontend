import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { UserSearch } from "lucide-react";
import { buildElementsGraphFingerprint } from '../../../utils/graph/graphElements.js';
import {
  safeCyCall,
  applySearchFadeEffect,
  shouldShowNoSearchResults,
  getNoSearchResultsMessage,
} from '../../../utils/graph/graphCy.js';
import { zoomGraphByFactor } from '../../../utils/graph/graphLayout.js';
import { GRAPH_ZOOM } from '../../../utils/graph/graphCore.js';
import { applyNormalizedNodeSizes } from "../../../utils/graph/graphStyles";
import { useGraphInteractions, useCyInstance } from '../../../hooks/graph/useGraphCy.js';
import {
  useCytoscapeMount,
  useGraphLayout,
  useCyTapHandlers,
  useCyElementSync,
  usePendingViewportFit,
  useCySearchHighlight,
  useCyResize,
} from '../../../hooks/graph/useCyLifecycle.js';
import { useLatestRef } from '../../../hooks/common/hooksShared.js';

/** imperative handle 슬롯: mount 시 할당, unmount 시 null */
function useRefSlot(slotRef, value) {
  useEffect(() => {
    if (!slotRef) return undefined;
    slotRef.current = value;
    return () => {
      slotRef.current = null;
    };
  }, [slotRef, value]);
}

const ZOOM_CONTROL_BUTTONS = [
  { factor: GRAPH_ZOOM.STEP, label: '그래프 확대', title: '확대', text: '+' },
  { factor: 1 / GRAPH_ZOOM.STEP, label: '그래프 축소', title: '축소', text: '−' },
];

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

const CytoscapeGraph = ({
  elements,
  stylesheet,
  fitNodeIds,
  cyRef: externalCyRef,
  searchTerm,
  isSearchActive,
  filteredElements,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedElementRef,
  graphClearRef,
  /** 그래프 페이지만 (관계 분석에서 연결 인물 선택) */
  graphSelectNodeRef,
  graphSelectElementRef,
  /** 그래프 페이지만: 갱신 중엔 빈 elements가 와도 기존 그래프 유지 */
  isDataRefreshing,
  /** 챕터 전환 등 뷰포트 재맞춤 트리거 (값이 바뀌면 전체 fit) */
  viewportFitKey,
}) => {
  const containerRef = useRef(null);
  const [cyReady, setCyReady] = useState(false);
  const initialStylesheetRef = useLatestRef(stylesheet);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const cy = useCyInstance(externalCyRef, cyReady);

  const elementsGraphFingerprint = useMemo(
    () => (elements?.length ? buildElementsGraphFingerprint(elements) : ""),
    [elements]
  );
  const elementsLength = Array.isArray(elements) ? elements.length : 0;

  const {
    pendingInitialFitRef,
    canApplyPendingViewportFit,
    clearPendingViewportFitBlock,
  } = usePendingViewportFit(viewportFitKey, elementsGraphFingerprint);

  const updateStylesheet = useCallback((cyInst) => {
    if (!cyInst || !stylesheet) return;
    // cy.style(sheet)는 적용 후 update()까지 수행 (별도 update 호출 시 전체 style 재계산이 2번)
    return safeCyCall(cyInst, () => {
      cyInst.style(stylesheet);
      return true;
    }, 'CytoscapeGraph:style');
  }, [stylesheet]);

  const applyNodeSizes = useCallback((cyInst, nodes, scale = 1, targetNodes = null) => {
    applyNormalizedNodeSizes(cyInst, {
      scaledNodes: nodes,
      scale,
      targetNodes,
      containerWidth: containerRef.current?.clientWidth,
    });
  }, []);

  const reapplySearchFade = useCallback(() => {
    if (!cy || !isSearchActive) return;
    // onAfterReset은 clearHighlightAndSelection이 하이라이트를 지운 직후에만 호출됨
    applySearchFadeEffect(cy, filteredElements || [], { alreadyCleared: true });
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

  useCytoscapeMount({ containerRef, externalCyRef, initialStylesheetRef, setCyReady });
  useCyTapHandlers(cy, { tapNodeHandler, tapEdgeHandler, tapBackgroundHandler });

  const { isGraphVisible, elementsUpdateRef } = useCyElementSync({
    cy,
    elements,
    elementsGraphFingerprint,
    isDataRefreshing,
    containerRef,
  });

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
    canApplyPendingViewportFit,
    clearPendingViewportFitBlock,
  });

  useCySearchHighlight({
    cy,
    elementsGraphFingerprint,
    elementsLength,
    fitNodeIds,
    isSearchActive,
    filteredElements,
    applyNodeSizes,
    reapplySelectionHighlight,
  });

  useCyResize({
    cy,
    containerRef,
    applyNodeSizes,
    pendingInitialFitRef,
    canApplyPendingViewportFit,
    clearPendingViewportFitBlock,
  });

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
      <GraphZoomControls cy={cy} />
    </div>
  );
};

export default CytoscapeGraph;

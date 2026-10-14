import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { UserSearch } from "lucide-react";
import { buildElementsGraphFingerprint } from "../../../utils/graph/graphElements.js";
import { safeCyCall } from "../../../utils/graph/graphCy.js";
import { zoomGraphByFactor } from "../../../utils/graph/graphViewport.js";
import { applySearchFadeEffect, shouldShowNoSearchResults, getNoSearchResultsMessage } from "../../../utils/graph/graphHighlight.js";
import { GRAPH_ZOOM } from "../../../utils/graph/graphCore.js";
import { applyNormalizedNodeSizes } from "../../../utils/styles/graphStyles.js";
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
import { useRefSlot, useLatestRef } from '../../../hooks/common/hooksShared.js';

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

const CytoscapeGraph = ({
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
  /** 챕터 전환 등 뷰포트 재맞춤 트리거 (값이 바뀌면 전체 fit) */
  viewportFitKey = null,
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

  useEffect(() => {
    if (!onCyReady) return undefined;
    if (cyReady && cy) {
      onCyReady(cy);
      return () => onCyReady(null);
    }
    onCyReady(null);
    return undefined;
  }, [cy, cyReady, onCyReady]);

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
      <GraphZoomControls cy={showZoomControls ? cy : null} />
    </div>
  );
};

export default CytoscapeGraph;

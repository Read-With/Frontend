import { lazy, memo, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './UnifiedNodeInfo';
import { GraphFloatingControls, GraphTopBarMeta } from './GraphControls';
import {
  GRAPH_LAYOUT_CONSTANTS,
  resolveChapterSidebarWidth,
} from '../../utils/graph/graphCore.js';
import { formatChapterOrdinalLabel } from '../../utils/viewer/viewerCore';
import { GraphA11yStatus, useGraphCanvasKeyboard, useGraphTopbarToolsReserve } from '../../hooks/graph/useGraphCy.js';

const UnifiedEdgeTooltip = lazy(() => import('./UnifiedEdgeTooltip'));

const {
  TOOLTIP_SIDEBAR_WIDTH: SIDEBAR_WIDTH,
  ANIMATION_MS: ANIMATION_DURATION,
} = GRAPH_LAYOUT_CONSTANTS;

function clearTimeoutRef(timeoutRef) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

function GraphLoadingOverlay() {
  return <div className="graph-canvas-loading" role="status">그래프 업데이트 중...</div>;
}

function GraphSidebar({
  activeTooltip,
  onClose,
  currentChapter,
  eventNum,
  filename,
  elements = [],
  onStartClosing,
  onClearGraph,
  isSidebarClosing = false,
  povSummaries = null,
  povError = null,
  povIsLoading = false,
  povCached = null,
  onRetryPov = null,
  apiBookGraphData = null,
  bookId = null,
  onSelectRelatedNode = null,
  chapterRailWidth = null,
  onRequestFocusCanvas = null,
  pendingKeepAnalysisOpenRef = null,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);
  const restoreCanvasFocusRef = useRef(false);

  const sidebarStyle = useMemo(() => ({
    right: isClosing || !isVisible ? `-${SIDEBAR_WIDTH}px` : '0px',
  }), [isClosing, isVisible]);

  const finishClose = useCallback(() => {
    onClose();
    setIsClosing(false);
    setIsVisible(false);
    animationTimeoutRef.current = null;
    if (restoreCanvasFocusRef.current) {
      restoreCanvasFocusRef.current = false;
      onRequestFocusCanvas?.();
    }
  }, [onClose, onRequestFocusCanvas]);

  const runCloseAnimation = useCallback(() => {
    clearTimeoutRef(animationTimeoutRef);
    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(finishClose, ANIMATION_DURATION);
  }, [finishClose]);

  const handleClose = useCallback(() => {
    restoreCanvasFocusRef.current = true;
    onClearGraph?.();
    onStartClosing?.();
    runCloseAnimation();
  }, [onClearGraph, onStartClosing, runCloseAnimation]);

  useEffect(() => {
    const prevActiveTooltip = previousActiveTooltipRef.current;

    if (activeTooltip && !prevActiveTooltip) {
      clearTimeoutRef(animationTimeoutRef);
      setIsClosing(false);
      setIsVisible(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
    } else if (!activeTooltip && prevActiveTooltip) {
      runCloseAnimation();
    }

    previousActiveTooltipRef.current = activeTooltip;
  }, [activeTooltip, runCloseAnimation]);

  useEffect(() => {
    if (isSidebarClosing && !isClosing) {
      runCloseAnimation();
    }
  }, [isSidebarClosing, isClosing, runCloseAnimation]);

  useEffect(() => () => clearTimeoutRef(animationTimeoutRef), []);

  if (!isVisible && !isClosing && !activeTooltip) {
    return null;
  }

  const sharedTooltipProps = {
    onClose: handleClose,
    currentChapter,
    eventNum,
  };

  let tooltipContent = null;
  if (activeTooltip?.type === 'node') {
    tooltipContent = (
      <UnifiedNodeInfo
        displayMode="sidebar"
        data={activeTooltip}
        elements={elements}
        filename={filename}
        povSummaries={povSummaries}
        povError={povError}
        povIsLoading={povIsLoading}
        povCached={povCached}
        onRetryPov={onRetryPov}
        apiBookGraphData={apiBookGraphData}
        onSelectRelatedNode={onSelectRelatedNode}
        chapterRailWidth={chapterRailWidth}
        pendingKeepAnalysisOpenRef={pendingKeepAnalysisOpenRef}
        {...sharedTooltipProps}
      />
    );
  } else if (activeTooltip) {
    tooltipContent = (
      <Suspense fallback={<div role="status" aria-live="polite">관계 정보를 불러오는 중…</div>}>
        <UnifiedEdgeTooltip
          data={activeTooltip.data}
          variant="graphPage"
          bookId={bookId}
          sourceEndpoint={activeTooltip.sourceEndpoint}
          targetEndpoint={activeTooltip.targetEndpoint}
          {...sharedTooltipProps}
        />
      </Suspense>
    );
  }

  return (
    <div
      className="graph-page-sidebar"
      style={sidebarStyle}
      data-testid="graph-sidebar"
    >
      {tooltipContent}
    </div>
  );
}

function GraphCanvas({
  isSidebarOpen,
  sidebarLayoutWidth,
  activeTooltip,
  cyRef,
  eventNum,
  filename,
  elements,
  renderElements,
  povSummaries,
  povError = null,
  povIsLoading = false,
  povCached = null,
  onRetryPov = null,
  apiBookGraphData,
  bookId,
  isLoading,
  hasShownGraphOnce,
  onCanvasClick,
  currentChapter,
  chapterDisplayLabel = null,
  chapterTitleTooltip = null,
  sidebarControl,
  searchState,
  floatingControls = null,
  pageChromeStart = null,
  cytoscapeConfig,
  tooltipHandlers,
  graphClearRef,
  graphSelectNodeRef = null,
  onSelectRelatedNode = null,
  pendingKeepAnalysisOpenRef = null,
}) {
  const { isSidebarClosing, onCloseSidebar, onStartClosing, onClearGraph } = sidebarControl;
  const { isSearchActive, filteredElements, searchTerm, fitNodeIds } = searchState;
  const { stylesheet } = cytoscapeConfig;
  const {
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedElementRef,
  } = tooltipHandlers;

  const topbarRef = useRef(null);
  const toolsRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const selectElementRef = useRef(null);
  const a11yStatusId = useId();
  const showSidebar = !!(activeTooltip || isSidebarClosing);
  const usePageChrome = !!(pageChromeStart || floatingControls);

  const chapterRailWidth = sidebarLayoutWidth != null
    ? sidebarLayoutWidth
    : resolveChapterSidebarWidth(isSidebarOpen);
  const chapterLabel = chapterDisplayLabel || formatChapterOrdinalLabel(currentChapter);
  const a11yElements = isSearchActive && Array.isArray(filteredElements)
    ? filteredElements
    : renderElements;
  const filterStage = floatingControls?.filterStage ?? 0;

  const { onKeyDown: handleCanvasKeyDown, liveAnnouncement, ariaLabel } = useGraphCanvasKeyboard({
    cyRef,
    graphClearRef,
    selectElementRef,
    activeTooltip,
    onClearTooltip,
  });

  const focusCanvas = useCallback(() => {
    requestAnimationFrame(() => {
      canvasAreaRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useGraphTopbarToolsReserve(topbarRef, toolsRef, usePageChrome);

  return (
    <div
      className="graph-canvas-shell"
      style={{ left: `${chapterRailWidth}px` }}
    >
      <div className="graph-page-shell graph-page-shell--fill">
        {usePageChrome ? (
          <>
            <div className="graph-page-topbar" ref={topbarRef}>
              <div className="graph-page-topbar-center">
                <GraphTopBarMeta
                  chapterLabel={chapterLabel}
                  chapterTitle={chapterTitleTooltip}
                />
              </div>
              <div className="graph-page-topbar-tools" ref={toolsRef}>
                {floatingControls ? (
                  <GraphFloatingControls
                    searchState={floatingControls.searchState}
                    searchActions={floatingControls.searchActions}
                    edgeLabelVisible={floatingControls.edgeLabelVisible}
                    onToggleEdgeLabel={floatingControls.onToggleEdgeLabel}
                    filterStage={floatingControls.filterStage}
                    onFilterChange={floatingControls.onFilterChange}
                    showLegend
                  />
                ) : null}
                {floatingControls && pageChromeStart ? (
                  <span className="graph-split-topbar-sep" aria-hidden />
                ) : null}
                {pageChromeStart}
              </div>
            </div>
          </>
        ) : null}

        <div className="graph-page-inner">
          {showSidebar && (
            <GraphSidebar
              activeTooltip={activeTooltip}
              onClose={onCloseSidebar}
              onStartClosing={onStartClosing}
              onClearGraph={onClearGraph}
              isSidebarClosing={isSidebarClosing}
              currentChapter={currentChapter}
              eventNum={eventNum}
              filename={filename}
              elements={elements}
              povSummaries={povSummaries}
              povError={povError}
              povIsLoading={povIsLoading}
              povCached={povCached}
              onRetryPov={onRetryPov}
              apiBookGraphData={apiBookGraphData}
              bookId={bookId}
              onSelectRelatedNode={onSelectRelatedNode}
              chapterRailWidth={chapterRailWidth}
              onRequestFocusCanvas={focusCanvas}
              pendingKeepAnalysisOpenRef={pendingKeepAnalysisOpenRef}
            />
          )}

          <div
            ref={canvasAreaRef}
            className="graph-canvas-area"
            onClick={onCanvasClick}
            onKeyDown={handleCanvasKeyDown}
            role="region"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-describedby={a11yStatusId}
          >
            <GraphA11yStatus
              id={a11yStatusId}
              chapterLabel={chapterLabel}
              eventNum={eventNum}
              elements={a11yElements}
              filterStage={filterStage}
              isSearchActive={isSearchActive}
              searchTerm={searchTerm}
              activeTooltip={activeTooltip}
              isLoading={isLoading}
              liveAnnouncement={liveAnnouncement}
            />
            {isLoading && hasShownGraphOnce && <GraphLoadingOverlay />}

            <CytoscapeGraphUnified
              elements={renderElements}
              stylesheet={stylesheet}
              cyRef={cyRef}
              fitNodeIds={fitNodeIds}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
              onShowNodeTooltip={onShowNodeTooltip}
              onShowEdgeTooltip={onShowEdgeTooltip}
              onClearTooltip={onClearTooltip}
              selectedElementRef={selectedElementRef}
              graphClearRef={graphClearRef}
              graphSelectNodeRef={graphSelectNodeRef}
              graphSelectElementRef={selectElementRef}
              isDataRefreshing={isLoading}
              showZoomControls
              viewportFitKey={currentChapter}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

GraphCanvas.propTypes = {
  isSidebarOpen: PropTypes.bool.isRequired,
  sidebarLayoutWidth: PropTypes.number,
  activeTooltip: PropTypes.object,
  cyRef: PropTypes.object.isRequired,
  eventNum: PropTypes.number.isRequired,
  filename: PropTypes.string.isRequired,
  elements: PropTypes.array.isRequired,
  renderElements: PropTypes.array.isRequired,
  povSummaries: PropTypes.any,
  povError: PropTypes.string,
  povIsLoading: PropTypes.bool,
  povCached: PropTypes.bool,
  onRetryPov: PropTypes.func,
  apiBookGraphData: PropTypes.object,
  bookId: PropTypes.number,
  isLoading: PropTypes.bool.isRequired,
  hasShownGraphOnce: PropTypes.bool.isRequired,
  onCanvasClick: PropTypes.func.isRequired,
  currentChapter: PropTypes.number.isRequired,
  chapterDisplayLabel: PropTypes.string,
  chapterTitleTooltip: PropTypes.string,
  sidebarControl: PropTypes.object.isRequired,
  searchState: PropTypes.object.isRequired,
  floatingControls: PropTypes.shape({
    searchState: PropTypes.object.isRequired,
    searchActions: PropTypes.object.isRequired,
    edgeLabelVisible: PropTypes.bool.isRequired,
    onToggleEdgeLabel: PropTypes.func.isRequired,
    filterStage: PropTypes.number.isRequired,
    onFilterChange: PropTypes.func.isRequired,
  }),
  pageChromeStart: PropTypes.node,
  cytoscapeConfig: PropTypes.object.isRequired,
  tooltipHandlers: PropTypes.object.isRequired,
  graphClearRef: PropTypes.object,
  graphSelectNodeRef: PropTypes.object,
  onSelectRelatedNode: PropTypes.func,
  pendingKeepAnalysisOpenRef: PropTypes.shape({ current: PropTypes.bool }),
};

export default memo(GraphCanvas);

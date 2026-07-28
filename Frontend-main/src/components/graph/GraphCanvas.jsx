import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified, { GraphZoomControls } from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './UnifiedNodeInfo';
import UnifiedEdgeTooltip from './UnifiedEdgeTooltip';
import { GraphFloatingControls } from './GraphControls';
import { graphStyles } from '../../utils/styles/graphStyles.js';
import { COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS, resolveChapterSidebarWidth, buildGraphViewportRefitKey } from '../../utils/graph/graphCore.js';

const {
  TOOLTIP_SIDEBAR_WIDTH: SIDEBAR_WIDTH,
  ANIMATION_MS: ANIMATION_DURATION,
} = GRAPH_LAYOUT_CONSTANTS;

const sidebarBaseStyle = {
  position: 'fixed',
  top: 0,
  width: `${SIDEBAR_WIDTH}px`,
  height: '100vh',
  background: COLORS.white,
  borderRadius: '0px',
  boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
  borderRight: `1px solid ${COLORS.border}`,
  zIndex: 99999,
  overflow: 'hidden',
  transition: `right ${ANIMATION_DURATION}ms ${ANIMATION_VALUES.EASE_OUT}`,
};

const loadingOverlayStyle = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(255, 255, 255, 0.75)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
  fontSize: '16px',
  fontWeight: 600,
  color: COLORS.primary,
  letterSpacing: '0.02em',
};

const canvasShellStyle = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
};

const pageContainerStyle = {
  ...graphStyles.graphPageContainer,
  height: '100%',
};

const pageInnerStyle = graphStyles.graphPageInner;

const canvasAreaStyle = {
  flex: 1,
  minHeight: 0,
};

function clearTimeoutRef(timeoutRef) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

function GraphLoadingOverlay() {
  return <div style={loadingOverlayStyle}>그래프 업데이트 중...</div>;
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
  onRetryPov = null,
  apiBookGraphData = null,
  bookId = null,
  onSelectRelatedNode = null,
  chapterRailWidth = null,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);

  const sidebarStyle = useMemo(() => ({
    ...sidebarBaseStyle,
    right: isClosing || !isVisible ? `-${SIDEBAR_WIDTH}px` : '0px',
  }), [isClosing, isVisible]);

  const finishClose = useCallback(() => {
    onClose();
    setIsClosing(false);
    setIsVisible(false);
    animationTimeoutRef.current = null;
  }, [onClose]);

  const runCloseAnimation = useCallback(() => {
    clearTimeoutRef(animationTimeoutRef);
    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(finishClose, ANIMATION_DURATION);
  }, [finishClose]);

  const handleClose = useCallback(() => {
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

  let tooltipContent = null;
  if (activeTooltip?.type === 'node') {
    tooltipContent = (
      <UnifiedNodeInfo
        displayMode="sidebar"
        data={activeTooltip}
        onClose={handleClose}
        currentChapter={currentChapter}
        eventNum={eventNum}
        elements={elements}
        filename={filename}
        povSummaries={povSummaries}
        povError={povError}
        onRetryPov={onRetryPov}
        apiBookGraphData={apiBookGraphData}
        onSelectRelatedNode={onSelectRelatedNode}
        chapterRailWidth={chapterRailWidth}
      />
    );
  } else if (activeTooltip) {
    tooltipContent = (
      <UnifiedEdgeTooltip
        data={activeTooltip.data}
        onClose={handleClose}
        currentChapter={currentChapter}
        eventNum={eventNum}
        variant="graphPage"
        bookId={bookId}
        sourceEndpoint={activeTooltip.sourceEndpoint}
        targetEndpoint={activeTooltip.targetEndpoint}
      />
    );
  }

  return (
    <div style={sidebarStyle} data-testid="graph-sidebar">
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

  const [chromeCy, setChromeCy] = useState(null);
  const topbarRef = useRef(null);
  const toolsRef = useRef(null);
  const showSidebar = !!(activeTooltip || isSidebarClosing);
  const usePageChrome = !!(pageChromeStart || floatingControls);

  const chapterRailWidth = sidebarLayoutWidth != null
    ? sidebarLayoutWidth
    : resolveChapterSidebarWidth(isSidebarOpen);
  const chapterLabel = chapterDisplayLabel || `챕터 ${currentChapter}`;
  const metaEventLabel = Number.isFinite(Number(eventNum)) && Number(eventNum) > 0
    ? `Event ${eventNum}`
    : 'Event ?';

  useEffect(() => {
    if (!usePageChrome) return undefined;
    const topbar = topbarRef.current;
    const tools = toolsRef.current;
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
  }, [usePageChrome]);

  return (
    <div
      style={{
        ...canvasShellStyle,
        left: `${chapterRailWidth}px`,
      }}
    >
      <div style={pageContainerStyle}>
        {usePageChrome ? (
          <div className="graph-page-topbar" ref={topbarRef}>
            <div className="graph-page-topbar-center">
              <div className="graph-topbar-meta">
                <span
                  className="graph-topbar-meta-chapter"
                  title={chapterTitleTooltip || chapterLabel}
                >
                  {chapterLabel}
                </span>
                <span className="graph-topbar-meta-event">{metaEventLabel}</span>
              </div>
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
              <span className="graph-split-topbar-sep" aria-hidden />
              <GraphZoomControls cy={chromeCy} className="graph-zoom-controls is-embedded" />
              {pageChromeStart}
            </div>
          </div>
        ) : null}

        <div style={pageInnerStyle}>
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
              onRetryPov={onRetryPov}
              apiBookGraphData={apiBookGraphData}
              bookId={bookId}
              onSelectRelatedNode={onSelectRelatedNode}
              chapterRailWidth={chapterRailWidth}
            />
          )}

          <div
            className="graph-canvas-area"
            onClick={onCanvasClick}
            role="application"
            aria-label="관계 그래프 캔버스"
            style={canvasAreaStyle}
          >
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
              isDataRefreshing={isLoading}
              currentChapter={currentChapter}
              viewportRefitKey={buildGraphViewportRefitKey(currentChapter, eventNum)}
              showZoomControls={!usePageChrome}
              onCyReady={usePageChrome ? setChromeCy : null}
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
};

export default memo(GraphCanvas);

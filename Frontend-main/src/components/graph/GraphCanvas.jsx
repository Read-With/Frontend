import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './UnifiedNodeInfo';
import UnifiedEdgeTooltip from './UnifiedEdgeTooltip';
import { graphStyles } from '../../utils/styles/graphStyles.js';
import { COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS, resolveChapterSidebarWidth } from '../../utils/graph/graphCore.js';

const {
  TOP_BAR_HEIGHT,
  TOOLTIP_SIDEBAR_WIDTH: SIDEBAR_WIDTH,
  ANIMATION_MS: ANIMATION_DURATION,
} = GRAPH_LAYOUT_CONSTANTS;

const sidebarBaseStyle = {
  position: 'fixed',
  top: `${TOP_BAR_HEIGHT}px`,
  width: `${SIDEBAR_WIDTH}px`,
  height: `calc(100vh - ${TOP_BAR_HEIGHT}px)`,
  background: '#fff',
  borderRadius: '0px',
  boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
  borderRight: '1px solid #e5e7eb',
  zIndex: 99999,
  overflow: 'hidden',
  transition: `right ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
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
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const pageInnerStyle = {
  ...graphStyles.graphPageInner,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

const canvasAreaStyle = {
  ...graphStyles.graphArea,
  flex: 1,
  minHeight: 0,
  position: 'relative',
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
  apiBookGraphData = null,
  bookId = null,
  onSelectRelatedNode = null,
  onOpenChapterSidebar = null,
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
        chapterNum={currentChapter}
        eventNum={eventNum}
        elements={elements}
        filename={filename}
        povSummaries={povSummaries}
        apiBookGraphData={apiBookGraphData}
        onSelectRelatedNode={onSelectRelatedNode}
        onOpenChapterSidebar={onOpenChapterSidebar}
      />
    );
  } else if (activeTooltip) {
    tooltipContent = (
      <UnifiedEdgeTooltip
        data={activeTooltip.data}
        onClose={handleClose}
        chapterNum={currentChapter}
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
  apiBookGraphData,
  bookId,
  isLoading,
  hasShownGraphOnce,
  onCanvasClick,
  currentChapter,
  sidebarControl,
  searchState,
  cytoscapeConfig,
  tooltipHandlers,
  graphClearRef,
  graphSelectNodeRef = null,
  onSelectRelatedNode = null,
  onOpenChapterSidebar = null,
}) {
  const { isSidebarClosing, onCloseSidebar, onStartClosing, onClearGraph } = sidebarControl;
  const { isSearchActive, filteredElements, searchTerm, fitNodeIds, isResetFromSearch } = searchState;
  const { stylesheet } = cytoscapeConfig;
  const {
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedElementRef,
  } = tooltipHandlers;

  const showSidebar = !!(activeTooltip || isSidebarClosing);

  return (
    <div
      style={{
        ...canvasShellStyle,
        left: `${
          sidebarLayoutWidth != null
            ? sidebarLayoutWidth
            : resolveChapterSidebarWidth(isSidebarOpen)
        }px`,
      }}
    >
      <div style={pageContainerStyle}>
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
              apiBookGraphData={apiBookGraphData}
              bookId={bookId}
              onSelectRelatedNode={onSelectRelatedNode}
              onOpenChapterSidebar={onOpenChapterSidebar}
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
              isResetFromSearch={isResetFromSearch}
              isDataRefreshing={isLoading}
              currentChapter={currentChapter}
              showRippleEffect
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
  apiBookGraphData: PropTypes.object,
  bookId: PropTypes.number,
  isLoading: PropTypes.bool.isRequired,
  hasShownGraphOnce: PropTypes.bool.isRequired,
  onCanvasClick: PropTypes.func.isRequired,
  currentChapter: PropTypes.number.isRequired,
  sidebarControl: PropTypes.object.isRequired,
  searchState: PropTypes.object.isRequired,
  cytoscapeConfig: PropTypes.object.isRequired,
  tooltipHandlers: PropTypes.object.isRequired,
  graphClearRef: PropTypes.object,
  graphSelectNodeRef: PropTypes.object,
  onSelectRelatedNode: PropTypes.func,
  onOpenChapterSidebar: PropTypes.func,
};

export default memo(GraphCanvas);

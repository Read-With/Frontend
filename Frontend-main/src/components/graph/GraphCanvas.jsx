import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './tooltip/UnifiedNodeInfo';
import UnifiedEdgeTooltip from './tooltip/UnifiedEdgeTooltip';
import { graphStyles, COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS, resolveChapterSidebarWidth } from '../../utils/graph/graphUtils.js';

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

function chapterLabel(n, title) {
  const trimmed = String(title ?? '').trim();
  return trimmed || `Chapter ${n}`;
}

function clearTimeoutRef(timeoutRef) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

function GraphLoadingOverlay() {
  return <div style={loadingOverlayStyle}>그래프 업데이트 중...</div>;
}

const GraphInfoBar = memo(function GraphInfoBar({
  currentChapter,
  currentChapterTitle = '',
  userCurrentChapter,
  userReadingChapterTitle = '',
  nodeCount,
  relationCount,
  filterStage,
}) {
  const chapterRangeLabel = `Chapter 1 ~ ${chapterLabel(currentChapter, currentChapterTitle)} 누적`;
  const readingLabel = chapterLabel(userCurrentChapter, userReadingChapterTitle);
  const filterSuffix = filterStage > 0 ? ' (필터링됨)' : '';

  return (
    <div
      role="region"
      aria-label="그래프 정보"
      style={{
        background: COLORS.background,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: COLORS.textPrimary }}>
          거시 그래프
        </h2>
        <div style={{
          background: COLORS.backgroundLight,
          padding: '4px 12px',
          borderRadius: '16px',
          fontSize: '12px',
          color: COLORS.textSecondary,
          fontWeight: '500',
        }}>
          {chapterRangeLabel}
        </div>
        {userCurrentChapter != null && (
          <div
            style={{
              background: COLORS.primary + '20',
              padding: '4px 12px',
              borderRadius: '16px',
              fontSize: '11px',
              color: COLORS.primary,
              fontWeight: '600',
            }}
            title={`챕터 ${userCurrentChapter}`}
          >
            독서 진행: {readingLabel}
          </div>
        )}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        color: COLORS.textSecondary,
        fontWeight: '500',
      }}>
        <span>{nodeCount}명{filterSuffix}</span>
        <span>•</span>
        <span>{relationCount}관계{filterSuffix}</span>
      </div>
    </div>
  );
});

GraphInfoBar.propTypes = {
  currentChapter: PropTypes.number.isRequired,
  currentChapterTitle: PropTypes.string,
  userCurrentChapter: PropTypes.number,
  userReadingChapterTitle: PropTypes.string,
  nodeCount: PropTypes.number.isRequired,
  relationCount: PropTypes.number.isRequired,
  filterStage: PropTypes.number.isRequired,
};

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
  activeTooltip,
  cyRef,
  currentChapterTitle = '',
  userReadingChapterTitle = '',
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
  userCurrentChapter,
  nodeCount,
  relationCount,
  filterStage,
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
        left: `${resolveChapterSidebarWidth(isSidebarOpen)}px`,
      }}
    >
      <div style={pageContainerStyle}>
        <GraphInfoBar
          currentChapter={currentChapter}
          currentChapterTitle={currentChapterTitle}
          userCurrentChapter={userCurrentChapter}
          userReadingChapterTitle={userReadingChapterTitle}
          nodeCount={nodeCount}
          relationCount={relationCount}
          filterStage={filterStage}
        />

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
  activeTooltip: PropTypes.object,
  cyRef: PropTypes.object.isRequired,
  currentChapterTitle: PropTypes.string,
  userReadingChapterTitle: PropTypes.string,
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
  userCurrentChapter: PropTypes.number,
  nodeCount: PropTypes.number.isRequired,
  relationCount: PropTypes.number.isRequired,
  filterStage: PropTypes.number.isRequired,
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

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './tooltip/UnifiedNodeInfo';
import UnifiedEdgeTooltip from './tooltip/UnifiedEdgeTooltip';
import { graphStyles, COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS, resolveChapterSidebarWidth } from './graphShared.js';

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

function GraphLoadingOverlay() {
  return (
    <div
      style={{
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
      }}
    >
      그래프 업데이트 중...
    </div>
  );
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
  const chapterRangeLabel = useMemo(() => {
    const nameOrNum = (n, title) => (title && String(title).trim() ? String(title).trim() : `Chapter ${n}`);
    const curName = nameOrNum(currentChapter, currentChapterTitle);
    return `Chapter 1 ~ ${curName} 누적`;
  }, [currentChapter, currentChapterTitle]);

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
        {userCurrentChapter !== null && (
          <div
            style={{
              background: COLORS.primary + '20',
              padding: '4px 12px',
              borderRadius: '16px',
              fontSize: '11px',
              color: COLORS.primary,
              fontWeight: '600',
            }}
            title={userReadingChapterTitle ? `챕터 ${userCurrentChapter}` : undefined}
          >
            독서 진행:{' '}
            {userReadingChapterTitle && String(userReadingChapterTitle).trim()
              ? String(userReadingChapterTitle).trim()
              : `Chapter ${userCurrentChapter}`}
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
        <span>
          {filterStage > 0 ? `${nodeCount}명 (필터링됨)` : `${nodeCount}명`}
        </span>
        <span>•</span>
        <span>
          {filterStage > 0 ? `${relationCount}관계 (필터링됨)` : `${relationCount}관계`}
        </span>
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
  chapterNum,
  eventNum,
  filename,
  elements = [],
  onStartClosing,
  onClearGraph,
  isSidebarClosing = false,
  povSummaries = null,
  apiBookGraphData = null,
  bookId = null,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);

  const sidebarStyle = useMemo(() => ({
    ...sidebarBaseStyle,
    right: isClosing || !isVisible ? `-${SIDEBAR_WIDTH}px` : '0px',
  }), [isClosing, isVisible]);

  const runCloseAnimation = useCallback(() => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(() => {
      onClose();
      setIsClosing(false);
      setIsVisible(false);
      animationTimeoutRef.current = null;
    }, ANIMATION_DURATION);
  }, [onClose]);

  const handleClose = useCallback(() => {
    onClearGraph?.();
    onStartClosing?.();
    runCloseAnimation();
  }, [onClearGraph, onStartClosing, runCloseAnimation]);

  useEffect(() => {
    const prevActiveTooltip = previousActiveTooltipRef.current;

    if (activeTooltip && !prevActiveTooltip) {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      setIsClosing(false);
      setIsVisible(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    }

    if (!activeTooltip && prevActiveTooltip) {
      setIsClosing(true);
      animationTimeoutRef.current = setTimeout(() => {
        onClose();
        setIsClosing(false);
        setIsVisible(false);
      }, ANIMATION_DURATION);
    }

    previousActiveTooltipRef.current = activeTooltip;
  }, [activeTooltip, onClose]);

  useEffect(() => {
    if (isSidebarClosing && !isClosing) {
      runCloseAnimation();
    }
  }, [isSidebarClosing, isClosing, runCloseAnimation]);

  useEffect(() => () => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }
  }, []);

  if (!isVisible && !isClosing && !activeTooltip) {
    return null;
  }

  if (!activeTooltip) {
    return <div style={sidebarStyle} data-testid="graph-sidebar" />;
  }

  if (activeTooltip.type === 'node') {
    return (
      <div style={sidebarStyle} data-testid="graph-sidebar">
        <UnifiedNodeInfo
          displayMode="sidebar"
          data={activeTooltip}
          onClose={handleClose}
          chapterNum={chapterNum}
          eventNum={eventNum}
          elements={elements}
          filename={filename}
          povSummaries={povSummaries}
          apiBookGraphData={apiBookGraphData}
        />
      </div>
    );
  }

  return (
    <div style={sidebarStyle} data-testid="graph-sidebar">
      <UnifiedEdgeTooltip
        data={activeTooltip.data}
        onClose={handleClose}
        chapterNum={chapterNum}
        eventNum={eventNum}
        variant="graphPage"
        bookId={bookId}
      />
    </div>
  );
}

function GraphCanvas({
  isSidebarOpen,
  activeTooltip,
  cyRef,
  chapterNum,
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
}) {
  const { isSidebarClosing, onCloseSidebar, onStartClosing, onClearGraph } = sidebarControl;
  const { isSearchActive, filteredElements, searchTerm, fitNodeIds, isResetFromSearch } = searchState;
  const { stylesheet, layout } = cytoscapeConfig;
  const { onShowNodeTooltip, onShowEdgeTooltip, onClearTooltip, selectedNodeIdRef, selectedEdgeIdRef } = tooltipHandlers;

  const sidebarLeft = resolveChapterSidebarWidth(isSidebarOpen);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: `${sidebarLeft}px`,
        right: 0,
        bottom: 0,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          ...graphStyles.graphPageContainer,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <GraphInfoBar
          currentChapter={currentChapter}
          currentChapterTitle={currentChapterTitle}
          userCurrentChapter={userCurrentChapter}
          userReadingChapterTitle={userReadingChapterTitle}
          nodeCount={nodeCount}
          relationCount={relationCount}
          filterStage={filterStage}
        />

        <div
          style={{
            ...graphStyles.graphPageInner,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {(activeTooltip || isSidebarClosing) && (
            <GraphSidebar
              activeTooltip={activeTooltip}
              onClose={onCloseSidebar}
              onStartClosing={onStartClosing}
              onClearGraph={onClearGraph}
              isSidebarClosing={isSidebarClosing}
              chapterNum={chapterNum}
              eventNum={eventNum}
              filename={filename}
              elements={elements}
              povSummaries={povSummaries}
              apiBookGraphData={apiBookGraphData}
              bookId={bookId}
            />
          )}

          <div
            className="graph-canvas-area"
            onClick={onCanvasClick}
            role="application"
            aria-label="관계 그래프 캔버스"
            style={{
              ...graphStyles.graphArea,
              flex: 1,
              minHeight: 0,
              position: 'relative',
            }}
          >
            {isLoading && hasShownGraphOnce && <GraphLoadingOverlay />}

            <CytoscapeGraphUnified
              elements={renderElements}
              stylesheet={stylesheet}
              layout={layout}
              cyRef={cyRef}
              fitNodeIds={fitNodeIds}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
              onShowNodeTooltip={onShowNodeTooltip}
              onShowEdgeTooltip={onShowEdgeTooltip}
              onClearTooltip={onClearTooltip}
              selectedNodeIdRef={selectedNodeIdRef}
              selectedEdgeIdRef={selectedEdgeIdRef}
              graphClearRef={graphClearRef}
              strictBackgroundClear={true}
              isResetFromSearch={isResetFromSearch}
              isDataRefreshing={isLoading}
              currentChapter={currentChapter}
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
  chapterNum: PropTypes.number.isRequired,
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
};

export default React.memo(GraphCanvas);

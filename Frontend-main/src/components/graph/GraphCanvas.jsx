import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './tooltip/UnifiedNodeInfo';
import UnifiedEdgeTooltip from './tooltip/UnifiedEdgeTooltip';
import { graphStyles, COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS } from './graphConstants.js';
import { resolveChapterSidebarWidth } from './graphShared.js';

const SIDEBAR_WIDTH = 480;
const { TOP_BAR_HEIGHT } = GRAPH_LAYOUT_CONSTANTS;
const ANIMATION_DURATION = 700;

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

const noRelationsOverlayStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 20px',
  textAlign: 'center',
  color: '#6b7280',
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
  apiFineData,
  currentChapter,
  currentChapterTitle = '',
  currentEvent,
  userCurrentChapter,
  userReadingChapterTitle = '',
  nodeCount,
  relationCount,
  filterStage,
}) {
  const hasEvent = !!apiFineData?.event;

  const graphTypeLabel = useMemo(() => {
    return hasEvent ? '세밀 그래프' : '거시 그래프';
  }, [hasEvent]);

  const chapterRangeLabel = useMemo(() => {
    const nameOrNum = (n, title) => (title && String(title).trim() ? String(title).trim() : `Chapter ${n}`);
    const curName = nameOrNum(currentChapter, currentChapterTitle);
    return hasEvent
      ? `${curName} · 이벤트 ${currentEvent}`
      : `Chapter 1 ~ ${curName} 누적`;
  }, [hasEvent, currentChapter, currentChapterTitle, currentEvent]);

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
          {graphTypeLabel}
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
        <>
          <span>•</span>
          <span style={{ color: COLORS.primary, fontWeight: '600' }}>API</span>
        </>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.currentChapter !== nextProps.currentChapter) return false;
  if (prevProps.currentChapterTitle !== nextProps.currentChapterTitle) return false;
  if (prevProps.currentEvent !== nextProps.currentEvent) return false;
  if (prevProps.userCurrentChapter !== nextProps.userCurrentChapter) return false;
  if (prevProps.userReadingChapterTitle !== nextProps.userReadingChapterTitle) return false;
  if (prevProps.nodeCount !== nextProps.nodeCount) return false;
  if (prevProps.relationCount !== nextProps.relationCount) return false;
  if (prevProps.filterStage !== nextProps.filterStage) return false;
  if (!!prevProps.apiFineData?.event !== !!nextProps.apiFineData?.event) return false;
  return true;
});

GraphInfoBar.propTypes = {
  apiFineData: PropTypes.shape({ event: PropTypes.object }),
  currentChapter: PropTypes.number.isRequired,
  currentChapterTitle: PropTypes.string,
  currentEvent: PropTypes.number.isRequired,
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
  maxChapter,
  hasNoRelations = false,
  filename,
  elements = [],
  isSearchActive = false,
  filteredElements = [],
  searchTerm = '',
  onStartClosing,
  onClearGraph,
  forceClose,
  povSummaries = null,
  apiMacroData = null,
  apiFineData = null,
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

  const handleClose = useCallback(() => {
    if (onClearGraph && !forceClose) {
      onClearGraph();
    }
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    onStartClosing?.();

    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(() => {
      onClose();
      setIsClosing(false);
      setIsVisible(false);
      animationTimeoutRef.current = null;
    }, ANIMATION_DURATION);
  }, [onClearGraph, forceClose, onStartClosing, onClose]);

  useEffect(() => {
    const prevActiveTooltip = previousActiveTooltipRef.current;

    if ((activeTooltip || hasNoRelations) && !prevActiveTooltip) {
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

    if (!activeTooltip && !hasNoRelations && prevActiveTooltip) {
      setIsClosing(true);
      animationTimeoutRef.current = setTimeout(() => {
        onClose();
        setIsClosing(false);
        setIsVisible(false);
      }, ANIMATION_DURATION);
    }

    previousActiveTooltipRef.current = activeTooltip;
  }, [activeTooltip, hasNoRelations, onClose]);

  useEffect(() => {
    if (forceClose && !isClosing) {
      handleClose();
    }
  }, [forceClose, isClosing, handleClose]);

  useEffect(() => () => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }
  }, []);

  if (!isVisible && !isClosing && !activeTooltip && !hasNoRelations) {
    return null;
  }

  if (hasNoRelations) {
    return (
      <div style={{ ...sidebarStyle, ...noRelationsOverlayStyle }} data-testid="graph-sidebar">
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📊</div>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
          관계 데이터가 없습니다
        </h3>
        <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 280 }}>
          현재 챕터와 이벤트에서 인물 간의 관계 정보가 없습니다.
        </p>
      </div>
    );
  }

  if (!activeTooltip) {
    return <div style={sidebarStyle} data-testid="graph-sidebar" />;
  }

  if (activeTooltip.type === 'node') {
    return (
      <div style={sidebarStyle} data-testid="graph-sidebar">
        <UnifiedNodeInfo
          displayMode="sidebar"
          data={activeTooltip.data}
          onClose={handleClose}
          chapterNum={chapterNum}
          eventNum={eventNum}
          maxChapter={maxChapter}
          elements={elements}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          searchTerm={searchTerm}
          filename={filename}
          povSummaries={povSummaries}
          apiMacroData={apiMacroData}
          apiFineData={apiFineData}
        />
      </div>
    );
  }

  return (
    <div style={sidebarStyle} data-testid="graph-sidebar">
      <UnifiedEdgeTooltip
        data={activeTooltip.data}
        sourceNode={activeTooltip.sourceNode}
        targetNode={activeTooltip.targetNode}
        onClose={handleClose}
        chapterNum={chapterNum}
        eventNum={eventNum}
        maxChapter={maxChapter}
        elements={elements}
        displayMode="sidebar"
        filename={filename}
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
  maxChapter,
  filename,
  elements,
  renderElements,
  povSummaries,
  apiMacroData,
  apiFineData,
  bookId,
  isLoading,
  hasShownGraphOnce,
  onCanvasClick,
  currentChapter,
  currentEvent,
  userCurrentChapter,
  nodeCount,
  relationCount,
  filterStage,
  sidebarControl,
  searchState,
  cytoscapeConfig,
  tooltipHandlers,
}) {
  const { isSidebarClosing, onCloseSidebar, onStartClosing, onClearGraph, forceClose } = sidebarControl;
  const { isSearchActive, filteredElements, searchTerm, fitNodeIds, isResetFromSearch } = searchState;
  const { stylesheet, layout, newNodeIds, isDropdownSelection } = cytoscapeConfig;
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
          apiFineData={apiFineData}
          currentChapter={currentChapter}
          currentChapterTitle={currentChapterTitle}
          currentEvent={currentEvent}
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
              forceClose={forceClose}
              chapterNum={chapterNum}
              eventNum={eventNum}
              maxChapter={maxChapter}
              filename={filename}
              elements={elements}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
              searchTerm={searchTerm}
              povSummaries={povSummaries}
              apiMacroData={apiMacroData}
              apiFineData={apiFineData}
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
              newNodeIds={newNodeIds}
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
              strictBackgroundClear={true}
              isResetFromSearch={isResetFromSearch}
              isDropdownSelection={isDropdownSelection}
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
  maxChapter: PropTypes.number.isRequired,
  filename: PropTypes.string.isRequired,
  elements: PropTypes.array.isRequired,
  renderElements: PropTypes.array.isRequired,
  povSummaries: PropTypes.array,
  apiMacroData: PropTypes.object,
  apiFineData: PropTypes.object,
  bookId: PropTypes.number,
  isLoading: PropTypes.bool.isRequired,
  hasShownGraphOnce: PropTypes.bool.isRequired,
  onCanvasClick: PropTypes.func.isRequired,
  currentChapter: PropTypes.number.isRequired,
  currentEvent: PropTypes.number.isRequired,
  userCurrentChapter: PropTypes.number,
  nodeCount: PropTypes.number.isRequired,
  relationCount: PropTypes.number.isRequired,
  filterStage: PropTypes.number.isRequired,
  sidebarControl: PropTypes.shape({
    isSidebarClosing: PropTypes.bool.isRequired,
    onCloseSidebar: PropTypes.func.isRequired,
    onStartClosing: PropTypes.func.isRequired,
    onClearGraph: PropTypes.func.isRequired,
    forceClose: PropTypes.bool.isRequired,
  }).isRequired,
  searchState: PropTypes.shape({
    isSearchActive: PropTypes.bool.isRequired,
    filteredElements: PropTypes.array,
    searchTerm: PropTypes.string.isRequired,
    fitNodeIds: PropTypes.array,
    isResetFromSearch: PropTypes.bool.isRequired,
  }).isRequired,
  cytoscapeConfig: PropTypes.shape({
    stylesheet: PropTypes.array.isRequired,
    layout: PropTypes.object.isRequired,
    newNodeIds: PropTypes.array.isRequired,
    isDropdownSelection: PropTypes.bool.isRequired,
  }).isRequired,
  tooltipHandlers: PropTypes.shape({
    onShowNodeTooltip: PropTypes.func.isRequired,
    onShowEdgeTooltip: PropTypes.func.isRequired,
    onClearTooltip: PropTypes.func.isRequired,
    selectedNodeIdRef: PropTypes.object.isRequired,
    selectedEdgeIdRef: PropTypes.object.isRequired,
  }).isRequired,
};

export default React.memo(GraphCanvas);

import React from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import GraphSidebar from './tooltip/GraphSidebar';
import GraphInfoBar from './GraphInfoBar';
import { graphStyles, COLORS } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/animations';

const GRAPH_CONSTANTS = {
  SIDEBAR: {
    OPEN_WIDTH: 240,
    CLOSED_WIDTH: 60,
  },
};

function GraphCanvas({
  isSidebarOpen,
  activeTooltip,
  isSidebarClosing,
  onCloseSidebar,
  onStartClosing,
  onClearGraph,
  forceClose,
  chapterNum,
  eventNum,
  maxChapter,
  filename,
  elements,
  isSearchActive,
  filteredElements,
  searchTerm,
  povSummaries,
  apiMacroData,
  apiFineData,
  bookId,
  finalElements,
  newNodeIds,
  stylesheet,
  layout,
  cyRef,
  fitNodeIds,
  onShowNodeTooltip,
  onShowEdgeTooltip,
  onClearTooltip,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  isResetFromSearch,
  isDropdownSelection,
  isLoading,
  hasShownGraphOnce,
  onCanvasClick,
  isApiBook,
  currentChapter,
  currentEvent,
  userCurrentChapter,
  nodeCount,
  relationCount,
  filterStage,
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: isSidebarOpen ? `${GRAPH_CONSTANTS.SIDEBAR.OPEN_WIDTH}px` : `${GRAPH_CONSTANTS.SIDEBAR.CLOSED_WIDTH}px`,
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
          isApiBook={isApiBook}
          apiFineData={apiFineData}
          currentChapter={currentChapter}
          currentEvent={currentEvent}
          userCurrentChapter={userCurrentChapter}
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
            {isLoading && hasShownGraphOnce && (
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
            )}
            <CytoscapeGraphUnified
              elements={finalElements}
              newNodeIds={newNodeIds}
              stylesheet={stylesheet}
              layout={layout}
              cyRef={cyRef}
              nodeSize={10}
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
              showRippleEffect={true}
              isDropdownSelection={isDropdownSelection}
              isDataRefreshing={isLoading}
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
  isSidebarClosing: PropTypes.bool.isRequired,
  onCloseSidebar: PropTypes.func.isRequired,
  onStartClosing: PropTypes.func.isRequired,
  onClearGraph: PropTypes.func.isRequired,
  forceClose: PropTypes.bool.isRequired,
  chapterNum: PropTypes.number.isRequired,
  eventNum: PropTypes.number.isRequired,
  maxChapter: PropTypes.number.isRequired,
  filename: PropTypes.string.isRequired,
  elements: PropTypes.array.isRequired,
  isSearchActive: PropTypes.bool.isRequired,
  filteredElements: PropTypes.array,
  searchTerm: PropTypes.string.isRequired,
  povSummaries: PropTypes.array,
  apiMacroData: PropTypes.object,
  apiFineData: PropTypes.object,
  bookId: PropTypes.number,
  finalElements: PropTypes.array.isRequired,
  newNodeIds: PropTypes.array.isRequired,
  stylesheet: PropTypes.array.isRequired,
  layout: PropTypes.object.isRequired,
  cyRef: PropTypes.object.isRequired,
  fitNodeIds: PropTypes.array,
  onShowNodeTooltip: PropTypes.func.isRequired,
  onShowEdgeTooltip: PropTypes.func.isRequired,
  onClearTooltip: PropTypes.func.isRequired,
  selectedNodeIdRef: PropTypes.object.isRequired,
  selectedEdgeIdRef: PropTypes.object.isRequired,
  isResetFromSearch: PropTypes.bool.isRequired,
  isDropdownSelection: PropTypes.bool.isRequired,
  isLoading: PropTypes.bool.isRequired,
  hasShownGraphOnce: PropTypes.bool.isRequired,
  onCanvasClick: PropTypes.func.isRequired,
  isApiBook: PropTypes.bool.isRequired,
  currentChapter: PropTypes.number.isRequired,
  currentEvent: PropTypes.number.isRequired,
  userCurrentChapter: PropTypes.number,
  nodeCount: PropTypes.number.isRequired,
  relationCount: PropTypes.number.isRequired,
  filterStage: PropTypes.number.isRequired,
};

export default GraphCanvas;

import React from 'react';
import PropTypes from 'prop-types';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import GraphSidebar from './tooltip/GraphSidebar';
import GraphInfoBar from './GraphInfoBar';
import { graphStyles, COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS } from './graphConstants.js';

// ─── 로딩 오버레이 ─────────────────────────────────────────────────────────────
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

// ─── GraphCanvas ───────────────────────────────────────────────────────────────
/**
 * Props 구조
 *
 * 개별 props:
 *   isSidebarOpen, activeTooltip, cyRef
 *   chapterNum, eventNum, maxChapter, filename
 *   elements        — 사이드바 표시용 원본 데이터
 *   renderElements  — Cytoscape 렌더링용 최종 데이터 (검색/필터 적용)
 *   povSummaries, apiMacroData, apiFineData, bookId
 *   isLoading, hasShownGraphOnce, onCanvasClick
 *   isApiBook, currentChapter, currentEvent, userCurrentChapter
 *   nodeCount, relationCount, filterStage
 *
 * 그룹 props:
 *   sidebarControl  — 사이드바 열기/닫기 동작
 *   searchState     — 검색 관련 상태
 *   cytoscapeConfig — Cytoscape 설정값
 *   tooltipHandlers — 툴팁 콜백 및 선택 ref
 */
function GraphCanvas({
  isSidebarOpen,
  activeTooltip,
  cyRef,
  chapterNum,
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
  isApiBook,
  currentChapter,
  currentEvent,
  userCurrentChapter,
  nodeCount,
  relationCount,
  filterStage,
  // ─── 그룹 props ──────────────────────────────────────────
  sidebarControl,
  searchState,
  cytoscapeConfig,
  tooltipHandlers,
}) {
  const { isSidebarClosing, onCloseSidebar, onStartClosing, onClearGraph, forceClose } = sidebarControl;
  const { isSearchActive, filteredElements, searchTerm, fitNodeIds, isResetFromSearch } = searchState;
  const { stylesheet, layout, newNodeIds, isDropdownSelection } = cytoscapeConfig;
  const { onShowNodeTooltip, onShowEdgeTooltip, onClearTooltip, selectedNodeIdRef, selectedEdgeIdRef } = tooltipHandlers;

  const { SIDEBAR } = GRAPH_LAYOUT_CONSTANTS;
  const sidebarLeft = isSidebarOpen ? SIDEBAR.OPEN_WIDTH : SIDEBAR.CLOSED_WIDTH;

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
            {isLoading && hasShownGraphOnce && <GraphLoadingOverlay />}

            <CytoscapeGraphUnified
              elements={renderElements}
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

// ─── PropTypes ─────────────────────────────────────────────────────────────────
GraphCanvas.propTypes = {
  // 개별 props
  isSidebarOpen: PropTypes.bool.isRequired,
  activeTooltip: PropTypes.object,
  cyRef: PropTypes.object.isRequired,
  chapterNum: PropTypes.number.isRequired,
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
  isApiBook: PropTypes.bool.isRequired,
  currentChapter: PropTypes.number.isRequired,
  currentEvent: PropTypes.number.isRequired,
  userCurrentChapter: PropTypes.number,
  nodeCount: PropTypes.number.isRequired,
  relationCount: PropTypes.number.isRequired,
  filterStage: PropTypes.number.isRequired,

  // 그룹 props
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

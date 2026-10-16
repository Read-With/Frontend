import { memo, useCallback, useRef } from 'react';
import GraphCanvasArea from '../canvas/GraphCanvasArea';
import GraphPageSidebar from './GraphPageSidebar';
import { GraphFloatingControls } from '../controls/GraphFloatingControls';
import { GraphTopBarMeta } from '../controls/GraphTopBarMeta';
import { formatChapterOrdinalLabel } from '../../../utils/common/chapterLabel';
import { useGraphTopbarToolsReserve } from '../../../hooks/graph/useGraphCy.js';
import { useGraphPage } from './GraphPageContext';

function GraphLoadingOverlay() {
  return <div className="graph-canvas-loading" role="status">그래프 업데이트 중...</div>;
}

function GraphPageLayout() {
  const {
    chapterRailWidth,
    cyRef,
    graphClearRef,
    graphSelectNodeRef,
    selectedElementRef,
    activeTooltip,
    currentChapter,
    eventNum,
    chapterDisplayLabel,
    chapterTitleTooltip,
    renderElements,
    stylesheet,
    isLoading,
    hasShownGraphOnce,
    onCanvasClick,
    pageChromeStart,
    isSidebarClosing,
    searchState,
    searchActions,
    edgeLabelVisible,
    toggleEdgeLabel,
    filterStage,
    setFilterStage,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
  } = useGraphPage();
  const { isSearchActive, filteredElements, appliedSearchTerm, fitNodeIds } = searchState;

  const topbarRef = useRef(null);
  const toolsRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const showSidebar = !!(activeTooltip || isSidebarClosing);

  const chapterLabel = chapterDisplayLabel || formatChapterOrdinalLabel(currentChapter);

  const focusCanvas = useCallback(() => {
    requestAnimationFrame(() => {
      canvasAreaRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useGraphTopbarToolsReserve(topbarRef, toolsRef);

  return (
    <div
      className="graph-canvas-shell"
      style={{ left: `${chapterRailWidth}px` }}
    >
      <div className="graph-page-shell graph-page-shell--fill">
        <div className="graph-page-topbar" ref={topbarRef}>
          <div className="graph-page-topbar-center">
            <GraphTopBarMeta
              chapterLabel={chapterLabel}
              chapterTitle={chapterTitleTooltip}
            />
          </div>
          <div className="graph-page-topbar-tools" ref={toolsRef}>
            <GraphFloatingControls
              searchState={searchState}
              searchActions={searchActions}
              edgeLabelVisible={edgeLabelVisible}
              onToggleEdgeLabel={toggleEdgeLabel}
              filterStage={filterStage}
              onFilterChange={setFilterStage}
            />
            <span className="graph-split-topbar-sep" aria-hidden />
            {pageChromeStart}
          </div>
        </div>

        <div className="graph-page-inner">
          {showSidebar && (
            <GraphPageSidebar onRequestFocusCanvas={focusCanvas} />
          )}

          <GraphCanvasArea
            ref={canvasAreaRef}
            onClick={onCanvasClick}
            activeTooltip={activeTooltip}
            chapterLabel={chapterLabel}
            eventNum={eventNum}
            filterStage={filterStage}
            isLoading={isLoading}
            elements={renderElements}
            stylesheet={stylesheet}
            cyRef={cyRef}
            fitNodeIds={fitNodeIds}
            searchTerm={appliedSearchTerm}
            isSearchActive={isSearchActive}
            filteredElements={filteredElements}
            onShowNodeTooltip={onShowNodeTooltip}
            onShowEdgeTooltip={onShowEdgeTooltip}
            onClearTooltip={onClearTooltip}
            selectedElementRef={selectedElementRef}
            graphClearRef={graphClearRef}
            graphSelectNodeRef={graphSelectNodeRef}
            isDataRefreshing={isLoading}
            viewportFitKey={currentChapter}
          >
            {isLoading && hasShownGraphOnce && <GraphLoadingOverlay />}
          </GraphCanvasArea>
        </div>
      </div>
    </div>
  );
}

export default memo(GraphPageLayout);

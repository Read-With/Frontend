import { lazy, Suspense, useMemo, useRef, memo, useCallback, useEffect } from 'react';
import GraphCanvasArea from '../graph/canvas/GraphCanvasArea';
import NodeDetail from '../graph/detail/NodeDetail';
import { getEdgeStyle, createGraphStylesheet } from '../../utils/graph/graphStyles';
import { usePreFocusViewport, shouldIgnoreGraphOutsideClick, useGraphTooltipSelection } from '../../hooks/graph/useGraphCy';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerSession';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import { formatChapterOrdinalLabel } from '../../utils/common/chapterLabel';
import { GraphSplitTopBar } from './graph/GraphSplitTopBar';
import { GraphEmptyEventsNotice, GraphErrorNotice, GraphFilteredEmptyNotice, GraphLoadingNotice, GraphRefreshOverlay } from './graph/GraphPanelNotices';
import { useGraphPanelState } from '../../hooks/viewer/useGraphPanelState';
import { useOpenGraphPage } from '../../hooks/viewer/useOpenGraphPage';
import '../graph/styles/graph.css';

const EdgeDetail = lazy(() => import('../graph/detail/EdgeDetail'));

const VIEWER_FOCUS_OPTIONS = { duration: 400, reserveRight: 48, padding: 24 };

/** 노드/간선 플로팅 툴팁 (활성 툴팁 종류에 따라 하나만) */
function GraphTooltipLayer({
  activeTooltip,
  onClose,
  tooltipBoundsRef,
  currentChapter,
  currentEvent,
  prevValidEvent,
  eventNum,
  filename,
  elements,
  bookId,
}) {
  return (
    <div
      className="graph-tooltip-layer"
      onClick={(e) => e.stopPropagation()}
    >
      {activeTooltip?.type === 'node' && (
        <NodeDetail
          key={`node-tooltip-${activeTooltip.id}`}
          displayMode="tooltip"
          data={activeTooltip}
          x={activeTooltip.x}
          y={activeTooltip.y}
          onClose={onClose}
          currentChapter={currentChapter}
          eventNum={eventNum}
          filename={filename}
          elements={elements}
          currentEvent={currentEvent}
          prevValidEvent={prevValidEvent}
          tooltipBoundsRef={tooltipBoundsRef}
        />
      )}
      {activeTooltip?.type === 'edge' && (
        <Suspense fallback={<div role="status" aria-live="polite">관계 정보를 불러오는 중…</div>}>
          <EdgeDetail
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={onClose}
            displayMode="tooltip"
            currentChapter={currentChapter}
            eventNum={eventNum}
            bookId={bookId}
            sourceEndpoint={activeTooltip.sourceEndpoint}
            targetEndpoint={activeTooltip.targetEndpoint}
            tooltipBoundsRef={tooltipBoundsRef}
          />
        </Suspense>
      )}
    </div>
  );
}

/** 뷰어 분할 패널용 그래프 + 플로팅 툴팁 */
/**
 * 뷰어 그래프 선택·툴팁: 선택 시 해당 요소로 이동하고, 해제(바깥 클릭·닫기)하면 이동 전 배치로 복귀.
 * 닫기 버튼으로 닫으면 키보드 포커스를 캔버스로 돌려준다
 */
function useViewerTooltipFocus({ cyRef, canvasAreaRef, currentChapter, currentEvent, tooltip }) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip } = tooltip;
  // 분할화면은 패널이 좁아 툴팁 전체 폭을 비우면 줌이 과도하게 줄어듦 — 약간 겹침 허용
  const { centerSelection, releasePreFocusViewport } = usePreFocusViewport(cyRef, VIEWER_FOCUS_OPTIONS);

  // 챕터·이벤트가 바뀌면 그래프 자체가 다시 fit되므로, 이전 배치 스냅샷은 더 이상 유효하지 않다.
  useEffect(() => {
    releasePreFocusViewport(false);
  }, [currentChapter, currentEvent, releasePreFocusViewport]);

  const clearTooltip = useCallback(() => {
    releasePreFocusViewport();
    onClearTooltip();
  }, [releasePreFocusViewport, onClearTooltip]);

  const closeAndRestoreFocus = useCallback(() => {
    clearTooltip();
    requestAnimationFrame(() => {
      canvasAreaRef.current?.focus({ preventScroll: true });
    });
  }, [clearTooltip, canvasAreaRef]);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useGraphTooltipSelection({
    activeTooltip,
    onSetActiveTooltip,
    centerSelection,
    focusDelayMs: 50,
    tooltipOpen: !!activeTooltip,
    onDismiss: clearTooltip,
    shouldIgnoreClick: (event) => shouldIgnoreGraphOutsideClick(event, 'viewer'),
    attachDelayMs: 50,
  });

  return { clearTooltip, closeAndRestoreFocus, onShowNodeTooltip, onShowEdgeTooltip };
}

/** 뷰어 분할 패널용 그래프 + 플로팅 툴팁. tooltip = ViewerPage의 tooltipProps */
const GraphContainer = memo(function GraphContainer({
  currentEvent,
  currentChapter,
  chapterLabel,
  edgeLabelVisible,
  filename,
  elements,
  prevValidEvent,
  tooltip,
  isEventTransition,
  searchTerm,
  isSearchActive,
  filteredElements,
  fitNodeIds,
  filterStage,
  bookId,
}) {
  const { activeTooltip, graphClearRef } = tooltip;
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter,
    progressTopBar: null,
    fallback: 0,
  });
  const cyRef = useRef(null);
  const selectedElementRef = useRef(null);
  const tooltipBoundsRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const { clearTooltip, closeAndRestoreFocus, onShowNodeTooltip, onShowEdgeTooltip } =
    useViewerTooltipFocus({ cyRef, canvasAreaRef, currentChapter, currentEvent, tooltip });

  const stylesheet = useMemo(
    () => createGraphStylesheet(getEdgeStyle('viewer'), edgeLabelVisible),
    [edgeLabelVisible]
  );

  return (
    <div className="graph-shell" ref={tooltipBoundsRef}>
      <GraphTooltipLayer
        activeTooltip={activeTooltip}
        onClose={closeAndRestoreFocus}
        tooltipBoundsRef={tooltipBoundsRef}
        currentChapter={currentChapter}
        currentEvent={currentEvent}
        prevValidEvent={prevValidEvent}
        eventNum={eventNum}
        filename={filename}
        elements={elements}
        bookId={bookId}
      />

      <GraphCanvasArea
        ref={canvasAreaRef}
        activeTooltip={activeTooltip}
        chapterLabel={chapterLabel}
        eventNum={eventNum}
        filterStage={filterStage}
        isLoading={isEventTransition}
        elements={elements}
        stylesheet={stylesheet}
        cyRef={cyRef}
        fitNodeIds={fitNodeIds}
        searchTerm={searchTerm}
        isSearchActive={isSearchActive}
        filteredElements={filteredElements}
        onShowNodeTooltip={onShowNodeTooltip}
        onShowEdgeTooltip={onShowEdgeTooltip}
        onClearTooltip={clearTooltip}
        selectedElementRef={selectedElementRef}
        graphClearRef={graphClearRef}
        viewportFitKey={currentChapter}
      />
    </div>
  );
});

/** 캔버스 위/대신 보여줄 안내: 갱신 중 · 필터 결과 없음 · 로딩 · 오류 */
function GraphPanelNotices({ panel, onResetFilter, inCanvas }) {
  const overlayClass = panel.hasElements ? 'graph-fill-overlay' : 'graph-fill-overlay graph-fill-overlay--bare';
  if (inCanvas) {
    const showFilteredEmpty =
      panel.isFilteredToEmpty && !panel.resolvedApiError && !panel.shouldShowLoading && !panel.showRefreshOverlay;
    return (
      <>
        {panel.showRefreshOverlay ? <GraphRefreshOverlay /> : null}
        {showFilteredEmpty ? (
          <GraphFilteredEmptyNotice className={overlayClass} onReset={onResetFilter} />
        ) : null}
      </>
    );
  }
  return (
    <>
      {panel.shouldShowLoading ? <GraphLoadingNotice className={overlayClass} notice={panel.loadingNotice} /> : null}
      {panel.resolvedApiError ? <GraphErrorNotice className={overlayClass} error={panel.resolvedApiError} /> : null}
    </>
  );
}

const GraphSplitArea = memo(function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
  tooltipProps,
  transitionState,
  apiError,
  cachedLocation,
  resumeAnchor,
  onToggleGraph,
}) {
  const { appliedSearchTerm, isSearchActive, filteredElements, fitNodeIds } = searchState;
  const { book, bookKey, routeBookId } = viewerState;
  const { currentChapter, edgeLabelVisible } = graphState;
  const { filterStage, setFilterStage } = graphActions;
  const topBarBookId = useMemo(() => toPositiveNumberOrNull(book?.id), [book?.id]);

  const panel = useGraphPanelState({
    viewerState,
    graphState,
    filterStage,
    isSearchActive,
    filteredElements,
    transitionState,
    apiError,
    cachedLocation,
    resumeAnchor,
  });
  const { canvasMeta } = panel;

  const resetFilterStage = useCallback(() => setFilterStage?.(0), [setFilterStage]);
  const openRelationGraphPage = useOpenGraphPage(currentChapter);
  const noticeProps = { panel, onResetFilter: resetFilterStage };

  return (
    <div className="graph-page-shell graph-page-shell--fill">
      <GraphSplitTopBar
        graphState={graphState}
        graphActions={graphActions}
        bookId={topBarBookId}
        searchState={searchState}
        searchActions={searchActions}
      />

      <div className="graph-page-inner">
        {panel.isDataLoadCompleteAndEmpty ? (
          <GraphEmptyEventsNotice onToggleGraph={onToggleGraph} onOpenRelationGraph={openRelationGraphPage} />
        ) : (
          <>
            {/* 기존 elements를 유지한 채 Cytoscape id diff로 추가·삭제만 반영 */}
            {panel.hasElements ? (
              <div className="graph-canvas-area">
                <GraphContainer
                  currentEvent={canvasMeta.currentEvent}
                  currentChapter={canvasMeta.currentChapter}
                  chapterLabel={formatChapterOrdinalLabel(canvasMeta.currentChapter)}
                  edgeLabelVisible={edgeLabelVisible}
                  filename={routeBookId ?? bookKey ?? ''}
                  elements={panel.finalElements}
                  searchTerm={appliedSearchTerm}
                  isSearchActive={isSearchActive}
                  filteredElements={filteredElements}
                  fitNodeIds={fitNodeIds}
                  filterStage={filterStage}
                  prevValidEvent={canvasMeta.prevValidEvent ?? null}
                  tooltip={tooltipProps}
                  isEventTransition={panel.isEventTransition || !panel.canShowGraph}
                  bookId={book?.id ?? bookKey}
                />
                <GraphPanelNotices {...noticeProps} inCanvas />
              </div>
            ) : null}
            <GraphPanelNotices {...noticeProps} />
          </>
        )}
      </div>
    </div>
  );
});

export default GraphSplitArea;

import { lazy, Suspense, useMemo, useRef, memo, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import GraphCanvasArea from '../graph/canvas/GraphCanvasArea';
import NodeDetail from '../graph/detail/NodeDetail';
import { getEdgeStyle, createGraphStylesheet } from '../../utils/styles/graphStyles';
import { usePreFocusViewport, shouldIgnoreGraphOutsideClick, useGraphTooltipSelection } from '../../hooks/graph/useGraphCy';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerSession';
import { toPositiveNumberOrNull, resolvePositiveBookId } from '../../utils/common/valueUtils';
import { formatChapterOrdinalLabel } from '../../utils/viewer/viewerCore';
import { userGraphPath } from '../../utils/common/urlUtils';
import { GraphSplitTopBar } from './graph/GraphSplitTopBar';
import { GraphEmptyEventsNotice, GraphErrorNotice, GraphFilteredEmptyNotice, GraphLoadingNotice, GraphRefreshOverlay } from './graph/GraphPanelNotices';
import { useGraphPanelState } from '../../hooks/viewer/useGraphPanelState';
import '../graph/styles/graph.css';

const EdgeDetail = lazy(() => import('../graph/detail/EdgeDetail'));

const VIEWER_FOCUS_OPTIONS = { duration: 400, reserveRight: 48, padding: 24 };

/** 노드/간선 플로팅 툴팁 (활성 툴팁 종류에 따라 하나만) */
function GraphTooltipLayer({
  activeTooltip,
  onClose,
  onSelectRelatedNode,
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
          onSelectRelatedNode={onSelectRelatedNode}
          showPovSummary={false}
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
            variant="viewer"
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
const GraphContainer = memo(function GraphContainer({
  currentEvent,
  currentChapter,
  chapterDisplayLabel = null,
  edgeLabelVisible = true,
  filename,
  elements = [],
  prevValidEvent = null,
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition = false,
  searchTerm = '',
  isSearchActive = false,
  filteredElements = [],
  fitNodeIds = [],
  filterStage = 0,
  bookId = null,
  cyRef: externalCyRef = null,
  onCyReady = null,
  showZoomControls = false,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter,
    progressTopBar: null,
    fallback: 0,
  });
  const localCyRef = useRef(null);
  const cyRef = externalCyRef ?? localCyRef;
  const selectedElementRef = useRef(null);
  const graphSelectNodeRef = useRef(null);
  const tooltipBoundsRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const chapterLabel = chapterDisplayLabel || formatChapterOrdinalLabel(currentChapter);

  // 클릭으로 뷰포트가 이동하기 전 상태를 저장해뒀다가, 선택 해제 시 그 배치로 되돌린다.
  // 분할화면은 패널이 좁아 툴팁 전체 폭을 비우면 줌이 과도하게 줄어듦 — 약간 겹침 허용
  const { centerSelection, releasePreFocusViewport } = usePreFocusViewport(cyRef, VIEWER_FOCUS_OPTIONS);

  // 챕터·이벤트가 바뀌면 그래프 자체가 다시 fit되므로, 이전 배치 스냅샷은 더 이상 유효하지 않다.
  useEffect(() => {
    releasePreFocusViewport(false);
  }, [currentChapter, currentEvent, releasePreFocusViewport]);

  const handleClearTooltip = useCallback(() => {
    releasePreFocusViewport();
    onClearTooltip?.();
  }, [releasePreFocusViewport, onClearTooltip]);

  const closeTooltipAndRestoreFocus = useCallback(() => {
    handleClearTooltip();
    requestAnimationFrame(() => {
      canvasAreaRef.current?.focus({ preventScroll: true });
    });
  }, [handleClearTooltip]);

  const handleSelectRelatedNode = useCallback((idOrName) => {
    return graphSelectNodeRef.current?.(idOrName) ?? false;
  }, []);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useGraphTooltipSelection({
    activeTooltip,
    onSetActiveTooltip,
    centerSelection,
    focusDelayMs: 50,
    tooltipOpen: !!activeTooltip,
    onDismiss: handleClearTooltip,
    shouldIgnoreClick: (event) => shouldIgnoreGraphOutsideClick(event, 'viewer'),
    attachDelayMs: 50,
  });

  const stylesheet = useMemo(
    () => createGraphStylesheet(getEdgeStyle('viewer'), edgeLabelVisible),
    [edgeLabelVisible]
  );

  return (
    <div className="graph-shell" ref={tooltipBoundsRef}>
      <GraphTooltipLayer
        activeTooltip={activeTooltip}
        onClose={closeTooltipAndRestoreFocus}
        onSelectRelatedNode={handleSelectRelatedNode}
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
        onClearTooltip={handleClearTooltip}
        selectedElementRef={selectedElementRef}
        graphClearRef={graphClearRef}
        graphSelectNodeRef={graphSelectNodeRef}
        showZoomControls={showZoomControls}
        onCyReady={onCyReady}
        viewportFitKey={currentChapter}
      />
    </div>
  );
});

const GraphSplitArea = memo(function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState = {},
  searchActions,
  tooltipProps,
  transitionState,
  apiError,
  cachedLocation = null,
  resumeAnchor = null,
  onToggleGraph = null,
}) {
  const navigate = useNavigate();
  const { filename: routeFilename } = useParams();
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const {
    appliedSearchTerm = '',
    isSearchActive = false,
    filteredElements = [],
    fitNodeIds = [],
  } = searchState;

  const { book, bookKey, routeBookId } = viewerState;
  const topBarBookId = useMemo(() => toPositiveNumberOrNull(book?.id), [book?.id]);
  const { currentChapter, edgeLabelVisible } = graphState;
  const { filterStage, setFilterStage } = graphActions;
  const cyRef = useRef(null);

  const {
    canShowGraph,
    isDataLoadCompleteAndEmpty,
    resolvedApiError,
    shouldShowLoading,
    showRefreshOverlay,
    loadingNotice,
    finalElements,
    hasElements,
    isEventTransition,
    isFilteredToEmpty,
    canvasMeta,
  } = useGraphPanelState({
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

  const resetFilterStage = useCallback(() => {
    setFilterStage?.(0);
  }, [setFilterStage]);

  const openRelationGraphPage = useCallback(() => {
    const id = resolvePositiveBookId(routeBookId, book?.id, bookKey, routeFilename);
    if (id == null) return;
    navigate(userGraphPath(id), {
      state: {
        book,
        selectedChapter: Number(currentChapter) || 1,
      },
    });
  }, [book, bookKey, currentChapter, navigate, routeBookId, routeFilename]);

  const fillOverlayClass = hasElements ? 'graph-fill-overlay' : 'graph-fill-overlay graph-fill-overlay--bare';
  const showFilteredEmpty = isFilteredToEmpty && !resolvedApiError && !shouldShowLoading && !showRefreshOverlay;

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
        {isDataLoadCompleteAndEmpty ? (
          <GraphEmptyEventsNotice onToggleGraph={onToggleGraph} onOpenRelationGraph={openRelationGraphPage} />
        ) : (
          <>
            {/* 기존 elements를 유지한 채 Cytoscape id diff로 추가·삭제만 반영 */}
            {hasElements ? (
              <div className="graph-canvas-area">
                <GraphContainer
                  currentEvent={canvasMeta.currentEvent}
                  currentChapter={canvasMeta.currentChapter}
                  chapterDisplayLabel={formatChapterOrdinalLabel(canvasMeta.currentChapter)}
                  edgeLabelVisible={edgeLabelVisible}
                  filename={routeBookId ?? bookKey ?? ''}
                  elements={finalElements}
                  searchTerm={appliedSearchTerm}
                  isSearchActive={isSearchActive}
                  filteredElements={filteredElements}
                  fitNodeIds={fitNodeIds}
                  filterStage={filterStage}
                  prevValidEvent={canvasMeta.prevValidEvent ?? null}
                  activeTooltip={activeTooltip}
                  onClearTooltip={onClearTooltip}
                  onSetActiveTooltip={onSetActiveTooltip}
                  graphClearRef={graphClearRef}
                  isEventTransition={isEventTransition || !canShowGraph}
                  bookId={book?.id ?? bookKey}
                  cyRef={cyRef}
                  showZoomControls
                />
                {showRefreshOverlay ? <GraphRefreshOverlay /> : null}
                {showFilteredEmpty ? (
                  <GraphFilteredEmptyNotice className={fillOverlayClass} onReset={resetFilterStage} />
                ) : null}
              </div>
            ) : null}

            {shouldShowLoading ? <GraphLoadingNotice className={fillOverlayClass} notice={loadingNotice} /> : null}
            {resolvedApiError ? <GraphErrorNotice className={fillOverlayClass} error={resolvedApiError} /> : null}
          </>
        )}
      </div>
    </div>
  );
});

export default GraphSplitArea;

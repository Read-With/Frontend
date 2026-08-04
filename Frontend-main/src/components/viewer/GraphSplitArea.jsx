import { lazy, Suspense, useMemo, useRef, memo, useCallback, useEffect, useState, useId } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Inbox, Loader2, Maximize, Minimize } from 'lucide-react';
import CytoscapeGraphUnified from '../graph/CytoscapeGraphUnified';
import UnifiedNodeInfo from '../graph/UnifiedNodeInfo';
import { useGraphElementPipeline } from '../../hooks/graph/useGraphViewState';
import { getEdgeStyle, createGraphStylesheet } from '../../utils/styles/graphStyles';
import { centerSelectionOnElementId } from '../../utils/graph/graphCy';
import {
  GraphA11yStatus,
  shouldIgnoreGraphOutsideClick,
  useGraphCanvasKeyboard,
  useGraphTooltipSelection,
  useGraphTopbarToolsReserve,
} from '../../hooks/graph/useGraphCy';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerSession';
import {
  resolveGraphCallContext,
  normalizeGraphApiError,
  getViewerGraphLoadingNotice,
  resolveViewerSplitChapterMeta,
} from '../../utils/viewer/viewerGraph';
import { hasGraphPanelLocationHint, toPositiveNumberOrNull, resolvePositiveBookId } from '../../utils/common/valueUtils';
import { eventUtils, formatChapterOrdinalLabel } from '../../utils/viewer/viewerCore';
import { userGraphPath } from '../../utils/common/urlUtils';
import '../graph/RelationGraph.css';
import {
  GraphFloatingControls,
  GraphChapterEventMeta,
  GraphNoticePanel,
} from '../graph/GraphControls';

const UnifiedEdgeTooltip = lazy(() => import('../graph/UnifiedEdgeTooltip'));

const FULLSCREEN_TOGGLE = {
  enter: {
    label: '그래프 확대 — 같은 읽기 그래프를 키움',
    title: '그래프 확대 (챕터 탐색은 「전체 관계도」)',
  },
  exit: {
    label: '분할로 — 본문과 함께 보기',
    title: '분할로 (본문+그래프)',
  },
};

const GraphSplitTopBar = memo(function GraphSplitTopBar({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
}) {
  const { book } = viewerState;

  const {
    currentChapter,
    currentEvent,
    prevValidEvent,
    graphFullScreen,
    progressTopBar,
    edgeLabelVisible,
  } = graphState;

  const { setGraphFullScreen, setEdgeLabelVisible, filterStage, setFilterStage } = graphActions;

  const bookId = useMemo(() => toPositiveNumberOrNull(book?.id), [book?.id]);

  const chapterMeta = useMemo(
    () => resolveViewerSplitChapterMeta(bookId, currentChapter),
    [bookId, currentChapter],
  );

  const fullscreenCopy = graphFullScreen ? FULLSCREEN_TOGGLE.exit : FULLSCREEN_TOGGLE.enter;

  const topbarRef = useRef(null);
  const toolsRef = useRef(null);
  useGraphTopbarToolsReserve(topbarRef, toolsRef);

  return (
    <div className="graph-split-topbar" ref={topbarRef}>
      <button
        type="button"
        className="graph-fullscreen-btn"
        aria-label={fullscreenCopy.label}
        title={fullscreenCopy.title}
        onClick={() => setGraphFullScreen(!graphFullScreen)}
      >
        {graphFullScreen ? (
          <Minimize size={18} aria-hidden />
        ) : (
          <Maximize size={18} aria-hidden />
        )}
      </button>

      <div className="graph-split-topbar-center">
        <GraphChapterEventMeta
          bookId={bookId}
          progressTopBar={progressTopBar}
          currentEvent={currentEvent}
          prevValidEvent={prevValidEvent}
          resolvedServerChapter={chapterMeta.resolvedServerChapter}
          chapterDisplayLabel={chapterMeta.chapterDisplayLabel}
        />
      </div>

      <div className="graph-split-topbar-tools" ref={toolsRef}>
        <GraphFloatingControls
          searchState={searchState}
          searchActions={searchActions}
          edgeLabelVisible={edgeLabelVisible}
          onToggleEdgeLabel={() => setEdgeLabelVisible((v) => !v)}
          filterStage={filterStage}
          onFilterChange={setFilterStage}
          showLegend
        />
      </div>
    </div>
  );
});

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
  const graphSelectElementRef = useRef(null);
  const tooltipBoundsRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const a11yStatusId = useId();
  const chapterLabel = chapterDisplayLabel || formatChapterOrdinalLabel(currentChapter);
  const a11yElements = isSearchActive && Array.isArray(filteredElements)
    ? filteredElements
    : elements;

  const dismissTooltip = useCallback(() => {
    onClearTooltip?.();
  }, [onClearTooltip]);

  const closeTooltipAndRestoreFocus = useCallback(() => {
    onClearTooltip?.();
    requestAnimationFrame(() => {
      canvasAreaRef.current?.focus({ preventScroll: true });
    });
  }, [onClearTooltip]);

  const { onKeyDown: handleCanvasKeyDown, liveAnnouncement, ariaLabel } = useGraphCanvasKeyboard({
    cyRef,
    graphClearRef,
    selectElementRef: graphSelectElementRef,
    activeTooltip,
    onClearTooltip: dismissTooltip,
  });

  const centerSelection = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy) return;

    // 분할화면은 패널이 좁아 툴팁 전체 폭을 비우면 줌이 과도하게 줄어듦 — 약간 겹침 허용
    centerSelectionOnElementId(cy, elementId, {
      duration: 400,
      reserveRight: 48,
      padding: 24,
    });
  }, [cyRef]);

  const handleSelectRelatedNode = useCallback((idOrName) => {
    return graphSelectNodeRef.current?.(idOrName) ?? false;
  }, []);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useGraphTooltipSelection({
    activeTooltip,
    onSetActiveTooltip,
    centerSelection,
    focusDelayMs: 50,
    tooltipOpen: !!activeTooltip,
    onDismiss: dismissTooltip,
    shouldIgnoreClick: (event) => shouldIgnoreGraphOutsideClick(event, 'viewer'),
    attachDelayMs: 50,
  });

  const stylesheet = useMemo(
    () => createGraphStylesheet(getEdgeStyle('viewer'), edgeLabelVisible),
    [edgeLabelVisible]
  );

  return (
    <div className="graph-shell" ref={tooltipBoundsRef}>
      <div
        className="graph-tooltip-layer"
        onClick={(e) => e.stopPropagation()}
      >
        {activeTooltip?.type === 'node' && (
          <UnifiedNodeInfo
            key={`node-tooltip-${activeTooltip.id}`}
            displayMode="tooltip"
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={closeTooltipAndRestoreFocus}
            currentChapter={currentChapter}
            eventNum={eventNum}
            filename={filename}
            elements={elements}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            onSelectRelatedNode={handleSelectRelatedNode}
            showPovSummary={false}
            tooltipBoundsRef={tooltipBoundsRef}
          />
        )}
        {activeTooltip?.type === 'edge' && (
          <Suspense fallback={<div role="status" aria-live="polite">관계 정보를 불러오는 중…</div>}>
            <UnifiedEdgeTooltip
              key={`edge-tooltip-${activeTooltip.id}`}
              data={activeTooltip.data}
              x={activeTooltip.x}
              y={activeTooltip.y}
              onClose={closeTooltipAndRestoreFocus}
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

      <div
        ref={canvasAreaRef}
        className="graph-canvas-area"
        role="region"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={a11yStatusId}
        onKeyDown={handleCanvasKeyDown}
      >
        <GraphA11yStatus
          id={a11yStatusId}
          chapterLabel={chapterLabel}
          eventNum={eventNum}
          elements={a11yElements}
          filterStage={filterStage}
          isSearchActive={isSearchActive}
          searchTerm={searchTerm}
          activeTooltip={activeTooltip}
          isLoading={isEventTransition}
          liveAnnouncement={liveAnnouncement}
        />
        <CytoscapeGraphUnified
          elements={elements}
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
          graphSelectElementRef={graphSelectElementRef}
          showZoomControls={showZoomControls}
          onCyReady={onCyReady}
          viewportFitKey={currentChapter}
        />
      </div>
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
    searchTerm = '',
    isSearchActive = false,
    filteredElements = [],
    fitNodeIds = [],
  } = searchState;

  const { graphPhase, isDataReady, isDataEmpty, appliedGraphKey, book, bookKey, routeBookId } = viewerState;
  const {
    elements,
    currentEvent,
    currentChapter,
    prevValidEvent,
    edgeLabelVisible,
  } = graphState;
  const { filterStage } = graphActions;
  const cyRef = useRef(null);

  const topBarSearchState = useMemo(
    () => ({
      searchTerm,
      isSearchActive,
      suggestions: searchState.suggestions ?? [],
      showSuggestions: searchState.showSuggestions ?? false,
      selectedIndex: searchState.selectedIndex ?? -1,
    }),
    [
      searchTerm,
      isSearchActive,
      searchState.suggestions,
      searchState.showSuggestions,
      searchState.selectedIndex,
    ]
  );

  const topBarSearchActions = useMemo(
    () => ({
      onSearchSubmit: searchActions?.onSearchSubmit,
      onClearSearch: searchActions?.clearSearch,
      onGenerateSuggestions: searchActions?.onGenerateSuggestions,
      onKeyDown: searchActions?.handleKeyDown,
      onCloseSuggestions: searchActions?.closeSuggestions,
      onSelectedIndexChange: searchActions?.onSelectedIndexChange,
    }),
    [searchActions]
  );

  const hasResolvedEvent = eventUtils.resolveEventNum(currentEvent) > 0;
  const targetGraphKey = useMemo(() => {
    if (!hasResolvedEvent) return null;
    const ctx = resolveGraphCallContext({ book, currentChapter, currentEvent });
    return ctx?.eventIdx >= 1 ? ctx.callKey : null;
  }, [book, currentChapter, currentEvent, hasResolvedEvent]);
  const graphMatchesTarget =
    Boolean(targetGraphKey) &&
    Boolean(appliedGraphKey) &&
    appliedGraphKey === targetGraphKey;

  const hasLocationHint =
    hasGraphPanelLocationHint(cachedLocation, { requireEventNum: true }) ||
    hasGraphPanelLocationHint(resumeAnchor);

  const isLocationDetermined = useMemo(() => {
    if (!currentChapter || currentChapter < 1) return hasLocationHint;
    if (!currentEvent) return hasLocationHint;
    return true;
  }, [currentChapter, currentEvent, hasLocationHint]);

  const { finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive,
    filteredElements,
  });

  const hasElements = Array.isArray(elements) && elements.length > 0;
  // 확정 이벤트 + 타깃 callKey 일치 시에만 노출 (이전 이벤트 stale 금지)
  const canShowGraph = isDataReady && hasResolvedEvent && hasElements && graphMatchesTarget;
  const isGraphIdle = graphPhase === 'idle';
  const isEventTransition =
    transitionState.type === 'event' && transitionState.inProgress;
  const isGraphRefreshing = graphPhase === 'event' || isEventTransition;

  const isDataLoadCompleteAndEmpty =
    isGraphIdle &&
    isDataReady &&
    isDataEmpty &&
    !hasElements &&
    hasResolvedEvent &&
    graphMatchesTarget;

  // hidden 동안에는 이전에 표시 중이던 이벤트 메타를 유지 (새 이벤트+옛 elements 혼선 방지)
  const [mountedEvent, setMountedEvent] = useState(currentEvent);
  const [mountedChapter, setMountedChapter] = useState(currentChapter);
  const [mountedPrevValidEvent, setMountedPrevValidEvent] = useState(prevValidEvent);
  useEffect(() => {
    if (!canShowGraph) return;
    setMountedEvent(currentEvent);
    setMountedChapter(currentChapter);
    setMountedPrevValidEvent(prevValidEvent);
  }, [canShowGraph, currentEvent, currentChapter, prevValidEvent]);

  const graphEventForCanvas = canShowGraph ? currentEvent : mountedEvent;
  const graphChapterForCanvas = canShowGraph ? currentChapter : mountedChapter;
  const graphPrevValidForCanvas = canShowGraph ? prevValidEvent : mountedPrevValidEvent;

  const resolvedApiError = normalizeGraphApiError(apiError);

  const shouldShowLoading =
    !canShowGraph &&
    !isDataLoadCompleteAndEmpty &&
    !resolvedApiError;

  const showRefreshOverlay = canShowGraph && isGraphRefreshing;

  const loadingNotice = getViewerGraphLoadingNotice(
    isGraphRefreshing || !isDataReady || !hasResolvedEvent || !graphMatchesTarget,
    isLocationDetermined,
    transitionState.type
  );

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

  const fillOverlayClass = [
    'graph-fill-overlay',
    hasElements ? null : 'graph-fill-overlay--bare',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="graph-page-shell graph-page-shell--fill">
      <GraphSplitTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={{ book }}
        searchState={topBarSearchState}
        searchActions={topBarSearchActions}
      />

      <div className="graph-page-inner">
        {isDataLoadCompleteAndEmpty ? (
          <GraphNoticePanel
            variant="empty"
            title="아직 이벤트가 없습니다"
            description="이 챕터에는 표시할 그래프 데이터가 없습니다. 본문을 더 읽거나 그래프를 닫을 수 있습니다."
            icon={<Inbox size={24} strokeWidth={1.75} aria-hidden />}
            actions={
              <>
                {onToggleGraph ? (
                  <button type="button" className="graph-panel-btn graph-panel-btn--secondary" onClick={onToggleGraph}>
                    그래프 닫기
                  </button>
                ) : null}
                <button type="button" className="graph-panel-btn graph-panel-btn--primary" onClick={openRelationGraphPage}>
                  전체 관계도 열기
                </button>
              </>
            }
          />
        ) : (
          <>
            {/* 기존 elements를 유지한 채 Cytoscape id diff로 추가·삭제만 반영 */}
            {hasElements ? (
              <div className="graph-canvas-area">
                <GraphContainer
                  currentEvent={graphEventForCanvas}
                  currentChapter={graphChapterForCanvas}
                  chapterDisplayLabel={formatChapterOrdinalLabel(graphChapterForCanvas)}
                  edgeLabelVisible={edgeLabelVisible}
                  filename={routeBookId ?? bookKey ?? ''}
                  elements={finalElements}
                  searchTerm={searchTerm}
                  isSearchActive={isSearchActive}
                  filteredElements={filteredElements}
                  fitNodeIds={fitNodeIds}
                  filterStage={filterStage}
                  prevValidEvent={graphPrevValidForCanvas ?? null}
                  activeTooltip={activeTooltip}
                  onClearTooltip={onClearTooltip}
                  onSetActiveTooltip={onSetActiveTooltip}
                  graphClearRef={graphClearRef}
                  isEventTransition={isEventTransition || !canShowGraph}
                  bookId={book?.id ?? bookKey}
                  cyRef={cyRef}
                  showZoomControls
                />
                {showRefreshOverlay ? (
                  <div
                    className="graph-refresh-overlay"
                    role="status"
                    aria-live="polite"
                    aria-label="그래프 전환 중"
                  >
                    <div className="graph-refresh-chip">
                      <Loader2 size={16} className="graph-spin" strokeWidth={2} aria-hidden />
                      <span>이벤트 반영 중</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {shouldShowLoading ? (
              <div className={fillOverlayClass}>
                <GraphNoticePanel
                  variant="loading"
                  title={loadingNotice.title}
                  description={loadingNotice.description}
                  icon={<Loader2 size={20} className="graph-spin" strokeWidth={2} aria-hidden />}
                />
              </div>
            ) : null}

            {resolvedApiError ? (
              <div className={`${fillOverlayClass} graph-fill-overlay--error`}>
                <GraphNoticePanel
                  variant="error"
                  title={resolvedApiError.message || '문제가 발생했습니다'}
                  description={resolvedApiError.details || '잠시 후 다시 시도해 주세요.'}
                  icon={<AlertCircle size={24} strokeWidth={2} aria-hidden />}
                  actions={
                    resolvedApiError.retry ? (
                      <button type="button" className="graph-panel-btn graph-panel-btn--primary" onClick={resolvedApiError.retry}>
                        다시 시도
                      </button>
                    ) : null
                  }
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});

export default GraphSplitArea;

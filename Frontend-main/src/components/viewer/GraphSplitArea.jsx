import { lazy, Suspense, useMemo, useRef, memo, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Filter, Inbox, Loader2, Maximize, Minimize } from 'lucide-react';
import GraphCanvasArea from '../graph/GraphCanvasArea';
import NodeDetail from '../graph/NodeDetail';
import { useGraphElementPipeline } from '../../hooks/graph/useGraphViewState';
import { getEdgeStyle, createGraphStylesheet } from '../../utils/styles/graphStyles';
import {
  usePreFocusViewport,
  shouldIgnoreGraphOutsideClick,
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
import { GraphFloatingControls, GraphTopBarMeta } from '../graph/GraphControls';
import { formatGraphEventMetaLabel } from '../../utils/graph/graphCore';

const EdgeDetail = lazy(() => import('../graph/EdgeDetail'));

/** 분할 상단바: 챕터 + 사건 메타 (계산중 포함) */
function GraphChapterEventMeta({
  bookId,
  progressTopBar,
  currentEvent,
  prevValidEvent,
  resolvedServerChapter,
  chapterDisplayLabel,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter: resolvedServerChapter,
    progressTopBar: progressTopBar ?? { eventNum: null },
    fallback: 0,
  });

  if (bookId && progressTopBar === undefined && !(eventNum > 0)) {
    return <span className="graph-topbar-meta-event">계산중…</span>;
  }

  return (
    <GraphTopBarMeta
      chapterLabel={chapterDisplayLabel}
      eventLabel={formatGraphEventMetaLabel(eventNum > 0 ? eventNum : null)}
    />
  );
}

/** 빈/로딩/에러 패널 (분할 그래프) */
function GraphNoticePanel({ variant, title, description, icon, actions }) {
  const isLoading = variant === 'loading';
  const TitleTag = isLoading ? 'p' : 'h3';

  return (
    <div
      className={`graph-panel-status graph-panel-status--${variant}`}
      role={isLoading ? 'status' : variant === 'error' ? 'alert' : undefined}
      aria-live={isLoading ? 'polite' : undefined}
    >
      <div className={`graph-panel-status-icon graph-panel-status-icon--${variant}`} aria-hidden>
        {icon}
      </div>
      <div className="graph-panel-status-copy">
        <TitleTag className="graph-panel-status-title">{title}</TitleTag>
        {description ? <p className="graph-panel-status-desc">{description}</p> : null}
      </div>
      {actions ? <div className="graph-panel-status-actions">{actions}</div> : null}
    </div>
  );
}

const VIEWER_FOCUS_OPTIONS = { duration: 400, reserveRight: 48, padding: 24 };

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
  bookId,
  searchState,
  searchActions,
}) {
  const {
    currentChapter,
    currentEvent,
    prevValidEvent,
    graphFullScreen,
    progressTopBar,
    edgeLabelVisible,
  } = graphState;

  const { setGraphFullScreen, setEdgeLabelVisible, filterStage, setFilterStage } = graphActions;

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
        />
      </div>
    </div>
  );
});

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

/**
 * 그래프 패널에 무엇을 보여줄지 결정하는 파생 상태.
 * - canShowGraph: 확정 이벤트 + 타깃 callKey 일치 + elements 있음 → 캔버스 노출 (이전 이벤트 stale 금지)
 * - isDataLoadCompleteAndEmpty: 로딩이 끝났고 이 챕터엔 표시할 이벤트가 없음 → 빈 상태 패널
 * - isGraphRefreshing: 이벤트 전환 중 → 캔버스는 유지한 채 오버레이만 노출
 * - shouldShowLoading / resolvedApiError: 캔버스를 아직 그릴 수 없을 때의 대체 패널
 */
function resolveGraphPanelStatus({
  graphPhase,
  isEventTransition,
  isDataReady,
  hasResolvedEvent,
  hasElements,
  graphMatchesTarget,
  isDataEmpty,
  apiError,
  isLocationDetermined,
  transitionType,
}) {
  const canShowGraph = isDataReady && hasResolvedEvent && hasElements && graphMatchesTarget;
  const isGraphRefreshing = graphPhase === 'event' || isEventTransition;
  const isDataLoadCompleteAndEmpty =
    graphPhase === 'idle' && isDataReady && isDataEmpty && !hasElements && hasResolvedEvent && graphMatchesTarget;
  const resolvedApiError = normalizeGraphApiError(apiError);
  const shouldShowLoading = !canShowGraph && !isDataLoadCompleteAndEmpty && !resolvedApiError;
  // 에러가 있으면 "이벤트 반영 중" 칩과 동시에 겹쳐 보이지 않도록 에러를 우선한다.
  const showRefreshOverlay = canShowGraph && isGraphRefreshing && !resolvedApiError;
  const loadingNotice = getViewerGraphLoadingNotice(
    isGraphRefreshing || !isDataReady || !hasResolvedEvent || !graphMatchesTarget,
    isLocationDetermined,
    transitionType
  );
  return {
    canShowGraph,
    isDataLoadCompleteAndEmpty,
    resolvedApiError,
    shouldShowLoading,
    showRefreshOverlay,
    loadingNotice,
  };
}

/** 확정 이벤트·타깃 그래프 callKey (이벤트 미확정이면 null) */
function resolveTargetGraphKey({ book, currentChapter, currentEvent, hasResolvedEvent }) {
  if (!hasResolvedEvent) return null;
  const ctx = resolveGraphCallContext({ book, currentChapter, currentEvent });
  return ctx?.eventIdx >= 1 ? ctx.callKey : null;
}

/** 캔버스를 못 그리는 동안에는 마지막으로 표시한 이벤트 메타 유지 (새 이벤트+옛 elements 혼선 방지) */
function useMountedGraphMeta(canShowGraph, currentEvent, currentChapter, prevValidEvent) {
  const [mounted, setMounted] = useState({ currentEvent, currentChapter, prevValidEvent });
  useEffect(() => {
    if (!canShowGraph) return;
    // 값이 같으면 이전 객체 유지 (불필요한 재렌더 방지)
    setMounted((prev) => (
      prev.currentEvent === currentEvent &&
      prev.currentChapter === currentChapter &&
      prev.prevValidEvent === prevValidEvent
        ? prev
        : { currentEvent, currentChapter, prevValidEvent }
    ));
  }, [canShowGraph, currentEvent, currentChapter, prevValidEvent]);
  return canShowGraph ? { currentEvent, currentChapter, prevValidEvent } : mounted;
}

function GraphPanelButton({ variant = 'primary', onClick, children }) {
  return (
    <button type="button" className={`graph-panel-btn graph-panel-btn--${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

function GraphEmptyEventsNotice({ onToggleGraph, onOpenRelationGraph }) {
  return (
    <GraphNoticePanel
      variant="empty"
      title="아직 이벤트가 없습니다"
      description="이 챕터에는 표시할 그래프 데이터가 없습니다. 본문을 더 읽거나 그래프를 닫을 수 있습니다."
      icon={<Inbox size={24} strokeWidth={1.75} aria-hidden />}
      actions={
        <>
          {onToggleGraph ? (
            <GraphPanelButton variant="secondary" onClick={onToggleGraph}>그래프 닫기</GraphPanelButton>
          ) : null}
          <GraphPanelButton onClick={onOpenRelationGraph}>전체 관계도 열기</GraphPanelButton>
        </>
      }
    />
  );
}

function GraphRefreshOverlay() {
  return (
    <div className="graph-refresh-overlay" role="status" aria-live="polite" aria-label="그래프 전환 중">
      <div className="graph-refresh-chip">
        <Loader2 size={16} className="graph-spin" strokeWidth={2} aria-hidden />
        <span>이벤트 반영 중</span>
      </div>
    </div>
  );
}

function GraphFilteredEmptyNotice({ className, onReset }) {
  return (
    <div className={className}>
      <GraphNoticePanel
        variant="empty"
        title="조건에 맞는 인물이 없습니다"
        description="현재 필터에 해당하는 핵심 인물이 이 챕터에는 없습니다. 필터를 해제하면 전체 인물을 볼 수 있습니다."
        icon={<Filter size={24} strokeWidth={1.75} aria-hidden />}
        actions={<GraphPanelButton onClick={onReset}>필터 해제</GraphPanelButton>}
      />
    </div>
  );
}

function GraphLoadingNotice({ className, notice }) {
  return (
    <div className={className}>
      <GraphNoticePanel
        variant="loading"
        title={notice.title}
        description={notice.description}
        icon={<Loader2 size={20} className="graph-spin" strokeWidth={2} aria-hidden />}
      />
    </div>
  );
}

function GraphErrorNotice({ className, error }) {
  return (
    <div className={`${className} graph-fill-overlay--error`}>
      <GraphNoticePanel
        variant="error"
        title={error.message || '문제가 발생했습니다'}
        description={error.details || '잠시 후 다시 시도해 주세요.'}
        icon={<AlertCircle size={24} strokeWidth={2} aria-hidden />}
        actions={error.retry ? <GraphPanelButton onClick={error.retry}>다시 시도</GraphPanelButton> : null}
      />
    </div>
  );
}

/** 그래프 패널 파생 상태: 타깃 일치·위치 확정·필터 결과 → resolveGraphPanelStatus + 캔버스 메타 유지 */
function useGraphPanelState({
  viewerState,
  graphState,
  filterStage,
  isSearchActive,
  filteredElements,
  transitionState,
  apiError,
  cachedLocation,
  resumeAnchor,
}) {
  const { graphPhase, isDataReady, isDataEmpty, appliedGraphKey, book } = viewerState;
  const { elements, currentEvent, currentChapter, prevValidEvent } = graphState;

  const hasResolvedEvent = eventUtils.resolveEventNum(currentEvent) > 0;
  const targetGraphKey = useMemo(
    () => resolveTargetGraphKey({ book, currentChapter, currentEvent, hasResolvedEvent }),
    [book, currentChapter, currentEvent, hasResolvedEvent],
  );
  const graphMatchesTarget = Boolean(targetGraphKey) && appliedGraphKey === targetGraphKey;

  const hasLocationHint =
    hasGraphPanelLocationHint(cachedLocation, { requireEventNum: true }) ||
    hasGraphPanelLocationHint(resumeAnchor);
  const isLocationDetermined = (currentChapter >= 1 && Boolean(currentEvent)) || hasLocationHint;

  const { finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive,
    filteredElements,
  });

  const hasElements = Array.isArray(elements) && elements.length > 0;
  const isEventTransition =
    transitionState.type === 'event' && transitionState.inProgress;
  // 검색 결과 0건은 CytoscapeGraph 내부 no-results 오버레이가 처리하지만,
  // 인물 필터(filterStage)로 인한 0건은 여기서 별도 안내가 필요함 — 그렇지 않으면 빈 캔버스만 노출됨
  const isFilteredToEmpty =
    hasElements && !isSearchActive && filterStage > 0 && finalElements.length === 0;

  const panelStatus = useMemo(
    () => resolveGraphPanelStatus({
      graphPhase,
      isEventTransition,
      isDataReady,
      hasResolvedEvent,
      hasElements,
      graphMatchesTarget,
      isDataEmpty,
      apiError,
      isLocationDetermined,
      transitionType: transitionState.type,
    }),
    [
      graphPhase,
      isEventTransition,
      isDataReady,
      hasResolvedEvent,
      hasElements,
      graphMatchesTarget,
      isDataEmpty,
      apiError,
      isLocationDetermined,
      transitionState.type,
    ],
  );

  const canvasMeta = useMountedGraphMeta(panelStatus.canShowGraph, currentEvent, currentChapter, prevValidEvent);

  return { ...panelStatus, finalElements, hasElements, isEventTransition, isFilteredToEmpty, canvasMeta };
}

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
                  searchTerm={searchTerm}
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

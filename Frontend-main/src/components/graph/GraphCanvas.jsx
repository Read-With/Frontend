import { lazy, memo, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { ChevronLeft, ChevronRight, MousePointer2, Move, X, ZoomIn } from 'lucide-react';
import CytoscapeGraphUnified, { GraphZoomControls } from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './UnifiedNodeInfo';
import { GraphFloatingControls, GraphTopBarMeta } from './GraphControls';
import {
  GRAPH_LAYOUT_CONSTANTS,
  formatGraphEventMetaLabel,
  resolveChapterSidebarWidth,
} from '../../utils/graph/graphCore.js';
import { formatChapterOrdinalLabel } from '../../utils/viewer/viewerCore';
import { GraphA11yStatus, useGraphCanvasKeyboard, useGraphTopbarToolsReserve } from '../../hooks/graph/useGraphCy.js';

const UnifiedEdgeTooltip = lazy(() => import('./UnifiedEdgeTooltip'));

const {
  TOOLTIP_SIDEBAR_WIDTH: SIDEBAR_WIDTH,
  ANIMATION_MS: ANIMATION_DURATION,
} = GRAPH_LAYOUT_CONSTANTS;

const GRAPH_GESTURE_HINT_KEY = 'readwith:graph-gesture-hint:v1';

const EVENT_SCRUB_JUMPS = [
  {
    id: 'first',
    label: '처음',
    title: '챕터 첫 사건',
    resolve: (indices) => indices[0],
    isActive: (currentIdx) => currentIdx === 0,
    isDisabled: () => false,
  },
  {
    id: 'reading',
    label: '읽는 중',
    titleWhenAvailable: '현재 읽기 위치의 사건',
    titleWhenMissing: '이 챕터의 읽기 위치 정보가 없습니다',
    resolve: (_indices, readingEventNum) => readingEventNum,
    isActive: (currentIdx, indices, currentEvent, readingEventNum) =>
      readingEventNum != null && Number(currentEvent) === Number(readingEventNum),
    isDisabled: (_indices, readingEventNum) =>
      readingEventNum == null || !_indices.includes(Number(readingEventNum)),
  },
  {
    id: 'last',
    label: '끝',
    title: '챕터 마지막 사건',
    resolve: (indices) => indices[indices.length - 1],
    isActive: (currentIdx, indices) => currentIdx === indices.length - 1,
    isDisabled: () => false,
  },
];

function hasDismissedGraphGestureHint() {
  try {
    return globalThis.localStorage?.getItem(GRAPH_GESTURE_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function clearTimeoutRef(timeoutRef) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

function GraphEventScrubber({
  eventIndices = [],
  currentEvent,
  onEventChange,
  readingEventNum = null,
}) {
  const indices = useMemo(
    () => (Array.isArray(eventIndices) ? eventIndices : []),
    [eventIndices],
  );
  const currentIdx = indices.indexOf(Number(currentEvent));
  const sliderValue = currentIdx >= 0 ? currentIdx : 0;
  const atStart = indices.length === 0 || currentIdx <= 0;
  const atEnd = indices.length === 0 || currentIdx < 0 || currentIdx >= indices.length - 1;

  const goTo = useCallback((eventNum) => {
    const next = Number(eventNum);
    if (!Number.isFinite(next) || next < 1) return;
    if (next === Number(currentEvent)) return;
    onEventChange?.(next);
  }, [currentEvent, onEventChange]);

  const goBy = useCallback((delta) => {
    if (indices.length === 0) return;
    if (currentIdx < 0) {
      goTo(indices[0]);
      return;
    }
    goTo(indices[Math.min(indices.length - 1, Math.max(0, currentIdx + delta))]);
  }, [currentIdx, goTo, indices]);

  if (indices.length === 0) {
    return (
      <div className="graph-event-scrubber" role="group" aria-label="사건 탐색">
        <span className="graph-event-scrubber-empty">이 챕터에 사건이 없습니다</span>
      </div>
    );
  }

  const displayEvent = currentIdx >= 0 ? indices[currentIdx] : null;

  return (
    <div className="graph-event-scrubber" role="group" aria-label="사건 탐색">
      <div className="graph-event-scrubber-nav">
        <button
          type="button"
          className="graph-event-scrubber-btn"
          onClick={() => goBy(-1)}
          disabled={atStart}
          aria-label="이전 사건"
          title="이전 사건"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <label className="graph-event-scrubber-slider-wrap">
          <span className="graph-event-scrubber-value">
            {formatGraphEventMetaLabel(displayEvent, { unknown: '—' })}
            <span className="graph-event-scrubber-total"> / {indices.length}</span>
          </span>
          <input
            type="range"
            className="graph-event-scrubber-slider"
            min={0}
            max={Math.max(0, indices.length - 1)}
            step={1}
            value={sliderValue}
            aria-label="사건 슬라이더"
            aria-valuetext={formatGraphEventMetaLabel(indices[sliderValue])}
            onChange={(e) => goTo(indices[Number(e.target.value)])}
          />
        </label>
        <button
          type="button"
          className="graph-event-scrubber-btn"
          onClick={() => goBy(1)}
          disabled={atEnd}
          aria-label="다음 사건"
          title="다음 사건"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
      <div className="graph-event-scrubber-jumps" role="group" aria-label="사건 바로가기">
        {EVENT_SCRUB_JUMPS.map((jump) => {
          const disabled = jump.isDisabled(indices, readingEventNum);
          const active = jump.isActive(currentIdx, indices, currentEvent, readingEventNum);
          const title = jump.id === 'reading'
            ? (disabled ? jump.titleWhenMissing : jump.titleWhenAvailable)
            : jump.title;
          return (
            <button
              key={jump.id}
              type="button"
              className="graph-event-scrubber-jump"
              onClick={() => goTo(jump.resolve(indices, readingEventNum))}
              disabled={disabled}
              aria-pressed={active}
              title={title}
            >
              {jump.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

GraphEventScrubber.propTypes = {
  eventIndices: PropTypes.arrayOf(PropTypes.number),
  currentEvent: PropTypes.number,
  onEventChange: PropTypes.func,
  readingEventNum: PropTypes.number,
};

function GraphLoadingOverlay() {
  return <div className="graph-canvas-loading" role="status">그래프 업데이트 중...</div>;
}

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
  povError = null,
  povIsLoading = false,
  povCached = null,
  onRetryPov = null,
  apiBookGraphData = null,
  bookId = null,
  onSelectRelatedNode = null,
  chapterRailWidth = null,
  onRequestFocusCanvas = null,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);
  const restoreCanvasFocusRef = useRef(false);

  const sidebarStyle = useMemo(() => ({
    right: isClosing || !isVisible ? `-${SIDEBAR_WIDTH}px` : '0px',
  }), [isClosing, isVisible]);

  const finishClose = useCallback(() => {
    onClose();
    setIsClosing(false);
    setIsVisible(false);
    animationTimeoutRef.current = null;
    if (restoreCanvasFocusRef.current) {
      restoreCanvasFocusRef.current = false;
      onRequestFocusCanvas?.();
    }
  }, [onClose, onRequestFocusCanvas]);

  const runCloseAnimation = useCallback(() => {
    clearTimeoutRef(animationTimeoutRef);
    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(finishClose, ANIMATION_DURATION);
  }, [finishClose]);

  const handleClose = useCallback(() => {
    restoreCanvasFocusRef.current = true;
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

  const sharedTooltipProps = {
    onClose: handleClose,
    currentChapter,
    eventNum,
  };

  let tooltipContent = null;
  if (activeTooltip?.type === 'node') {
    tooltipContent = (
      <UnifiedNodeInfo
        displayMode="sidebar"
        data={activeTooltip}
        elements={elements}
        filename={filename}
        povSummaries={povSummaries}
        povError={povError}
        povIsLoading={povIsLoading}
        povCached={povCached}
        onRetryPov={onRetryPov}
        apiBookGraphData={apiBookGraphData}
        onSelectRelatedNode={onSelectRelatedNode}
        chapterRailWidth={chapterRailWidth}
        {...sharedTooltipProps}
      />
    );
  } else if (activeTooltip) {
    tooltipContent = (
      <Suspense fallback={<div role="status" aria-live="polite">관계 정보를 불러오는 중…</div>}>
        <UnifiedEdgeTooltip
          data={activeTooltip.data}
          variant="graphPage"
          bookId={bookId}
          sourceEndpoint={activeTooltip.sourceEndpoint}
          targetEndpoint={activeTooltip.targetEndpoint}
          {...sharedTooltipProps}
        />
      </Suspense>
    );
  }

  return (
    <div
      className="graph-page-sidebar"
      style={sidebarStyle}
      data-testid="graph-sidebar"
    >
      {tooltipContent}
    </div>
  );
}

function GraphCanvas({
  isSidebarOpen,
  sidebarLayoutWidth,
  activeTooltip,
  cyRef,
  eventNum,
  filename,
  elements,
  renderElements,
  povSummaries,
  povError = null,
  povIsLoading = false,
  povCached = null,
  onRetryPov = null,
  apiBookGraphData,
  bookId,
  isLoading,
  hasShownGraphOnce,
  onCanvasClick,
  currentChapter,
  chapterDisplayLabel = null,
  chapterTitleTooltip = null,
  sidebarControl,
  searchState,
  floatingControls = null,
  pageChromeStart = null,
  cytoscapeConfig,
  tooltipHandlers,
  graphClearRef,
  graphSelectNodeRef = null,
  onSelectRelatedNode = null,
  eventScrub = null,
}) {
  const { isSidebarClosing, onCloseSidebar, onStartClosing, onClearGraph } = sidebarControl;
  const { isSearchActive, filteredElements, searchTerm, fitNodeIds } = searchState;
  const { stylesheet } = cytoscapeConfig;
  const {
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedElementRef,
  } = tooltipHandlers;

  const [chromeCy, setChromeCy] = useState(null);
  const [showGestureHint, setShowGestureHint] = useState(
    () => !hasDismissedGraphGestureHint(),
  );
  const [usesTouchGestures] = useState(
    () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
  );
  const topbarRef = useRef(null);
  const toolsRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const selectElementRef = useRef(null);
  const a11yStatusId = useId();
  const showSidebar = !!(activeTooltip || isSidebarClosing);
  const usePageChrome = !!(pageChromeStart || floatingControls);

  const chapterRailWidth = sidebarLayoutWidth != null
    ? sidebarLayoutWidth
    : resolveChapterSidebarWidth(isSidebarOpen);
  const chapterLabel = chapterDisplayLabel || formatChapterOrdinalLabel(currentChapter);
  const metaEventLabel = formatGraphEventMetaLabel(eventNum);
  const a11yElements = isSearchActive && Array.isArray(filteredElements)
    ? filteredElements
    : renderElements;
  const filterStage = floatingControls?.filterStage ?? 0;

  const { onKeyDown: handleCanvasKeyDown, liveAnnouncement, ariaLabel } = useGraphCanvasKeyboard({
    cyRef,
    graphClearRef,
    selectElementRef,
    activeTooltip,
    onClearTooltip,
  });

  const dismissGestureHint = useCallback(() => {
    setShowGestureHint(false);
    try {
      globalThis.localStorage?.setItem(GRAPH_GESTURE_HINT_KEY, '1');
    } catch {
      // 저장소 접근이 제한된 환경에서도 현재 화면에서는 닫힌 상태를 유지한다.
    }
  }, []);

  const focusCanvas = useCallback(() => {
    requestAnimationFrame(() => {
      canvasAreaRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useGraphTopbarToolsReserve(topbarRef, toolsRef, usePageChrome);

  return (
    <div
      className="graph-canvas-shell"
      style={{ left: `${chapterRailWidth}px` }}
    >
      <div className="graph-page-shell graph-page-shell--fill">
        {usePageChrome ? (
          <>
            <div className="graph-page-topbar" ref={topbarRef}>
              <div className="graph-page-topbar-center">
                <GraphTopBarMeta
                  chapterLabel={chapterLabel}
                  chapterTitle={chapterTitleTooltip}
                  eventLabel={metaEventLabel}
                />
              </div>
              <div className="graph-page-topbar-tools" ref={toolsRef}>
                {floatingControls ? (
                  <GraphFloatingControls
                    searchState={floatingControls.searchState}
                    searchActions={floatingControls.searchActions}
                    edgeLabelVisible={floatingControls.edgeLabelVisible}
                    onToggleEdgeLabel={floatingControls.onToggleEdgeLabel}
                    filterStage={floatingControls.filterStage}
                    onFilterChange={floatingControls.onFilterChange}
                    showLegend
                  />
                ) : null}
                <span className="graph-split-topbar-sep" aria-hidden />
                <GraphZoomControls cy={chromeCy} className="graph-zoom-controls is-embedded" />
                {pageChromeStart}
              </div>
            </div>
            {eventScrub ? (
              <GraphEventScrubber
                eventIndices={eventScrub.eventIndices}
                currentEvent={eventScrub.currentEvent ?? eventNum}
                onEventChange={eventScrub.onEventChange}
                readingEventNum={eventScrub.readingEventNum}
              />
            ) : null}
          </>
        ) : null}

        <div className="graph-page-inner">
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
              povError={povError}
              povIsLoading={povIsLoading}
              povCached={povCached}
              onRetryPov={onRetryPov}
              apiBookGraphData={apiBookGraphData}
              bookId={bookId}
              onSelectRelatedNode={onSelectRelatedNode}
              chapterRailWidth={chapterRailWidth}
              onRequestFocusCanvas={focusCanvas}
            />
          )}

          <div
            ref={canvasAreaRef}
            className="graph-canvas-area"
            onClick={onCanvasClick}
            onKeyDown={handleCanvasKeyDown}
            role="region"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-describedby={a11yStatusId}
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
              isLoading={isLoading}
              liveAnnouncement={liveAnnouncement}
            />
            {isLoading && hasShownGraphOnce && <GraphLoadingOverlay />}

            {showGestureHint && !isLoading && renderElements.length > 0 && (
              <aside className="graph-gesture-hint" aria-label="그래프 조작 안내">
                <div className="graph-gesture-hint-items">
                  <span><MousePointer2 aria-hidden />노드·간선 선택</span>
                  <span><Move aria-hidden />{usesTouchGestures ? '한 손가락으로 이동' : '드래그로 이동'}</span>
                  <span><ZoomIn aria-hidden />{usesTouchGestures ? '두 손가락으로 확대·축소' : '휠로 확대·축소'}</span>
                </div>
                <button
                  type="button"
                  className="graph-gesture-hint-close"
                  onClick={dismissGestureHint}
                  aria-label="그래프 조작 안내 닫기"
                >
                  <X aria-hidden />
                </button>
              </aside>
            )}

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
              graphSelectElementRef={selectElementRef}
              isDataRefreshing={isLoading}
              showZoomControls={!usePageChrome}
              onCyReady={usePageChrome ? setChromeCy : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

GraphCanvas.propTypes = {
  isSidebarOpen: PropTypes.bool.isRequired,
  sidebarLayoutWidth: PropTypes.number,
  activeTooltip: PropTypes.object,
  cyRef: PropTypes.object.isRequired,
  eventNum: PropTypes.number.isRequired,
  filename: PropTypes.string.isRequired,
  elements: PropTypes.array.isRequired,
  renderElements: PropTypes.array.isRequired,
  povSummaries: PropTypes.any,
  povError: PropTypes.string,
  povIsLoading: PropTypes.bool,
  povCached: PropTypes.bool,
  onRetryPov: PropTypes.func,
  apiBookGraphData: PropTypes.object,
  bookId: PropTypes.number,
  isLoading: PropTypes.bool.isRequired,
  hasShownGraphOnce: PropTypes.bool.isRequired,
  onCanvasClick: PropTypes.func.isRequired,
  currentChapter: PropTypes.number.isRequired,
  chapterDisplayLabel: PropTypes.string,
  chapterTitleTooltip: PropTypes.string,
  sidebarControl: PropTypes.object.isRequired,
  searchState: PropTypes.object.isRequired,
  floatingControls: PropTypes.shape({
    searchState: PropTypes.object.isRequired,
    searchActions: PropTypes.object.isRequired,
    edgeLabelVisible: PropTypes.bool.isRequired,
    onToggleEdgeLabel: PropTypes.func.isRequired,
    filterStage: PropTypes.number.isRequired,
    onFilterChange: PropTypes.func.isRequired,
  }),
  pageChromeStart: PropTypes.node,
  eventScrub: PropTypes.shape({
    eventIndices: PropTypes.arrayOf(PropTypes.number),
    currentEvent: PropTypes.number,
    onEventChange: PropTypes.func,
    readingEventNum: PropTypes.number,
  }),
  cytoscapeConfig: PropTypes.object.isRequired,
  tooltipHandlers: PropTypes.object.isRequired,
  graphClearRef: PropTypes.object,
  graphSelectNodeRef: PropTypes.object,
  onSelectRelatedNode: PropTypes.func,
};

export default memo(GraphCanvas);

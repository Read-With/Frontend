import { useMemo, useEffect, useState, useRef, memo, useCallback } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import CytoscapeGraphUnified from '../graph/CytoscapeGraphUnified';
import UnifiedNodeInfo from '../graph/UnifiedNodeInfo';
import UnifiedEdgeTooltip from '../graph/UnifiedEdgeTooltip';
import { useGraphElementPipeline } from '../../hooks/graph/useGraphViewState';
import { getEdgeStyle, createGraphStylesheet, graphStyles } from '../../utils/styles/graphStyles';
import {
  centerSelectionOnElementId,
  getEdgeFocusPanTarget,
} from '../../utils/graph/graphCy';
import {
  shouldIgnoreViewerOutsideClick,
  useGraphTooltipSelection,
} from '../../hooks/graph/useGraphCy';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerSession';
import { hasGraphPanelLocationHint, resolveChapterIndex, toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import {
  eventUtils,
  formatChapterOrderAndName,
  stripRedundantBookTitlePrefix,
} from '../../utils/viewer/viewerCore';
import '../graph/RelationGraph.css';
import GraphControls, { EdgeLabelToggle, CharacterFilterSegmented } from '../graph/GraphControls';
import { getChapterData, getManifestFromCache } from '../../utils/common/cache/manifestCache';

const iconShellClass = {
  loading: 'bg-emerald-50 text-[#5C6F5C]',
  empty: 'bg-slate-100 text-slate-500',
  error: 'bg-red-50 text-red-600',
};

const primaryBtnClass =
  'rounded-lg bg-[#5C6F5C] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4A5A4A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C6F5C] focus-visible:ring-offset-2';

const LOADING_STYLE = {
  display: 'inline-block',
  padding: '4px 16px',
  borderRadius: 16,
  background: '#f3f4f6',
  color: '#9ca3af',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid #e3e6ef',
};

const CHAPTER_STYLE = {
  display: 'inline-block',
  padding: '4px 12px',
  borderRadius: 16,
  background: '#E8F5E8',
  color: '#5C6F5C',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid #e3e6ef',
  maxWidth: 'min(360px, 42vw)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const EVENT_NUMBER_STYLE = {
  display: 'inline-block',
  padding: '4px 16px',
  borderRadius: 16,
  background: '#5C6F5C',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  boxShadow: '0 2px 8px rgba(92,111,92,0.13)',
  transition: 'transform 0.3s, background 0.3s',
};

const PROGRESS_BAR_CONTAINER_STYLE = {
  width: 120,
  height: 6,
  background: '#e3e6ef',
  borderRadius: 3,
  overflow: 'hidden',
};

const PROGRESS_BAR_FILL_STYLE = {
  height: '100%',
  background: 'linear-gradient(90deg, #5C6F5C 0%, #6B7B6B 100%)',
  borderRadius: 3,
  transition: 'width 0.4s cubic-bezier(.4,2,.6,1)',
};

const BAR_BASE_STYLE = {
  height: 44,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  width: '100%',
  marginBottom: 0,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 0,
};

const ROW_STYLE = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
};

const FULLSCREEN_BTN_STYLE = {
  height: 28,
  width: 28,
  minWidth: 28,
  minHeight: 28,
  borderRadius: '6px',
  border: '1.5px solid #e3e6ef',
  background: '#fff',
  color: '#22336b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(108,142,255,0.07)',
  transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
};

function ChapterEventInfo({
  bookId,
  isProgressPending,
  progressTopBar,
  currentEvent,
  prevValidEvent,
  resolvedServerChapter,
  chapterDisplayLabel,
  chapterTitleTooltip,
  currentProgressWidth,
}) {
  if ((progressTopBar === undefined || isProgressPending) && bookId) {
    return <span style={LOADING_STYLE}>계산중...</span>;
  }

  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter: resolvedServerChapter,
    progressTopBar: progressTopBar ?? { eventNum: null },
    fallback: 0,
  });
  const eventDisplay = eventNum > 0 ? String(eventNum) : '?';

  return (
    <>
      <span style={CHAPTER_STYLE} title={chapterTitleTooltip}>
        {chapterDisplayLabel}
      </span>
      <div style={{ ...ROW_STYLE, gap: 12 }}>
        <span style={EVENT_NUMBER_STYLE}>Event {eventDisplay}</span>
        <div style={PROGRESS_BAR_CONTAINER_STYLE}>
          <div style={{ ...PROGRESS_BAR_FILL_STYLE, width: currentProgressWidth }} />
        </div>
      </div>
    </>
  );
}

const GraphTopBar = memo(function GraphTopBar({
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
    edgeLabelVisible,
    progressTopBar,
    progressMetricsReady = true,
  } = graphState;

  const {
    setGraphFullScreen,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
  } = graphActions;

  const {
    searchTerm,
    isSearchActive,
    suggestions = [],
    showSuggestions = false,
    selectedIndex = -1,
  } = searchState;

  const {
    onSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions,
    handleKeyDown,
    onSelectedIndexChange,
  } = searchActions;

  const bookId = useMemo(() => toPositiveNumberOrNull(book?.id), [book?.id]);

  const stripBookTitle = useMemo(() => {
    const fromBook = String(book?.title ?? '').trim();
    if (fromBook) return fromBook;
    const m = bookId != null ? getManifestFromCache(bookId) : null;
    return String(m?.book?.title ?? m?.title ?? '').trim();
  }, [book?.title, bookId]);

  const chapterMeta = useMemo(() => {
    const fallbackChapter = Number(currentChapter) || 1;
    if (bookId == null) {
      return {
        resolvedServerChapter: fallbackChapter,
        chapterDisplayLabel: formatChapterOrderAndName(fallbackChapter, ''),
        chapterTitleTooltip: undefined,
      };
    }

    const byCurrent = getChapterData(bookId, currentChapter);
    const resolvedFromData = byCurrent ? resolveChapterIndex(byCurrent) : null;
    const resolvedServerChapter = resolvedFromData ?? fallbackChapter;
    const ch =
      byCurrent && (resolvedFromData == null || resolvedFromData === Number(currentChapter))
        ? byCurrent
        : getChapterData(bookId, resolvedServerChapter);

    const rawTitle = String(ch?.title ?? '').trim();
    const displayName = rawTitle ? stripRedundantBookTitlePrefix(rawTitle, stripBookTitle) : '';

    return {
      resolvedServerChapter,
      chapterDisplayLabel: formatChapterOrderAndName(resolvedServerChapter, displayName),
      chapterTitleTooltip: rawTitle || undefined,
    };
  }, [bookId, currentChapter, stripBookTitle]);

  const isProgressPending =
    Boolean(bookId) &&
    !progressMetricsReady &&
    (progressTopBar?.readingProgressPercent == null ||
      !Number.isFinite(Number(progressTopBar?.readingProgressPercent)));

  const currentProgressWidth = useMemo(() => {
    if (progressTopBar === undefined || isProgressPending) return '0%';
    const rp = progressTopBar.readingProgressPercent;
    if (rp != null && Number.isFinite(rp)) {
      return `${Math.min(100, Math.max(0, Math.round(rp * 100) / 100))}%`;
    }
    return '0%';
  }, [progressTopBar, isProgressPending]);

  const fullscreenLabel = graphFullScreen
    ? '분할 화면으로 전환'
    : '그래프 전체화면으로 전환';

  const chapterEventInfo = (
    <ChapterEventInfo
      bookId={bookId}
      isProgressPending={isProgressPending}
      progressTopBar={progressTopBar}
      currentEvent={currentEvent}
      prevValidEvent={prevValidEvent}
      resolvedServerChapter={chapterMeta.resolvedServerChapter}
      chapterDisplayLabel={chapterMeta.chapterDisplayLabel}
      chapterTitleTooltip={chapterMeta.chapterTitleTooltip}
      currentProgressWidth={currentProgressWidth}
    />
  );

  return (
    <>
      <div
        style={{
          ...BAR_BASE_STYLE,
          gap: 0,
          justifyContent: 'space-between',
          borderBottom: graphFullScreen ? '1px solid #e3e6ef' : 'none',
        }}
      >
        <div style={{ ...ROW_STYLE, gap: 12, marginRight: 36 }}>
          <button
            type="button"
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            onClick={() => setGraphFullScreen(!graphFullScreen)}
            style={FULLSCREEN_BTN_STYLE}
          >
            {graphFullScreen ? '>' : '<'}
          </button>

          <GraphControls
            onSearchSubmit={onSearchSubmit}
            onGenerateSuggestions={onGenerateSuggestions}
            searchTerm={searchTerm}
            isSearchActive={isSearchActive}
            onClearSearch={clearSearch}
            onCloseSuggestions={closeSuggestions}
            suggestions={suggestions}
            showSuggestions={showSuggestions}
            selectedIndex={selectedIndex}
            onSelectedIndexChange={onSelectedIndexChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        {graphFullScreen && (
          <div style={{ ...ROW_STYLE, gap: 16 }}>{chapterEventInfo}</div>
        )}

        <div style={{ ...ROW_STYLE, gap: 12, marginRight: 24 }}>
          <EdgeLabelToggle
            visible={edgeLabelVisible}
            onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
          />
          <CharacterFilterSegmented value={filterStage} onChange={setFilterStage} />
        </div>
      </div>

      {!graphFullScreen && (
        <div
          style={{
            ...BAR_BASE_STYLE,
            justifyContent: 'center',
            borderTop: '1px solid #e3e6ef',
            borderBottom: '1px solid #e3e6ef',
          }}
        >
          {chapterEventInfo}
        </div>
      )}
    </>
  );
});

function GraphNoticePanel({ variant, title, description, icon, actions }) {
  const shell = iconShellClass[variant] ?? iconShellClass.loading;
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50/90 p-4 sm:p-6">
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200/90 bg-white px-6 py-9 text-center shadow-sm sm:px-10 sm:py-10"
        role={variant === 'error' ? 'alert' : undefined}
      >
        <div
          className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${shell}`}
          aria-hidden
        >
          {icon}
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold tracking-tight text-slate-800">{title}</h3>
          {description ? (
            <p className="text-sm leading-relaxed text-slate-600 [word-break:keep-all]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="mt-6 flex flex-col items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

function normalizeGraphApiError(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return {
      message: '그래프 데이터를 불러올 수 없습니다',
      details: raw,
      retry: null,
    };
  }
  return raw;
}

function getLoadingNotice(isEventGraphBusy, isLocationDetermined, transitionType) {
  if (isEventGraphBusy) {
    return {
      title: '이벤트 반영 중',
      description: '읽기 위치에 맞는 이벤트와 관계 그래프를 확정하는 중입니다.',
    };
  }
  if (!isLocationDetermined) {
    return {
      title: '위치 정보를 확인하는 중',
      description: '현재 읽고 있는 위치를 파악하고 있습니다. 잠시만 기다려 주세요.',
    };
  }
  if (transitionType === 'chapter') {
    return {
      title: '챕터 전환 중',
      description: '새 챕터의 이벤트를 준비하고 있습니다.',
    };
  }
  return {
    title: '그래프 정보를 불러오는 중',
    description: '인물 관계 데이터를 불러오고 있습니다.',
  };
}

/** 뷰어 분할 패널용 그래프 + 플로팅 툴팁 */
const GraphContainer = memo(function GraphContainer({
  currentEvent,
  currentChapter,
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
  isResetFromSearch = false,
  bookId = null,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    progressTopBar: null,
    fallback: 0,
  });
  const cyRef = useRef(null);
  const selectedElementRef = useRef(null);
  const graphSelectNodeRef = useRef(null);
  const viewportRefitKey = useMemo(
    () => `${currentChapter ?? ''}:${eventNum ?? ''}`,
    [currentChapter, eventNum]
  );

  // handleClearTooltip이 이미 graphClearRef를 호출함.
  // 여기서 한 번 더 지우면 TOOLTIP_CLEAR_DELAY(150ms) 동안 툴팁은 남고 하이라이트만 사라짐.
  const dismissTooltip = useCallback(() => {
    onClearTooltip?.();
  }, [onClearTooltip]);

  const centerSelection = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy) return;

    const element = cy.getElementById(String(elementId));
    const isEdge =
      element?.length > 0 &&
      typeof element.isEdge === 'function' &&
      element.isEdge();

    centerSelectionOnElementId(cy, elementId, {
      duration: 400,
      ...(isEdge ? { panTarget: getEdgeFocusPanTarget(cy) } : {}),
    });
  }, []);

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
    shouldIgnoreClick: shouldIgnoreViewerOutsideClick,
    attachDelayMs: 50,
  });

  const stylesheet = useMemo(
    () => createGraphStylesheet(getEdgeStyle('viewer'), edgeLabelVisible),
    [edgeLabelVisible]
  );

  return (
    <div style={graphStyles.container}>
      <div
        style={graphStyles.tooltipContainer}
        onClick={(e) => e.stopPropagation()}
      >
        {activeTooltip?.type === 'node' && (
          <UnifiedNodeInfo
            key={`node-tooltip-${activeTooltip.id}`}
            displayMode="tooltip"
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={dismissTooltip}
            chapterNum={currentChapter}
            eventNum={eventNum}
            filename={filename}
            elements={elements}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            onSelectRelatedNode={handleSelectRelatedNode}
            cyRef={cyRef}
          />
        )}
        {activeTooltip?.type === 'edge' && (
          <UnifiedEdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={dismissTooltip}
            variant="viewer"
            chapterNum={currentChapter}
            eventNum={eventNum}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            bookId={bookId}
            sourceEndpoint={activeTooltip.sourceEndpoint}
            targetEndpoint={activeTooltip.targetEndpoint}
            cyRef={cyRef}
          />
        )}
      </div>

      <div className="graph-canvas-area" style={graphStyles.graphArea}>
        <CytoscapeGraphUnified
          elements={elements}
          stylesheet={stylesheet}
          cyRef={cyRef}
          fitNodeIds={fitNodeIds}
          searchTerm={searchTerm}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          isResetFromSearch={isResetFromSearch}
          currentChapter={currentChapter}
          viewportRefitKey={viewportRefitKey}
          skipViewportRefit={isEventTransition}
          onShowNodeTooltip={onShowNodeTooltip}
          onShowEdgeTooltip={onShowEdgeTooltip}
          onClearTooltip={onClearTooltip}
          selectedElementRef={selectedElementRef}
          graphClearRef={graphClearRef}
          graphSelectNodeRef={graphSelectNodeRef}
          showRippleEffect
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
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const {
    searchTerm: searchTermValue = '',
    isSearchActive: isSearchActiveValue = false,
    filteredElements: filteredElementsValue = [],
    isResetFromSearch: isResetFromSearchValue = false,
    fitNodeIds: searchFitNodeIds = [],
  } = searchState;

  const { graphPhase, isDataReady, isDataEmpty, book, bookKey, routeBookId } = viewerState;
  const {
    elements,
    currentEvent,
    currentChapter,
    prevValidEvent,
    edgeLabelVisible,
  } = graphState;
  const { filterStage } = graphActions;

  const hasResolvedEvent = eventUtils.resolveEventNum(currentEvent) > 0;
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
    isSearchActive: isSearchActiveValue,
    filteredElements: filteredElementsValue,
  });

  const hasElements = Array.isArray(elements) && elements.length > 0;
  const isEventGraphBusy = graphPhase === 'event';
  const isGraphIdle = graphPhase === 'idle';
  const isEventTransition =
    transitionState.type === 'event' && transitionState.inProgress;

  const isDataLoadCompleteAndEmpty =
    isGraphIdle && isDataEmpty && !hasElements && !hasResolvedEvent;

  const shouldShowLoading =
    !hasElements &&
    !isDataLoadCompleteAndEmpty &&
    (!isGraphIdle || !isLocationDetermined || (!isDataReady && !hasResolvedEvent));

  const rawTransitionOverlay =
    !hasElements && (isEventGraphBusy || isEventTransition);

  const [showTransitionOverlay, setShowTransitionOverlay] = useState(false);
  const overlayHideTimerRef = useRef(null);

  useEffect(() => {
    if (rawTransitionOverlay) {
      if (overlayHideTimerRef.current) {
        clearTimeout(overlayHideTimerRef.current);
        overlayHideTimerRef.current = null;
      }
      setShowTransitionOverlay(true);
      return undefined;
    }

    if (!showTransitionOverlay) return undefined;

    overlayHideTimerRef.current = setTimeout(() => {
      setShowTransitionOverlay(false);
      overlayHideTimerRef.current = null;
    }, 0);

    return () => {
      if (overlayHideTimerRef.current) {
        clearTimeout(overlayHideTimerRef.current);
        overlayHideTimerRef.current = null;
      }
    };
  }, [rawTransitionOverlay, showTransitionOverlay]);

  const resolvedApiError = normalizeGraphApiError(apiError);
  const loadingNotice = getLoadingNotice(
    isEventGraphBusy,
    isLocationDetermined,
    transitionState.type
  );

  return (
    <div style={{ ...graphStyles.graphPageContainer, height: '100%' }}>
      <GraphTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={{ book }}
        searchState={searchState}
        searchActions={searchActions}
      />

      <div style={{ ...graphStyles.graphPageInner, minWidth: 0, position: 'relative' }}>
        {shouldShowLoading ? (
          <GraphNoticePanel
            variant="loading"
            title={loadingNotice.title}
            description={loadingNotice.description}
            icon={<Loader2 className="h-7 w-7 animate-spin" strokeWidth={2} aria-hidden />}
          />
        ) : isDataLoadCompleteAndEmpty ? (
          <GraphNoticePanel
            variant="empty"
            title="아직 이벤트가 없습니다"
            description="이 챕터에는 표시할 그래프 데이터가 없습니다. 이벤트가 생기면 이 영역에 관계가 나타납니다."
            icon={<Inbox className="h-7 w-7" strokeWidth={1.75} aria-hidden />}
          />
        ) : resolvedApiError ? (
          <GraphNoticePanel
            variant="error"
            title={resolvedApiError.message || '문제가 발생했습니다'}
            description={resolvedApiError.details || '잠시 후 다시 시도해 주세요.'}
            icon={<AlertCircle className="h-7 w-7" strokeWidth={2} aria-hidden />}
            actions={
              resolvedApiError.retry ? (
                <button type="button" className={primaryBtnClass} onClick={resolvedApiError.retry}>
                  다시 시도
                </button>
              ) : null
            }
          />
        ) : (
          <div
            className="graph-canvas-area"
            style={{
              ...graphStyles.graphArea,
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              position: 'relative',
            }}
          >
            <GraphContainer
              currentEvent={currentEvent}
              currentChapter={currentChapter}
              edgeLabelVisible={edgeLabelVisible}
              filename={routeBookId ?? bookKey ?? ''}
              elements={finalElements}
              searchTerm={searchTermValue}
              isSearchActive={isSearchActiveValue}
              filteredElements={filteredElementsValue}
              fitNodeIds={searchFitNodeIds}
              isResetFromSearch={isResetFromSearchValue}
              prevValidEvent={prevValidEvent ?? null}
              activeTooltip={activeTooltip}
              onClearTooltip={onClearTooltip}
              onSetActiveTooltip={onSetActiveTooltip}
              graphClearRef={graphClearRef}
              isEventTransition={isEventTransition}
              bookId={book?.id ?? bookKey}
            />
            {showTransitionOverlay ? (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-slate-50/90"
                role="status"
                aria-live="polite"
                aria-label="그래프 전환 중"
              >
                <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
                  <span>이벤트 반영 중</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
});

export default GraphSplitArea;

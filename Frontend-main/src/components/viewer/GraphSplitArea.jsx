import { useMemo, useRef, useState, memo, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import CytoscapeGraphUnified, { GraphZoomControls } from '../graph/CytoscapeGraphUnified';
import UnifiedNodeInfo from '../graph/UnifiedNodeInfo';
import UnifiedEdgeTooltip from '../graph/UnifiedEdgeTooltip';
import { useGraphElementPipeline } from '../../hooks/graph/useGraphViewState';
import { getEdgeStyle, createGraphStylesheet, graphStyles } from '../../utils/styles/graphStyles';
import { centerSelectionOnElementId } from '../../utils/graph/graphCy';
import {
  shouldIgnoreViewerOutsideClick,
  useGraphTooltipSelection,
} from '../../hooks/graph/useGraphCy';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerSession';
import { hasGraphPanelLocationHint, resolveChapterIndex, toPositiveNumberOrNull, resolvePositiveBookId } from '../../utils/common/valueUtils';
import {
  eventUtils,
  formatChapterOrderAndName,
  stripRedundantBookTitlePrefix,
  resolveChapterTitleMeta,
} from '../../utils/viewer/viewerCore';
import { userGraphPath } from '../../utils/common/urlUtils';
import { buildGraphViewportRefitKey } from '../../utils/graph/graphCore.js';
import '../graph/RelationGraph.css';
import { GraphFloatingControls } from '../graph/GraphControls';
import { getChapterData, getManifestFromCache } from '../../utils/common/cache/manifestCache';

const iconShellClass = {
  loading: 'bg-[var(--rg-brand-tint)] text-[var(--rg-brand)]',
  empty: 'bg-slate-100 text-slate-500',
  error: 'bg-red-50 text-red-600',
};

const primaryBtnClass =
  'rounded-lg bg-[var(--rg-brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--rg-brand-dark)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rg-brand)] focus-visible:ring-offset-2';

const secondaryBtnClass =
  'rounded-lg border border-[var(--rg-border)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--rg-brand)] transition-colors hover:bg-[var(--rg-brand-tint-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rg-brand)] focus-visible:ring-offset-2';

function ChapterEventInfo({
  bookId,
  progressTopBar,
  currentEvent,
  prevValidEvent,
  resolvedServerChapter,
  chapterDisplayLabel,
  chapterTitleTooltip,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter: resolvedServerChapter,
    progressTopBar: progressTopBar ?? { eventNum: null },
    fallback: 0,
  });

  // currentEvent가 있으면 진행 메타 대기 없이 바로 표시
  if (eventNum > 0) {
    return (
      <div className="graph-topbar-meta">
        <span
          className="graph-topbar-meta-chapter"
          title={chapterTitleTooltip || chapterDisplayLabel}
        >
          {chapterDisplayLabel}
        </span>
        <span className="graph-topbar-meta-event">Event {eventNum}</span>
      </div>
    );
  }

  if (bookId && progressTopBar === undefined) {
    return <span className="graph-topbar-meta-event">계산중…</span>;
  }

  return (
    <div className="graph-topbar-meta">
      <span
        className="graph-topbar-meta-chapter"
        title={chapterTitleTooltip || chapterDisplayLabel}
      >
        {chapterDisplayLabel}
      </span>
      <span className="graph-topbar-meta-event">Event ?</span>
    </div>
  );
}

const GraphSplitTopBar = memo(function GraphSplitTopBar({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
  cy,
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

  const stripBookTitle = useMemo(() => {
    const fromBook = String(book?.title ?? '').trim();
    if (fromBook) return fromBook;
    const m = bookId != null ? getManifestFromCache(bookId) : null;
    return String(m?.book?.title ?? m?.title ?? '').trim();
  }, [book?.title, bookId]);

  const chapterMeta = useMemo(() => {
    const rawChapter = Number(currentChapter);
    const hasValidChapter = Number.isFinite(rawChapter) && rawChapter >= 1;
    const displayChapter = hasValidChapter ? rawChapter : null;

    if (bookId == null) {
      return {
        resolvedServerChapter: displayChapter,
        chapterResolved: false,
        chapterDisplayLabel: displayChapter
          ? formatChapterOrderAndName(displayChapter, '')
          : '챕터 ?',
        chapterTitleTooltip: undefined,
      };
    }

    const byCurrent = getChapterData(bookId, currentChapter);
    const resolvedFromData = byCurrent ? resolveChapterIndex(byCurrent) : null;
    // manifest에 없으면 fallback 1로 API/표시를 속이지 않음
    const resolvedServerChapter = resolvedFromData ?? (hasValidChapter ? rawChapter : null);
    const chapterResolved = resolvedFromData != null || (hasValidChapter && Boolean(byCurrent));
    const ch =
      byCurrent && (resolvedFromData == null || resolvedFromData === Number(currentChapter))
        ? byCurrent
        : resolvedServerChapter != null
          ? getChapterData(bookId, resolvedServerChapter)
          : null;

    if (resolvedServerChapter == null) {
      return {
        resolvedServerChapter: null,
        chapterResolved: false,
        chapterDisplayLabel: '챕터 ?',
        chapterTitleTooltip: undefined,
      };
    }

    const meta = resolveChapterTitleMeta(ch, stripBookTitle, resolvedServerChapter);
    const displayName =
      meta.status === 'ok'
        ? stripRedundantBookTitlePrefix(meta.raw, stripBookTitle) || meta.display
        : meta.status === 'collapsed'
          ? meta.display
          : '';

    return {
      resolvedServerChapter,
      chapterResolved,
      chapterDisplayLabel: formatChapterOrderAndName(resolvedServerChapter, displayName),
      chapterTitleTooltip: meta.raw || meta.tooltip || undefined,
    };
  }, [bookId, currentChapter, stripBookTitle]);

  const fullscreenLabel = graphFullScreen
    ? '분할 화면으로 전환'
    : '그래프 전체화면으로 전환';

  const topbarRef = useRef(null);
  const toolsRef = useRef(null);

  // 오른쪽 도구 실제 너비만큼 중앙 메타 max-width 확보 → 절대 겹침 방지
  useEffect(() => {
    const topbar = topbarRef.current;
    const tools = toolsRef.current;
    if (!topbar || !tools) return undefined;

    const applyReserve = () => {
      const width = Math.ceil(tools.getBoundingClientRect().width);
      topbar.style.setProperty(
        '--graph-split-tools-reserve',
        `${Math.max(width, 1)}px`,
      );
    };

    applyReserve();
    const ro = new ResizeObserver(applyReserve);
    ro.observe(tools);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="graph-split-topbar" ref={topbarRef}>
      <div className="graph-split-topbar-center">
        <ChapterEventInfo
          bookId={bookId}
          progressTopBar={progressTopBar}
          currentEvent={currentEvent}
          prevValidEvent={prevValidEvent}
          resolvedServerChapter={chapterMeta.resolvedServerChapter}
          chapterDisplayLabel={chapterMeta.chapterDisplayLabel}
          chapterTitleTooltip={chapterMeta.chapterTitleTooltip}
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
        <span className="graph-split-topbar-sep" aria-hidden />
        <GraphZoomControls cy={cy} className="graph-zoom-controls is-embedded" />
        <button
          type="button"
          className="graph-fullscreen-btn"
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
          onClick={() => setGraphFullScreen(!graphFullScreen)}
        >
          <span className="material-symbols-outlined" aria-hidden>
            {graphFullScreen ? 'close_fullscreen' : 'fullscreen'}
          </span>
        </button>
      </div>
    </div>
  );
});

function GraphNoticePanel({ variant, title, description, icon, actions }) {
  const shell = iconShellClass[variant] ?? iconShellClass.loading;
  const isLoading = variant === 'loading';

  if (isLoading) {
    return (
      <div className="graph-panel-status graph-panel-status--loading" role="status" aria-live="polite">
        <div className={`graph-panel-status-icon ${shell}`} aria-hidden>
          {icon}
        </div>
        <div className="graph-panel-status-copy">
          <p className="graph-panel-status-title">{title}</p>
          {description ? <p className="graph-panel-status-desc">{description}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`graph-panel-status graph-panel-status--${variant}`}
      role={variant === 'error' ? 'alert' : undefined}
    >
      <div className={`graph-panel-status-icon ${shell}`} aria-hidden>
        {icon}
      </div>
      <div className="graph-panel-status-copy">
        <h3 className="graph-panel-status-title">{title}</h3>
        {description ? <p className="graph-panel-status-desc">{description}</p> : null}
      </div>
      {actions ? <div className="graph-panel-status-actions">{actions}</div> : null}
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
  bookId = null,
  cyRef: externalCyRef = null,
  onCyReady = null,
  showZoomControls = false,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    progressTopBar: null,
    fallback: 0,
  });
  const localCyRef = useRef(null);
  const cyRef = externalCyRef ?? localCyRef;
  const selectedElementRef = useRef(null);
  const graphSelectNodeRef = useRef(null);
  const viewportRefitKey = useMemo(
    () => buildGraphViewportRefitKey(currentChapter, eventNum),
    [currentChapter, eventNum]
  );

  const dismissTooltip = useCallback(() => {
    onClearTooltip?.();
  }, [onClearTooltip]);

  const centerSelection = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy) return;

    // 분할화면은 패널이 좁아 툴팁 전체 폭을 비우면 줌이 과도하게 줄어듦 — 약간 겹침 허용
    centerSelectionOnElementId(cy, elementId, {
      duration: 400,
      reserveRight: 48,
      padding: 24,
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
          currentChapter={currentChapter}
          viewportRefitKey={viewportRefitKey}
          skipViewportRefit={isEventTransition}
          onShowNodeTooltip={onShowNodeTooltip}
          onShowEdgeTooltip={onShowEdgeTooltip}
          onClearTooltip={onClearTooltip}
          selectedElementRef={selectedElementRef}
          graphClearRef={graphClearRef}
          graphSelectNodeRef={graphSelectNodeRef}
          showZoomControls={showZoomControls}
          onCyReady={onCyReady}
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
    searchTerm: searchTermValue = '',
    isSearchActive: isSearchActiveValue = false,
    filteredElements: filteredElementsValue = [],
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
  const cyRef = useRef(null);
  const [cyInstance, setCyInstance] = useState(null);
  const handleCyReady = useCallback((cy) => {
    setCyInstance(cy);
  }, []);

  const topBarSearchState = useMemo(
    () => ({
      searchTerm: searchTermValue,
      isSearchActive: isSearchActiveValue,
      suggestions: searchState.suggestions ?? [],
      showSuggestions: searchState.showSuggestions ?? false,
      selectedIndex: searchState.selectedIndex ?? -1,
    }),
    [
      searchTermValue,
      isSearchActiveValue,
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
  const isGraphRefreshing = isEventGraphBusy || isEventTransition;

  const isDataLoadCompleteAndEmpty =
    isGraphIdle && isDataEmpty && !hasElements && !hasResolvedEvent;

  const resolvedApiError = normalizeGraphApiError(apiError);

  // 요소 없음: 부트스트랩 대기(위치/데이터/갱신) → 단일 로딩 패널
  const shouldShowLoading =
    !hasElements &&
    !isDataLoadCompleteAndEmpty &&
    !resolvedApiError &&
    (!isLocationDetermined ||
      !isGraphIdle ||
      (!isDataReady && !hasResolvedEvent) ||
      isGraphRefreshing);

  // 요소 있음: 캔버스 유지 + 갱신 중 오버레이만
  const showRefreshOverlay = hasElements && isGraphRefreshing;

  const loadingNotice = getLoadingNotice(
    isEventGraphBusy || isEventTransition,
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

  return (
    <div style={{ ...graphStyles.graphPageContainer, height: '100%' }}>
      <GraphSplitTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={{ book }}
        searchState={topBarSearchState}
        searchActions={topBarSearchActions}
        cy={cyInstance}
      />

      <div style={{ ...graphStyles.graphPageInner, minWidth: 0, position: 'relative' }}>
        {shouldShowLoading ? (
          <GraphNoticePanel
            variant="loading"
            title={loadingNotice.title}
            description={loadingNotice.description}
            icon={<Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} aria-hidden />}
          />
        ) : isDataLoadCompleteAndEmpty ? (
          <GraphNoticePanel
            variant="empty"
            title="아직 이벤트가 없습니다"
            description="이 챕터에는 표시할 그래프 데이터가 없습니다. 본문을 더 읽거나 그래프를 닫을 수 있습니다."
            icon={<Inbox className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
            actions={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {onToggleGraph ? (
                  <button type="button" className={secondaryBtnClass} onClick={onToggleGraph}>
                    그래프 닫기
                  </button>
                ) : null}
                <button type="button" className={primaryBtnClass} onClick={openRelationGraphPage}>
                  인물 관계도 보기
                </button>
              </div>
            }
          />
        ) : resolvedApiError ? (
          <GraphNoticePanel
            variant="error"
            title={resolvedApiError.message || '문제가 발생했습니다'}
            description={resolvedApiError.details || '잠시 후 다시 시도해 주세요.'}
            icon={<AlertCircle className="h-6 w-6" strokeWidth={2} aria-hidden />}
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
              prevValidEvent={prevValidEvent ?? null}
              activeTooltip={activeTooltip}
              onClearTooltip={onClearTooltip}
              onSetActiveTooltip={onSetActiveTooltip}
              graphClearRef={graphClearRef}
              isEventTransition={isEventTransition}
              bookId={book?.id ?? bookKey}
              cyRef={cyRef}
              onCyReady={handleCyReady}
              showZoomControls={false}
            />
            {showRefreshOverlay ? (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--rg-surface-slate)]/80"
                role="status"
                aria-live="polite"
                aria-label="그래프 전환 중"
              >
                <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-[var(--rg-text)] shadow-sm border border-[var(--rg-border-soft)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--rg-brand)]" strokeWidth={2} aria-hidden />
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

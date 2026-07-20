import { useMemo, useEffect, useState, useRef, memo, useCallback } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import CytoscapeGraphUnified from '../graph/CytoscapeGraphUnified';
import UnifiedNodeInfo from '../graph/tooltip/UnifiedNodeInfo';
import UnifiedEdgeTooltip from '../graph/tooltip/UnifiedEdgeTooltip';
import ViewerTopBar from './ViewerTopBar';
import { useGraphElementPipeline } from '../../hooks/graph/useGraphViewHooks';
import { getEdgeStyle, createGraphStylesheet, graphStyles } from '../../utils/styles/graphStyles';
import {
  centerSelectionOnElementId,
  getEdgeFocusPanTarget,
} from '../../utils/graph/graphUtils';
import {
  shouldIgnoreViewerOutsideClick,
  useGraphTooltipSelection,
} from '../../hooks/graph/useGraphInteractions';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerEventProgressUtils';
import { hasGraphPanelLocationHint } from '../../utils/common/valueUtils';
import { eventUtils } from '../../utils/viewer/viewerCoreStateUtils';
import '../graph/RelationGraph.css';

const iconShellClass = {
  loading: 'bg-emerald-50 text-[#5C6F5C]',
  empty: 'bg-slate-100 text-slate-500',
  error: 'bg-red-50 text-red-600',
};

const primaryBtnClass =
  'rounded-lg bg-[#5C6F5C] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4A5A4A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C6F5C] focus-visible:ring-offset-2';

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
      <ViewerTopBar
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

import { useMemo, useEffect, useState, useRef, memo } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import GraphContainer from "../graph/GraphContainer";
import ViewerTopBar from "./ViewerTopBar";
import { useGraphElementPipeline } from "../../hooks/graph/useGraphViewHooks";
import { graphStyles } from "../../utils/styles/graphStyles";
import { hasGraphPanelLocationHint } from "../../utils/common/locatorUtils";
import { eventUtils } from "../../utils/viewer/viewerCoreStateUtils";

const iconShellClass = {
  loading: "bg-emerald-50 text-[#5C6F5C]",
  empty: "bg-slate-100 text-slate-500",
  error: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-700",
};

function GraphNoticePanel({ variant, title, description, icon, actions }) {
  const shell = iconShellClass[variant] ?? iconShellClass.loading;
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50/90 p-4 sm:p-6">
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200/90 bg-white px-6 py-9 text-center shadow-sm sm:px-10 sm:py-10"
        role={variant === "error" || variant === "warning" ? "alert" : undefined}
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

const primaryBtnClass =
  "rounded-lg bg-[#5C6F5C] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4A5A4A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C6F5C] focus-visible:ring-offset-2";

function normalizeGraphApiError(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    return {
      message: "그래프 데이터를 불러올 수 없습니다",
      details: raw,
      retry: null,
    };
  }
  return raw;
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
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const {
    searchTerm: searchTermValue = "",
    isSearchActive: isSearchActiveValue = false,
    filteredElements: filteredElementsValue = [],
    isResetFromSearch: isResetFromSearchValue = false,
    fitNodeIds: searchFitNodeIds = [],
  } = searchState;

  const { graphPhase, isDataReady, isDataEmpty, book, bookKey, routeBookId } = viewerState;
  const { elements, currentEvent, currentChapter, prevValidEvent } = graphState;
  const { filterStage } = graphActions;
  const hasResolvedEvent = eventUtils.resolveEventNum(currentEvent) > 0;

  const hasResumeLocator = useMemo(
    () => hasGraphPanelLocationHint(resumeAnchor),
    [resumeAnchor]
  );

  const hasCachedLocation = useMemo(
    () => hasGraphPanelLocationHint(cachedLocation, { requireEventNum: true }),
    [cachedLocation]
  );

  const hasLocationHint = hasCachedLocation || hasResumeLocator;

  const isLocationDetermined = useMemo(() => {
    if (!currentChapter || currentChapter < 1) {
      return hasLocationHint;
    }
    if (!currentEvent) {
      return hasLocationHint;
    }
    return true;
  }, [currentChapter, currentEvent, hasLocationHint]);

  const { finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive: isSearchActiveValue,
    filteredElements: filteredElementsValue,
  });

  const hasCurrentEvent = hasResolvedEvent;
  const hasElements = Array.isArray(elements) && elements.length > 0;
  
  const isFineGraphBusy = graphPhase === 'fine';
  const isGraphIdle = graphPhase === 'idle';
  const rawTransitionOverlay =
    !hasElements &&
    (isFineGraphBusy || (transitionState.type === "event" && transitionState.inProgress));
  const [showTransitionOverlay, setShowTransitionOverlay] = useState(false);
  const overlayHideTimerRef = useRef(null);
  useEffect(() => {
    if (rawTransitionOverlay) {
      if (overlayHideTimerRef.current) {
        clearTimeout(overlayHideTimerRef.current);
        overlayHideTimerRef.current = null;
      }
      if (!showTransitionOverlay) {
        setShowTransitionOverlay(true);
      }
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

  useEffect(() => {
    return () => {
      if (overlayHideTimerRef.current) {
        clearTimeout(overlayHideTimerRef.current);
      }
    };
  }, []);
  const isDataLoadCompleteAndEmpty = isGraphIdle && isDataEmpty && !hasElements && !hasResolvedEvent;
  const isLoading = isDataLoadCompleteAndEmpty
    ? false
    : hasElements
      ? (!isLocationDetermined || (!isDataReady && !hasCurrentEvent))
      : (!isGraphIdle || !isLocationDetermined || (!isDataReady && !hasCurrentEvent));
  const shouldShowEmptyData = isDataLoadCompleteAndEmpty;
  const shouldShowLoading = !hasElements && isLoading;

  const resolvedApiError = useMemo(() => normalizeGraphApiError(apiError), [apiError]);

  return (
    <div
      style={{
        ...graphStyles.graphPageContainer,
        height: "100%",
      }}
    >
      <ViewerTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={{ book }}
        searchState={searchState}
        searchActions={searchActions}
      />
      
      <div
        style={{
          ...graphStyles.graphPageInner,
          minWidth: 0,
          position: "relative",
        }}
      >
        {shouldShowLoading ? (
          <GraphNoticePanel
            variant="loading"
            title={
              isFineGraphBusy
                ? "이벤트 반영 중"
                : !isLocationDetermined
                  ? "위치 정보를 확인하는 중"
                  : transitionState.type === "chapter"
                    ? "챕터 전환 중"
                    : "그래프 정보를 불러오는 중"
            }
            description={
              isFineGraphBusy
                ? "읽기 위치에 맞는 이벤트와 관계 그래프를 확정하는 중입니다."
                : !isLocationDetermined
                  ? "현재 읽고 있는 위치를 파악하고 있습니다. 잠시만 기다려 주세요."
                  : transitionState.type === "chapter"
                    ? "새 챕터의 이벤트를 준비하고 있습니다."
                    : "인물 관계 데이터를 불러오고 있습니다."
            }
            icon={<Loader2 className="h-7 w-7 animate-spin" strokeWidth={2} aria-hidden />}
          />
        ) : shouldShowEmptyData ? (
          <GraphNoticePanel
            variant="empty"
            title="아직 이벤트가 없습니다"
            description="이 챕터에는 표시할 그래프 데이터가 없습니다. 이벤트가 생기면 이 영역에 관계가 나타납니다."
            icon={<Inbox className="h-7 w-7" strokeWidth={1.75} aria-hidden />}
          />
        ) : resolvedApiError ? (
          <GraphNoticePanel
            variant="error"
            title={resolvedApiError.message || "문제가 발생했습니다"}
            description={resolvedApiError.details || "잠시 후 다시 시도해 주세요."}
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
              position: "relative",
            }}
          >
            <GraphContainer
              currentEvent={graphState.currentEvent}
              currentChapter={graphState.currentChapter}
              edgeLabelVisible={graphState.edgeLabelVisible}
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
              isEventTransition={transitionState.type === 'event' && transitionState.inProgress}
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

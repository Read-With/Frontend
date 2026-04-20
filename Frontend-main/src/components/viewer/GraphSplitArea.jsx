import React, { useRef, useMemo, memo } from "react";
import { AlertCircle, AlertTriangle, Inbox, Loader2 } from "lucide-react";
import GraphContainer from "../graph/GraphContainer";
import ViewerTopBar from "./ViewerTopBar";
import { useGraphElementPipeline } from "../../hooks/graph/useGraphElementPipeline";
import {
  graphPanelHasCachedLocationHint,
  graphPanelHasResumeLocationHint,
} from "../../utils/common/locatorUtils";

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
  bookId = null,
  book = null,
  cachedLocation = null,
  resumeAnchor = null,
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const graphContainerRef = useRef(null);
  const {
    searchTerm: searchTermValue = "",
    isSearchActive: isSearchActiveValue = false,
    filteredElements: filteredElementsValue = [],
    isResetFromSearch: isResetFromSearchValue = false,
    fitNodeIds: searchFitNodeIds = [],
    suggestions: suggestionsValue = [],
    showSuggestions: showSuggestionsValue = false,
    selectedIndex: selectedSuggestionIndex = -1,
  } = searchState;
  
  const { loading, isReloading, isGraphLoading, isFineGraphLoading, graphLoading, isDataReady, isDataEmpty } =
    viewerState;
  const { elements, currentEvent, currentChapter } = graphState;
  const { filterStage } = graphActions;

  const hasResumeLocator = useMemo(
    () => graphPanelHasResumeLocationHint(resumeAnchor),
    [resumeAnchor]
  );

  const hasCachedLocation = useMemo(
    () => graphPanelHasCachedLocationHint(cachedLocation),
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

  const prevValidEventForGraph = graphState.prevValidEvent ?? null;

  const hasCurrentEvent = !!currentEvent;
  const hasElements = elements && Array.isArray(elements) && elements.length > 0;
  
  const isDataLoadCompleteAndEmpty = graphLoading === false && isDataEmpty && !hasElements;
  const isLoading = isDataLoadCompleteAndEmpty
    ? false
    : (loading || isReloading || !isLocationDetermined || (!isDataReady && !hasCurrentEvent) || (graphLoading !== false && isGraphLoading));
  const shouldShowEmptyData = isDataLoadCompleteAndEmpty;
  
  // fine 그래프가 아직 반영되지 않았으면(이벤트 확정 전) 기존 elements가 있어도 그래프 대신 로딩 — 중간 이벤트 표시 방지
  const isFineGraphBusy = isFineGraphLoading === true;
  const shouldShowLoading = (!hasElements && isLoading) || (hasElements && isFineGraphBusy);

  const topBarSearchState = useMemo(() => ({
    searchTerm: searchTermValue,
    isSearchActive: isSearchActiveValue,
    suggestions: suggestionsValue,
    showSuggestions: showSuggestionsValue,
    selectedIndex: selectedSuggestionIndex,
  }), [searchTermValue, isSearchActiveValue, suggestionsValue, showSuggestionsValue, selectedSuggestionIndex]);

  // viewerState 전체를 넘기면 showToolbar 등 무관한 변경으로 TopBar memo가 깨짐
  const viewerStateForTopBar = useMemo(
    () => ({ filename: viewerState.filename, book: viewerState.book }),
    [viewerState.filename, viewerState.book]
  );

  const resolvedApiError = useMemo(() => normalizeGraphApiError(apiError), [apiError]);

  return (
    <div className="h-full w-full flex flex-col" style={{ minHeight: 0, overflow: "hidden" }}>
      <ViewerTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={viewerStateForTopBar}
        searchState={topBarSearchState}
        searchActions={searchActions}
      />
      
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
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
        ) : transitionState.error ? (
          <GraphNoticePanel
            variant="warning"
            title="일시적인 오류가 발생했습니다"
            description="페이지를 새로고침하면 대부분 정상적으로 돌아옵니다. 문제가 계속되면 잠시 뒤에 다시 열어 주세요."
            icon={<AlertTriangle className="h-7 w-7" strokeWidth={2} aria-hidden />}
            actions={
              <button type="button" className={primaryBtnClass} onClick={() => window.location.reload()}>
                새로고침
              </button>
            }
          />
        ) : (
          <div className="h-full w-full relative" style={{ minHeight: 0, minWidth: 0 }}>
            <GraphContainer
              ref={graphContainerRef}
              currentPosition={graphState.currentCharIndex}
              currentEvent={graphState.currentEvent}
              currentChapter={graphState.currentChapter}
              edgeLabelVisible={graphState.edgeLabelVisible}
              filename={viewerState.filename}
              elements={finalElements}
              searchTerm={searchTermValue}
              isSearchActive={isSearchActiveValue}
              filteredElements={filteredElementsValue}
              fitNodeIds={searchFitNodeIds}
              isResetFromSearch={isResetFromSearchValue}
              prevValidEvent={prevValidEventForGraph}
              events={graphState.events || []}
              activeTooltip={activeTooltip}
              onClearTooltip={onClearTooltip}
              onSetActiveTooltip={onSetActiveTooltip}
              graphClearRef={graphClearRef}
              isEventTransition={transitionState.type === 'event' && transitionState.inProgress}
              bookId={book?.id ?? bookId}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default GraphSplitArea;

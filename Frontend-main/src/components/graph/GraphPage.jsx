import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import GraphCanvas from "./GraphCanvas";
import { GraphPageContext } from "./GraphPageContext";
import ChapterSidebar from "./ChapterSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle } from "../../utils/styles/graphStyles";
import {
  GRAPH_LAYOUT_CONSTANTS,
  resolveChapterSidebarWidth,
} from '../../utils/graph/graphCore';
import { userViewerPath } from '../../utils/common/urlUtils';
import {
  useGraphSearch,
  useGraphState,
  useGraphElementPipeline,
} from '../../hooks/graph/useGraphViewState';
import { useApiGraphData } from '../../hooks/graph/useApiGraphData';
import { useChapterPovSummaries } from '../../hooks/graph/useChapterPovSummaries';
import {
  useGraphChapterEventState,
  useManifestChapterEventClamp,
  useChapterTitleMeta,
  useGraphPageElements,
  useChapterSelect,
} from '../../hooks/graph/useGraphPage';
import { useIsNarrowViewport, useLatestRef } from '../../hooks/common/hooksShared';
import { resolveServerBookId } from '../../utils/viewer/viewerCore';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import {
  shouldIgnoreGraphOutsideClick,
  useGraphTooltipSelection,
  useGraphViewportFocus,
} from '../../hooks/graph/useGraphCy';
import { getChapterData } from '../../utils/common/cache/manifestCache.js';

const GRAPH_PAGE_EDGE_STYLE = getEdgeStyle('graph');


function GraphLoadBanner({ apiError, onRetry }) {
  return (
    <div className="graph-load-banner" role="status">
      {apiError
        ? '그래프를 불러오지 못했습니다.'
        : '선택한 챕터에 표시할 그래프 데이터가 없습니다.'}
      {typeof onRetry === 'function' && (
        <button type="button" onClick={() => { void onRetry(); }} className="graph-load-banner-retry">
          다시 시도
        </button>
      )}
    </div>
  );
}

function GraphPage() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;

  const bookId = toPositiveNumberOrNull(filename);
  const { currentChapter, setCurrentChapter, currentEvent, setCurrentEvent } =
    useGraphChapterEventState(filename, location.state?.selectedChapter);
  const [hasShownGraphOnce, setHasShownGraphOnce] = useState(false);

  const cyRef = useRef(null);
  const graphClearRef = useRef(null);
  const graphSelectNodeRef = useRef(null);
  const selectedElementRef = useRef(null);
  const pendingKeepAnalysisOpenRef = useRef(false);
  const prevChapterNum = useRef(currentChapter);
  const prevEventNum = useRef();
  const locationRef = useLatestRef(location);

  const serverBookId = useMemo(
    () => resolveServerBookId(book, bookId),
    [book, bookId],
  );

  const {
    isSidebarOpen,
    edgeLabelVisible,
    activeTooltip,
    isSidebarClosing,
    filterStage,
    setActiveTooltip,
    toggleSidebar,
    setSidebarOpen,
    toggleEdgeLabel,
    startClosing,
    cancelClosing,
    closeSidebar,
    setFilterStage,
  } = useGraphState();

  const isNarrow = useIsNarrowViewport();
  const sidebarLayoutWidth = resolveChapterSidebarWidth(isSidebarOpen, { isNarrow });

  const {
    manifest: { data: manifestData, ready: manifestReady },
    graph: {
      data: apiBookGraphData,
      loadedKey: loadedGraphKey,
      maxChapter: apiMaxChapter,
      userCurrentChapter,
      isLoading: isGraphLoading,
    },
    error: apiError,
    retryGraph,
  } = useApiGraphData(serverBookId, currentChapter);

  const {
    povSummaries,
    error: povError,
    isLoading: povIsLoading,
    retry: retryPov,
  } = useChapterPovSummaries(serverBookId, currentChapter);

  const povCached = useMemo(() => {
    if (serverBookId == null || currentChapter == null) return null;
    const ch = getChapterData(serverBookId, currentChapter, manifestData);
    if (!ch) return null;
    return Boolean(ch.povSummariesCached);
  }, [serverBookId, currentChapter, manifestData]);

  const handleBackToViewer = useCallback(() => {
    const { state, pathname } = locationRef.current;
    const nextState = {
      ...(state || {}),
      from: state?.from ? { ...state.from, search: '' } : { pathname, search: '' },
    };

    if (book || serverBookId) {
      nextState.book = {
        ...(book || {}),
        ...(serverBookId ? { id: serverBookId, _bookId: serverBookId } : {}),
      };
    }

    navigate(userViewerPath(filename), { state: nextState });
  }, [navigate, filename, book, serverBookId, locationRef]);

  const currentChapterData = useMemo(
    () => ({ characters: Array.isArray(apiBookGraphData?.characters) ? apiBookGraphData.characters : [] }),
    [apiBookGraphData],
  );

  const { bookTitle, chapterMeta } = useChapterTitleMeta(serverBookId, currentChapter, manifestData);

  useManifestChapterEventClamp({
    serverBookId,
    manifestReady,
    manifestData,
    apiMaxChapter,
    currentChapter,
    setCurrentChapter,
    currentEvent,
    setCurrentEvent,
  });

  const { elements, isApiGraphEmpty } = useGraphPageElements({
    serverBookId,
    currentChapter,
    currentEvent,
    apiBookGraphData,
    loadedGraphKey,
    isGraphLoading,
  });

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);
  const { clearSearch } = searchActions;

  const {
    clearGraphSelection,
    centerSelection,
    onClearTooltip,
    dismissTooltip,
    onBeforeOpenTooltip,
  } = useGraphViewportFocus({
    cyRef,
    graphClearRef,
    isNarrow,
    isSidebarOpen,
    closeSidebar,
    startClosing,
    cancelClosing,
  });

  const hasOpenTooltip = !!(activeTooltip && !isSidebarClosing);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useGraphTooltipSelection({
    activeTooltip,
    onSetActiveTooltip: setActiveTooltip,
    onBeforeOpen: onBeforeOpenTooltip,
    centerSelection,
    focusDelayMs: GRAPH_LAYOUT_CONSTANTS.FOCUS_PAN_DELAY_MS,
    tooltipOpen: hasOpenTooltip,
    onDismiss: dismissTooltip,
    shouldIgnoreClick: (event) => shouldIgnoreGraphOutsideClick(event, 'page'),
  });

  useEffect(() => {
    const chapterChanged =
      prevChapterNum.current !== undefined && prevChapterNum.current !== currentChapter;
    const eventChanged =
      prevEventNum.current !== undefined && prevEventNum.current !== currentEvent;

    if (chapterChanged || eventChanged) {
      if (chapterChanged && searchState.isSearchActive) clearSearch();
      clearGraphSelection({ fitViewport: false, restoreViewport: false });
    }

    prevChapterNum.current = currentChapter;
    prevEventNum.current = currentEvent;
  }, [currentChapter, currentEvent, searchState.isSearchActive, clearSearch, clearGraphSelection]);

  const { finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive: searchState.isSearchActive,
    filteredElements: searchState.filteredElements,
  });

  const stylesheet = useMemo(
    () => createGraphStylesheet(GRAPH_PAGE_EDGE_STYLE, edgeLabelVisible),
    [edgeLabelVisible],
  );

  const pageChromeStart = useMemo(() => (
    <button
      type="button"
      className="graph-page-back"
      onClick={handleBackToViewer}
      aria-label="뷰어로 돌아가기"
    >
      <ArrowLeft size={16} aria-hidden />
      돌아가기
    </button>
  ), [handleBackToViewer]);

  const handleChapterSelect = useChapterSelect({
    currentChapter,
    setCurrentChapter,
    setCurrentEvent,
    serverBookId,
    manifestData,
    activeTooltip,
    clearGraphSelection,
    startClosing,
  });

  const handleSelectRelatedNode = useCallback((idOrName) => {
    cancelClosing();
    return graphSelectNodeRef.current?.(idOrName) ?? false;
  }, [cancelClosing]);

  const handleCanvasClick = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    if (hasOpenTooltip) dismissTooltip();
  }, [hasOpenTooltip, dismissTooltip]);

  const isCanvasLoading = isGraphLoading && elements.length === 0;
  const eventNum = Math.max(currentEvent, 1);

  // GraphCanvas · GraphPageSidebar가 읽는 값 (중간 컴포넌트 props 전달 없음)
  const graphPageValue = useMemo(() => ({
    chapterRailWidth: sidebarLayoutWidth,
    cyRef,
    graphClearRef,
    graphSelectNodeRef,
    selectedElementRef,
    activeTooltip,
    currentChapter,
    eventNum,
    chapterDisplayLabel: chapterMeta.chapterDisplayLabel,
    chapterTitleTooltip: chapterMeta.chapterTitleTooltip,
    renderElements: finalElements,
    stylesheet,
    isLoading: isCanvasLoading,
    hasShownGraphOnce,
    onCanvasClick: handleCanvasClick,
    pageChromeStart,
    // 상세 사이드바
    bookId: serverBookId,
    isSidebarClosing,
    closeSidebar,
    startClosing,
    clearGraphSelection,
    // 검색·표시 옵션
    searchState,
    searchActions,
    edgeLabelVisible,
    toggleEdgeLabel,
    filterStage,
    setFilterStage,
    // Cytoscape 탭 → 툴팁
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    // NodeDetail에 그대로 펼쳐 넘김
    nodeDetail: {
      filename,
      elements,
      povSummaries,
      povError,
      povIsLoading,
      povCached,
      onRetryPov: retryPov,
      apiBookGraphData,
      onSelectRelatedNode: handleSelectRelatedNode,
      pendingKeepAnalysisOpenRef,
    },
  }), [
    sidebarLayoutWidth,
    activeTooltip,
    currentChapter,
    eventNum,
    chapterMeta,
    finalElements,
    stylesheet,
    isCanvasLoading,
    hasShownGraphOnce,
    handleCanvasClick,
    pageChromeStart,
    serverBookId,
    isSidebarClosing,
    closeSidebar,
    startClosing,
    clearGraphSelection,
    searchState,
    searchActions,
    edgeLabelVisible,
    toggleEdgeLabel,
    filterStage,
    setFilterStage,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    filename,
    elements,
    povSummaries,
    povError,
    povIsLoading,
    povCached,
    retryPov,
    apiBookGraphData,
    handleSelectRelatedNode,
  ]);

  const chapterList = useMemo(
    () => Array.from({ length: apiMaxChapter }, (_, i) => i + 1),
    [apiMaxChapter],
  );

  useEffect(() => {
    if (!isGraphLoading) setHasShownGraphOnce(true);
  }, [isGraphLoading]);

  return (
    <div className="graph-page-root">
      {(isApiGraphEmpty || apiError) && (
        <GraphLoadBanner apiError={apiError} onRetry={retryGraph} />
      )}

      <ChapterSidebar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
        onCloseSidebar={() => setSidebarOpen(false)}
        chapterList={chapterList}
        currentChapter={currentChapter}
        onChapterSelect={handleChapterSelect}
        manifestBookId={serverBookId ?? null}
        bookTitle={bookTitle}
        manifestHint={manifestData}
        userCurrentChapter={userCurrentChapter}
      />

      <GraphPageContext.Provider value={graphPageValue}>
        <GraphCanvas />
      </GraphPageContext.Provider>
    </div>
  );
}

export default GraphPage;

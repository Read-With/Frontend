import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import GraphCanvas from "./GraphCanvas";
import ChapterSidebar from "./ChapterSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle } from "../../utils/styles/graphStyles";
import { COLORS } from "../../utils/styles/styles.js";
import {
  GRAPH_LAYOUT_CONSTANTS,
  resolveChapterSidebarWidth,
  calculateLastEventForChapter,
} from '../../utils/graph/graphCore';
import { isGraphDragEndEvent } from '../../utils/graph/graphCy';
import { userViewerPath, errorUtils } from '../../utils/common/urlUtils';
import {
  useGraphSearch,
  useGraphState,
  useGraphElementPipeline,
  useIsNarrowViewport,
} from '../../hooks/graph/useGraphViewState';
import { useApiGraphData, useChapterPovSummaries } from '../../hooks/graph/useApiGraphData';
import { resolveServerBookIdOrFallback, useLocalStorageNumber } from '../../hooks/common/hooksShared';
import {
  convertGraphSourceToElements,
  commitVisibleGraphElements,
  DEFAULT_GRAPH_TRANSFORM_DEPS,
} from '../../utils/viewer/viewerGraph';
import { extractNodeWeightsFromElements, getGraphEventState } from '../../utils/graph/graphModel';
import { eventUtils, formatFallbackChapterLabel, stripRedundantBookTitlePrefix, resolveChapterTitleMeta } from '../../utils/viewer/viewerCore';
import { hasGraphPayload } from '../../utils/api/graphApi';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import {
  shouldIgnoreGraphOutsideClick,
  useGraphTooltipSelection,
  useGraphViewportFocus,
} from '../../hooks/graph/useGraphCy';
import {
  getChapterData,
  findManifestEventInChapter,
} from '../../utils/common/cache/manifestCache.js';

const pageRootStyle = {
  width: '100vw',
  height: '100vh',
  background: COLORS.backgroundLighter,
  overflow: 'hidden',
};

const emptyGraphBannerStyle = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 10003,
  background: 'rgba(255,255,255,0.96)',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: '8px 12px',
  color: '#374151',
  fontSize: 12,
  fontWeight: 600,
};

const GRAPH_PAGE_EDGE_STYLE = getEdgeStyle('graph');

/**
 * 챕터 레일 폭 변경 시 window resize를 지연 발행하는 시간(ms).
 * .graph-chapter-rail의 CSS width transition(0.3s, relation-graph/canvas.css)이
 * 끝난 뒤 발행되도록 여유(20ms)를 둔 값 — CSS transition 값을 바꾸면 이 값도 함께 맞춰야 한다.
 */
const CHAPTER_RAIL_RESIZE_DELAY_MS = 320;

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;

  const bookId = toPositiveNumberOrNull(filename);
  let chapterFromViewer = Number(location.state?.selectedChapter);
  if (!Number.isFinite(chapterFromViewer) || chapterFromViewer < 1) {
    chapterFromViewer = null;
  }

  const [currentChapter, setCurrentChapter] = useLocalStorageNumber(
    `lastGraphChapter_${filename}`,
    chapterFromViewer ?? 1,
    { forceInitialValue: chapterFromViewer != null }
  );
  const [currentEvent, setCurrentEvent] = useState(1);
  const [hasShownGraphOnce, setHasShownGraphOnce] = useState(false);
  const [elements, setElements] = useState([]);

  const appliedRequestedChapterRef = useRef(null);
  const cyRef = useRef(null);
  const graphClearRef = useRef(null);
  const graphSelectNodeRef = useRef(null);
  const selectedElementRef = useRef(null);
  const pendingKeepAnalysisOpenRef = useRef(false);
  const prevChapterNum = useRef(currentChapter);
  const prevEventNum = useRef();
  const profileApplyTokenRef = useRef(0);
  const pendingChapterChangeRef = useRef(null);
  const locationRef = useRef({ state: location.state, pathname: location.pathname });

  useEffect(() => {
    locationRef.current = { state: location.state, pathname: location.pathname };
  }, [location.state, location.pathname]);

  useEffect(() => () => {
    if (pendingChapterChangeRef.current) {
      window.clearTimeout(pendingChapterChangeRef.current);
      pendingChapterChangeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (chapterFromViewer == null) return;
    if (appliedRequestedChapterRef.current === chapterFromViewer) return;
    if (chapterFromViewer !== currentChapter) {
      setCurrentChapter(chapterFromViewer);
      setCurrentEvent(1);
    }
    appliedRequestedChapterRef.current = chapterFromViewer;
  }, [chapterFromViewer, currentChapter, setCurrentChapter]);

  const serverBookId = useMemo(
    () => resolveServerBookIdOrFallback(book, bookId),
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
    clearError: clearApiError,
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
  }, [navigate, filename, book, serverBookId]);

  const currentChapterData = useMemo(
    () => ({ characters: Array.isArray(apiBookGraphData?.characters) ? apiBookGraphData.characters : [] }),
    [apiBookGraphData],
  );

  const bookTitle = useMemo(
    () => String(manifestData?.book?.title ?? '').trim(),
    [manifestData?.book?.title],
  );

  const chapterMeta = useMemo(() => {
    const ch =
      serverBookId != null ? getChapterData(serverBookId, currentChapter) : null;
    if (!Number.isFinite(Number(currentChapter)) || Number(currentChapter) < 1) {
      return { chapterDisplayLabel: '챕터 ?', chapterTitleTooltip: undefined };
    }
    const meta = resolveChapterTitleMeta(ch, bookTitle, currentChapter);
    const displayName =
      meta.status === 'ok'
        ? stripRedundantBookTitlePrefix(meta.raw, bookTitle) || meta.display
        : meta.status === 'collapsed'
          ? meta.display
          : '';
    return {
      chapterDisplayLabel: displayName || formatFallbackChapterLabel(currentChapter),
      chapterTitleTooltip: meta.raw || meta.tooltip || undefined,
    };
  }, [serverBookId, currentChapter, bookTitle]);

  useEffect(() => {
    if (!manifestReady) return;
    if (apiMaxChapter > 0 && currentChapter > apiMaxChapter) {
      setCurrentChapter(apiMaxChapter);
    }
  }, [manifestReady, apiMaxChapter, currentChapter, setCurrentChapter]);

  useEffect(() => {
    if (serverBookId == null || !manifestReady) return;
    const ch = Number(currentChapter);
    if (!Number.isFinite(ch) || ch < 1) return;
    if (findManifestEventInChapter(serverBookId, ch, { eventIdx: currentEvent }, manifestData)) return;

    const events = getChapterData(serverBookId, ch, manifestData)?.events;
    if (!Array.isArray(events) || events.length === 0) return;

    const firstEv = events[0];
    const next = eventUtils.resolveEventNum(firstEv);
    if (!(next > 0) || next === currentEvent) return;
    if (findManifestEventInChapter(serverBookId, ch, { eventIdx: next }, manifestData)) {
      setCurrentEvent(next);
    }
  }, [serverBookId, manifestReady, manifestData, currentChapter, currentEvent]);

  const graphApiPayload = hasGraphPayload(apiBookGraphData) ? apiBookGraphData : null;
  const requestedGraphKey = serverBookId != null
    ? `${serverBookId}:${Number(currentChapter)}`
    : null;
  const isGraphResponseCurrent = loadedGraphKey === requestedGraphKey;

  const apiElements = useMemo(() => {
    if (!isGraphResponseCurrent) return null;
    if (!graphApiPayload) return [];
    try {
      const previousEventState =
        serverBookId && currentEvent > 1
          ? getGraphEventState(serverBookId, currentChapter, currentEvent - 1)
          : null;
      return convertGraphSourceToElements(
        graphApiPayload,
        currentChapter,
        currentEvent,
        DEFAULT_GRAPH_TRANSFORM_DEPS,
        extractNodeWeightsFromElements(previousEventState?.elements),
        { bookId: serverBookId },
      ).elements;
    } catch (error) {
      errorUtils.logError('RelationGraphWrapper.convert', error, {
        bookId: serverBookId,
        chapter: currentChapter,
        event: currentEvent,
      });
      return [];
    }
  }, [isGraphResponseCurrent, graphApiPayload, serverBookId, currentChapter, currentEvent]);

  useEffect(() => {
    if (apiElements == null) return;
    if (!apiElements.length) {
      if (isGraphLoading) return;
      profileApplyTokenRef.current += 1;
      setElements([]);
      return;
    }
    commitVisibleGraphElements(setElements, apiElements, {
      applyTokenRef: profileApplyTokenRef,
    });
  }, [apiElements, isGraphLoading]);

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);
  const { clearSearch } = searchActions;

  const floatingSearchActions = useMemo(() => ({
    onSearchSubmit: searchActions.onSearchSubmit,
    onClearSearch: searchActions.clearSearch,
    onGenerateSuggestions: searchActions.onGenerateSuggestions,
    onKeyDown: searchActions.handleKeyDown,
    onCloseSuggestions: searchActions.closeSuggestions,
    onSelectedIndexChange: searchActions.onSelectedIndexChange,
  }), [searchActions]);

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
    blockDragEndEvents: true,
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

  const handleChapterSelect = useCallback((chapter) => {
    if (chapter === currentChapter) return;

    if (pendingChapterChangeRef.current) {
      window.clearTimeout(pendingChapterChangeRef.current);
      pendingChapterChangeRef.current = null;
    }

    const applyChapter = () => {
      pendingChapterChangeRef.current = null;
      setCurrentChapter(chapter);

      const lastEventNum = calculateLastEventForChapter({
        manifestChapters: manifestData?.chapters,
        manifestBookId: serverBookId,
        chapter,
      });
      const normalized = Number(lastEventNum);
      if (Number.isFinite(normalized) && normalized >= 1) {
        setCurrentEvent(normalized);
        return;
      }
      // 빈 챕터: 가짜 lastEvent=1로 속이지 않음. 첫 실제 이벤트만 사용.
      const firstEv = getChapterData(serverBookId, chapter, manifestData)?.events?.[0];
      const firstNum = eventUtils.resolveEventNum(firstEv);
      if (firstNum > 0) setCurrentEvent(firstNum);
    };

    // 선택(노드/간선·툴팁)이 있으면 먼저 해제한 뒤 챕터 전환
    const hadTooltip = Boolean(activeTooltip);
    clearGraphSelection({ fitViewport: false, restoreViewport: false });

    if (hadTooltip) {
      startClosing();
      pendingChapterChangeRef.current = window.setTimeout(
        applyChapter,
        GRAPH_LAYOUT_CONSTANTS.ANIMATION_MS
      );
      return;
    }

    applyChapter();
  }, [
    activeTooltip,
    currentChapter,
    setCurrentChapter,
    manifestData,
    serverBookId,
    clearGraphSelection,
    startClosing,
  ]);

  const handleSelectRelatedNode = useCallback((idOrName) => {
    cancelClosing();
    return graphSelectNodeRef.current?.(idOrName) ?? false;
  }, [cancelClosing]);

  const handleCanvasClick = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    if (isGraphDragEndEvent(e)) return;
    if (hasOpenTooltip) dismissTooltip();
  }, [hasOpenTooltip, dismissTooltip]);

  const chapterList = useMemo(
    () => Array.from({ length: apiMaxChapter }, (_, i) => i + 1),
    [apiMaxChapter],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, CHAPTER_RAIL_RESIZE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [sidebarLayoutWidth]);

  const isApiGraphEmpty = !isGraphLoading && isGraphResponseCurrent && !graphApiPayload;

  useEffect(() => {
    if (!isGraphLoading) setHasShownGraphOnce(true);
  }, [isGraphLoading]);

  return (
    <div style={pageRootStyle}>
      {(isApiGraphEmpty || apiError) && (
        <div style={emptyGraphBannerStyle}>
          {apiError
            ? '그래프를 불러오지 못했습니다.'
            : '선택한 챕터에 표시할 그래프 데이터가 없습니다.'}
          {typeof retryGraph === 'function' && (
            <button
              type="button"
              onClick={() => {
                clearApiError();
                void retryGraph();
              }}
              style={{
                marginLeft: 12,
                textDecoration: 'underline',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
          )}
        </div>
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

      <GraphCanvas
        isSidebarOpen={isSidebarOpen}
        sidebarLayoutWidth={sidebarLayoutWidth}
        activeTooltip={activeTooltip}
        cyRef={cyRef}
        eventNum={Math.max(currentEvent, 1)}
        filename={filename}
        elements={elements}
        renderElements={finalElements}
        povSummaries={povSummaries}
        povError={povError}
        povIsLoading={povIsLoading}
        povCached={povCached}
        onRetryPov={retryPov}
        apiBookGraphData={apiBookGraphData}
        bookId={serverBookId}
        isLoading={isGraphLoading && elements.length === 0}
        hasShownGraphOnce={hasShownGraphOnce}
        onCanvasClick={handleCanvasClick}
        currentChapter={currentChapter}
        chapterDisplayLabel={chapterMeta.chapterDisplayLabel}
        chapterTitleTooltip={chapterMeta.chapterTitleTooltip}
        sidebarControl={{
          isSidebarClosing,
          onCloseSidebar: closeSidebar,
          onStartClosing: startClosing,
          onClearGraph: clearGraphSelection,
        }}
        searchState={{
          isSearchActive: searchState.isSearchActive,
          filteredElements: searchState.filteredElements,
          searchTerm: searchState.searchTerm,
          fitNodeIds: searchState.fitNodeIds,
        }}
        pageChromeStart={(
          <button
            type="button"
            className="graph-page-back"
            onClick={handleBackToViewer}
            aria-label="뷰어로 돌아가기"
          >
            <ArrowLeft size={16} aria-hidden />
            돌아가기
          </button>
        )}
        floatingControls={{
          searchState,
          searchActions: floatingSearchActions,
          edgeLabelVisible,
          onToggleEdgeLabel: toggleEdgeLabel,
          filterStage,
          onFilterChange: setFilterStage,
        }}
        cytoscapeConfig={{ stylesheet }}
        tooltipHandlers={{
          onShowNodeTooltip,
          onShowEdgeTooltip,
          onClearTooltip,
          selectedElementRef,
        }}
        graphClearRef={graphClearRef}
        graphSelectNodeRef={graphSelectNodeRef}
        onSelectRelatedNode={handleSelectRelatedNode}
        pendingKeepAnalysisOpenRef={pendingKeepAnalysisOpenRef}
      />
    </div>
  );
}

export default RelationGraphWrapper;

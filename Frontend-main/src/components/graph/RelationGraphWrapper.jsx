import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import { GraphTopBar } from "./GraphControls";
import GraphCanvas from "./GraphCanvas";
import ChapterSidebar from "./ChapterSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle } from "../../utils/styles/graphStyles";
import { COLORS, createAdvancedButtonHandlers } from "../../utils/styles/styles.js";
import {
  GRAPH_LAYOUT_CONSTANTS,
  resolveChapterSidebarWidth,
  calculateLastEventForChapter,
} from '../../utils/graph/graphCore';
import {
  isGraphDragEndEvent,
  fitGraphToNodes,
  centerSelectionOnElementId,
} from '../../utils/graph/graphCy';
import { errorUtils, userViewerPath } from '../../utils/common/urlUtils';
import {
  useGraphSearch,
  useGraphState,
  useGraphElementPipeline,
  useIsNarrowViewport,
} from '../../hooks/graph/useGraphViewState';
import { useApiGraphData, useChapterPovSummaries } from '../../hooks/graph/useApiGraphData';
import { resolveServerBookIdOrFallback, useLocalStorageNumber } from '../../hooks/common/hooksShared';
import {
  createCharacterMaps,
  buildNodeWeights,
  extractNodeWeightsFromElements,
  convertRelationsToElements,
  getGraphEventState,
} from '../../utils/graph/graphModel';
import { eventUtils } from '../../utils/viewer/viewerCore';
import { hasGraphPayload } from '../../utils/graph/graphFetch';
import {
  convertGraphSourceToElements,
  commitVisibleGraphElements,
} from '../../utils/viewer/viewerGraph';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import {
  shouldIgnoreGraphPageOutsideClick,
  useGraphTooltipSelection,
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
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '8px 12px',
  color: '#374151',
  fontSize: 12,
  fontWeight: 600,
};

const backButtonStyle = {
  height: 32,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: 'rgba(255, 255, 255, 0.9)',
  color: COLORS.textPrimary,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  outline: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  backdropFilter: 'blur(8px)',
  justifyContent: 'center',
};

const backButtonContainerStyle = {
  position: 'fixed',
  top: '12px',
  right: '24px',
  zIndex: 10002,
  pointerEvents: 'auto',
};

const graphBackButtonHandlers = createAdvancedButtonHandlers('default');
const GRAPH_PAGE_EDGE_STYLE = getEdgeStyle('graph');
const GRAPH_TRANSFORM_DEPS = { createCharacterMaps, buildNodeWeights, convertRelationsToElements };

function ErrorToast({ error, onClose, duration = 5000 }) {
  useEffect(() => {
    if (!error || duration <= 0) return undefined;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [error, duration, onClose]);

  if (!error) return null;

  return (
    <div className="graph-error-toast" role="alert" aria-live="assertive">
      <span className="material-symbols-outlined graph-error-toast__icon">error</span>
      <div className="graph-error-toast__body">
        <div className="graph-error-toast__title">오류 발생</div>
        <div className="graph-error-toast__message">
          {errorUtils.getUserFriendlyMessage(error)}
        </div>
      </div>
      <button
        type="button"
        className="graph-error-toast__close"
        onClick={onClose}
        aria-label="오류 메시지 닫기"
      >
        <span className="material-symbols-outlined">close</span>
      </button>
    </div>
  );
}

ErrorToast.propTypes = {
  error: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.object,
    PropTypes.instanceOf(Error),
  ]),
  onClose: PropTypes.func.isRequired,
  duration: PropTypes.number,
};

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;

  const bookId = toPositiveNumberOrNull(filename);
  const requestedChapterFromViewer = Number(location.state?.selectedChapter);
  const chapterFromViewer =
    Number.isFinite(requestedChapterFromViewer) && requestedChapterFromViewer >= 1
      ? requestedChapterFromViewer
      : null;

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
    if (!Number.isFinite(requestedChapterFromViewer) || requestedChapterFromViewer < 1) return;
    if (appliedRequestedChapterRef.current === requestedChapterFromViewer) return;
    if (requestedChapterFromViewer !== currentChapter) {
      setCurrentChapter(requestedChapterFromViewer);
      setCurrentEvent(1);
    }
    appliedRequestedChapterRef.current = requestedChapterFromViewer;
  }, [requestedChapterFromViewer, currentChapter, setCurrentChapter]);

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
      maxChapter: apiMaxChapter,
      userCurrentChapter,
      isLoading: isGraphLoading,
    },
    error: apiError,
    clearError: clearApiError,
  } = useApiGraphData(serverBookId, currentChapter);

  const { povSummaries } = useChapterPovSummaries(serverBookId, currentChapter);

  const handleBackToViewer = useCallback(() => {
    const { state, pathname } = locationRef.current;
    const nextState = {
      ...(state || {}),
      from: state?.from ? { ...state.from, search: '' } : { pathname, search: '' },
    };

    const baseBook = book || state?.book;
    const sid = toPositiveNumberOrNull(serverBookId);
    if (baseBook || sid) {
      nextState.book = {
        ...(baseBook || {}),
        ...(sid ? { id: sid, _bookId: sid } : {}),
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

    const firstEv = getChapterData(serverBookId, ch, manifestData)?.events?.[0];
    const next = eventUtils.resolveEventNum(firstEv) || 1;
    if (!(next > 0) || next === currentEvent) return;
    if (findManifestEventInChapter(serverBookId, ch, { eventIdx: next }, manifestData)) {
      setCurrentEvent(next);
    }
  }, [serverBookId, manifestReady, manifestData, currentChapter, currentEvent]);

  const graphApiPayload = hasGraphPayload(apiBookGraphData) ? apiBookGraphData : null;

  const apiElements = useMemo(() => {
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
        GRAPH_TRANSFORM_DEPS,
        extractNodeWeightsFromElements(previousEventState?.elements),
        { bookId: serverBookId },
      ).elements;
    } catch {
      return [];
    }
  }, [graphApiPayload, serverBookId, currentChapter, currentEvent]);

  useEffect(() => {
    if (!apiElements.length) {
      profileApplyTokenRef.current += 1;
      setElements([]);
      return;
    }
    commitVisibleGraphElements(setElements, apiElements, {
      applyTokenRef: profileApplyTokenRef,
    });
  }, [apiElements]);

  const { searchState, searchActions } = useGraphSearch(elements, currentChapterData);
  const { clearSearch } = searchActions;

  const topBarSearchActions = useMemo(() => ({
    onSearchSubmit: searchActions.onSearchSubmit,
    onClearSearch: searchActions.clearSearch,
    onGenerateSuggestions: searchActions.onGenerateSuggestions,
    onKeyDown: searchActions.handleKeyDown,
    onCloseSuggestions: searchActions.closeSuggestions,
    onSelectedIndexChange: searchActions.onSelectedIndexChange,
  }), [searchActions]);

  const clearGraphSelection = useCallback((options) => {
    graphClearRef.current?.(options);
  }, []);

  const centerSelection = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy) return;

    const { TOP_BAR_HEIGHT, TOOLTIP_SIDEBAR_WIDTH, FOCUS_PAN_MS } = GRAPH_LAYOUT_CONSTANTS;
    const chapterSidebarWidth = sidebarLayoutWidth;
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - TOOLTIP_SIDEBAR_WIDTH;
    const availableGraphHeight = window.innerHeight - TOP_BAR_HEIGHT;

    centerSelectionOnElementId(cy, elementId, {
      duration: FOCUS_PAN_MS,
      panTarget: {
        x: chapterSidebarWidth + (availableGraphWidth / 2) - availableGraphWidth * 0.14,
        y: TOP_BAR_HEIGHT + (availableGraphHeight / 2) - availableGraphHeight * 0.06,
      },
    });
  }, [sidebarLayoutWidth]);

  const onClearTooltip = useCallback(() => {
    closeSidebar();
    fitGraphToNodes(cyRef.current, { duration: 500 });
  }, [closeSidebar]);

  const dismissTooltip = useCallback(() => {
    clearGraphSelection({ fitViewport: true });
    startClosing();
  }, [clearGraphSelection, startClosing]);

  const onBeforeOpenTooltip = useCallback(() => {
    cancelClosing();
  }, [cancelClosing]);

  const hasOpenTooltip = !!(activeTooltip && !isSidebarClosing);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useGraphTooltipSelection({
    activeTooltip,
    onSetActiveTooltip: setActiveTooltip,
    onBeforeOpen: onBeforeOpenTooltip,
    centerSelection,
    focusDelayMs: GRAPH_LAYOUT_CONSTANTS.FOCUS_PAN_DELAY_MS,
    tooltipOpen: hasOpenTooltip,
    onDismiss: dismissTooltip,
    shouldIgnoreClick: shouldIgnoreGraphPageOutsideClick,
    blockDragEndEvents: true,
  });

  useEffect(() => {
    const chapterChanged =
      prevChapterNum.current !== undefined && prevChapterNum.current !== currentChapter;
    const eventChanged =
      prevEventNum.current !== undefined && prevEventNum.current !== currentEvent;

    if (chapterChanged || eventChanged) {
      if (chapterChanged && searchState.isSearchActive) clearSearch();
      clearGraphSelection({ fitViewport: false });
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
      setCurrentEvent(Number.isFinite(normalized) && normalized >= 1 ? normalized : 1);
    };

    // 선택(노드/간선·툴팁)이 있으면 먼저 해제한 뒤 챕터 전환
    const hadTooltip = Boolean(activeTooltip);
    clearGraphSelection({ fitViewport: false });

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
    manifestData?.chapters,
    serverBookId,
    clearGraphSelection,
    startClosing,
  ]);

  const handleSelectRelatedNode = useCallback((idOrName) => {
    cancelClosing();
    return graphSelectNodeRef.current?.(idOrName) ?? false;
  }, [cancelClosing]);

  const handleOpenChapterSidebar = useCallback(() => {
    if (!isSidebarOpen) setSidebarOpen(true);
  }, [isSidebarOpen, setSidebarOpen]);

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
    }, 320);
    return () => window.clearTimeout(id);
  }, [sidebarLayoutWidth]);

  const isApiGraphEmpty = !isGraphLoading && !hasGraphPayload(apiBookGraphData);

  useEffect(() => {
    if (!isGraphLoading) setHasShownGraphOnce(true);
  }, [isGraphLoading]);

  return (
    <div style={pageRootStyle}>
      {apiError && <ErrorToast error={apiError} onClose={clearApiError} />}
      {isApiGraphEmpty && (
        <div style={emptyGraphBannerStyle}>
          선택한 챕터에 표시할 그래프 데이터가 없습니다.
        </div>
      )}

      <GraphTopBar
        isSidebarOpen={isSidebarOpen}
        sidebarLayoutWidth={sidebarLayoutWidth}
        searchState={searchState}
        searchActions={topBarSearchActions}
        edgeLabelVisible={edgeLabelVisible}
        onToggleEdgeLabel={toggleEdgeLabel}
        filterStage={filterStage}
        onFilterChange={setFilterStage}
      />

      <div style={backButtonContainerStyle}>
        <button
          type="button"
          onClick={handleBackToViewer}
          style={backButtonStyle}
          aria-label="뷰어로 돌아가기"
          {...graphBackButtonHandlers}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
          돌아가기
        </button>
      </div>

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
        apiBookGraphData={apiBookGraphData}
        bookId={serverBookId}
        isLoading={isGraphLoading}
        hasShownGraphOnce={hasShownGraphOnce}
        onCanvasClick={handleCanvasClick}
        currentChapter={currentChapter}
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
          isResetFromSearch: searchState.isResetFromSearch,
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
        onOpenChapterSidebar={handleOpenChapterSidebar}
      />
    </div>
  );
}

export default RelationGraphWrapper;

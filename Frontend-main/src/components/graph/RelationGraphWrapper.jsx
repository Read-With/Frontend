import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import GraphTopBar from "./GraphTopBar";
import ChapterSidebar from "./ChapterSidebar";
import GraphCanvas from "./GraphCanvas";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle, getWideLayout } from "../../utils/styles/graphStyles";
import { COLORS, ANIMATION_VALUES, createButtonStyle, createAdvancedButtonHandlers } from "../../utils/styles/styles.js";
import {
  GRAPH_LAYOUT_CONSTANTS,
  resolveChapterSidebarWidth,
  resolveChapterDisplayTitle as resolveSharedChapterDisplayTitle,
} from './graphShared';
import { errorUtils } from '../../utils/common/errorUtils';
import {
  useGraphSearch,
  useGraphState,
  useGraphElementPipeline,
} from '../../hooks/graph/useGraphViewHooks';
import { useApiGraphData } from '../../hooks/graph/useApiGraphData';
import { useLocalStorageNumber } from '../../hooks/common/useLocalStorage.js';
import { resolveServerBookIdOrFallback } from '../../hooks/common/hooksShared';
import { convertRelationsToElements } from '../../utils/graph/graphDataUtils';
import { createCharacterMaps, buildNodeWeights, extractNodeWeightsFromElements } from '../../utils/graph/characterUtils';
import { getGraphEventState } from '../../utils/common/cache/chapterEventCache';
import {
  calculateLastEventForChapter,
  processTooltipData,
  buildTooltipPayload,
  createTooltipTapHandlers,
  isGraphNodeElement,
} from '../../utils/graph/graphUtils';
import { eventUtils } from '../../utils/viewer/viewerCoreStateUtils';
import {
  convertFineGraphToElements,
  hasFineGraphPayload,
  commitVisibleGraphElements,
} from '../../utils/viewer/viewerGraphUtils';
import { userViewerPath } from '../../utils/navigation/viewerPaths';
import {
  useGraphOutsideDismiss,
  isGraphDragEndEvent,
  shouldIgnoreGraphPageOutsideClick,
} from '../../hooks/graph/useGraphOutsideDismiss';
import { useChapterPovSummaries } from '../../hooks/graph/useChapterPovSummaries';
import {
  getChapterData,
  findManifestEventInChapter,
} from '../../utils/common/cache/manifestCache.js';

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

function ErrorToast({ error, onClose, duration = 5000 }) {
  useEffect(() => {
    if (error && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [error, duration, onClose]);

  if (!error) return null;

  const userFriendlyMessage = errorUtils.getUserFriendlyMessage(error);

  return (
    <div className="graph-error-toast" role="alert" aria-live="assertive">
      <span className="material-symbols-outlined graph-error-toast__icon">
        error
      </span>
      <div className="graph-error-toast__body">
        <div className="graph-error-toast__title">오류 발생</div>
        <div className="graph-error-toast__message">{userFriendlyMessage}</div>
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

  const isBookId = !isNaN(filename) && filename.length > 0;
  const bookId = isBookId ? parseInt(filename) : null;
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

  const appliedRequestedChapterRef = useRef(null);
  useEffect(() => {
    if (!Number.isFinite(requestedChapterFromViewer) || requestedChapterFromViewer < 1) {
      return;
    }
    if (appliedRequestedChapterRef.current === requestedChapterFromViewer) {
      return;
    }
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
    setIsSidebarClosing,
    toggleSidebar,
    toggleEdgeLabel,
    startClosing,
    closeSidebar,
    setFilterStage,
  } = useGraphState();

  const {
    manifestData,
    manifestReady,
    apiBookGraphData,
    apiMaxChapter,
    userCurrentChapter,
    isGraphLoading,
    apiError,
    clearError: clearApiError,
  } = useApiGraphData(serverBookId, currentChapter);

  const { povSummaries } = useChapterPovSummaries(
    serverBookId,
    currentChapter
  );

  const cyRef = useRef(null);
  const graphClearRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const viewBeforeSelectionRef = useRef(null);
  const prevChapterNum = useRef(currentChapter);
  const prevEventNum = useRef();

  const locationRef = useRef({
    state: location.state,
    pathname: location.pathname,
  });
  useEffect(() => {
    locationRef.current = {
      state: location.state,
      pathname: location.pathname,
    };
  }, [location.state, location.pathname]);

  const handleBackToViewer = useCallback(() => {
    const { state, pathname } = locationRef.current;
    const nextState = {
      ...(state || {}),
      from: state?.from ? { ...state.from, search: '' } : { pathname, search: '' },
    };

    const baseBook = book || state?.book;
    const sid =
      serverBookId != null && Number.isFinite(Number(serverBookId)) && Number(serverBookId) > 0
        ? Number(serverBookId)
        : null;
    if (baseBook || sid) {
      nextState.book = {
        ...(baseBook || {}),
        ...(sid ? { id: sid, _bookId: sid } : {}),
      };
    }

    navigate(userViewerPath(filename), {
      state: nextState,
      replace: false,
    });
  }, [navigate, filename, book, serverBookId]);

  const currentChapterData = useMemo(
    () => ({
      characters: Array.isArray(apiBookGraphData?.characters)
        ? apiBookGraphData.characters
        : [],
    }),
    [apiBookGraphData],
  );

  const manifestBookTitleStr = useMemo(
    () => String(manifestData?.book?.title ?? '').trim(),
    [manifestData?.book?.title],
  );

  const resolveChapterDisplayTitle = useCallback(
    (chapterNum) =>
      resolveSharedChapterDisplayTitle(
        serverBookId,
        chapterNum,
        manifestBookTitleStr,
        manifestData,
      ),
    [serverBookId, manifestData, manifestBookTitleStr],
  );

  const currentChapterTitle = useMemo(
    () => resolveChapterDisplayTitle(currentChapter),
    [resolveChapterDisplayTitle, currentChapter],
  );

  const userReadingChapterTitle = useMemo(() => {
    if (userCurrentChapter == null) return '';
    return resolveChapterDisplayTitle(userCurrentChapter);
  }, [resolveChapterDisplayTitle, userCurrentChapter]);

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
    const chData = getChapterData(serverBookId, ch, manifestData);
    const firstEv = Array.isArray(chData?.events) ? chData.events[0] : null;
    const next = eventUtils.resolveEventNum(firstEv) || 1;
    if (!(next > 0) || next === currentEvent) return;
    if (findManifestEventInChapter(serverBookId, ch, { eventIdx: next }, manifestData)) {
      setCurrentEvent(next);
    }
  }, [serverBookId, manifestReady, manifestData, currentChapter, currentEvent]);

  const graphApiPayload = useMemo(() => {
    if (!apiBookGraphData || !hasFineGraphPayload(apiBookGraphData)) return null;
    return apiBookGraphData;
  }, [apiBookGraphData]);

  const apiElements = useMemo(() => {
    if (!graphApiPayload) return [];

    try {
      const previousEventState =
        serverBookId && currentEvent > 1
          ? getGraphEventState(serverBookId, currentChapter, currentEvent - 1)
          : null;
      const previousNodeWeights = extractNodeWeightsFromElements(previousEventState?.elements);

      return convertFineGraphToElements(
        graphApiPayload,
        currentChapter,
        currentEvent,
        { createCharacterMaps, buildNodeWeights, convertRelationsToElements },
        previousNodeWeights
      ).elements;
    } catch {
      return [];
    }
  }, [graphApiPayload, serverBookId, currentChapter, currentEvent]);

  const [elements, setElements] = useState([]);
  const profileApplyTokenRef = useRef(0);

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

  const { searchState: graphSearchState, searchActions } = useGraphSearch(
    elements,
    currentChapterData,
  );
  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    isResetFromSearch,
    suggestions,
    showSuggestions,
    selectedIndex,
  } = graphSearchState;
  const {
    onSearchSubmit: handleSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions: setSearchTerm,
    handleKeyDown,
    onSelectedIndexChange,
  } = searchActions;

  const centerElementBetweenSidebars = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy) return;

    const element = cy.getElementById(elementId);
    if (!element.length) return;

    const { TOP_BAR_HEIGHT, TOOLTIP_SIDEBAR_WIDTH } = GRAPH_LAYOUT_CONSTANTS;
    const chapterSidebarWidth = resolveChapterSidebarWidth(isSidebarOpen);
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - TOOLTIP_SIDEBAR_WIDTH;
    const availableGraphHeight = window.innerHeight - TOP_BAR_HEIGHT;

    const leftOffset = availableGraphWidth * 0.14;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;

    const topOffset = availableGraphHeight * 0.06;
    const centerY = TOP_BAR_HEIGHT + (availableGraphHeight / 2) - topOffset;

    const elementPos = element.position();
    const targetX = centerX - elementPos.x;
    const targetY = centerY - elementPos.y;

    cy.animate({
      pan: { x: targetX, y: targetY },
      duration: 500,
      easing: 'ease-in'
    });
  }, [isSidebarOpen]);

  const openElementTooltip = useCallback((tapPayload, type) => {
    setIsSidebarClosing(false);
    const cy = cyRef.current;
    if (cy) viewBeforeSelectionRef.current = { pan: { ...cy.pan() }, zoom: cy.zoom() };

    const processedTooltipData = processTooltipData(buildTooltipPayload(tapPayload, type), type);
    setActiveTooltip(processedTooltipData);
  }, [setIsSidebarClosing, setActiveTooltip]);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useMemo(
    () => createTooltipTapHandlers(openElementTooltip),
    [openElementTooltip],
  );

  const onClearTooltip = useCallback(() => {
    closeSidebar();
    const stored = viewBeforeSelectionRef.current;
    const cy = cyRef.current;
    if (stored && cy) {
      viewBeforeSelectionRef.current = null;
      cy.animate({
        pan: stored.pan,
        zoom: stored.zoom,
      }, { duration: 500, easing: 'ease-in' });
    }
  }, [closeSidebar]);

  const clearGraphSelection = useCallback(() => {
    graphClearRef.current?.();
  }, []);

  useEffect(() => {
    const chapterChanged =
      prevChapterNum.current !== undefined && prevChapterNum.current !== currentChapter;
    const eventChanged =
      prevEventNum.current !== undefined && prevEventNum.current !== currentEvent;

    if (chapterChanged) {
      if (isSearchActive) clearSearch();
      clearGraphSelection();
    } else if (eventChanged) {
      clearGraphSelection();
    }

    prevChapterNum.current = currentChapter;
    prevEventNum.current = currentEvent;
  }, [currentChapter, currentEvent, isSearchActive, clearSearch, clearGraphSelection]);

  const { filteredMainCharacters, finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive,
    filteredElements,
  });

  const nodeCount = useMemo(() => {
    const source = filterStage > 0 ? filteredMainCharacters : elements;
    return source.filter(isGraphNodeElement).length;
  }, [filterStage, filteredMainCharacters, elements]);

  const relationCount = useMemo(() => {
    const source = filterStage > 0 ? filteredMainCharacters : elements;
    return eventUtils.filterEdges(source).length;
  }, [filterStage, filteredMainCharacters, elements]);

  const edgeStyle = getEdgeStyle('graph');
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );
  const layout = useMemo(() => getWideLayout(), []);

  useEffect(() => {
    if (activeTooltip && cyRef.current && !isSidebarClosing) {
      const elementId = activeTooltip.id;

      const timeoutId = setTimeout(() => {
        centerElementBetweenSidebars(elementId);
      }, GRAPH_LAYOUT_CONSTANTS.ANIMATION_MS + 100);

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [activeTooltip, isSidebarOpen, isSidebarClosing, centerElementBetweenSidebars]);

  const handleChapterSelect = useCallback((chapter) => {
    if (chapter !== currentChapter) {
      clearGraphSelection();
      setCurrentChapter(chapter);

      const lastEventNum = calculateLastEventForChapter({
        manifestChapters: manifestData?.chapters,
        manifestBookId: serverBookId,
        chapter,
      });

      const normalizedLastEventNum = Number.isFinite(Number(lastEventNum)) && Number(lastEventNum) >= 1
        ? Number(lastEventNum)
        : 1;
      setCurrentEvent(normalizedLastEventNum);
    }
  }, [
    currentChapter,
    setCurrentChapter,
    manifestData?.chapters,
    serverBookId,
    clearGraphSelection,
    setCurrentEvent,
  ]);

  const dismissActiveTooltip = useCallback(() => {
    clearGraphSelection();
    startClosing();
  }, [clearGraphSelection, startClosing]);

  const handleCanvasClick = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    if (isGraphDragEndEvent(e)) return;

    if (activeTooltip && !isSidebarClosing) {
      dismissActiveTooltip();
    }
  }, [activeTooltip, isSidebarClosing, dismissActiveTooltip]);

  useGraphOutsideDismiss({
    enabled: !!(activeTooltip && !isSidebarClosing),
    onDismiss: dismissActiveTooltip,
    shouldIgnoreClick: shouldIgnoreGraphPageOutsideClick,
    blockDragEndEvents: true,
  });

  const chapterList = useMemo(() =>
    Array.from({ length: apiMaxChapter }, (_, i) => i + 1),
    [apiMaxChapter]
  );

  const isLoading = isGraphLoading;
  const isApiGraphEmpty = useMemo(() => {
    if (isLoading) return false;
    const chars = Array.isArray(graphApiPayload?.characters) ? graphApiPayload.characters.length : 0;
    const rels = Array.isArray(graphApiPayload?.relations) ? graphApiPayload.relations.length : 0;
    return chars === 0 && rels === 0;
  }, [isLoading, graphApiPayload]);

  useEffect(() => {
    if (!isLoading) {
      setHasShownGraphOnce(true);
    }
  }, [isLoading]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLORS.backgroundLighter, overflow: 'hidden' }}>
      {apiError && (
        <ErrorToast
          error={apiError}
          onClose={clearApiError}
        />
      )}
      {isApiGraphEmpty && (
        <div
          style={{
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
          }}
        >
          선택한 챕터에 표시할 그래프 데이터가 없습니다.
        </div>
      )}

      <GraphTopBar
        isSidebarOpen={isSidebarOpen}
        searchState={{
          searchTerm,
          isSearchActive,
          suggestions,
          showSuggestions,
          selectedIndex,
        }}
        searchActions={{
          onSearchSubmit: handleSearchSubmit,
          onClearSearch: clearSearch,
          onGenerateSuggestions: setSearchTerm,
          onKeyDown: handleKeyDown,
          onCloseSuggestions: closeSuggestions,
          onSelectedIndexChange,
        }}
        edgeLabelVisible={edgeLabelVisible}
        onToggleEdgeLabel={toggleEdgeLabel}
        filterStage={filterStage}
        onFilterChange={setFilterStage}
      />

      <div style={backButtonContainerStyle}>
        <button
          type="button"
          onClick={handleBackToViewer}
          style={{
            ...createButtonStyle(ANIMATION_VALUES, 'default'),
            ...backButtonStyle,
          }}
          aria-label="뷰어로 돌아가기"
          {...graphBackButtonHandlers}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
            close
          </span>
          돌아가기
        </button>
      </div>

      <ChapterSidebar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
        chapterList={chapterList}
        currentChapter={currentChapter}
        onChapterSelect={handleChapterSelect}
        manifestBookId={serverBookId != null ? serverBookId : null}
        manifestHint={manifestData}
      />

      <GraphCanvas
        isSidebarOpen={isSidebarOpen}
        activeTooltip={activeTooltip}
        cyRef={cyRef}
        chapterNum={currentChapter}
        currentChapterTitle={currentChapterTitle}
        userReadingChapterTitle={userReadingChapterTitle}
        eventNum={Math.max(currentEvent, 1)}
        filename={filename}
        elements={elements}
        renderElements={finalElements}
        povSummaries={povSummaries}
        apiBookGraphData={apiBookGraphData}
        bookId={serverBookId}
        isLoading={isLoading}
        hasShownGraphOnce={hasShownGraphOnce}
        onCanvasClick={handleCanvasClick}
        currentChapter={currentChapter}
        userCurrentChapter={userCurrentChapter}
        nodeCount={nodeCount}
        relationCount={relationCount}
        filterStage={filterStage}
        sidebarControl={{
          isSidebarClosing,
          onCloseSidebar: closeSidebar,
          onStartClosing: startClosing,
          onClearGraph: clearGraphSelection,
        }}
        searchState={{
          isSearchActive,
          filteredElements,
          searchTerm,
          fitNodeIds,
          isResetFromSearch,
        }}
        cytoscapeConfig={{
          stylesheet,
          layout,
        }}
        tooltipHandlers={{
          onShowNodeTooltip,
          onShowEdgeTooltip,
          onClearTooltip,
          selectedNodeIdRef,
          selectedEdgeIdRef,
        }}
        graphClearRef={graphClearRef}
      />
    </div>
  );
}

export default RelationGraphWrapper;

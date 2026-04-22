import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import GraphTopBar from "./GraphTopBar";
import ChapterSidebar from "./ChapterSidebar";
import GraphCanvas from "./GraphCanvas";
import ErrorToast from "../common/ErrorToast";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle, getWideLayout } from "../../utils/styles/graphStyles";
import { COLORS, ANIMATION_VALUES, createButtonStyle, createAdvancedButtonHandlers } from "../../utils/styles/styles.js";
import { GRAPH_LAYOUT_CONSTANTS } from './graphConstants.js';
import { useGraphSearch } from '../../hooks/graph/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/graph/useGraphDataLoader.js';
import { useApiGraphData } from '../../hooks/graph/useApiGraphData.js';
import { useGraphState } from '../../hooks/graph/useGraphState.js';
import { useLocalStorageNumber } from '../../hooks/common/useLocalStorage.js';
import { convertRelationsToElements } from '../../utils/graph/graphDataUtils';
import { createCharacterMaps, buildNodeWeights } from '../../utils/graph/characterUtils';
import {
  processTooltipData,
  calculateLastEventForChapter,
  isSidebarElement,
  isDragEndEvent,
  calculateNodeCount,
  calculateRelationCount,
} from '../../utils/graph/graphUtils.js';
import { eventUtils, graphDataTransformUtils, getServerBookId } from '../../utils/viewer/viewerUtils';
import { userViewerPath } from '../../utils/navigation/viewerPaths';
import useGraphInteractions from "../../hooks/graph/useGraphInteractions";
import { useGraphElementPipeline } from "../../hooks/graph/useGraphElementPipeline";
import { useChapterPovSummaries } from '../../hooks/viewer/useChapterPovSummaries';
import {
  getChapterData,
  isValidEvent,
  resolveLastEventIdxForFineGraph,
} from '../../utils/common/cache/manifestCache.js';
import { stripRedundantBookTitlePrefix } from '../../utils/viewer/chapterTitleDisplay';

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

const getEdgeStyleForGraph = () => getEdgeStyle('graph');
const graphBackButtonHandlers = createAdvancedButtonHandlers('default');

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
  const [forcedChapterEventIdx, setForcedChapterEventIdx] = useState(null);
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

  const serverBookId = useMemo(() => {
    return getServerBookId(book) || bookId || null;
  }, [book?.id, book?._bookId, bookId]);

  const {
    isSidebarOpen,
    edgeLabelVisible,
    activeTooltip,
    isSidebarClosing,
    forceClose,
    filterStage,
    isDropdownSelection,
    setActiveTooltip,
    setForceClose,
    setIsSidebarClosing,
    toggleSidebar,
    toggleEdgeLabel,
    clearTooltip: _clearTooltip,
    startClosing,
    closeSidebar,
    setFilterStage,
    setDropdownSelection,
  } = useGraphState();

  const {
    manifestData,
    manifestReady,
    apiMacroData,
    apiFineData,
    apiMaxChapter,
    userCurrentChapter,
    isGraphLoading,
    apiFineLoading,
    apiError,
    clearError: clearApiError,
  } = useApiGraphData(
    serverBookId,
    currentChapter,
    currentEvent,
    forcedChapterEventIdx,
    { macroOnly: true },
  );

  const { povSummaries } = useChapterPovSummaries(
    serverBookId,
    currentChapter
  );

  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const viewBeforeSelectionRef = useRef(null);
  const prevChapterNum = useRef(currentChapter);
  const prevEventNum = useRef();
  const timeoutRef = useRef(null);

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

  const loaderBookKey = useMemo(() => serverBookId ?? bookId ?? null, [serverBookId, bookId]);

  const loaderEventIdx = useMemo(() => {
    return Number.isFinite(currentEvent) && currentEvent > 0 ? currentEvent : null;
  }, [currentEvent]);

  const {
    currentChapterData,
  } = useGraphDataLoader(loaderBookKey, currentChapter, loaderEventIdx);
  const newNodeIds = [];

  const effectiveMaxChapter = apiMaxChapter;

  const manifestBookTitleStr = useMemo(
    () => String(manifestData?.book?.title ?? '').trim(),
    [manifestData?.book?.title],
  );

  const resolveChapterDisplayTitle = useCallback(
    (chapterNum) => {
      if (serverBookId == null || !manifestData) return '';
      const n = Number(chapterNum);
      if (!Number.isFinite(n) || n < 1) return '';
      const ch = getChapterData(serverBookId, n, manifestData);
      const raw = String(ch?.title ?? '').trim();
      if (!raw) return '';
      const stripped = stripRedundantBookTitlePrefix(raw, manifestBookTitleStr).trim();
      return stripped || raw;
    },
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
    if (effectiveMaxChapter > 0 && currentChapter > effectiveMaxChapter) {
      setCurrentChapter(effectiveMaxChapter);
    }
  }, [manifestReady, effectiveMaxChapter, currentChapter, setCurrentChapter]);

  useEffect(() => {
    if (serverBookId == null || !manifestReady) return;
    const ch = Number(currentChapter);
    if (!Number.isFinite(ch) || ch < 1) return;
    if (isValidEvent(serverBookId, ch, currentEvent, manifestData)) return;
    const next = resolveLastEventIdxForFineGraph(serverBookId, ch, manifestData);
    if (next == null || next === currentEvent) return;
    if (isValidEvent(serverBookId, ch, next, manifestData)) {
      setCurrentEvent(next);
    }
  }, [serverBookId, manifestReady, manifestData, currentChapter, currentEvent]);

  useEffect(() => {
    const forced = Number(forcedChapterEventIdx);
    if (!Number.isFinite(forced) || forced < 1) return;
    if (currentEvent !== forced) {
      setCurrentEvent(forced);
    }
  }, [forcedChapterEventIdx, currentEvent]);

  useEffect(() => {
    const forced = Number(forcedChapterEventIdx);
    if (!Number.isFinite(forced) || forced < 1 || !apiFineData) return;
    const applied = graphDataTransformUtils.normalizeApiEvent(apiFineData?.event)?.eventNum;
    if (Number.isFinite(applied) && applied === forced) {
      setForcedChapterEventIdx(null);
    }
  }, [forcedChapterEventIdx, apiFineData]);

  const graphApiPayload = useMemo(() => {
    const fineChars = Array.isArray(apiFineData?.characters) ? apiFineData.characters : [];
    const fineRels = Array.isArray(apiFineData?.relations) ? apiFineData.relations : [];
    if (fineChars.length > 0 || fineRels.length > 0) {
      return apiFineData;
    }
    return null;
  }, [apiFineData]);

  const apiElements = useMemo(() => {
    if (!graphApiPayload) return [];

    const fineChars = Array.isArray(graphApiPayload.characters) ? graphApiPayload.characters : [];
    const fineRels = Array.isArray(graphApiPayload.relations) ? graphApiPayload.relations : [];
    if (fineChars.length === 0 && fineRels.length === 0) {
      return [];
    }

    try {
      const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = createCharacterMaps(fineChars);

      const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(graphApiPayload.event);
      const nodeWeights = buildNodeWeights(fineChars);

      const convertedElements = convertRelationsToElements(
        fineRels,
        idToName,
        idToDesc,
        idToDescKo,
        idToMain,
        idToNames,
        'api',
        Object.keys(nodeWeights).length > 0 ? nodeWeights : null,
        null,
        normalizedEvent,
        idToProfileImage,
        fineChars.length > 0 ? fineChars : null
      );

      return convertedElements;
    } catch {
      return [];
    }
  }, [graphApiPayload]);

  const elements = useMemo(() => (apiElements.length > 0 ? apiElements : []), [apiElements]);

  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    isResetFromSearch,
    suggestions,
    showSuggestions,
    selectedIndex,
    handleKeyDown,
    closeSuggestions,
    handleSearchSubmit,
    clearSearch,
    setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  const handleGenerateSuggestions = useCallback((searchTerm) => {
    setSearchTerm(searchTerm);
  }, [setSearchTerm]);

  const centerElementBetweenSidebars = useCallback((elementId) => {
    const cy = cyRef.current;
    if (!cy) return;

    const element = cy.getElementById(elementId);
    if (!element.length) return;

    const { TOP_BAR_HEIGHT, TOOLTIP_SIDEBAR_WIDTH, SIDEBAR } = GRAPH_LAYOUT_CONSTANTS;
    const chapterSidebarWidth = isSidebarOpen ? SIDEBAR.OPEN_WIDTH : SIDEBAR.CLOSED_WIDTH;
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - TOOLTIP_SIDEBAR_WIDTH;
    const availableGraphHeight = window.innerHeight - TOP_BAR_HEIGHT;

    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;

    const topOffset = availableGraphHeight * 0.15;
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

  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    setForceClose(false);
    setIsSidebarClosing(false);
    const cy = cyRef.current;
    if (cy) viewBeforeSelectionRef.current = { pan: { ...cy.pan() }, zoom: cy.zoom() };
    const nodeData = node.data();

    const tooltipData = {
      type: 'node',
      id: node.id(),
      x: mouseX,
      y: mouseY,
      data: nodeData,
      nodeCenter
    };

    const processedTooltipData = processTooltipData(tooltipData, 'node');
    setActiveTooltip(processedTooltipData);
    centerElementBetweenSidebars(node.id(), 'node');
  }, [setForceClose, setIsSidebarClosing, setActiveTooltip, centerElementBetweenSidebars]);

  const onShowEdgeTooltip = useCallback(({ edge, edgeCenter, mouseX, mouseY }) => {
    setForceClose(false);
    setIsSidebarClosing(false);
    const cy = cyRef.current;
    if (cy) viewBeforeSelectionRef.current = { pan: { ...cy.pan() }, zoom: cy.zoom() };
    const edgeData = edge.data();

    const finalX = mouseX !== undefined ? mouseX : edgeCenter?.x || 0;
    const finalY = mouseY !== undefined ? mouseY : edgeCenter?.y || 0;

    const tooltipData = {
      type: 'edge',
      id: edge.id(),
      x: finalX,
      y: finalY,
      data: edgeData,
      sourceNode: edge.source(),
      targetNode: edge.target(),
      edgeCenter,
    };

    const processedTooltipData = processTooltipData(tooltipData, 'edge');

    setActiveTooltip(processedTooltipData);

    centerElementBetweenSidebars(edge.id());
  }, [setForceClose, setIsSidebarClosing, setActiveTooltip, centerElementBetweenSidebars]);

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

  const handleStartClosing = startClosing;

  const {
    clearAll,
  } = useGraphInteractions({
    cyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
  });

  const handleClearGraph = useCallback(() => {
    clearAll();
  }, [clearAll]);

  useEffect(() => {
    if (prevChapterNum.current !== undefined && prevChapterNum.current !== currentChapter) {
      if (isSearchActive) {
        clearSearch();
      }
      clearAll();
    }
    prevChapterNum.current = currentChapter;
    prevEventNum.current = currentEvent;
  }, [currentChapter, currentEvent, isSearchActive, clearSearch, clearAll]);

  useEffect(() => {
    if (prevEventNum.current !== undefined && prevEventNum.current !== currentEvent) {
      clearAll();
    }
  }, [currentEvent, clearAll]);

  const { sortedElements, filteredMainCharacters, finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive,
    filteredElements,
  });

  const nodeCount = useMemo(() => {
    return calculateNodeCount(elements, filterStage, filteredMainCharacters);
  }, [filterStage, filteredMainCharacters, elements]);

  const relationCount = useMemo(() => {
    return calculateRelationCount(elements, filterStage, filteredMainCharacters, eventUtils);
  }, [filterStage, filteredMainCharacters, elements]);

  const edgeStyle = getEdgeStyleForGraph();
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );
  const layout = useMemo(() => getWideLayout(), []);

  useEffect(() => {
    if (activeTooltip && cyRef.current && !isSidebarClosing) {
      const elementId = activeTooltip.id;

      const animationDuration = 700;
      const timeoutId = setTimeout(() => {
        centerElementBetweenSidebars(elementId);
      }, animationDuration + 100);

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [activeTooltip, isSidebarOpen, isSidebarClosing, centerElementBetweenSidebars]);

  const handleChapterSelect = useCallback((chapter) => {
    if (chapter !== currentChapter) {
      setDropdownSelection(true);
      clearAll();
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
    clearAll,
    setDropdownSelection,
    setCurrentEvent,
  ]);

  useEffect(() => {
    if (isDropdownSelection) {
      const timeoutId = setTimeout(() => {
        setDropdownSelection(false);
      }, 100);

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [isDropdownSelection, setDropdownSelection]);

  const triggerForceClose = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setForceClose(true);
      timeoutRef.current = null;
    }, 100);
  }, [setForceClose]);

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
  }, [navigate, filename, book, currentChapter, serverBookId]);

  const handleGlobalClick = useCallback((e) => {
    if (!activeTooltip || isSidebarClosing) return;
    if (isDragEndEvent(e)) return;
    if (isSidebarElement(e)) return;

    e.stopPropagation();
    clearAll();
    triggerForceClose();
  }, [activeTooltip, isSidebarClosing, clearAll, triggerForceClose]);

  const handleCanvasClick = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    if (isDragEndEvent(e)) return;

    if (activeTooltip && !isSidebarClosing) {
      clearAll();
      triggerForceClose();
    }
  }, [activeTooltip, isSidebarClosing, clearAll, triggerForceClose]);

  useEffect(() => {
    if (!activeTooltip || isSidebarClosing) return;

    const handleDocumentClick = (e) => {
      const graphCanvas = e.target.closest('.graph-canvas-area');
      if (graphCanvas) return;
      handleGlobalClick(e);
    };

    const handleDragEnd = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleDocumentClick, true);
      document.addEventListener('dragend', handleDragEnd, true);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('dragend', handleDragEnd, true);
    };
  }, [activeTooltip, isSidebarClosing, handleGlobalClick]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const chapterList = useMemo(() =>
    Array.from({ length: effectiveMaxChapter }, (_, i) => i + 1),
    [effectiveMaxChapter]
  );

  useEffect(() => {
    if (!serverBookId || !apiMacroData) return;
    console.log(
      `[Macro API] bookId=${serverBookId} ch=${currentChapter}`,
      apiMacroData,
    );
  }, [apiMacroData, serverBookId, currentChapter]);

  const isLoading = apiFineLoading || isGraphLoading;
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

  const topBarSearchState = useMemo(() => ({
    searchTerm,
    isSearchActive,
    suggestions,
    showSuggestions,
    selectedIndex,
  }), [searchTerm, isSearchActive, suggestions, showSuggestions, selectedIndex]);

  const topBarSearchActions = useMemo(() => ({
    onSearchSubmit: handleSearchSubmit,
    onClearSearch: clearSearch,
    onGenerateSuggestions: handleGenerateSuggestions,
    onKeyDown: handleKeyDown,
    onCloseSuggestions: closeSuggestions,
  }), [handleSearchSubmit, clearSearch, handleGenerateSuggestions, handleKeyDown, closeSuggestions]);

  const sidebarControl = useMemo(() => ({
    isSidebarClosing,
    onCloseSidebar: closeSidebar,
    onStartClosing: handleStartClosing,
    onClearGraph: handleClearGraph,
    forceClose,
  }), [isSidebarClosing, closeSidebar, handleStartClosing, handleClearGraph, forceClose]);

  const searchState = useMemo(() => ({
    isSearchActive,
    filteredElements,
    searchTerm,
    fitNodeIds,
    isResetFromSearch,
  }), [isSearchActive, filteredElements, searchTerm, fitNodeIds, isResetFromSearch]);

  const cytoscapeConfig = useMemo(() => ({
    stylesheet,
    layout,
    newNodeIds,
    isDropdownSelection,
  }), [stylesheet, layout, newNodeIds, isDropdownSelection]);

  const tooltipHandlers = useMemo(() => ({
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
  }), [onShowNodeTooltip, onShowEdgeTooltip, onClearTooltip]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLORS.backgroundLighter, overflow: 'hidden' }}>
      {apiError && (
        <ErrorToast
          error={apiError}
          onClose={clearApiError}
          duration={5000}
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
        searchState={topBarSearchState}
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
        maxChapter={effectiveMaxChapter}
        filename={filename}
        elements={elements}
        renderElements={finalElements}
        povSummaries={povSummaries}
        apiMacroData={apiMacroData}
        apiFineData={apiFineData}
        bookId={serverBookId}
        isLoading={isLoading}
        hasShownGraphOnce={hasShownGraphOnce}
        onCanvasClick={handleCanvasClick}
        currentChapter={currentChapter}
        currentEvent={currentEvent}
        userCurrentChapter={userCurrentChapter}
        nodeCount={nodeCount}
        relationCount={relationCount}
        filterStage={filterStage}
        sidebarControl={sidebarControl}
        searchState={searchState}
        cytoscapeConfig={cytoscapeConfig}
        tooltipHandlers={tooltipHandlers}
      />
    </div>
  );
}

export default RelationGraphWrapper;
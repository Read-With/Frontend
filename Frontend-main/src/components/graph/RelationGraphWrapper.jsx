import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import GraphTopBar from "./GraphTopBar";
import ChapterSidebar from "./ChapterSidebar";
import GraphInfoBar from "./GraphInfoBar";
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
import { convertRelationsToElements, filterMainCharacters } from '../../utils/graph/graphDataUtils';
import { createCharacterMaps, buildNodeWeights } from '../../utils/graph/characterUtils';
import { getFolderKeyFromFilename, getLastEventIndexForChapter } from '../../utils/graph/graphData';
import {
  processTooltipData,
  calculateLastEventForChapter,
  isSidebarElement,
  isDragEndEvent,
  sortElementsById,
  calculateNodeCount,
  calculateRelationCount,
  determineFinalElements
} from '../../utils/graph/graphUtils.js';
import { eventUtils, graphDataTransformUtils, getServerBookId } from '../../utils/viewer/viewerUtils';
import { userViewerPath } from '../../utils/navigation/viewerPaths';
import useGraphInteractions from "../../hooks/graph/useGraphInteractions";
import { useChapterPovSummaries } from '../../hooks/viewer/useChapterPovSummaries';

// ─── 백버튼 스타일 ────────────────────────────────────────────────────────────
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

  const [currentChapter, setCurrentChapter] = useLocalStorageNumber(
    `lastGraphChapter_${filename}`,
    1,
    { forceInitialValue: false }
  );
  const [currentEvent, setCurrentEvent] = useState(1);
  const [hasShownGraphOnce, setHasShownGraphOnce] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(requestedChapterFromViewer) || requestedChapterFromViewer < 1) {
      return;
    }
    if (requestedChapterFromViewer !== currentChapter) {
      setCurrentChapter(requestedChapterFromViewer);
      setCurrentEvent(1);
    }
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

  const isApiBook = useMemo(() => {
    return !!serverBookId || (book && book.isFromAPI === true);
  }, [serverBookId, book?.isFromAPI]);

  const {
    manifestData,
    apiMacroData,
    apiFineData,
    apiMaxChapter,
    userCurrentChapter,
    isGraphLoading,
    apiFineLoading,
    apiError,
    clearError: clearApiError,
  } = useApiGraphData(serverBookId, currentChapter, currentEvent, isApiBook);

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

  // ─── location 스냅샷: 3개 ref → 1개 ref로 통합 ──────────────────────────
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

  const loaderBookKey = useMemo(() => {
    if (isApiBook && serverBookId) {
      return serverBookId;
    }
    return filename || null;
  }, [isApiBook, serverBookId, filename]);

  const loaderEventIdx = useMemo(() => {
    return Number.isFinite(currentEvent) && currentEvent > 0 ? currentEvent : null;
  }, [currentEvent]);

  const {
    elements: localElements,
    newNodeIds,
    currentChapterData,
    eventNum,
    maxChapter,
    loading
  } = useGraphDataLoader(loaderBookKey, currentChapter, loaderEventIdx);

  const effectiveMaxChapter = isApiBook ? apiMaxChapter : maxChapter;

  useEffect(() => {
    if (effectiveMaxChapter > 0 && currentChapter > effectiveMaxChapter) {
      setCurrentChapter(effectiveMaxChapter);
    }
  }, [effectiveMaxChapter, currentChapter, setCurrentChapter]);

  const apiElements = useMemo(() => {
    if (!apiFineData?.characters || !apiFineData?.relations) {
      return [];
    }

    try {
      const { idToName, idToDesc, idToMain, idToNames, idToProfileImage } = createCharacterMaps(apiFineData.characters);

      const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(apiFineData.event, currentChapter, currentEvent);
      const nodeWeights = buildNodeWeights(apiFineData.characters);

      const convertedElements = convertRelationsToElements(
        apiFineData.relations,
        idToName,
        idToDesc,
        idToDesc,
        idToMain,
        idToNames,
        'api',
        Object.keys(nodeWeights).length > 0 ? nodeWeights : null,
        null,
        normalizedEvent,
        idToProfileImage
      );

      return convertedElements;
    } catch (error) {
      console.error('apiElements 변환 실패:', error);
      return [];
    }
  }, [apiFineData?.characters, apiFineData?.relations, apiFineData?.event, currentChapter, currentEvent]);

  const elements = useMemo(() => {
    return (isApiBook && apiElements.length > 0) ? apiElements : localElements;
  }, [isApiBook, apiElements, localElements]);

  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    isResetFromSearch,
    suggestions,
    showSuggestions,
    selectedIndex,
    selectSuggestion,
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
    isSearchActive,
    filteredElements,
  });

  const handleClearGraph = useCallback(() => {
    clearAll();
  }, [clearAll]);

  // 챕터 변경 시 검색 초기화 및 선택 효과 제거
  useEffect(() => {
    if (prevChapterNum.current !== undefined && prevChapterNum.current !== currentChapter) {
      if (isSearchActive) {
        clearSearch();
      }
      clearAll();
    }
    prevChapterNum.current = currentChapter;
    prevEventNum.current = eventNum;
  }, [currentChapter, eventNum, isSearchActive, clearSearch, clearAll]);

  // 이벤트 변경 시 선택 효과 제거
  useEffect(() => {
    if (prevEventNum.current !== undefined && prevEventNum.current !== eventNum) {
      clearAll();
    }
  }, [eventNum, clearAll]);

  const sortedElements = useMemo(() => {
    return sortElementsById(elements);
  }, [elements]);

  const filteredMainCharacters = useMemo(() => {
    return filterMainCharacters(elements, filterStage);
  }, [elements, filterStage]);

  const nodeCount = useMemo(() => {
    return calculateNodeCount(elements, filterStage, filteredMainCharacters);
  }, [filterStage, filteredMainCharacters, elements]);

  const relationCount = useMemo(() => {
    return calculateRelationCount(elements, filterStage, filteredMainCharacters, eventUtils);
  }, [filterStage, filteredMainCharacters, elements]);

  const finalElements = useMemo(() => {
    return determineFinalElements(isSearchActive, filteredElements, sortedElements, filterStage, filteredMainCharacters);
  }, [isSearchActive, filteredElements, sortedElements, filterStage, filteredMainCharacters]);

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
        isApiBook,
        manifestChapters: manifestData?.chapters,
        chapter,
        filename,
        getFolderKeyFromFilename,
        getLastEventIndexForChapter
      });

      setCurrentEvent(lastEventNum);
    }
  }, [currentChapter, setCurrentChapter, isApiBook, manifestData?.chapters, filename, clearAll, setDropdownSelection, setCurrentEvent]);

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

  // ─── forceClose 트리거: 두 클릭 핸들러에서 공유 ──────────────────────────
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

  const isLoading = (isApiBook && (apiFineLoading || isGraphLoading)) || (!isApiBook && (loading || isGraphLoading));

  useEffect(() => {
    if (!isLoading) {
      setHasShownGraphOnce(true);
    }
  }, [isLoading]);

  // ─── GraphTopBar prop 그룹 ───────────────────────────────────────────────
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
    onSelectSuggestion: selectSuggestion,
    onKeyDown: handleKeyDown,
    onCloseSuggestions: closeSuggestions,
  }), [handleSearchSubmit, clearSearch, handleGenerateSuggestions, selectSuggestion, handleKeyDown, closeSuggestions]);

  // ─── GraphCanvas prop 그룹 ────────────────────────────────────────────────
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
      />

      <GraphCanvas
        isSidebarOpen={isSidebarOpen}
        activeTooltip={activeTooltip}
        cyRef={cyRef}
        chapterNum={currentChapter}
        eventNum={isApiBook ? Math.max(currentEvent, 1) : eventNum}
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
        isApiBook={isApiBook}
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

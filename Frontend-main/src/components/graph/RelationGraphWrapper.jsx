import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import GraphTopBar from "./GraphTopBar";
import ChapterSidebar from "./ChapterSidebar";
import GraphInfoBar from "./GraphInfoBar";
import EventControls from "./EventControls";
import BackButton from "./BackButton";
import GraphCanvas from "./GraphCanvas";
import ErrorToast from "../common/ErrorToast";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle, getWideLayout } from "../../utils/styles/graphStyles";
import { COLORS } from "../../utils/styles/styles.js";
import { useGraphSearch } from '../../hooks/graph/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/graph/useGraphDataLoader.js';
import { useApiGraphData } from '../../hooks/graph/useApiGraphData.js';
import { useGraphState } from '../../hooks/graph/useGraphState.js';
import { useLocalStorageNumber } from '../../hooks/common/useLocalStorage.js';
import { convertRelationsToElements, filterMainCharacters } from '../../utils/graph/graphDataUtils';
import { createCharacterMaps, buildNodeWeights } from '../../utils/characterUtils';
import { getFolderKeyFromFilename, getLastEventIndexForChapter } from '../../utils/graph/graphData';
import { 
  processTooltipData, 
  calculateLastEventForChapter,
  formatSearchParams,
  isSidebarElement,
  isDragEndEvent,
  sortElementsById,
  calculateNodeCount,
  calculateRelationCount,
  determineFinalElements
} from '../../utils/graph/graphUtils.js';
import { eventUtils, graphDataTransformUtils, getServerBookId } from '../../utils/viewerUtils';
import useGraphInteractions from "../../hooks/graph/useGraphInteractions";
import { useChapterPovSummaries } from '../../hooks/viewer/useChapterPovSummaries';

const getEdgeStyleForGraph = () => getEdgeStyle('graph');

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  
  const initialChapter = useMemo(() => {
    if (typeof window === 'undefined') {
      return 1;
    }
    try {
      const searchParams = new URLSearchParams(location.search || '');
      const chapterParam = Number(searchParams.get('chapter'));
      if (Number.isFinite(chapterParam) && chapterParam >= 1) {
        return Math.floor(chapterParam);
      }
    } catch (error) {
    }
    return 1;
  }, [location.search]);
  
  const isBookId = !isNaN(filename) && filename.length > 0;
  const bookId = isBookId ? parseInt(filename) : null;
  
  const [currentChapter, setCurrentChapter] = useLocalStorageNumber(
    `lastGraphChapter_${filename}`,
    initialChapter,
    { forceInitialValue: true }
  );
  const [currentEvent, setCurrentEvent] = useState(1);
  const [hasShownGraphOnce, setHasShownGraphOnce] = useState(false);

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
    clearTooltip,
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

    const topBarHeight = 54;
    const chapterSidebarWidth = isSidebarOpen ? 240 : 60;
    const tooltipSidebarWidth = 450;
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - tooltipSidebarWidth;
    const availableGraphHeight = window.innerHeight - topBarHeight;
    
    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;
    
    const topOffset = availableGraphHeight * 0.15;
    const centerY = topBarHeight + (availableGraphHeight / 2) - topOffset;
    
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

  const handleEventChange = useCallback((eventNum) => {
    clearAll();
    setCurrentEvent(eventNum);
  }, [clearAll, setCurrentEvent]);

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

  const locationStateRef = useRef(location.state);
  const locationPathnameRef = useRef(location.pathname);
  const locationSearchRef = useRef(location.search);
  
  useEffect(() => {
    locationStateRef.current = location.state;
    locationPathnameRef.current = location.pathname;
    locationSearchRef.current = location.search;
  }, [location.state, location.pathname, location.search]);

  const handleBackToViewer = useCallback(() => {
    const retainedSearch = locationStateRef.current?.viewerSearch || '';
    const nextSearch = formatSearchParams(retainedSearch);

    const nextState = {
      ...(locationStateRef.current || {}),
      from: (locationStateRef.current && locationStateRef.current.from) || { pathname: locationPathnameRef.current, search: locationSearchRef.current },
      fromGraph: true,
    };

    if (book || locationStateRef.current?.book) {
      nextState.book = book || locationStateRef.current?.book;
    }

    navigate(`/user/viewer/${filename}${nextSearch}`, {
      state: nextState,
      replace: false,
    });
  }, [navigate, filename, book]);


  const handleGlobalClick = useCallback((e) => {
    if (!activeTooltip || isSidebarClosing) return;
    if (isDragEndEvent(e)) return;
    if (isSidebarElement(e)) return;
    
    e.stopPropagation();
    clearAll();
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setForceClose(true);
      timeoutRef.current = null;
    }, 100);
  }, [activeTooltip, isSidebarClosing, clearAll, setForceClose]);

  const handleCanvasClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      if (isDragEndEvent(e)) return;
      
      if (activeTooltip && !isSidebarClosing) {
        clearAll();
        
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          setForceClose(true);
          timeoutRef.current = null;
        }, 100);
      }
    }
  }, [activeTooltip, isSidebarClosing, clearAll, setForceClose]);

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

  // 로딩 상태: 그래프 데이터 로딩 또는 챕터 리스트 준비 대기
  // 챕터 드롭다운이 표시되려면 effectiveMaxChapter가 준비되어야 함
  const isLoading = (isApiBook && (apiFineLoading || isGraphLoading)) || (!isApiBook && (loading || isGraphLoading));
  
  useEffect(() => {
    if (!isLoading) {
      setHasShownGraphOnce(true);
    }
  }, [isLoading]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLORS.backgroundLighter, overflow: 'hidden' }}>
      <style>
        {`
          @keyframes loadingProgress {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
          }
        `}
      </style>

      {apiError && (
        <ErrorToast
          error={apiError}
          onClose={clearApiError}
          duration={5000}
        />
      )}

      <GraphTopBar
        isSidebarOpen={isSidebarOpen}
        searchTerm={searchTerm}
        onSearchSubmit={handleSearchSubmit}
        onClearSearch={clearSearch}
        onGenerateSuggestions={handleGenerateSuggestions}
        suggestions={suggestions}
        showSuggestions={showSuggestions}
        selectedIndex={selectedIndex}
        onSelectSuggestion={selectSuggestion}
        onKeyDown={handleKeyDown}
        onCloseSuggestions={closeSuggestions}
        isSearchActive={isSearchActive}
        edgeLabelVisible={edgeLabelVisible}
        onToggleEdgeLabel={toggleEdgeLabel}
        filterStage={filterStage}
        onFilterChange={setFilterStage}
      />

      <BackButton onBack={handleBackToViewer} />

      {book?.isFromAPI && (
        <EventControls currentEvent={currentEvent} onEventChange={handleEventChange} />
      )}

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
        isSidebarClosing={isSidebarClosing}
        onCloseSidebar={closeSidebar}
        onStartClosing={handleStartClosing}
        onClearGraph={handleClearGraph}
        forceClose={forceClose}
        chapterNum={currentChapter}
        eventNum={isApiBook ? Math.max(currentEvent, 1) : eventNum}
        maxChapter={effectiveMaxChapter}
        filename={filename}
        elements={elements}
        isSearchActive={isSearchActive}
        filteredElements={filteredElements}
        searchTerm={searchTerm}
        povSummaries={povSummaries}
        apiMacroData={apiMacroData}
        apiFineData={apiFineData}
        bookId={serverBookId}
        finalElements={finalElements}
        newNodeIds={newNodeIds}
        stylesheet={stylesheet}
        layout={layout}
        cyRef={cyRef}
        fitNodeIds={fitNodeIds}
        onShowNodeTooltip={onShowNodeTooltip}
        onShowEdgeTooltip={onShowEdgeTooltip}
        onClearTooltip={onClearTooltip}
        selectedNodeIdRef={selectedNodeIdRef}
        selectedEdgeIdRef={selectedEdgeIdRef}
        isResetFromSearch={isResetFromSearch}
        isDropdownSelection={isDropdownSelection}
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
      />
    </div>
  );
}

export default RelationGraphWrapper;
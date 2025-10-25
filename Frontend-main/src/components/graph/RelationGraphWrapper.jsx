import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import GraphSidebar from "./tooltip/GraphSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle, getWideLayout } from "../../utils/styles/graphStyles";
import { ANIMATION_VALUES } from "../../utils/styles/animations";
import { sidebarStyles, topBarStyles, containerStyles, graphStyles, createButtonStyle, createAdvancedButtonHandlers, COLORS } from "../../utils/styles/styles.js";
import { useGraphSearch } from '../../hooks/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/useGraphDataLoader.js';
import { useLocalStorageNumber } from '../../hooks/useLocalStorage.js';
import { getMacroGraph, getChapterGraph } from '../../utils/api/graphApi.js';
import { convertRelationsToElements, filterMainCharacters } from '../../utils/graphDataUtils';
import { createCharacterMaps } from '../../utils/characterUtils';
import { createRippleEffect, ensureElementsInBounds, processTooltipData } from '../../utils/graphUtils.js';
import useGraphInteractions from "../../hooks/useGraphInteractions";
import { useChapterPovSummaries } from '../../hooks/useChapterPovSummaries';

// 노드 크기는 가중치 기반으로만 계산됨
const getEdgeStyleForGraph = () => getEdgeStyle('graph');

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  
  // bookId인지 filename인지 확인
  const isBookId = !isNaN(filename) && filename.length > 0;
  const bookId = isBookId ? parseInt(filename) : null;
  
  // 상태 관리 - 파일명별로 localStorage 키 구분
  const [currentChapter, setCurrentChapter] = useLocalStorageNumber(`lastGraphChapter_${filename}`, 1);
  const [currentEvent, setCurrentEvent] = useState(1);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  const [filterStage, setFilterStage] = useState(0);
  
  // API 그래프 데이터 상태
  const [apiMacroData, setApiMacroData] = useState(null);
  const [apiFineData, setApiFineData] = useState(null);
  const [apiFineLoading, setApiFineLoading] = useState(false);
  
  // 거시 그래프에서 관점 요약 가져오기 (1장 기준)
  const { povSummaries, loading: povLoading, error: povError } = useChapterPovSummaries(
    isBookId ? bookId : null, 
    1 // 거시 그래프에서는 1장 기준
  );
  
  // refs
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const prevChapterNum = useRef();
  const prevEventNum = useRef();
  const isMacroGraphLoadingRef = useRef(false);
  
  // API 책인지 확인 (bookId가 있거나 숫자 ID를 가진 책이거나 isFromAPI가 true인 경우)
  const isApiBook = isBookId || (book && (typeof book.id === 'number' || book.isFromAPI === true));
  
  // API 거시 그래프 데이터 로딩 (초기 로딩)
  useEffect(() => {
    const loadMacroGraphData = async () => {
      // bookId가 있는 경우 또는 API 책인 경우
      const targetBookId = bookId || (book && typeof book.id === 'number' ? book.id : null);
      
      if (!targetBookId) {
        setApiFineData(null);
        return;
      }
      
      // 이미 로딩 중이면 중복 호출 방지
      if (isMacroGraphLoadingRef.current) {
        console.log('⚠️ 거시 그래프 API 호출 중복 방지:', {
          targetBookId,
          isLoading: isMacroGraphLoadingRef.current,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      isMacroGraphLoadingRef.current = true;
      setApiFineLoading(true);
      try {
        // 거시 그래프는 맨 마지막 챕터의 데이터만 가져옴
        // 임시로 1을 사용 (실제로는 책의 최대 챕터 번호를 가져와야 함)
        console.log('🔍 거시 그래프 API 호출 시작:', {
          targetBookId,
          uptoChapter: 1,
          timestamp: new Date().toISOString()
        });
        
        const macroData = await getMacroGraph({
          bookId: targetBookId,
          uptoChapter: 1
        });
        
        console.log('✅ 거시 그래프 API 응답:', {
          isSuccess: macroData?.isSuccess,
          hasResult: !!macroData?.result,
          resultKeys: macroData?.result ? Object.keys(macroData.result) : [],
          charactersCount: macroData?.result?.characters?.length || 0,
          relationsCount: macroData?.result?.relations?.length || 0
        });
        
        setApiMacroData(macroData.result);
        setApiFineData(macroData.result);
        
      } catch (error) {
        console.error('❌ 거시 그래프 API 호출 실패:', {
          error: error.message,
          status: error.status,
          targetBookId,
          uptoChapter: 1,
          timestamp: new Date().toISOString()
        });
        
        // API 호출 실패 시 로컬 데이터 사용으로 폴백
        console.log('🔄 API 호출 실패, 로컬 데이터 사용으로 전환');
        setApiMacroData(null);
        setApiFineData(null);
      } finally {
        isMacroGraphLoadingRef.current = false;
        setApiFineLoading(false);
      }
    };

    loadMacroGraphData();
  }, [bookId, book?.id]);

  // 챕터 변경 시 API 데이터 로딩
  useEffect(() => {
    const loadChapterGraphData = async () => {
      // API 책인 경우에만 실행
      if (!isApiBook) return;
      
      const targetBookId = bookId || (book && typeof book.id === 'number' ? book.id : null);
      if (!targetBookId) return;
      
      setApiFineLoading(true);
      try {
        console.log('🔍 챕터 그래프 API 호출 시작:', {
          targetBookId,
          chapterIdx: currentChapter,
          timestamp: new Date().toISOString()
        });
        
        // 임시로 거시 그래프 API를 사용 (챕터별 엔드포인트가 구현되지 않은 경우)
        const chapterData = await getMacroGraph({
          bookId: targetBookId,
          uptoChapter: currentChapter
        });
        
        console.log('✅ 챕터 그래프 API 응답:', {
          isSuccess: chapterData?.isSuccess,
          hasResult: !!chapterData?.result,
          resultKeys: chapterData?.result ? Object.keys(chapterData.result) : [],
          charactersCount: chapterData?.result?.characters?.length || 0,
          relationsCount: chapterData?.result?.relations?.length || 0
        });
        
        setApiFineData(chapterData.result);
        
      } catch (error) {
        console.error('❌ 챕터 그래프 API 호출 실패:', {
          error: error.message,
          status: error.status,
          targetBookId,
          chapterIdx: currentChapter,
          timestamp: new Date().toISOString()
        });
        
        // API 호출 실패 시 로컬 데이터 사용으로 폴백
        console.log('🔄 챕터 그래프 API 호출 실패, 로컬 데이터 사용으로 전환');
        setApiFineData(null);
      } finally {
        setApiFineLoading(false);
      }
    };

    loadChapterGraphData();
  }, [currentChapter, isApiBook, bookId, book?.id]);

  // 데이터 로딩 - bookId가 있는 경우 또는 API 책이 아닌 경우에만 기존 로컬 데이터 사용
  const {
    elements: localElements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum,
    maxChapter,
    loading,
    error
  } = useGraphDataLoader(isApiBook ? null : filename, currentChapter);

  // currentChapter가 maxChapter를 초과하지 않도록 검증
  useEffect(() => {
    if (maxChapter > 0 && currentChapter > maxChapter) {
      setCurrentChapter(1); // 첫 번째 챕터로 리셋
    }
  }, [maxChapter, currentChapter, filename, setCurrentChapter]);
  
  // API 데이터를 그래프 요소로 변환
  const apiElements = useMemo(() => {
    if (!apiFineData?.characters || !apiFineData?.relations) {
      return [];
    }
    
    try {
      const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(apiFineData.characters);
      
      const convertedElements = convertRelationsToElements(
        apiFineData.relations,
        idToName,
        idToDesc,
        idToDesc, // idToDescKo (한국어 설명이 없으므로 idToDesc 사용)
        idToMain,
        idToNames,
        'api', // folderKey
        null, // nodeWeights
        null  // previousRelations
      );
      
      return convertedElements;
    } catch (error) {
      console.error('API 데이터 변환 실패:', error);
      return [];
    }
  }, [apiFineData]);
  
  // 사용할 elements 결정 (API 데이터 우선, 없으면 로컬 데이터)
  const elements = (isApiBook && apiElements.length > 0) ? apiElements : localElements;
  
  
  // API 책의 경우 이벤트 선택 핸들러
  const handleEventChange = useCallback((eventNum) => {
    setCurrentEvent(eventNum);
  }, []);
  
  // 검색 기능
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

  // 제안 생성을 위한 별도 함수
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    setSearchTerm(searchTerm);
  }, [setSearchTerm]);

  // 노드/간선 클릭 시 중앙 정렬 함수
  const centerElementBetweenSidebars = useCallback((elementId, elementType) => {
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
      duration: 800,
      easing: 'ease-out-cubic'
    });
  }, [isSidebarOpen]);

  // 특정 좌표를 기준으로 중앙 정렬하는 함수
  const centerElementAtPosition = useCallback((targetX, targetY) => {
    const cy = cyRef.current;
    if (!cy) return;

    const topBarHeight = 54;
    const chapterSidebarWidth = isSidebarOpen ? 240 : 60;
    const tooltipSidebarWidth = 450;
    const availableGraphWidth = window.innerWidth - chapterSidebarWidth - tooltipSidebarWidth;
    const availableGraphHeight = window.innerHeight - topBarHeight;
    
    const leftOffset = availableGraphWidth * 0.1;
    const centerX = chapterSidebarWidth + (availableGraphWidth / 2) - leftOffset;
    
    const topOffset = availableGraphHeight * 0.15;
    const centerY = topBarHeight + (availableGraphHeight / 2) - topOffset;
    
    const panX = centerX - targetX;
    const panY = centerY - targetY;
    
    cy.animate({
      pan: { x: panX, y: panY },
      duration: 800,
      easing: 'ease-out-cubic'
    });
  }, [isSidebarOpen]);

  // 툴팁 핸들러 - 유틸리티 함수 사용
  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
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
  }, [centerElementBetweenSidebars]);

  const onShowEdgeTooltip = useCallback(({ edge, absoluteX, absoluteY }) => {
    const edgeData = edge.data();
    
    const tooltipData = {
      type: 'edge',
      id: edge.id(),
      x: absoluteX,
      y: absoluteY,
      data: edgeData,
      sourceNode: edge.source(),
      targetNode: edge.target(),
    };
    
    const processedTooltipData = processTooltipData(tooltipData, 'edge');
    
    setActiveTooltip(processedTooltipData);
    
    const sourcePos = edge.source().position();
    const targetPos = edge.target().position();
    const edgeCenterX = (sourcePos.x + targetPos.x) / 2;
    const edgeCenterY = (sourcePos.y + targetPos.y) / 2;
    
    centerElementAtPosition(edgeCenterX, edgeCenterY);
  }, [centerElementBetweenSidebars, centerElementAtPosition]);

  const onClearTooltip = useCallback(() => {
    setForceClose(true);
  }, []);

  // 슬라이드바 애니메이션 시작 함수
  const handleStartClosing = useCallback(() => {
    setIsSidebarClosing(true);
  }, []);

  // 그래프 인터랙션 훅
  const {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
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

  // 그래프 초기화 함수
  const handleClearGraph = useCallback(() => {
    clearAll();
  }, [clearAll]);

  // elements 정렬 및 필터링
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  // 3단계 필터링 로직 - 유틸리티 함수 사용
  const filteredMainCharacters = useMemo(() => {
    return filterMainCharacters(elements, filterStage);
  }, [elements, filterStage]);

  const finalElements = useMemo(() => {
    if (isSearchActive && filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return sortedElements;
  }, [isSearchActive, filteredElements, sortedElements, filterStage, filteredMainCharacters]);

  // 그래프 스타일 및 레이아웃
  const edgeStyle = getEdgeStyleForGraph();
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );
  const layout = useMemo(() => getWideLayout(), []);

  // 로딩 상태 관리
  useEffect(() => {
    prevChapterNum.current = currentChapter;
    prevEventNum.current = eventNum;
  }, [currentChapter, eventNum]);

  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  // 사이드바 상태 변경 시 활성 요소 재중앙 정렬
  useEffect(() => {
    if (activeTooltip && cyRef.current && !isSidebarClosing) {
      const elementId = activeTooltip.id;
      const elementType = activeTooltip.type;
      
      const animationDuration = 700;
      setTimeout(() => {
        centerElementBetweenSidebars(elementId, elementType);
      }, animationDuration + 100);
    }
  }, [isSidebarOpen, centerElementBetweenSidebars]);

  // 이벤트 핸들러
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  // 드롭다운 선택 상태 관리
  const [isDropdownSelection, setIsDropdownSelection] = useState(false);

  const handleChapterSelect = useCallback((chapter) => {
    if (chapter !== currentChapter) {
      
      // 드롭다운 선택 상태 설정
      setIsDropdownSelection(true);
      
      setCurrentChapter(chapter);
      
      // 짧은 지연 후 드롭다운 선택 상태 해제
      setTimeout(() => {
        setIsDropdownSelection(false);
      }, 100);
    }
  }, [currentChapter, setCurrentChapter]);


  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible(prev => !prev);
  }, []);

  const handleBackToViewer = useCallback(() => {
    navigate(`/user/viewer/${filename}`);
  }, [navigate, filename]);


  // 뷰어로 돌아가기 버튼 전용 hover 핸들러 - 기존 createAdvancedButtonHandlers 활용
  const backButtonHandlers = createAdvancedButtonHandlers('default');

  // 슬라이드바 외부 영역 클릭 시 닫힘 핸들러
  const handleGlobalClick = useCallback((e) => {
    if (!activeTooltip || isSidebarClosing) return;
    
    // 드래그 후 클릭인지 확인
    const isDragEndEvent = e.detail && e.detail.type === 'dragend';
    if (isDragEndEvent) return;
    
    const sidebarElement = document.querySelector('[data-testid="graph-sidebar"]') || 
                          document.querySelector('.graph-sidebar') ||
                          e.target.closest('[data-testid="graph-sidebar"]') ||
                          e.target.closest('.graph-sidebar');
    
    if (sidebarElement && sidebarElement.contains(e.target)) {
      return;
    }
    
    e.stopPropagation();
    clearAll();
    setTimeout(() => {
      setForceClose(true);
    }, 100);
  }, [activeTooltip, isSidebarClosing, clearAll]);

  // 그래프 영역 클릭 핸들러
  const handleCanvasClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      
      // 드래그 후 클릭인지 확인
      const isDragEndEvent = e.detail && e.detail.type === 'dragend';
      if (isDragEndEvent) return;
      
      if (activeTooltip && !isSidebarClosing) {
        clearAll();
        setTimeout(() => {
          setForceClose(true);
        }, 100);
      }
    }
  }, [activeTooltip, isSidebarClosing, clearAll]);

  // 전역 클릭 이벤트 리스너 등록
  useEffect(() => {
    if (activeTooltip && !isSidebarClosing) {
      const handleDocumentClick = (e) => {
        const graphCanvas = e.target.closest('.graph-canvas-area');
        if (graphCanvas) return;
        
        handleGlobalClick(e);
      };

      const handleDragEnd = (e) => {
        // 드래그 완료 이벤트를 클릭 이벤트로 변환하지 않도록 처리
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
    }
  }, [activeTooltip, isSidebarClosing, handleGlobalClick]);

  // 챕터 목록 메모이제이션
  const chapterList = useMemo(() => 
    Array.from({ length: maxChapter }, (_, i) => i + 1), 
    [maxChapter]
  );

  // 로딩 상태 렌더링 (API 호출 중이거나 로컬 데이터 로딩 중)
  if ((isApiBook && apiFineLoading) || (!isApiBook && isGraphLoading)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: COLORS.backgroundLighter,
        padding: '20px',
        textAlign: 'center'
      }}>
        <div style={{
          fontSize: '48px',
          marginBottom: '16px',
          color: COLORS.primary,
          animation: 'spin 1s linear infinite'
        }}>
          ⏳
        </div>
        <h3 style={{
          color: COLORS.textPrimary,
          marginBottom: '12px',
          fontSize: '18px',
          fontWeight: '600'
        }}>
          그래프 정보를 불러오는 중...
        </h3>
        <p style={{
          color: COLORS.textSecondary,
          marginBottom: '20px',
          fontSize: '14px',
          lineHeight: '1.5'
        }}>
          관계 데이터를 분석하고 있습니다.
        </p>
      </div>
    );
  }

  // 데이터 없음 상태 렌더링
  if (!elements || elements.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: COLORS.backgroundLighter,
        padding: '20px',
        textAlign: 'center'
      }}>
        <h2 style={{
          color: COLORS.textPrimary,
          marginBottom: '16px',
          fontSize: '24px',
          fontWeight: '600'
        }}>
          {isApiBook ? 'API 데이터를 찾을 수 없습니다' : '데이터가 없습니다'}
        </h2>
        <div style={{
          fontSize: '16px',
          color: COLORS.textSecondary,
          marginBottom: '24px',
          lineHeight: '1.5',
          maxWidth: '500px'
        }}>
          {isApiBook 
            ? `API에서 bookId ${bookId}의 ${currentChapter}장까지의 관계 데이터를 찾을 수 없습니다.`
            : `이 챕터에는 표시할 관계 데이터가 없습니다.`
          }
        </div>
        <div style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              backgroundColor: COLORS.primary,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            새로고침
          </button>
          <button
            onClick={() => navigate('/user/mypage')}
            style={{
              padding: '12px 24px',
              backgroundColor: COLORS.backgroundLight,
              color: COLORS.textPrimary,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            마이페이지로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLORS.backgroundLighter, overflow: 'hidden' }}>
      {/* 상단 컨트롤 바 - 기존 topBarStyles 활용 */}
      <div style={{ 
        ...topBarStyles.container, 
        position: 'fixed', 
        top: 0, 
        left: isSidebarOpen ? '240px' : '60px',
        right: 0,
        zIndex: 10000,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${COLORS.border}`
      }}>
        <div style={topBarStyles.leftSection}>
          <GraphControls
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
          />
          
          <EdgeLabelToggle
            visible={edgeLabelVisible}
            onToggle={toggleEdgeLabel}
          />
          
          {/* 3단계 필터링 드롭다운 - 기존 스타일 활용 */}
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(Number(e.target.value))}
            style={{
              ...createButtonStyle(ANIMATION_VALUES, 'default'),
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: `1px solid ${filterStage > 0 ? COLORS.primary : COLORS.border}`,
              background: filterStage > 0 ? COLORS.primary : COLORS.background,
              color: filterStage > 0 ? '#fff' : COLORS.textPrimary,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: filterStage > 0 ? `0 2px 8px ${COLORS.primary}40` : '0 2px 8px rgba(0,0,0,0.1)',
              justifyContent: 'center',
              minWidth: 120,
            }}
            title="필터링 단계 선택"
          >
            <option value={0} style={{ color: COLORS.textPrimary, background: COLORS.background }}>
              모두 보기
            </option>
            <option value={1} style={{ color: COLORS.textPrimary, background: COLORS.background }}>
              주요 인물만 보기
            </option>
            <option value={2} style={{ color: COLORS.textPrimary, background: COLORS.background }}>
              주요 인물과 보기
            </option>
          </select>
        </div>

        <div style={topBarStyles.rightSection}>
        </div>
      </div>

      {/* 뷰어로 돌아가기 버튼 - 간소화된 디자인 */}
      <div style={{
        position: 'fixed',
        top: '12px',
        right: '24px',
        zIndex: 10002,
        pointerEvents: 'auto'
      }}>
        <button
          onClick={handleBackToViewer}
          style={{
            ...createButtonStyle(ANIMATION_VALUES, 'default'),
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
          }}
          {...backButtonHandlers}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
          돌아가기
        </button>
      </div>

      {/* API 책의 경우 이벤트 선택 UI - 간소화된 디자인 */}
      {book?.isFromAPI && (
        <div 
          style={{
            position: 'fixed',
            top: '60px',
            right: '24px',
            background: 'rgba(255, 255, 255, 0.95)',
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            padding: '10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            zIndex: 10001,
            pointerEvents: 'auto',
            backdropFilter: 'blur(8px)'
          }}
        >
          <div style={{ marginBottom: '6px', fontSize: '11px', fontWeight: '500', color: COLORS.textPrimary }}>
            이벤트
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => handleEventChange(Math.max(1, currentEvent - 1))}
              disabled={currentEvent <= 1}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, 'default'),
                padding: '6px 12px',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '6px',
                background: currentEvent <= 1 ? COLORS.backgroundLight : COLORS.background,
                color: currentEvent <= 1 ? COLORS.textSecondary : COLORS.textPrimary,
                cursor: currentEvent <= 1 ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
            >
              이전
            </button>
            <span style={{ fontSize: '11px', color: COLORS.textPrimary, minWidth: '40px', textAlign: 'center', fontWeight: '500' }}>
              {currentEvent}
            </span>
            <button
              onClick={() => handleEventChange(currentEvent + 1)}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, 'default'),
                padding: '6px 12px',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '6px',
                background: COLORS.background,
                color: COLORS.textPrimary,
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
            >
              다음
            </button>
          </div>
        </div>
      )}

      {/* 챕터 사이드바 */}
      <div 
        data-testid="chapter-sidebar"
        style={{
          ...sidebarStyles.container(isSidebarOpen, ANIMATION_VALUES),
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          marginTop: 0
        }}
      >
        <div style={sidebarStyles.header}>
          <button
            onClick={toggleSidebar}
            style={sidebarStyles.toggleButton(ANIMATION_VALUES)}
            title={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          >
            {isSidebarOpen ? <span className="material-symbols-outlined">chevron_left</span> : <span className="material-symbols-outlined">menu</span>}
          </button>
          <span style={sidebarStyles.title(isSidebarOpen, ANIMATION_VALUES)}>
            챕터 선택
          </span>
        </div>

        <div style={sidebarStyles.chapterList}>
          {chapterList.map((chapter) => (
            <button
              key={chapter}
              onClick={() => handleChapterSelect(chapter)}
              style={sidebarStyles.chapterButton(currentChapter === chapter, isSidebarOpen, ANIMATION_VALUES)}
              title={!isSidebarOpen ? `Chapter ${chapter}` : ''}
            >
              <span style={sidebarStyles.chapterNumber(currentChapter === chapter, ANIMATION_VALUES)}>
                {chapter}
              </span>
              <span style={sidebarStyles.chapterText(isSidebarOpen, ANIMATION_VALUES)}>
                Chapter {chapter}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 그래프 영역 */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: isSidebarOpen ? '240px' : '60px',
        right: 0,
        bottom: 0,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          ...graphStyles.graphPageContainer,
          display: 'flex',
          flexDirection: 'column',
          height: '100%'
        }}>
          {/* 챕터 정보 헤더 - 통일된 디자인 적용 */}
          <div style={{
            background: COLORS.background,
            borderBottom: `1px solid ${COLORS.border}`,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: '600',
                color: COLORS.textPrimary
              }}>
                {isApiBook ? '챕터 그래프' : '거시 그래프'}
              </h2>
              <div style={{
                background: COLORS.backgroundLight,
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                color: COLORS.textSecondary,
                fontWeight: '500'
              }}>
                {isApiBook 
                  ? `Chapter ${currentChapter} 관계`
                  : `Chapter 1 ~ ${currentChapter} 누적 관계`
                }
              </div>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: COLORS.textSecondary,
              fontWeight: '500'
            }}>
              <span>
                {filterStage > 0 
                  ? `${filteredMainCharacters.filter(el => el.data && el.data.id && !el.data.source).length}명 (필터링됨)`
                  : `${apiElements.filter(el => el.data && el.data.id && !el.data.source).length}명`
                }
              </span>
              <span>•</span>
              <span>
                {filterStage > 0 
                  ? `${filteredMainCharacters.filter(el => el.data && el.data.source && el.data.target).length}관계 (필터링됨)`
                  : `${apiElements.filter(el => el.data && el.data.source && el.data.target).length}관계`
                }
              </span>
            </div>
          </div>
          
          <div style={{
            ...graphStyles.graphPageInner,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative'
          }}>
            {(activeTooltip || isSidebarClosing) && (
              <GraphSidebar
                activeTooltip={activeTooltip}
                onClose={() => {
                  setActiveTooltip(null);
                  setForceClose(false);
                  setIsSidebarClosing(false);
                }}
                onStartClosing={handleStartClosing}
                onClearGraph={handleClearGraph}
                forceClose={forceClose}
                chapterNum={currentChapter}
                eventNum={eventNum}
                maxChapter={maxChapter}
                filename={filename}
                elements={elements}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                searchTerm={searchTerm}
                povSummaries={povSummaries}
                apiMacroData={apiMacroData}
                apiFineData={apiFineData}
              />
            )}
            <div 
              className="graph-canvas-area" 
              onClick={handleCanvasClick} 
              style={{
                ...graphStyles.graphArea,
                flex: 1,
                minHeight: 0,
                position: 'relative'
              }}
            >
              <CytoscapeGraphUnified
                elements={finalElements}
                newNodeIds={newNodeIds}
                stylesheet={stylesheet}
                layout={layout}
                cyRef={cyRef}
                nodeSize={10}
                fitNodeIds={fitNodeIds}
                searchTerm={searchTerm}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                onShowNodeTooltip={onShowNodeTooltip}
                onShowEdgeTooltip={onShowEdgeTooltip}
                onClearTooltip={onClearTooltip}
                selectedNodeIdRef={selectedNodeIdRef}
                selectedEdgeIdRef={selectedEdgeIdRef}
                strictBackgroundClear={true}
                isResetFromSearch={isResetFromSearch}
                showRippleEffect={true}
                isDropdownSelection={isDropdownSelection}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;
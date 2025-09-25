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
import { getMacroGraph } from '../../utils/common/api.js';
import { convertRelationsToElements, filterMainCharacters } from '../../utils/graphDataUtils';
import { createCharacterMaps } from '../../utils/characterUtils';
import { createRippleEffect, ensureElementsInBounds, processTooltipData } from '../../utils/graphUtils.js';
import useGraphInteractions from "../../hooks/useGraphInteractions";

// 노드 크기는 가중치 기반으로만 계산됨
const getEdgeStyleForGraph = () => getEdgeStyle('graph');


// 레이아웃 스타일은 기존 graphStyles에서 가져옴

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  
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
  
  // API 세밀 그래프 데이터 상태
  const [apiFineData, setApiFineData] = useState(null);
  const [apiFineLoading, setApiFineLoading] = useState(false);
  
  // refs
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const prevChapterNum = useRef();
  const prevEventNum = useRef();
  
   // API 거시 그래프 데이터 로딩
   useEffect(() => {
     const loadMacroGraphData = async () => {
       // API 책인지 확인 (숫자 ID를 가진 책이거나 isFromAPI가 true인 경우)
       const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
       
        console.log('🔍 API 책 확인 (거시그래프):', { 
          bookId: book?.id, 
          isFromAPI: book?.isFromAPI, 
          currentChapter, 
          bookType: typeof book?.id,
          isApiBook: isApiBook
        });
       
       if (!book?.id || !isApiBook || !currentChapter) {
         console.log('❌ API 거시그래프 로딩 조건 미충족:', {
           hasBookId: !!book?.id,
           isFromAPI: book?.isFromAPI,
           isApiBook: isApiBook,
           hasCurrentChapter: !!currentChapter
         });
         setApiFineData(null);
         return;
       }
      
      setApiFineLoading(true);
      try {
        console.log('🔗 거시 그래프 API 호출 - 챕터별 누적 데이터:', { 
          bookId: book.id, 
          uptoChapter: currentChapter,
          description: `Chapter 1부터 Chapter ${currentChapter}까지의 누적 관계`
        });
        
        const macroData = await getMacroGraph(book.id, currentChapter);
        setApiFineData(macroData.result);
        console.log('✅ 거시 그래프 데이터 로딩 성공:', {
          userCurrentChapter: macroData.result.userCurrentChapter,
          charactersCount: macroData.result.characters.length,
          relationsCount: macroData.result.relations.length
        });
        
        // 상세한 거시 그래프 정보 출력
        console.log('🔍 거시그래프 상세 정보:', {
          전체응답: macroData,
          캐릭터목록: macroData.result.characters,
          관계목록: macroData.result.relations
        });
        
        // 관계별 positivity 값 확인
        console.log('📊 관계별 긍정도 정보:', macroData.result.relations.map(rel => ({
          id1: rel.id1,
          id2: rel.id2,
          positivity: rel.positivity,
          relation: rel.relation,
          count: rel.count
        })));
        
       } catch (error) {
         console.error('❌ 거시 그래프 API 호출 실패:', error);
         
         // 500 에러인 경우 특별한 처리
         if (error.message.includes('500') || error.message.includes('서버 에러')) {
           console.log('⚠️ 서버 에러 발생 - API 서버가 해당 데이터를 처리할 수 없습니다.');
           console.log('📋 요청 정보:', {
             bookId: book.id,
             uptoChapter: currentChapter,
             bookTitle: book.title
           });
           console.log('🔄 로컬 데이터로 fallback합니다.');
         }
         
         setApiFineData(null);
       } finally {
         setApiFineLoading(false);
       }
    };

    loadMacroGraphData();
  }, [book?.id, currentChapter]);

  // 데이터 로딩 - API 책이 아닌 경우에만 기존 로컬 데이터 사용
  const {
    elements: localElements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum,
    maxChapter,
    loading,
    error
  } = useGraphDataLoader(book?.isFromAPI ? null : filename, currentChapter);

  // currentChapter가 maxChapter를 초과하지 않도록 검증
  useEffect(() => {
    if (maxChapter > 0 && currentChapter > maxChapter) {
      console.log('⚠️ currentChapter가 maxChapter를 초과함:', { currentChapter, maxChapter, filename });
      setCurrentChapter(1); // 첫 번째 챕터로 리셋
    }
  }, [maxChapter, currentChapter, filename, setCurrentChapter]);
  
  // API 데이터를 그래프 요소로 변환
  const apiElements = useMemo(() => {
    if (!apiFineData?.characters || !apiFineData?.relations) return [];
    
    try {
      const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(apiFineData.characters);
      const convertedElements = convertRelationsToElements(
        apiFineData.relations,
        idToName,
        idToDesc,
        idToMain,
        idToNames,
        'api', // API 데이터임을 표시
        null, // nodeWeights
        null  // previousRelations
      );
      
      // 변환된 요소 정보 출력
      const edges = convertedElements.filter(el => el.data && el.data.source && el.data.target);
      const nodes = convertedElements.filter(el => el.data && el.data.id && !el.data.source);
      console.log('🔄 거시그래프 변환된 요소 (챕터별 누적):', {
        챕터: currentChapter,
        노드수: nodes.length,
        엣지수: edges.length,
        노드목록: nodes.map(n => ({ id: n.data.id, label: n.data.label })),
        엣지목록: edges.map(e => ({ 
          id: e.data.id, 
          source: e.data.source, 
          target: e.data.target,
          positivity: e.data.positivity 
        }))
      });
      
      // 변환된 간선의 positivity 값 확인
      console.log('🔗 변환된 간선 긍정도 정보:', edges.map(edge => ({
        id: edge.data.id,
        source: edge.data.source,
        target: edge.data.target,
        positivity: edge.data.positivity,
        relation: edge.data.relation,
        label: edge.data.label
      })));
      
      return convertedElements;
    } catch (error) {
      console.error('API 데이터 변환 실패:', error);
      return [];
    }
  }, [apiFineData]);
  
  // API 책인지 확인 (숫자 ID를 가진 책이거나 isFromAPI가 true인 경우)
  const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);

  // 사용할 elements 결정 (API 데이터 우선, 없으면 로컬 데이터)
  const elements = isApiBook ? apiElements : localElements;
  
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
    
    console.log('🔍 간선 클릭 - 슬라이드바 표시용 데이터:', {
      id: processedTooltipData.id,
      positivity: processedTooltipData.data.positivity,
      positivityPercent: Math.round(processedTooltipData.data.positivity * 100),
      relation: processedTooltipData.data.relation,
      source: processedTooltipData.data.source,
      target: processedTooltipData.data.target
    });
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
      console.log('📖 챕터 변경:', { from: currentChapter, to: chapter });
      
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

  // 로딩 상태 렌더링
  if (isGraphLoading || apiFineLoading) {
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
      <div style={containerStyles.error}>
        <div>데이터가 없습니다</div>
        <div style={{ fontSize: '14px', color: COLORS.textSecondary, marginTop: '8px' }}>
          이 챕터에는 표시할 관계 데이터가 없습니다.
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
                거시 그래프
              </h2>
              <div style={{
                background: COLORS.backgroundLight,
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                color: COLORS.textSecondary,
                fontWeight: '500'
              }}>
                Chapter 1 ~ {currentChapter} 누적 관계
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
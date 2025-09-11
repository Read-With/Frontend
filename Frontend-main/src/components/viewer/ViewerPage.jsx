import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import cytoscape from "cytoscape";
import { CytoscapeGraphPortalProvider } from "../graph/CytoscapeGraphUnified";
import GraphContainer from "../graph/GraphContainer";
import ViewerLayout from "./ViewerLayout";
import EpubViewer from "./epub/EpubViewer";
import BookmarkPanel from "./bookmark/BookmarkPanel";
import ViewerSettings from "./epub/ViewerSettings";
import ViewerTopBar from "./ViewerTopBar";
import { useViewerPage } from "../../hooks/useViewerPage";
import { useGraphSearch } from "../../hooks/useGraphSearch";
import { useClickOutside } from "../../hooks/useClickOutside";
import { createStorageKey } from "../../hooks/useLocalStorage";
import { 
  parseCfiToChapterDetail, 
  extractEventNodesAndEdges
} from "../../utils/viewerUtils";
import { 
  getEventsForChapter,
  getElementsFromRelations,
  getChapterFile,
  filterIsolatedNodes,
  getDetectedMaxChapter,
  getEventData,
  getCharactersData
} from "../../utils/graphData";
import { calcGraphDiff } from "../../utils/graphDataUtils";


function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
  activeTooltip,
  onClearTooltip,
  onSetActiveTooltip,
  graphClearRef,
  isEventUndefined,
}) {
  const graphContainerRef = React.useRef(null);
  const { isSearchActive, filteredElements, isResetFromSearch } = searchState;

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        width: "100%",
        overflow: "hidden",
        alignItems: "stretch",
        justifyContent: "stretch",
        boxSizing: "border-box",
        padding: 0,
      }}
    >
      <ViewerTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={viewerState}
        searchState={searchState}
        searchActions={searchActions}
      />
      
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        {isEventUndefined ? (
          // 이벤트가 정해지지 않은 경우 새로고침 메시지 표시
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '20px',
            textAlign: 'center',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            border: '1px solid #e9ecef'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '16px',
              color: '#6c757d'
            }}>
              ⚠️
            </div>
            <h3 style={{
              color: '#495057',
              marginBottom: '12px',
              fontSize: '18px',
              fontWeight: '600'
            }}>
              이벤트 정보를 불러올 수 없습니다
            </h3>
            <p style={{
              color: '#6c757d',
              marginBottom: '20px',
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              페이지를 새로고침하여 다시 시도해주세요.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#4F6DDE',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#3d5bc7'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#4F6DDE'}
            >
              새로고침
            </button>
          </div>
        ) : (
          <GraphContainer
            ref={graphContainerRef}
            currentPosition={graphState.currentCharIndex}
            currentEvent={graphState.currentEvent}
            currentChapter={graphState.currentChapter}
            edgeLabelVisible={graphState.edgeLabelVisible}
            filename={viewerState.filename}
            elements={isSearchActive && filteredElements && filteredElements.length > 0 ? filteredElements : graphState.elements}
            isResetFromSearch={isResetFromSearch}
            // ViewerTopBar와 동일한 이벤트 정보 전달 - 현재 챕터의 이벤트만 전달
            prevValidEvent={graphState.currentEvent && graphState.currentEvent.chapter === graphState.currentChapter ? graphState.currentEvent : null}
            events={graphState.events || []}
            // 툴팁 관련 props 추가
            activeTooltip={activeTooltip}
            onClearTooltip={onClearTooltip}
            onSetActiveTooltip={onSetActiveTooltip}
            graphClearRef={graphClearRef}
          />
        )}
      </div>
    </div>
  );
}

const ViewerPage = () => {
  const {
    filename, location, navigate, viewerRef,
    reloadKey, setReloadKey, failCount, setFailCount,
    progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal, setShowSettingsModal,
    settings, setSettings,
    currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    prevEvent, setPrevEvent, events, setEvents, maxChapter, setMaxChapter,
    graphFullScreen, setGraphFullScreen, showGraph, setShowGraph,
    elements, setElements, graphViewState, setGraphViewState,
    hideIsolated, setHideIsolated, edgeLabelVisible, setEdgeLabelVisible,
    graphDiff, setGraphDiff,
    currentCharIndex, setCurrentCharIndex, currentPageWords, setCurrentPageWords,
    totalChapterWords, setTotalChapterWords, loading, setLoading,
    chapterText, setChapterText, isDataReady, setIsDataReady,
    characterData, setCharacterData, isReloading, setIsReloading,
    eventNum, setEventNum, isGraphLoading, setIsGraphLoading,
    showToolbar, setShowToolbar,
    cleanFilename, bookmarks, setBookmarks, showBookmarkList, setShowBookmarkList,
    prevValidEventRef, prevElementsRef, prevChapterNumRef, prevEventNumRef,
    book, folderKey,
    graphElements, newNodeIds, currentChapterData, maxEventNum,
    graphEventNum, detectedMaxChapter, graphLoading, graphError,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, handleDeleteBookmark,
    handleRemoveBookmark, toggleGraph, handleFitView, handleLocationChange,
    graphState, graphActions, viewerState, searchState,
  } = useViewerPage();

  // 툴팁 상태 관리
  const [activeTooltip, setActiveTooltip] = useState(null);
  
  // 그래프 상태 초기화를 위한 ref
  const graphClearRef = useRef(null);
  
  // 이벤트 상태 관리
  const [isEventUndefined, setIsEventUndefined] = useState(false);
  
  // 툴팁 닫기 함수
  const handleClearTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  // 툴팁과 그래프 스타일을 모두 초기화하는 함수
  const handleClearTooltipAndGraph = useCallback(() => {
    setActiveTooltip(null);
    if (graphClearRef.current) {
      graphClearRef.current();
    }
  }, []);

  // 툴팁 설정 함수
  const handleSetActiveTooltip = useCallback((tooltipData) => {
    setActiveTooltip(tooltipData);
  }, [currentEvent, currentChapter]);

  // 전역 클릭 감지를 위한 ref - 툴팁이 활성화된 경우에만 감지
  // 툴팁 닫기와 동시에 그래프 스타일도 초기화
  const viewerPageRef = useClickOutside(handleClearTooltipAndGraph, !!activeTooltip);

  // 이벤트 상태 감지 및 새로고침 메시지 표시
  useEffect(() => {
    const checkEventStatus = () => {
      // 로딩 중인 경우는 제외하고 이벤트가 정해지지 않은 경우들만 체크
      if (loading || isReloading) {
        setIsEventUndefined(false);
        return;
      }

      // 로딩이 완료된 후 이벤트가 정해지지 않은 경우들
      const isEventInvalid = 
        // 1. currentEvent가 null이거나 undefined인 경우
        !currentEvent ||
        // 2. currentEvent.eventNum이 undefined이거나 null인 경우
        currentEvent.eventNum === undefined || currentEvent.eventNum === null ||
        // 3. currentEvent.chapter가 undefined이거나 null인 경우
        currentEvent.chapter === undefined || currentEvent.chapter === null ||
        // 4. events 배열이 비어있는 경우
        !events || events.length === 0;

      if (isEventInvalid) {
        setIsEventUndefined(true);
        
      } else {
        setIsEventUndefined(false);
      }
    };

    checkEventStatus();
  }, [currentEvent, currentChapter, events, loading, isReloading, isDataReady, isEventUndefined]);

  useEffect(() => {
    const loadEventsData = async () => {
      try {
        setLoading(true);
        setIsGraphLoading(true);
        setIsDataReady(false);
        
        // 현재 챕터가 유효한지 확인
        if (!currentChapter || currentChapter < 1) {
          setIsDataReady(true);
          return;
        }
        
        const events = getEventsForChapter(currentChapter, folderKey);
        
        // 이벤트 데이터가 현재 챕터에 속하는지 검증
        const validEvents = events.filter(event => {
          return event.chapter === currentChapter;
        });
        
        if (validEvents.length === 0 && events.length > 0) {
        }
        
        setEvents(validEvents);
        
        try {
          const allCharacterData = [];
          for (let chapter = 1; chapter <= currentChapter; chapter++) {
            const charData = getCharactersData(folderKey, chapter);
            if (charData && charData.characters) {
              allCharacterData.push(...charData.characters);
            }
          }
          
          const uniqueCharacters = [];
          const seenIds = new Set();
          for (let i = allCharacterData.length - 1; i >= 0; i--) {
            const char = allCharacterData[i];
            const id = String(Math.trunc(char.id));
            if (!seenIds.has(id)) {
              seenIds.add(id);
              uniqueCharacters.unshift(char);
            }
          }
          
          setCharacterData(uniqueCharacters);
        } catch (charError) {
          if (currentChapterData) {
            setCharacterData(currentChapterData.characters || currentChapterData);
          }
        }
        
        setIsDataReady(true);
      } catch (error) {
        setIsDataReady(true);
      } finally {
        setLoading(false);
        setIsGraphLoading(false);
      }
    };
    
    // 초기 로딩 시에는 챕터가 확실히 설정되고 초기 감지가 완료된 후에만 실행
    if (currentChapter && currentChapter > 0 && graphState.isInitialChapterDetected) {
      loadEventsData();
    } else if (currentChapter && currentChapter > 0 && !graphState.isInitialChapterDetected) {
      // 초기 챕터 감지가 완료되지 않은 경우, 일정 시간 후 재시도
      const timer = setTimeout(() => {
        if (currentChapter && currentChapter > 0) {
          loadEventsData();
        }
      }, 500); // 0.5초 후 재시도
      
      return () => clearTimeout(timer);
    }
  }, [currentChapter, currentChapterData, folderKey, graphState.isInitialChapterDetected]);

  const currentEventElements = useMemo(() => {
    if (loading || isReloading || !currentEvent || !events?.length || !characterData?.length) {
      return [];
    }
    
    // 이벤트가 정해지지 않은 경우들 체크
    if (currentEvent.eventNum === undefined || currentEvent.eventNum === null ||
        currentEvent.chapter === undefined || currentEvent.chapter === null) {
      return [];
    }
    
    // 현재 이벤트가 현재 챕터에 속하는지 확인
    if (currentEvent.chapter !== currentChapter) {
      return [];
    }
    
    const currentEventNum = currentEvent.eventNum;
    const eventChapter = currentEvent.chapter;
    
    try {
      // currentEvent.eventNum이 0-based인지 1-based인지 확인
      
      // event_id가 있으면 그것을 사용, 없으면 eventNum 사용
      const actualEventNum = currentEvent.event_id !== undefined ? currentEvent.event_id : currentEventNum;
      
      const eventData = getEventData(folderKey, eventChapter, actualEventNum);
      
      if (!eventData) {
        return [];
      }
      
      const currentRelations = eventData.relations || [];
      const currentImportance = eventData.importance || {};
      const currentNewAppearances = eventData.log?.new_character_ids || [];
      
      
      const generatedElements = getElementsFromRelations(
        currentRelations,
        characterData,
        currentNewAppearances,
        currentImportance,
        eventChapter,
        folderKey
      );
      
      
      return generatedElements;
    } catch (error) {
      return [];
    }
  }, [currentEvent, characterData, folderKey, events]);

  const {
    searchTerm, isSearchActive, filteredElements, fitNodeIds,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    selectSuggestion, handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(currentEventElements, null, currentChapterData);

  // === [최적화] elements 설정 로직 - 불필요한 재렌더링 방지 ===
  const elementsRef = useRef([]);
  const lastProcessedRef = useRef({});

  useEffect(() => {
    if (!isDataReady || !events || !events.length || !characterData) {
      return;
    }

    // 현재 상태를 키로 사용하여 중복 실행 방지
    const currentState = {
      currentEventId: currentEvent?.eventNum,
      currentChapter,
      eventsLength: events.length,
      characterDataLength: characterData.length,
      hideIsolated
    };

    // 이전과 동일한 상태면 실행하지 않음
    if (JSON.stringify(currentState) === JSON.stringify(lastProcessedRef.current)) {
      return;
    }

    lastProcessedRef.current = currentState;

    let targetElements = [];
    let source = '';

    // 1차: currentEvent가 있고 currentEventElements가 있을 때
    if (currentEvent && currentEventElements.length > 0) {
      targetElements = currentEventElements;
      source = `현재 이벤트(${currentEvent.eventNum})`;
    }
    // 2차: currentEvent가 없거나 currentEventElements가 비어있을 때는 빈 배열 반환
    // 자동 이벤트 선택 제거 - 사용자가 직접 선택하도록 함

    // elements 설정 (고립 노드 필터링 적용)
    if (targetElements.length > 0) {
      const filteredElements = filterIsolatedNodes(targetElements, hideIsolated);
      
      // 노드 위치 복원
      let nodePositions = {};
      try {
        const posStr = localStorage.getItem(
          createStorageKey.chapterNodePositions(currentChapter)
        );
        if (posStr) nodePositions = JSON.parse(posStr);
      } catch (e) {}

      const sortedElements = filteredElements
        .slice()
        .sort((a, b) => {
          const aId = a.data?.id || (a.data?.source ? a.data?.source + "-" + a.data?.target : "");
          const bId = b.data?.id || (b.data?.source ? b.data?.source + "-" + b.data?.target : "");
          return aId.localeCompare(bId);
        })
        .map((el) => {
          if (el.data.id && nodePositions[el.data.id]) {
            return { ...el, position: nodePositions[el.data.id] };
          }
          return el;
        });

      // 이전 elements와 동일하면 업데이트하지 않음
      if (JSON.stringify(elementsRef.current) !== JSON.stringify(sortedElements)) {
        elementsRef.current = sortedElements;
        setElements(sortedElements);
      }
    }
  }, [isDataReady, currentEvent, currentEventElements, events, characterData, folderKey, hideIsolated, currentChapter]);

  // === [제거] 중복된 useEffect - 위의 통합 로직으로 대체됨 ===

  // === [수정] 현재 이벤트 등장 노드/간선 위치 저장 및 이벤트별 적용 ===
  // 현재 이벤트에서 등장한 노드/간선 위치를 저장
  useEffect(() => {
    if (!isDataReady || !currentEvent || !graphViewState) return;
    
    // 현재 이벤트에서 등장한 노드/간선 id 추출
    const { nodes: currentNodes, edges: currentEdges } = extractEventNodesAndEdges(currentEvent);
    
    // graphViewState에서 해당 노드/간선 위치만 추출
    const partialLayout = {};
    Object.entries(graphViewState).forEach(([key, value]) => {
      if (currentNodes.has(key) || currentEdges.has(key)) {
        partialLayout[key] = value;
      }
    });
    
    // 현재 이벤트별로 위치 저장
    try {
      const eventKey = createStorageKey.graphEventLayout(currentChapter, currentEvent.eventNum);
      localStorage.setItem(eventKey, JSON.stringify(partialLayout));
      
      // 전체 챕터 레이아웃도 업데이트 (누적)
      const chapterKey = createStorageKey.graphPartialLayout(currentChapter);
      const existingLayout = JSON.parse(localStorage.getItem(chapterKey) || '{}');
      const updatedLayout = { ...existingLayout, ...partialLayout };
      localStorage.setItem(chapterKey, JSON.stringify(updatedLayout));
    } catch (e) {}
  }, [isDataReady, currentEvent, currentChapter, graphViewState]);

  // 현재 이벤트까지의 누적 레이아웃을 merge해서 graphViewState로 적용
  useEffect(() => {
    if (!isDataReady || !currentEvent) return;
    
    try {
      // 현재 이벤트까지의 모든 이벤트 레이아웃을 누적하여 merge
      const mergedLayout = {};
      const currentEventNum = currentEvent.eventNum || 0;
      
      // 현재 이벤트까지의 모든 이벤트에서 레이아웃 정보 수집
      for (let eventNum = 0; eventNum <= currentEventNum; eventNum++) {
        const eventKey = createStorageKey.graphEventLayout(currentChapter, eventNum);
        const eventLayoutStr = localStorage.getItem(eventKey);
        
        if (eventLayoutStr) {
          try {
            const eventLayout = JSON.parse(eventLayoutStr);
            Object.assign(mergedLayout, eventLayout);
          } catch (e) {
            // 개별 이벤트 레이아웃 파싱 오류 무시
          }
        }
      }
      
      // 현재 이벤트에 등장하는 노드/간선만 최종 적용
      const { nodes: currentNodes, edges: currentEdges } = extractEventNodesAndEdges(currentEvent);
      
      // 현재 이벤트에 등장하는 요소들의 위치만 적용
      const finalLayout = {};
      Object.entries(mergedLayout).forEach(([key, value]) => {
        if (currentNodes.has(key) || currentEdges.has(key)) {
          finalLayout[key] = value;
        }
      });
      
      setGraphViewState(finalLayout);
    } catch (e) {
      // 전체 레이아웃 복원 오류 처리
    }
  }, [isDataReady, currentEvent, currentEventElements, currentChapter, hideIsolated]);

  // elements가 바뀔 때마다 diff 계산
  useEffect(() => {
    if (!elements) return;
    const prev = prevElementsRef.current || [];
    const curr = elements;
    const diff = calcGraphDiff(prev, curr);
    setGraphDiff(diff);
    prevElementsRef.current = curr;
  }, [elements]);

  // === [제거] 중복된 초기 로딩 fallback - 위의 통합 로직으로 대체됨 ===

  // elements가 이전과 완전히 같으면 로딩 메시지 안 보이게
  const isSameElements = useMemo(() => {
    if (!prevElementsRef.current || !elements) return false;
    if (prevElementsRef.current.length !== elements.length) return false;
    for (let i = 0; i < elements.length; i++) {
      if (
        JSON.stringify(prevElementsRef.current[i]) !==
        JSON.stringify(elements[i])
      )
        return false;
    }
    return true;
  }, [elements]);

  // === [디버깅용 로그 추가] 최초 진입 시 모든 챕터의 전체 노드 위치 미리 저장 ===
  useEffect(() => {
    // 동적으로 최대 챕터 번호 계산
    const maxChapterCount = getDetectedMaxChapter(folderKey);
    if (maxChapterCount === 0) return; // 챕터가 없으면 종료
    
    const chapterNums = Array.from({ length: maxChapterCount }, (_, i) => i + 1);
    chapterNums.forEach((chapterNum) => {
      const storageKey = createStorageKey.chapterNodePositions(chapterNum);
      if (localStorage.getItem(storageKey)) {
        return;
      }
      // 1. merged_relations.json 전체 노드/엣지 생성
      const relationsData = getChapterFile(chapterNum, "relations");
      const charactersData = getChapterFile(chapterNum, "characters");
      if (!relationsData || !charactersData) {
        return;
      }
      let allRelations = relationsData.relations || relationsData;
      let allImportance = relationsData.importance || {};
      let allNewAppearances = relationsData.new_appearances || [];
      const elements = getElementsFromRelations(
        allRelations,
        charactersData,
        allNewAppearances,
        allImportance,
        chapterNum,
        folderKey
      );
      if (!elements || elements.length === 0) {
        return;
      }
      // 2. Cytoscape 임시 인스턴스 생성 및 레이아웃 실행
      const cy = cytoscape({
        elements,
        style: [],
        headless: true,
      });
      const layout = cy.layout({
        name: "cose",
        animate: false,
        fit: true,
        padding: 80,
      });
      layout.run();
      // headless 모드에서는 layoutstop 이벤트가 잘 안 오므로, setTimeout으로 우회
      setTimeout(() => {
        const layoutObj = {};
        cy.nodes().forEach((node) => {
          layoutObj[node.id()] = node.position();
        });
        try {
          localStorage.setItem(storageKey, JSON.stringify(layoutObj));
        } catch (e) {}
        cy.destroy();
      }, 100);
    });
  }, [folderKey]);


  return (
    <div
      ref={viewerPageRef}
      className="h-screen"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      <ViewerLayout
        showControls={showToolbar}
        book={book}
        progress={progress}
        setProgress={setProgress}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
        isBookmarked={false}
        onToggleBookmarkList={onToggleBookmarkList}
        onAddBookmark={handleAddBookmark}
        onOpenSettings={handleOpenSettings}
        onSliderChange={handleSliderChange}
        currentPage={currentPage}
        totalPages={totalPages}
        showGraph={showGraph}
        onToggleGraph={toggleGraph}
        pageMode={settings.pageMode}
        graphFullScreen={graphFullScreen}
        rightSideContent={
          <CytoscapeGraphPortalProvider>
            <GraphSplitArea
              graphState={{
                ...graphState,
                // 현재 챕터의 이벤트만 유효한 이벤트로 설정
                prevValidEvent: currentEvent && currentEvent.chapter === currentChapter ? currentEvent : null,
                events: getEventsForChapter(currentChapter, folderKey)
              }}
              graphActions={graphActions}
              viewerState={viewerState}
              searchState={{
                ...searchState,
                searchTerm,
                isSearchActive,
                elements: currentEventElements,
                filteredElements,
                isResetFromSearch,
                suggestions,
                showSuggestions,
                selectedIndex
              }}
              searchActions={{
                onSearchSubmit: handleSearchSubmit,
                clearSearch,
                closeSuggestions,
                onGenerateSuggestions: setSearchTerm,
                selectSuggestion,
                handleKeyDown
              }}
              activeTooltip={activeTooltip}
              onClearTooltip={handleClearTooltip}
              onSetActiveTooltip={handleSetActiveTooltip}
              graphClearRef={graphClearRef}
              isEventUndefined={isEventUndefined}
            />
          </CytoscapeGraphPortalProvider>
        }
      >
        <EpubViewer
          key={reloadKey}
          ref={viewerRef}
          book={book}
          onProgressChange={setProgress}
          onCurrentPageChange={(page) => {
            setCurrentPage(page);
          }}
          onTotalPagesChange={setTotalPages}
          onCurrentChapterChange={(chapter) => {
            setCurrentChapter(chapter);
          }}
          settings={settings}
          onCurrentLineChange={(charIndex, totalEvents, receivedEvent) => {
            setCurrentCharIndex(charIndex);
            setTotalChapterWords(totalEvents || 0);
            
            // 받은 이벤트가 있으면 업데이트 (챕터 동기화는 별도로 처리)
            if (receivedEvent) {
              
              // 챕터 불일치 시 currentChapter도 업데이트
              if (receivedEvent.chapter && receivedEvent.chapter !== currentChapter) {
                setCurrentChapter(receivedEvent.chapter);
              }
              
              setCurrentEvent(receivedEvent);
            }
          }}
          onAllCfisReady={(_cfis, _ranges, offsets) => {}}
          onTextReady={(text, i) => {}}
          onRelocated={handleLocationChange}
        />
        {showBookmarkList && (
          <BookmarkPanel bookmarks={bookmarks} onSelect={handleBookmarkSelect}>
            {bookmarks.map((bm) => (
              <span
                key={bm.cfi}
                style={{
                  fontSize: "0.98rem",
                  color: "#4F6DDE",
                  fontFamily: "monospace",
                }}
              >
                위치: {parseCfiToChapterDetail(bm.cfi)}
              </span>
            ))}
          </BookmarkPanel>
        )}

        {/* 설정 모달 */}
        <ViewerSettings
          isOpen={showSettingsModal}
          onClose={handleCloseSettings}
          onApplySettings={handleApplySettings}
          currentSettings={settings}
        />
      </ViewerLayout>
      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop
        closeOnClick
      />
    </div>
  );
};

export default ViewerPage;


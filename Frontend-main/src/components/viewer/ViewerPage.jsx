import React, { useRef, useState, useEffect, useMemo } from "react";
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


// GraphSplitArea 컴포넌트를 ViewerPage 함수 전에 정의
function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
}) {
  const graphContainerRef = React.useRef(null);

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
      
      {/* 그래프 본문 */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        <GraphContainer
          ref={graphContainerRef}
          currentPosition={graphState.currentCharIndex}
          currentEvent={graphState.currentEvent || graphState.prevValidEvent}
          currentChapter={graphState.currentChapter}
          edgeLabelVisible={graphState.edgeLabelVisible}
          filename={viewerState.filename}
          elements={graphState.elements}
        />
      </div>
    </div>
  );
}

const ViewerPage = ({ darkMode: initialDarkMode }) => {
  // 커스텀 훅을 사용하여 모든 상태와 로직을 관리
  const {
    // 라우터 관련
    filename,
    location,
    navigate,
    
    // refs
    viewerRef,
    
    // 기본 상태
    reloadKey,
    setReloadKey,
    failCount,
    setFailCount,
    progress,
    setProgress,
    currentPage,
    setCurrentPage,
    totalPages,
    setTotalPages,
    showSettingsModal,
    setShowSettingsModal,
    
    // 설정 관련
    settings,
    setSettings,
    darkMode,
    setDarkMode,
    
    // 챕터 및 이벤트 관련
    currentChapter,
    setCurrentChapter,
    currentEvent,
    setCurrentEvent,
    prevEvent,
    setPrevEvent,
    events,
    setEvents,
    maxChapter,
    setMaxChapter,
    
    // 그래프 관련
    graphFullScreen,
    setGraphFullScreen,
    showGraph,
    setShowGraph,
    elements,
    setElements,
    graphViewState,
    setGraphViewState,
    hideIsolated,
    setHideIsolated,
    edgeLabelVisible,
    setEdgeLabelVisible,
    graphDiff,
    setGraphDiff,
    
    // 기타 상태
    currentCharIndex,
    setCurrentCharIndex,
    currentPageWords,
    setCurrentPageWords,
    totalChapterWords,
    setTotalChapterWords,
    loading,
    setLoading,
    chapterText,
    setChapterText,
    isDataReady,
    setIsDataReady,
    characterData,
    setCharacterData,
    isReloading,
    setIsReloading,
    eventNum,
    setEventNum,
    isGraphLoading,
    setIsGraphLoading,
    showToolbar,
    setShowToolbar,
    
    // 북마크 관련
    cleanFilename,
    bookmarks,
    setBookmarks,
    showBookmarkList,
    setShowBookmarkList,
    
    // refs
    prevValidEventRef,
    prevElementsRef,
    prevChapterNumRef,
    prevEventNumRef,
    
    // book 정보
    book,
    
    // 폴더 키
    folderKey,
    
    // 그래프 데이터 로더 결과
    graphElements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    graphEventNum,
    detectedMaxChapter,
    graphLoading,
    graphError,
    
    // 이벤트 핸들러들
    handlePrevPage,
    handleNextPage,
    handleAddBookmark,
    handleBookmarkSelect,
    handleOpenSettings,
    handleCloseSettings,
    handleApplySettings,
    onToggleBookmarkList,
    handleSliderChange,
    handleDeleteBookmark,
    handleRemoveBookmark,
    toggleGraph,
    handleFitView,
    handleLocationChange,
    
    // 그룹화된 상태들 (GraphSplitArea용)
    graphState,
    graphActions,
    viewerState,
    searchState,
  } = useViewerPage(initialDarkMode);

  // 검색 기능 (useGraphSearch 훅 사용)
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

  // 챕터 데이터 로딩 (이벤트 데이터만 별도 처리)
  useEffect(() => {
    const loadEventsData = async () => {
      try {
        setLoading(true);
        setIsDataReady(false);
        
        // 이벤트 데이터 로드
        const events = getEventsForChapter(currentChapter, folderKey);
        setEvents(events);
        
        // 캐릭터 데이터는 누적된 모든 챕터의 데이터를 사용
        try {
          const allCharacterData = [];
          
          // 현재 챕터까지의 모든 캐릭터 데이터를 누적
          for (let chapter = 1; chapter <= currentChapter; chapter++) {
            const charData = getCharactersData(folderKey, chapter);
            if (charData && charData.characters) {
              allCharacterData.push(...charData.characters);
            }
          }
          
          // 중복 제거 (같은 ID를 가진 캐릭터는 마지막에 추가된 것만 유지)
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
          console.warn('캐릭터 데이터 누적 로드 실패:', charError);
          // fallback: currentChapterData 사용
          if (currentChapterData) {
            setCharacterData(currentChapterData.characters || currentChapterData);
          }
        }
        
        setIsDataReady(true);
        
        // 초기 로딩 시 currentEvent가 없으면 의미있는 이벤트로 설정
        if (!currentEvent && events.length > 0) {
          // 현재 챕터의 이벤트 중에서 이벤트 번호가 1 이상인 첫 번째 이벤트를 찾거나, 없으면 첫 번째 이벤트 사용
          const currentChapterEvents = events.filter(e => e.chapter === currentChapter);
          const initialEvent = currentChapterEvents.length > 0 
            ? (currentChapterEvents.find(e => e.eventNum >= 1) || currentChapterEvents[0])
            : (events.find(e => e.eventNum >= 1) || events[0]);
            
          setCurrentEvent(initialEvent);
        }
      } catch (error) {
        console.error('Chapter data loading error:', error);
        // 에러 발생 시에도 기본 데이터로 fallback
        setIsDataReady(true);
      } finally {
        setLoading(false);
      }
    };
    
    loadEventsData();
  }, [currentChapter, currentChapterData, folderKey]);

  // === [수정] 현재 이벤트에 해당하는 그래프만 생성 (utils 함수 활용) ===
  const currentEventElements = useMemo(() => {
    // currentEvent가 없을 때는 빈 배열 반환
    if (!currentEvent) {
      return [];
    }
    
    // 필수 데이터가 없을 때는 빈 배열 반환
    if (!events || !events.length || !characterData || !characterData.length) {
      return [];
    }
    
    const currentEventNum = currentEvent.eventNum;
    const currentChapter = currentEvent.chapter;
    
    try {
      // utils/graphData.js의 getEventData 함수 활용
      const eventData = getEventData(folderKey, currentChapter, currentEventNum);
      
      if (!eventData) {
        console.warn('이벤트 데이터를 찾을 수 없습니다:', { folderKey, currentChapter, currentEventNum });
        return [];
      }
      
      const currentRelations = eventData.relations || [];
      const currentImportance = eventData.importance || {};
      const currentNewAppearances = eventData.log?.new_character_ids || [];
      
      const generatedElements = getElementsFromRelations(
        currentRelations,
        characterData,
        currentNewAppearances,
        currentImportance
      );
      
      return generatedElements;
    } catch (error) {
      console.error('관계 데이터 로드 실패:', error);
      return [];
    }
  }, [currentEvent, characterData, folderKey, events]);

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
    // 2차: currentEvent가 없거나 currentEventElements가 비어있을 때 적절한 이벤트 선택
    else {
      let targetEvent;
      
      // 현재 챕터의 이벤트들을 찾아서 더 의미있는 이벤트 선택
      const currentChapterEvents = events.filter(e => e.chapter === currentChapter);
      
      if (currentChapterEvents.length > 0) {
        // 현재 챕터에서 이벤트 번호가 1 이상인 첫 번째 이벤트를 찾거나, 없으면 첫 번째 이벤트 사용
        targetEvent = currentChapterEvents.find(e => e.eventNum >= 1) || currentChapterEvents[0];
      } else {
        // 현재 챕터에 이벤트가 없으면 전체 이벤트에서 이벤트 번호가 1 이상인 첫 번째 이벤트 사용
        targetEvent = events.find(e => e.eventNum >= 1) || events[0];
      }
        
      if (targetEvent) {
        try {
          const eventData = getEventData(folderKey, targetEvent.chapter, targetEvent.eventNum);
          if (eventData) {
            const currentRelations = eventData.relations || [];
            const currentImportance = eventData.importance || {};
            const currentNewAppearances = eventData.log?.new_character_ids || [];
            
            targetElements = getElementsFromRelations(
              currentRelations,
              characterData,
              currentNewAppearances,
              currentImportance
            );
            source = `Fallback 이벤트(${targetEvent.eventNum})`;
            
            // currentEvent가 현재 챕터와 다르면 업데이트
            if (!currentEvent || currentEvent.chapter !== currentChapter) {
              setCurrentEvent(targetEvent);
            }
          }
        } catch (error) {
          console.error('이벤트 데이터 로드 실패:', error);
          return;
        }
      }
    }

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
        allImportance
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
      className="h-screen"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      <ViewerLayout
        showControls={showToolbar}
        book={book}
        darkMode={darkMode}
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
                prevValidEvent: prevValidEventRef.current,
                events: getEventsForChapter(currentChapter, folderKey)
              }}
              graphActions={graphActions}
              viewerState={viewerState}
              searchState={{
                ...searchState,
                searchTerm,
                isSearchActive,
                elements
              }}
              searchActions={{
                onSearchSubmit: handleSearchSubmit,
                clearSearch,
                closeSuggestions,
                onGenerateSuggestions: setSearchTerm
              }}
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
              setCurrentEvent(receivedEvent);
              
              // 챕터 불일치 시 currentChapter도 업데이트
              if (receivedEvent.chapter && receivedEvent.chapter !== currentChapter) {
                setCurrentChapter(receivedEvent.chapter);
              }
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


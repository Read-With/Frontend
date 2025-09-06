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
import { 
  parseCfiToChapterDetail, 
  extractEventNodesAndEdges
} from "../../utils/viewerUtils";
import { 
  getEventsForChapter,
  loadChapterData,
  getElementsFromRelations,
  getChapterFile,
  filterIsolatedNodes
} from "../../utils/graphData";
import { calcGraphDiff } from "../../utils/graphDataUtils";


// GraphSplitArea 컴포넌트를 ViewerPage 함수 전에 정의
function GraphSplitArea({
  currentCharIndex,
  hideIsolated,
  setHideIsolated,
  edgeLabelVisible,
  setEdgeLabelVisible,
  handleFitView,
  currentChapter,
  setCurrentChapter,
  maxChapter,
  loading,
  isDataReady,
  showGraph,
  graphFullScreen,
  setGraphFullScreen,
  navigate,
  filename,
  book,
  viewerRef,
  currentEvent,
  prevValidEvent,
  prevEvent,
  events,
  graphDiff,
  prevElements,
  currentElements,
  // 검색 관련 props
  searchTerm,
  isSearchActive,
  elements,
  onSearchSubmit,
  clearSearch,
  currentChapterData,
  closeSuggestions,
  onGenerateSuggestions,
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
        navigate={navigate}
        filename={filename}
        currentChapter={currentChapter}
        setCurrentChapter={setCurrentChapter}
        maxChapter={maxChapter}
        book={book}
        viewerRef={viewerRef}
        currentEvent={currentEvent}
        prevValidEvent={prevValidEvent}
        prevEvent={prevEvent}
        events={events}
        graphFullScreen={graphFullScreen}
        setGraphFullScreen={setGraphFullScreen}
        edgeLabelVisible={edgeLabelVisible}
        setEdgeLabelVisible={setEdgeLabelVisible}
        hideIsolated={hideIsolated}
        setHideIsolated={setHideIsolated}
        searchTerm={searchTerm}
        isSearchActive={isSearchActive}
        elements={elements}
        onSearchSubmit={onSearchSubmit}
        clearSearch={clearSearch}
        currentChapterData={currentChapterData}
        closeSuggestions={closeSuggestions}
        onGenerateSuggestions={onGenerateSuggestions}
      />
      
      {/* 그래프 본문 */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        <GraphContainer
          ref={graphContainerRef}
          currentPosition={currentCharIndex}
          currentEvent={currentEvent || prevValidEvent}
          currentChapter={currentChapter}
          edgeLabelVisible={edgeLabelVisible}
          filename={filename}
          elements={elements} // ViewerPage에서 생성한 elements 전달
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

  // 챕터 데이터 로딩
  useEffect(() => {
    loadChapterData(
      currentChapter,
      setEvents,
      setCharacterData,
      setElements,
      setIsDataReady,
      setLoading
    );
  }, [currentChapter]);

  // === [수정] 현재 이벤트에 해당하는 그래프만 생성 (ViewerPage 전용) ===
  const currentEventElements = useMemo(() => {
    if (!currentEvent || !events || !events.length || !characterData || !characterData.length) {
      return [];
    }
    
    // 현재 이벤트에 해당하는 관계 데이터를 별도로 로드
    const currentEventNum = currentEvent.eventNum;
    const currentChapter = currentEvent.chapter;
    
    try {
      // chapter1_relationships_event_1.json 형태로 관계 데이터 로드
      const relationModule = import.meta.glob('/src/data/gatsby/chapter*_relationships_event_*.json', { eager: true });
      const relationFilePath = Object.keys(relationModule).find(path => 
        path.includes(`chapter${currentChapter}_relationships_event_${currentEventNum}.json`)
      );
      
      if (!relationFilePath) return [];
      
      const relationData = relationModule[relationFilePath]?.default || {};
      const currentRelations = relationData.relations || [];
      const currentImportance = relationData.importance || {};
      const currentNewAppearances = relationData.log?.new_character_ids || [];
      
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
  }, [currentEvent, characterData]);

  // === [수정] elements: 현재 이벤트에 해당하는 그래프만 표시 ===
  // 1. 데이터 준비되면 currentEventElements를 보여줌
  useEffect(() => {
    if (isDataReady && currentEvent && currentEventElements.length > 0) {
      // 현재 이벤트에 해당하는 그래프만 표시
      setElements(currentEventElements);
    }
  }, [isDataReady, currentEvent, currentEventElements]);

  // 2. currentEvent가 변경되면 현재 이벤트에 해당하는 그래프만 표시
  useEffect(() => {
    if (!currentEvent || !isDataReady) return;

    // currentEventElements가 이미 현재 이벤트에 해당하는 그래프를 생성했으므로
    // 추가 필터링 없이 바로 사용
    if (currentEventElements.length > 0) {
      // 고립 노드 필터링 적용
      const filteredWithIsolation = filterIsolatedNodes(currentEventElements, hideIsolated);

      let nodePositions = {};
      try {
        const posStr = localStorage.getItem(
          `chapter_node_positions_${currentChapter}`
        );
        if (posStr) nodePositions = JSON.parse(posStr);
      } catch (e) {}

      const sorted = filteredWithIsolation
        .slice()
        .sort((a, b) => {
          const aId =
            a.data?.id ||
            (a.data?.source ? a.data?.source + "-" + a.data?.target : "");
          const bId =
            b.data?.id ||
            (b.data?.source ? b.data?.source + "-" + b.data?.target : "");
          return aId.localeCompare(bId);
        })
        .map((el) => {
          if (el.data.id && nodePositions[el.data.id]) {
            return { ...el, position: nodePositions[el.data.id] };
          }
          return el;
        });

      setElements(sorted);
    }
  }, [currentEvent, currentEventElements, currentChapter, hideIsolated, isDataReady]);

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
      const eventKey = `graph_event_layout_chapter_${currentChapter}_event_${currentEvent.eventNum}`;
      localStorage.setItem(eventKey, JSON.stringify(partialLayout));
      
      // 전체 챕터 레이아웃도 업데이트 (누적)
      const chapterKey = `graph_partial_layout_chapter_${currentChapter}`;
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
        const eventKey = `graph_event_layout_chapter_${currentChapter}_event_${eventNum}`;
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
    // 챕터 번호 1~9 (data 폴더 기준)
    const chapterNums = Array.from({ length: 9 }, (_, i) => i + 1);
    chapterNums.forEach((chapterNum) => {
      const storageKey = `chapter_node_positions_${chapterNum}`;
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
  }, []);


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
              currentCharIndex={currentCharIndex}
              hideIsolated={hideIsolated}
              setHideIsolated={setHideIsolated}
              edgeLabelVisible={edgeLabelVisible}
              setEdgeLabelVisible={setEdgeLabelVisible}
              handleFitView={handleFitView}
              currentChapter={currentChapter}
              setCurrentChapter={setCurrentChapter}
              maxChapter={maxChapter}
              loading={loading}
              isDataReady={isDataReady}
              showGraph={showGraph}
              graphFullScreen={graphFullScreen}
              setGraphFullScreen={setGraphFullScreen}
              navigate={navigate}
              filename={filename}
              book={book}
              viewerRef={viewerRef}
              currentEvent={currentEvent}
              prevValidEvent={prevValidEventRef.current}
              prevEvent={prevEvent}
              events={getEventsForChapter(currentChapter)}
              graphDiff={graphDiff}
              prevElements={prevElementsRef.current}
              currentElements={elements}
              // 검색 관련 props
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              elements={elements}
              onSearchSubmit={handleSearchSubmit}
              clearSearch={clearSearch}
              currentChapterData={currentChapterData}
              closeSuggestions={closeSuggestions}
              onGenerateSuggestions={setSearchTerm}
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
          onCurrentLineChange={(charIndex, totalEvents, currentEvent) => {
            setCurrentCharIndex(charIndex);
            setTotalChapterWords(totalEvents || 0);
            setCurrentEvent(currentEvent);
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

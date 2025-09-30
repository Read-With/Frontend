import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { ToastContainer } from "react-toastify";
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
import { getAllProgress, saveProgress, getBookProgress, getBookManifest, getFineGraph } from "../../utils/common/api";
import { 
  parseCfiToChapterDetail, 
  extractEventNodesAndEdges
} from "../../utils/viewerUtils";
import { applyBookmarkHighlights, removeBookmarkHighlights } from "./bookmark/BookmarkManager";
import { 
  getEventsForChapter,
  getDetectedMaxChapter,
  getCharactersData,
  getChapterFile,
  getElementsFromRelations
} from "../../utils/graphData";
import { calcGraphDiff, convertRelationsToElements, filterMainCharacters } from "../../utils/graphDataUtils";
import { createCharacterMaps } from "../../utils/characterUtils";
import { processTooltipData } from "../../utils/graphUtils";


function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
  tooltipProps,
  transitionStates,
  apiError,
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const { isEventUndefined, isEventTransition, isChapterTransition } = transitionStates;
  const graphContainerRef = React.useRef(null);
  const { isSearchActive, filteredElements, isResetFromSearch } = searchState;
  const { loading, isReloading, isGraphLoading, isDataReady } = viewerState;
  const { elements } = graphState;
  const { filterStage } = graphActions;

  const filteredMainCharacters = React.useMemo(() => {
    return filterMainCharacters(elements, filterStage);
  }, [elements, filterStage]);

  const finalElements = React.useMemo(() => {
    if (isSearchActive && filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return elements;
  }, [isSearchActive, filteredElements, filterStage, filteredMainCharacters, elements]);

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
        {loading || isReloading || isGraphLoading || !isDataReady ? (
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
              color: '#4F6DDE',
              animation: 'spin 1s linear infinite'
            }}>
              ⏳
            </div>
            <h3 style={{
              color: '#495057',
              marginBottom: '12px',
              fontSize: '18px',
              fontWeight: '600'
            }}>
              {isChapterTransition ? '챕터 전환 중...' : '그래프 정보를 불러오는 중...'}
            </h3>
            <p style={{
              color: '#6c757d',
              marginBottom: '20px',
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              {isChapterTransition ? '새로운 챕터의 이벤트를 준비하고 있습니다.' : '관계 데이터를 분석하고 있습니다.'}
            </p>
          </div>
        ) : apiError ? (
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
              color: '#dc3545'
            }}>
              ❌
            </div>
            <h3 style={{
              color: '#495057',
              marginBottom: '12px',
              fontSize: '18px',
              fontWeight: '600'
            }}>
              {apiError.message}
            </h3>
            <p style={{
              color: '#6c757d',
              marginBottom: '20px',
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              {apiError.details}
            </p>
            <button
              onClick={apiError.retry}
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
              다시 시도
            </button>
          </div>
        ) : isEventUndefined ? (
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
            elements={finalElements}
            isResetFromSearch={isResetFromSearch}
            prevValidEvent={graphState.currentEvent && graphState.currentEvent.chapter === graphState.currentChapter ? graphState.currentEvent : null}
            events={graphState.events || []}
            activeTooltip={activeTooltip}
            onClearTooltip={onClearTooltip}
            onSetActiveTooltip={onSetActiveTooltip}
            graphClearRef={graphClearRef}
            isEventTransition={isEventTransition}
          />
        )}
      </div>
    </div>
  );
}

const ViewerPage = () => {
  const {
    viewerRef, reloadKey, progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal, setShowSettingsModal,
    settings, setSettings, currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    events, setEvents, showGraph, setShowGraph, elements, graphViewState, setGraphViewState,
    graphDiff, setGraphDiff, currentCharIndex, setCurrentCharIndex,
    totalChapterWords, setTotalChapterWords, loading, setLoading,
    isDataReady, setIsDataReady, characterData, setCharacterData, isReloading, setIsReloading,
    isGraphLoading, setIsGraphLoading, showToolbar, setShowToolbar,
    bookmarks, setBookmarks, showBookmarkList, setShowBookmarkList,
    prevElementsRef, book, folderKey, currentChapterData,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, toggleGraph, handleLocationChange,
    graphState, graphActions, viewerState, searchState, graphFullScreen, setGraphFullScreen,
  } = useViewerPage();


  const [activeTooltip, setActiveTooltip] = useState(null);
  const graphClearRef = useRef(null);
  const [isEventUndefined, setIsEventUndefined] = useState(false);
  const [isEventTransition, setIsEventTransition] = useState(false);
  const [isChapterTransition, setIsChapterTransition] = useState(false);
  const prevEventRef = useRef(null);
  const prevChapterRef = useRef(null);
  
  const handleClearTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  const handleClearTooltipAndGraph = useCallback(() => {
    setActiveTooltip(null);
    if (graphClearRef.current) {
      graphClearRef.current();
    }
  }, []);

  const handleSetActiveTooltip = useCallback((tooltipData) => {
    const processedTooltipData = processTooltipData(tooltipData, tooltipData.type);
    setActiveTooltip(processedTooltipData);
  }, []);

  const viewerPageRef = useClickOutside(handleClearTooltipAndGraph, !!activeTooltip);

  const testProgressAPI = useCallback(async () => {
    if (!book?.id) return;
    
    try {
      await getAllProgress();
      
      try {
        await getBookProgress(book.id);
      } catch (progressError) {
        if (!progressError.message.includes('404') && !progressError.message.includes('찾을 수 없습니다')) {
          console.error('독서 진도 조회 실패:', progressError);
        }
      }
      
      await getBookManifest(book.id);
      setManifestLoaded(true);
      
    } catch (error) {
      console.error('독서 진도 API 호출 실패:', error);
    }
  }, [book?.id]);

  useEffect(() => {
    testProgressAPI();
  }, [testProgressAPI]);

  const [manifestLoaded, setManifestLoaded] = useState(false);
  const [apiError, setApiError] = useState(null);
  const apiCallRef = useRef(null);
  
  useEffect(() => {
    let isMounted = true;
    
    const loadMacroGraphData = async () => {
      const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
      
      if (!book?.id || !isApiBook || !currentChapter || !manifestLoaded) {
        return;
      }
      
      const eventIdx = 3;
      const callKey = `${book.id}-${currentChapter}-${eventIdx}`;
      if (apiCallRef.current === callKey) {
        return;
      }
      apiCallRef.current = callKey;
       
      try {
        if (!book?.id || !currentChapter || eventIdx < 0) {
          if (isMounted) {
            setApiMacroData(null);
          }
          return;
        }
        
        const fineData = await getFineGraph(book.id, currentChapter, eventIdx);
        
        if (!isMounted) return;
        
        let convertedElements = [];
        if (fineData.result.characters && fineData.result.relations) {
          const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(fineData.result.characters);
          convertedElements = convertRelationsToElements(
            fineData.result.relations,
            idToName,
            idToDesc,
            idToMain,
            idToNames,
            'api',
            null,
            null
          );
          
          if (convertedElements.length > 0 && isMounted) {
            graphActions.setElements(convertedElements);
            
            if (!events || events.length === 0) {
              const apiEvent = fineData.result.event;
              const defaultEvent = {
                chapter: apiEvent?.chapterIdx || currentChapter,
                eventNum: apiEvent?.event_id || eventIdx,
                cfi: "epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/2/1:3)",
                relations: fineData.result.relations || [],
                start: apiEvent?.start,
                end: apiEvent?.end
              };
              setEvents([defaultEvent]);
              setCurrentEvent(defaultEvent);
            }
          }
        }
        
      } catch (error) {
        if (isMounted) {
          console.error('세밀그래프 API 호출 실패:', error);
          setApiError({
            message: '그래프 데이터를 불러오는데 실패했습니다.',
            details: error.message || '알 수 없는 오류가 발생했습니다.',
            retry: () => {
              setApiError(null);
              apiCallRef.current = null;
            }
          });
        }
      }
    };

    loadMacroGraphData();
    
    return () => {
      isMounted = false;
    };
  }, [book?.id, currentChapter, manifestLoaded, graphActions, events]);

  useEffect(() => {
    const autoSaveProgress = async () => {
      if (!book?.id || !currentChapter || typeof book.id !== 'number') return;
      
      try {
        const progressData = {
          bookId: book.id,
          chapterIdx: currentChapter || 1,
          eventIdx: currentEvent?.eventNum || 0,
          cfi: currentEvent?.cfi || "epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/2/1:3)"
        };
        
        await saveProgress(progressData);
        
      } catch (error) {
        console.error('진도 자동 저장 실패:', error);
      }
    };

    const timeoutId = setTimeout(autoSaveProgress, 2000);
    return () => clearTimeout(timeoutId);
  }, [book?.id, currentChapter, currentEvent]);

  useEffect(() => {
    if (bookmarks && bookmarks.length > 0) {
      const timer = setTimeout(() => {
        applyBookmarkHighlights(bookmarks);
      }, 500);
      
      return () => {
        clearTimeout(timer);
        removeBookmarkHighlights();
      };
    }
  }, [bookmarks, currentChapter]);

  useEffect(() => {
    const checkEventStatus = () => {
      if (loading || isReloading || isGraphLoading || !isDataReady || isChapterTransition) {
        setIsEventUndefined(false);
        return;
      }

      const isEventInvalid = 
        !currentEvent ||
        currentEvent.eventNum === undefined || currentEvent.eventNum === null ||
        currentEvent.chapter === undefined || currentEvent.chapter === null ||
        !events || events.length === 0;

      setIsEventUndefined(isEventInvalid);
    };

    checkEventStatus();
  }, [currentEvent, currentChapter, events, loading, isReloading, isDataReady, isGraphLoading, isChapterTransition]);

  useEffect(() => {
    if (currentEvent && prevEventRef.current) {
      const prevEvent = prevEventRef.current;
      const isEventChanged = 
        prevEvent.eventNum !== currentEvent.eventNum ||
        prevEvent.chapter !== currentEvent.chapter;
      
      if (isEventChanged) {
        setIsEventTransition(true);
        
        setTimeout(() => {
          setIsEventTransition(false);
        }, 200);
      }
    }
    
    if (currentEvent) {
      prevEventRef.current = currentEvent;
    }
  }, [currentEvent]);

  useEffect(() => {
    const handleChapterTransition = () => {
      if (prevChapterRef.current !== null && prevChapterRef.current !== currentChapter) {
        setIsChapterTransition(true);
      }
      prevChapterRef.current = currentChapter;
    };

    handleChapterTransition();
  }, [currentChapter]);

  const loadEventsData = useCallback(async () => {
    const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
    if (isApiBook) {
      setIsDataReady(true);
      setIsChapterTransition(false);
      return;
    }
    
    try {
      setLoading(true);
      setIsGraphLoading(true);
      setIsDataReady(false);
      
      if (!currentChapter || currentChapter < 1) {
        setIsDataReady(true);
        setIsChapterTransition(false);
        return;
      }
      
      const events = getEventsForChapter(currentChapter, folderKey);
      
      const validEvents = events.filter(event => {
        return event.chapter === currentChapter;
      });
      
      setEvents(validEvents);
      
      if (validEvents.length > 0 && isChapterTransition) {
        const firstEvent = validEvents[0];
        setCurrentEvent(firstEvent);
      }
      
      try {
        const charData = getCharactersData(folderKey, currentChapter);
        if (charData && charData.characters) {
          setCharacterData(charData.characters);
        } else {
          setCharacterData([]);
        }
      } catch (charError) {
        setCharacterData(currentChapterData?.characters || currentChapterData || []);
      }
      
      setIsDataReady(true);
      setIsChapterTransition(false);
    } catch (error) {
      setIsDataReady(true);
      setIsChapterTransition(false);
    } finally {
      setLoading(false);
      setIsGraphLoading(false);
    }
  }, [book, currentChapter, folderKey, isChapterTransition, currentChapterData, setLoading, setIsGraphLoading, setIsDataReady, setIsChapterTransition, setEvents, setCurrentEvent, setCharacterData]);

  useEffect(() => {
    if (currentChapter && currentChapter > 0 && graphState.isInitialChapterDetected) {
      loadEventsData();
    } else if (currentChapter && currentChapter > 0 && !graphState.isInitialChapterDetected) {
      const timer = setTimeout(() => {
        if (currentChapter && currentChapter > 0) {
          loadEventsData();
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [currentChapter, graphState.isInitialChapterDetected, loadEventsData]);


  const {
    searchTerm, isSearchActive, filteredElements,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    selectSuggestion, handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  useEffect(() => {
    if (!isDataReady || !currentEvent) return;
    
    try {
      const mergedLayout = {};
      const currentEventNum = currentEvent.eventNum || 0;
      
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
      
      const { nodes: currentNodes, edges: currentEdges } = extractEventNodesAndEdges(currentEvent);
      
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
  }, [isDataReady, currentEvent, elements, currentChapter]);

  useEffect(() => {
    if (!elements) return;
    const prev = prevElementsRef.current || [];
    const diff = calcGraphDiff(prev, elements);
    setGraphDiff(diff);
    prevElementsRef.current = elements;
  }, [elements]);



  useEffect(() => {
    let isMounted = true;
    const cyInstances = [];
    
    const preloadChapterLayouts = async () => {
      const maxChapterCount = getDetectedMaxChapter(folderKey);
      if (maxChapterCount === 0) return;
      
      const chapterNums = Array.from({ length: maxChapterCount }, (_, i) => i + 1);
      
      for (let i = 0; i < chapterNums.length; i += 3) {
        if (!isMounted) break;
        
        const batch = chapterNums.slice(i, i + 3);
        const promises = batch.map(async (chapterNum) => {
          const storageKey = createStorageKey.chapterNodePositions(chapterNum);
          if (localStorage.getItem(storageKey)) {
            return;
          }
          
          try {
            const charactersData = getChapterFile(chapterNum, "characters", folderKey);
            if (!charactersData) return;
            
            const events = getEventsForChapter(chapterNum, folderKey);
            if (!events || events.length === 0) return;
            
            const lastEvent = events[events.length - 1];
            const allRelations = lastEvent.relations || [];
            const allImportance = lastEvent.importance || {};
            const allNewAppearances = lastEvent.new_appearances || [];
            const elements = getElementsFromRelations(
              allRelations,
              charactersData,
              allNewAppearances,
              allImportance,
              chapterNum,
              folderKey
            );
            if (!elements || elements.length === 0) return;
            
            const cy = cytoscape({
              elements,
              style: [],
              headless: true,
            });
            cyInstances.push(cy);
            
            const layout = cy.layout({
              name: "cose",
              animate: false,
              fit: true,
              padding: 80,
            });
            
            await new Promise(resolve => {
              layout.one('layoutstop', resolve);
              layout.run();
            });
            
            const layoutObj = {};
            cy.nodes().forEach((node) => {
              layoutObj[node.id()] = node.position();
            });
            
            try {
              localStorage.setItem(storageKey, JSON.stringify(layoutObj));
            } catch (e) {
              // 로컬 스토리지 저장 실패 무시
            }
            
            cy.destroy();
          } catch (error) {
            // 챕터 레이아웃 생성 실패 무시
          }
        });
        
        await Promise.all(promises);
        
        if (i + 3 < chapterNums.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };
    
    preloadChapterLayouts();
    
    return () => {
      isMounted = false;
      cyInstances.forEach(cy => {
        try {
          cy.destroy();
        } catch (e) {
          // 이미 정리된 경우 무시
        }
      });
    };
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
                prevValidEvent: currentEvent && currentEvent.chapter === currentChapter ? currentEvent : null,
                events: getEventsForChapter(currentChapter, folderKey)
              }}
              graphActions={graphActions}
              viewerState={viewerState}
              searchState={{
                ...searchState,
                searchTerm,
                isSearchActive,
                elements: elements,
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
              tooltipProps={{
                activeTooltip,
                onClearTooltip: handleClearTooltip,
                onSetActiveTooltip: handleSetActiveTooltip,
                graphClearRef
              }}
              transitionStates={{
                isEventUndefined,
                isEventTransition,
                isChapterTransition
              }}
              apiError={apiError}
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
            
            if (receivedEvent) {
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
                  fontFamily: "Noto Serif KR",
                }}
              >
                위치: {parseCfiToChapterDetail(bm.cfi)}
              </span>
            ))}
          </BookmarkPanel>
        )}

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
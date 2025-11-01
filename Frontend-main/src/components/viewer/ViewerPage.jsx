import React, { useRef, useState, useEffect, useCallback } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import cytoscape from "cytoscape";
// CytoscapeGraphPortalProvider는 뷰어페이지에서 사용하지 않음
import GraphContainer from "../graph/GraphContainer";
import ViewerLayout from "./ViewerLayout";
import EpubViewer from "./epub/EpubViewer";
import BookmarkPanel from "./bookmark/BookmarkPanel";
import ViewerSettings from "./epub/ViewerSettings";
import ViewerTopBar from "./ViewerTopBar";
import { useViewerPage } from "../../hooks/useViewerPage";
import { useGraphSearch } from "../../hooks/useGraphSearch";
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
  getCharactersDataFromMaxChapter,
  getChapterFile
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
  transitionState,
  apiError,
  isFromLibrary = false,
  previousPage = null,
  bookId = null,
  book = null,
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const graphContainerRef = React.useRef(null);
  const { isSearchActive, filteredElements, isResetFromSearch } = searchState;
  const { loading, isReloading, isGraphLoading, isDataReady } = viewerState;
  const { elements, currentEvent, currentChapter } = graphState;
  const { filterStage } = graphActions;
  
  const isApiBook = React.useMemo(() => {
    if (book && (typeof book.id === 'number' || book.isFromAPI === true)) {
      return true;
    }
    if (bookId && (typeof bookId === 'number' || !isNaN(parseInt(bookId, 10)))) {
      return true;
    }
    return false;
  }, [book, bookId]);
  
  const isLocationDetermined = React.useMemo(() => {
    if (!currentChapter || currentChapter < 1) {
      return false;
    }
    if (isApiBook && !currentEvent) {
      return false;
    }
    return true;
  }, [currentChapter, currentEvent, isApiBook]);

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
        isFromLibrary={isFromLibrary}
        previousPage={previousPage}
      />
      
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        {loading || isReloading || isGraphLoading || !isDataReady || !isLocationDetermined ? (
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
              color: '#5C6F5C',
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
              {!isLocationDetermined ? '위치 정보를 확인하는 중...' : 
               transitionState.type === 'chapter' ? '챕터 전환 중...' : 
               '그래프 정보를 불러오는 중...'}
            </h3>
            <p style={{
              color: '#6c757d',
              marginBottom: '20px',
              fontSize: '14px',
              lineHeight: '1.5',
              wordBreak: 'keep-all'
            }}>
              {!isLocationDetermined ? '현재 읽고 있는 위치를 파악하고 있습니다. 잠시만 기다려주세요.' :
               transitionState.type === 'chapter' ? '새로운 챕터의 이벤트를 준비하고 있습니다.' : 
               '관계 데이터를 분석하고 있습니다.'}
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
              lineHeight: '1.5',
              wordBreak: 'keep-all'
            }}>
              {apiError.details}
            </p>
            <button
              onClick={apiError.retry}
              style={{
                backgroundColor: '#5C6F5C',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#4A5A4A'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#5C6F5C'}
            >
              다시 시도
            </button>
          </div>
        ) : transitionState.error ? (
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
            일시적인 오류가 발생했습니다
          </h3>
          <p style={{
            color: '#6c757d',
            marginBottom: '20px',
            fontSize: '14px',
            lineHeight: '1.5',
            wordBreak: 'keep-all'
          }}>
            새로고침하면 정상적으로 작동할 것입니다.
          </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#5C6F5C',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#4A5A4A'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#5C6F5C'}
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
            isEventTransition={transitionState.type === 'event' && transitionState.inProgress}
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
    events, setEvents, showGraph, setShowGraph, elements, setElements, graphViewState, setGraphViewState,
    currentCharIndex, setCurrentCharIndex,
    loading, setLoading,
    isDataReady, setIsDataReady, isReloading, setIsReloading,
    isGraphLoading, setIsGraphLoading, showToolbar, setShowToolbar,
    bookmarks, setBookmarks, showBookmarkList, setShowBookmarkList,
    prevElementsRef, book, folderKey, currentChapterData,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, toggleGraph, handleLocationChange,
    graphState, graphActions, viewerState, searchState, graphFullScreen, setGraphFullScreen,
    previousPage, isFromLibrary, bookId,
  } = useViewerPage();


  const [activeTooltip, setActiveTooltip] = useState(null);
  const graphClearRef = useRef(null);
  const lastTooltipOpenAtRef = useRef(0);
  const activeTooltipRef = useRef(null);
  
  // activeTooltip 상태 변화 추적 - 제거됨
  
  const [transitionState, setTransitionState] = useState({
    type: null,
    inProgress: false,
    error: false,
    direction: null // 'forward' or 'backward'
  });
  
  const prevEventRef = useRef(null);
  const prevChapterRef = useRef(null);
  
  
  const handleClearTooltip = useCallback(() => {
    const now = Date.now();
    if (now - lastTooltipOpenAtRef.current < 150) {
      return;
    }
    setActiveTooltip(null);
  }, []);

  const handleClearTooltipAndGraph = useCallback(() => {
    const now = Date.now();
    if (now - lastTooltipOpenAtRef.current < 150) {
      return;
    }
    setActiveTooltip(null);
    if (graphClearRef.current) {
      graphClearRef.current();
    }
  }, []);

  const handleSetActiveTooltip = useCallback((tooltipData) => {
    const processedTooltipData = processTooltipData(tooltipData, tooltipData.type);
    lastTooltipOpenAtRef.current = Date.now();
    setActiveTooltip(processedTooltipData);
    // 툴팁 표시 실패 알림 (열림 직후 곧바로 닫힌 경우)
    setTimeout(() => {
      if (!activeTooltipRef.current) {
        toast.error("툴팁 표시에 문제가 발생했습니다. 페이지를 새로고침 해주세요.", {
          autoClose: 2000,
          closeOnClick: true,
          pauseOnHover: true
        });
      }
    }, 220);
  }, []);

  // ViewerPage에서는 useClickOutside를 사용하지 않음 (툴팁 컴포넌트 자체에서 처리)
  const viewerPageRef = useRef(null);
  
  // activeTooltip 최신값을 ref로 유지 (watchdog 용)
  useEffect(() => {
    activeTooltipRef.current = activeTooltip;
  }, [activeTooltip]);

  const [savedProgress, setSavedProgress] = useState(null);
  const [isProgressLoaded, setIsProgressLoaded] = useState(false);

  const testProgressAPI = useCallback(async () => {
    if (!book?.id) return;
    
    const isLocalBook = !book.id || typeof book.id === 'string' || bookId.includes('.epub') || isNaN(parseInt(bookId, 10));
    
    if (isLocalBook) {
      setManifestLoaded(true);
      setIsProgressLoaded(true);
      return;
    }
    
    try {
      try {
        const bookProgressResponse = await getBookProgress(book.id);
        if (bookProgressResponse.isSuccess && bookProgressResponse.result) {
          const progressData = bookProgressResponse.result;
          setSavedProgress(progressData);
        }
      } catch (progressError) {
        if (!progressError.message.includes('404') && !progressError.message.includes('찾을 수 없습니다')) {
          console.error('독서 진도 조회 실패:', progressError);
        }
      }
      
      const manifestResponse = await getBookManifest(book.id);
      if (manifestResponse.isSuccess) {
        setManifestData(manifestResponse.result);
      }
      
      setManifestLoaded(true);
      setIsProgressLoaded(true);
      
    } catch (error) {
      setManifestLoaded(true);
      setIsProgressLoaded(true);
    }
  }, [book?.id]);

  useEffect(() => {
    if (savedProgress && viewerRef.current && isProgressLoaded && !loading) {
      const restoreProgress = async () => {
        try {
          if (savedProgress.chapterIdx && savedProgress.chapterIdx !== currentChapter) {
            setCurrentChapter(savedProgress.chapterIdx);
          }
          
          if (savedProgress.cfi && viewerRef.current?.displayAt) {
            await viewerRef.current.displayAt(savedProgress.cfi);
          }
        } catch (error) {
          console.error('진도 복원 실패:', error);
        }
      };
      
      const timer = setTimeout(restoreProgress, 1000);
      return () => clearTimeout(timer);
    }
  }, [savedProgress, isProgressLoaded, loading]);

  useEffect(() => {
    testProgressAPI();
  }, [testProgressAPI]);

  const [manifestLoaded, setManifestLoaded] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [manifestData, setManifestData] = useState(null);
  const apiCallRef = useRef(null);
  const isChapterTransitionRef = useRef(false);
  const setElementsRef = useRef(setElements);
  
  useEffect(() => {
    setElementsRef.current = setElements;
  }, [setElements]);
  
  useEffect(() => {
    if (transitionState.type === 'chapter') {
      isChapterTransitionRef.current = true;
    } else {
      isChapterTransitionRef.current = false;
    }
  }, [transitionState.type]);
  
  useEffect(() => {
    let isMounted = true;
    
    const loadGraphData = async () => {
        const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
        
        if (isApiBook) {
          if (!book?.id || !currentChapter || !manifestLoaded) {
            return;
          }
          
          let eventIdx = currentEvent?.eventNum || 0;
          
          if (isChapterTransitionRef.current) {
            const direction = transitionState.direction;
            
            if (direction === 'backward' && manifestData?.chapters) {
              const chapterInfo = manifestData.chapters.find(ch => ch.chapter === currentChapter || ch.chapterIdx === currentChapter);
              if (chapterInfo && chapterInfo.eventCount > 0) {
                eventIdx = chapterInfo.eventCount - 1;
              }
            } else if (direction === 'forward') {
              eventIdx = 0;
            }
          }
          
          const callKey = `${book.id}-${currentChapter}-${eventIdx}`;
          if (apiCallRef.current === callKey) {
            return;
          }
          apiCallRef.current = callKey;
         
        try {
          if (!book?.id || !currentChapter || eventIdx < 0) {
            return;
          }
          
          const fineData = await getFineGraph(book.id, currentChapter, eventIdx);
          
          if (!isMounted) return;
          
          let convertedElements = [];
          if (fineData.result.characters && fineData.result.relations && 
              fineData.result.characters.length > 0 && fineData.result.relations.length > 0) {
            const { idToName, idToDesc, idToDescKo, idToMain, idToNames } = createCharacterMaps(fineData.result.characters);
            convertedElements = convertRelationsToElements(
              fineData.result.relations,
              idToName,
              idToDesc,
              idToDescKo,
              idToMain,
              idToNames,
              'api',
              null,
              null,
              fineData.result.event
            );
            
            if (convertedElements.length > 0 && isMounted) {
              setElementsRef.current(convertedElements);
              
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
          
          if (isChapterTransitionRef.current) {
            isChapterTransitionRef.current = false;
          }
          
          if (isMounted) {
            setIsDataReady(true);
            setTransitionState({ type: null, inProgress: false, error: false, direction: null });
            setApiError(null);
          }
          
        } catch (error) {
          if (isMounted) {
            if (error.message.includes('404') || error.message.includes('찾을 수 없습니다')) {
              setApiError(null);
            } else {
              setApiError({
                message: '그래프 데이터를 불러오는데 실패했습니다.',
                details: error.message || '알 수 없는 오류가 발생했습니다.',
                retry: () => {
                  setApiError(null);
                  apiCallRef.current = null;
                }
              });
            }
            setIsDataReady(true);
            setTransitionState({ type: null, inProgress: false, error: false, direction: null });
          }
        }
        
        return;
      }
      
      try {
        setLoading(true);
        setIsGraphLoading(true);
        setIsDataReady(false);
        
        if (!currentChapter || currentChapter < 1) {
          setIsDataReady(true);
          setTransitionState({ type: null, inProgress: false, error: false, direction: null });
          return;
        }
        
        const localEvents = getEventsForChapter(currentChapter, folderKey);
        
        const validEvents = localEvents.filter(event => {
          return event.chapter === currentChapter;
        });
        
        if (!isMounted) return;
        
        setEvents(validEvents);
        
        if (validEvents.length > 0 && isChapterTransitionRef.current) {
          const direction = transitionState.direction;
          const targetEvent = direction === 'backward'
            ? validEvents[validEvents.length - 1] 
            : validEvents[0];
          
          setCurrentEvent(targetEvent);
          isChapterTransitionRef.current = false;
        }
        
        try {
          const charData = getCharactersDataFromMaxChapter(folderKey);
          // characterData는 현재 사용되지 않음
        } catch (charError) {
          // characterData는 현재 사용되지 않음
        }
        
        if (isMounted) {
          setIsDataReady(true);
          setTransitionState({ type: null, inProgress: false, error: false, direction: null });
        }
      } catch (error) {
        if (isMounted) {
          setIsDataReady(true);
          setTransitionState({ type: null, inProgress: false, error: false, direction: null });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setIsGraphLoading(false);
        }
      }
    };

    loadGraphData();
    
    return () => {
      isMounted = false;
    };
  }, [
    book?.id, 
    currentChapter, 
    manifestLoaded, 
    folderKey,
    currentEvent?.eventNum,  // API 책의 이벤트 변경 감지
    transitionState.direction  // 챕터 전환 방향 감지
    // graphActions, currentChapterData는 제외 (무한 루프 방지)
  ]);

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
        
        const response = await saveProgress(progressData);
        
        if (response.isSuccess) {
          // 성공
        } else {
          console.warn('진도 저장 실패:', response.message);
        }
        
      } catch (error) {
        // 저장 실패
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
      if (loading || isReloading || isGraphLoading || !isDataReady || transitionState.type === 'chapter') {
        setTransitionState(prev => ({ ...prev, error: false }));
        return;
      }

      setTransitionState(prev => ({ ...prev, error: false }));
    };

    checkEventStatus();
  }, [currentEvent, currentChapter, events, loading, isReloading, isDataReady, isGraphLoading, transitionState.type]);

  useEffect(() => {
    if (currentEvent && prevEventRef.current) {
      const prevEvent = prevEventRef.current;
      const isEventChanged = 
        prevEvent.eventNum !== currentEvent.eventNum ||
        prevEvent.chapter !== currentEvent.chapter;
      
      if (isEventChanged) {
        setTransitionState({ type: 'event', inProgress: true, error: false, direction: null });
        
        setTimeout(() => {
          setTransitionState({ type: null, inProgress: false, error: false, direction: null });
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
        const direction = prevChapterRef.current > currentChapter ? 'backward' : 'forward';
        setTransitionState({ 
          type: 'chapter', 
          inProgress: true, 
          error: false,
          direction 
        });
      }
      prevChapterRef.current = currentChapter;
    };

    handleChapterTransition();
  }, [currentChapter]);



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
              // 파싱 오류
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
      // 복원 오류
    }
  }, [isDataReady, currentEvent, elements, currentChapter]);

  useEffect(() => {
    if (!elements) return;
    const prev = prevElementsRef.current || [];
    // graphDiff는 현재 사용되지 않음
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
            if (!folderKey) {
              return;
            }
            
            const characterDataObj = getCharactersDataFromMaxChapter(folderKey);
            if (!characterDataObj) return;
            
            const charactersData = characterDataObj.characters || characterDataObj;
            if (!charactersData || !Array.isArray(charactersData) || charactersData.length === 0) return;
            
            const events = getEventsForChapter(chapterNum, folderKey);
            if (!events || events.length === 0) return;
            
            const lastEvent = events[events.length - 1];
            const allRelations = lastEvent.relations || [];
            
            const { idToName, idToDesc, idToDescKo, idToMain, idToNames } = createCharacterMaps({ characters: charactersData });
            
            const elements = convertRelationsToElements(
              allRelations,
              idToName,
              idToDesc,
              idToDescKo,
              idToMain,
              idToNames,
              folderKey,
              null, // nodeWeights
              null, // previousRelations
              lastEvent // eventData
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
              // 저장 실패
            }
            
            cy.destroy();
          } catch (error) {
            // 생성 실패
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
          // 정리됨
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
        isFromLibrary={isFromLibrary}
        previousPage={previousPage}
        rightSideContent={
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
            transitionState={transitionState}
            apiError={apiError}
            isFromLibrary={isFromLibrary}
            previousPage={previousPage}
            bookId={bookId}
            book={book}
          />
        }
      >
        <EpubViewer
          key={reloadKey}
          ref={viewerRef}
          book={book}
          reloadKey={reloadKey}
          initialChapter={currentChapter}
          initialPage={currentPage}
          initialProgress={progress}
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
            
            if (receivedEvent) {
              if (receivedEvent.chapter && receivedEvent.chapter !== currentChapter) {
                setCurrentChapter(receivedEvent.chapter);
              }
              
              setCurrentEvent(receivedEvent);
            }
          }}
          onRelocated={handleLocationChange}
        />
        {showBookmarkList && (
          <BookmarkPanel bookmarks={bookmarks} onSelect={handleBookmarkSelect}>
            {bookmarks.map((bm) => (
              <span
                key={bm.cfi}
                style={{
                  fontSize: "0.98rem",
                  color: "#5C6F5C",
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
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
import { getBookProgress, getFineGraph, getBookManifest } from "../../utils/api/api";
import { setProgressToCache } from "../../utils/common/cache/progressCache";
import { getGraphEventState, getCachedReaderProgress, setCachedReaderProgress, getCachedChapterEvents } from "../../utils/common/cache/chapterEventCache";
import { getManifestFromCache, setManifestData as cacheManifestData } from "../../utils/common/cache/manifestCache";
import { 
  extractEventNodesAndEdges,
  getServerBookId,
  eventUtils,
  transitionUtils,
  bookUtils
} from "../../utils/viewerUtils";
import { applyBookmarkHighlights, removeBookmarkHighlights } from "./bookmark/BookmarkManager";
import { 
  getEventsForChapter,
  getDetectedMaxChapter,
  getCharactersDataFromMaxChapter,
  getEventDataByIndex
} from "../../utils/graphData";
import { convertRelationsToElements, filterMainCharacters, filterRelationsByTimeline } from "../../utils/graphDataUtils";
import { createCharacterMaps, buildNodeWeights } from "../../utils/characterUtils";
import { processTooltipData } from "../../utils/graphUtils";
import { getRelationKeyFromRelation } from "../../utils/relationUtils";

function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState = {},
  searchActions,
  tooltipProps,
  transitionState,
  apiError,
  isFromLibrary = false,
  previousPage = null,
  bookId = null,
  book = null,
  cachedLocation = null,
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const graphContainerRef = React.useRef(null);
  const searchTermValue = searchState?.searchTerm ?? "";
  const isSearchActiveValue = searchState?.isSearchActive ?? false;
  const filteredElementsValue = searchState?.filteredElements ?? [];
  const isResetFromSearchValue = searchState?.isResetFromSearch ?? false;
  const searchFitNodeIds = searchState?.fitNodeIds ?? [];
  const suggestionsValue = searchState?.suggestions ?? [];
  const showSuggestionsValue = searchState?.showSuggestions ?? false;
  const selectedSuggestionIndex = searchState?.selectedIndex ?? -1;
  
  const { loading, isReloading, isGraphLoading, isDataReady } = viewerState;
  const { elements, currentEvent, currentChapter } = graphState;
  const { filterStage } = graphActions;
  
  const isApiBook = React.useMemo(() => {
    return bookUtils.isApiBook(book, bookId);
  }, [book, bookId]);
  
  const hasCachedLocation = React.useMemo(() => {
    if (!cachedLocation) {
      return false;
    }
    const cachedChapter = Number(cachedLocation.chapterIdx);
    if (!Number.isFinite(cachedChapter) || cachedChapter < 1) {
      return false;
    }
    if (isApiBook) {
      const cachedEvent = Number(cachedLocation.eventIdx ?? cachedLocation.eventNum ?? 0);
      return Number.isFinite(cachedEvent) && cachedEvent > 0;
    }
    return true;
  }, [cachedLocation, isApiBook]);

  const isLocationDetermined = React.useMemo(() => {
    if (!currentChapter || currentChapter < 1) {
      return hasCachedLocation;
    }
    if (isApiBook && !currentEvent) {
      return hasCachedLocation;
    }
    return true;
  }, [currentChapter, currentEvent, isApiBook, hasCachedLocation]);

  const filteredMainCharacters = React.useMemo(() => {
    return filterMainCharacters(elements, filterStage);
  }, [elements, filterStage]);

  const finalElements = React.useMemo(() => {
    if (isSearchActiveValue && filteredElementsValue && filteredElementsValue.length > 0) {
      return filteredElementsValue;
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return elements;
  }, [isSearchActiveValue, filteredElementsValue, filterStage, filteredMainCharacters, elements]);

  const hasCurrentEvent = !!currentEvent;
  const shouldShowLoading =
    loading ||
    isReloading ||
    !isLocationDetermined ||
    (!isDataReady && !hasCurrentEvent);

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
        searchState={{
          searchTerm: searchTermValue,
          isSearchActive: isSearchActiveValue,
          elements: graphState.elements ?? [],
          filteredElements: filteredElementsValue,
          isResetFromSearch: isResetFromSearchValue,
          fitNodeIds: searchFitNodeIds,
          suggestions: suggestionsValue,
          showSuggestions: showSuggestionsValue,
          selectedIndex: selectedSuggestionIndex,
        }}
        searchActions={searchActions}
        isFromLibrary={isFromLibrary}
        previousPage={previousPage}
      />
      
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        {shouldShowLoading ? (
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
            searchTerm={searchTermValue}
            isSearchActive={isSearchActiveValue}
            filteredElements={filteredElementsValue}
            fitNodeIds={searchFitNodeIds}
            isResetFromSearch={isResetFromSearchValue}
            prevValidEvent={graphState.currentEvent && graphState.currentEvent.chapter === graphState.currentChapter ? graphState.currentEvent : null}
            events={graphState.events || []}
            activeTooltip={activeTooltip}
            onClearTooltip={onClearTooltip}
            onSetActiveTooltip={onSetActiveTooltip}
            graphClearRef={graphClearRef}
            isEventTransition={transitionState.type === 'event' && transitionState.inProgress}
            bookId={book?.id ?? bookId}
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

  const bookKey = React.useMemo(() => {
    if (bookId !== undefined && bookId !== null) {
      const trimmed = String(bookId).trim();
      if (trimmed) {
        return trimmed;
      }
    }
    if (book?.id !== undefined && book?.id !== null) {
      const trimmed = String(book.id).trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return null;
  }, [bookId, book?.id]);

  const [cachedLocation, setCachedLocation] = useState(() => {
    if (!bookKey) return null;
    try {
      return getCachedReaderProgress(bookKey);
    } catch {
      return null;
    }
  });

  const [activeTooltip, setActiveTooltip] = useState(null);
  const graphClearRef = useRef(null);
  const apiEventCacheRef = useRef(new Map());
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
  
  useEffect(() => {
    if (!bookKey) {
      setCachedLocation(null);
      return;
    }
    try {
      const cached = getCachedReaderProgress(bookKey);
      setCachedLocation(cached);
    } catch {
      setCachedLocation(null);
    }
  }, [bookKey]);
  
  useEffect(() => {
    apiEventCacheRef.current.clear();
  }, [book?.id, currentChapter]);

  
  const handleClearTooltip = useCallback(() => {
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


  useEffect(() => {
    if (!bookKey) {
      return;
    }
    if (!currentChapter || currentChapter < 1) {
      return;
    }
    if (!currentEvent || currentEvent.placeholder) {
      return;
    }
    if (currentEvent.chapter && Number(currentEvent.chapter) !== Number(currentChapter)) {
      return;
    }

    const resolvedIdx = eventUtils.extractRawEventIdx(currentEvent);
    const cachedChapterIdx = cachedLocation ? Number(cachedLocation.chapterIdx) : null;
    const cachedEventIdxValue = cachedLocation
      ? Number(cachedLocation.eventIdx ?? cachedLocation.eventNum ?? 0)
      : null;
    const hasCachedEventIdx =
      cachedEventIdxValue !== null && Number.isFinite(cachedEventIdxValue) && cachedEventIdxValue > 0;
    const isSameChapter =
      cachedChapterIdx !== null &&
      Number.isFinite(cachedChapterIdx) &&
      cachedChapterIdx > 0 &&
      Number(cachedChapterIdx) === Number(currentChapter);
    const isSameEvent =
      isSameChapter &&
      hasCachedEventIdx &&
      cachedEventIdxValue === resolvedIdx &&
      ((cachedLocation?.cfi ?? null) === (currentEvent.cfi ?? null));

    if (isSameEvent) {
      return;
    }

    const stored = setCachedReaderProgress(bookKey, {
      bookId: typeof book?.id === 'number' ? book.id : null,
      chapterIdx: currentChapter,
      eventIdx: resolvedIdx,
      eventNum: currentEvent.eventNum ?? currentEvent.eventIdx ?? resolvedIdx,
      eventId: currentEvent.event_id ?? currentEvent.eventId ?? currentEvent.id ?? null,
      cfi: currentEvent.cfi ?? null,
      eventName:
        currentEvent.event?.name ??
        currentEvent.event?.title ??
        currentEvent.title ??
        currentEvent.name ??
        null,
      chapterProgress: currentEvent.chapterProgress ?? null,
      source: 'runtime'
    });

    if (stored) {
      setCachedLocation(stored);
    }
  }, [bookKey, currentChapter, currentEvent, cachedLocation, book?.id]);

  const prefetchChapterEventsSequentially = useCallback(async (targetChapter) => {
    if (!book?.id || typeof book.id !== 'number') {
      return;
    }

    if (!targetChapter || targetChapter < 1) {
      return;
    }

    const bookId = book.id;
    const key = `${bookId}-${targetChapter}`;
    const status = sequentialPrefetchStatusRef.current.get(key);

    if (status === 'running' || status === 'completed') {
      return;
    }

    sequentialPrefetchStatusRef.current.set(key, 'running');

    try {
      const chapterPayload = getCachedChapterEvents(bookId, targetChapter);
      if (!chapterPayload || !Array.isArray(chapterPayload.events)) {
        sequentialPrefetchStatusRef.current.set(key, 'completed');
        return;
      }

      const sortedEvents = [...chapterPayload.events].sort(
        (a, b) => (Number(a?.eventIdx) || 0) - (Number(b?.eventIdx) || 0)
      );

      sortedEvents.forEach((event) => {
        const normalizedIdx = eventUtils.normalizeEventIdx(event) || 0;
        if (!normalizedIdx) {
          return;
        }

        const normalizedEvent = {
          ...event.event,
          chapter: targetChapter,
          chapterIdx: targetChapter,
          eventIdx: normalizedIdx,
          eventNum: normalizedIdx,
          event_id: normalizedIdx,
          resolvedEventIdx: normalizedIdx,
          originalEventIdx: normalizedIdx,
          relations: Array.isArray(event.relations) ? event.relations : [],
          characters: Array.isArray(event.characters) ? event.characters : [],
          start: event?.startPos ?? event?.start ?? null,
          end: event?.endPos ?? event?.end ?? null,
        };

        setEvents((prevEvents) => {
          const previous = Array.isArray(prevEvents) ? prevEvents : [];
          const otherChapterEvents = previous.filter(
            (evt) => Number(evt?.chapter ?? evt?.chapterIdx) !== targetChapter
          );
          const currentChapterEvents = previous.filter(
            (evt) => Number(evt?.chapter ?? evt?.chapterIdx) === targetChapter
          );

          const targetIdx = eventUtils.extractRawEventIdx(normalizedEvent);
          const existingIdx = currentChapterEvents.findIndex(
            (evt) => eventUtils.extractRawEventIdx(evt) === targetIdx
          );

          let updatedCurrent = [];
          if (existingIdx >= 0) {
            updatedCurrent = currentChapterEvents.map((evt, mapIdx) =>
              mapIdx === existingIdx ? { ...evt, ...normalizedEvent } : evt
            );
          } else {
            updatedCurrent = [...currentChapterEvents, normalizedEvent];
          }

          updatedCurrent.sort((a, b) => eventUtils.extractRawEventIdx(a) - eventUtils.extractRawEventIdx(b));
          return [...otherChapterEvents, ...updatedCurrent];
        });
      });

      sequentialPrefetchStatusRef.current.set(key, 'completed');
    } catch (error) {
      console.error('❌ 챕터 이벤트 사전 로드 중 오류:', error);
      sequentialPrefetchStatusRef.current.delete(key);
    }
  }, [book?.id, setEvents]);

  useEffect(() => {
    if (!book?.id || typeof book.id !== 'number') {
      return;
    }

    if (!currentChapter || currentChapter < 1) {
      return;
    }

    prefetchChapterEventsSequentially(currentChapter);
  }, [book?.id, currentChapter, prefetchChapterEventsSequentially]);

  // activeTooltip 최신값을 ref로 유지 (watchdog 용)
  useEffect(() => {
    activeTooltipRef.current = activeTooltip;
  }, [activeTooltip]);

  const testProgressAPI = useCallback(async () => {
    // 서버 bookId 확인 (공통 함수 사용)
    const serverBookId = getServerBookId(book);
    
    // 서버에 업로드된 책인지 확인
    const isServerBook = !!serverBookId;

    // 로컬 책인 경우 manifestLoaded를 즉시 true로 설정
    if (!isServerBook || !serverBookId) {
      setManifestLoaded(true);
      return;
    }

    try {
      // 진도 조회: 로컬 캐시에서 가져오기 (manifest 로드 시 이미 모든 진도가 로컬에 저장됨)
      try {
        await getBookProgress(serverBookId);
      } catch (progressError) {
        // 에러는 조용히 처리 (로컬 캐시에서 가져오므로 일반적으로 에러 없음)
      }

      // Manifest 조회: 서버에 업로드된 책이면 서버에서 가져옴
      // 먼저 캐시 확인 (서버 bookId 사용)
      let manifest = getManifestFromCache(serverBookId);
      
      // 캐시에 있으면 즉시 manifestLoaded 설정
      if (manifest) {
        // 캐시에 이미 있으므로 로컬 상태만 업데이트 (캐시 저장 불필요)
        setManifestData(manifest);
        setManifestLoaded(true);
        return;
      }
      
      // 캐시에 없으면 서버에서 가져오기
      try {
        const manifestResponse = await getBookManifest(serverBookId);
        if (manifestResponse?.isSuccess && manifestResponse?.result) {
          manifest = manifestResponse.result;
          // getBookManifest 내부에서 이미 캐시에 저장하므로 로컬 상태만 업데이트
          setManifestData(manifest);
          setManifestLoaded(true);
        } else {
          console.warn('[Viewer] 그래프/매니페스트를 서버에서 가져올 수 없습니다.', { bookId: serverBookId });
          setApiError((prev) => prev ?? '그래프 데이터를 서버에서 가져올 수 없습니다.');
          setManifestLoaded(true);
        }
      } catch (manifestError) {
        // 404와 403 에러는 조용히 처리
        if (
          manifestError.status !== 404 &&
          manifestError.status !== 403 &&
          !manifestError.message?.includes('404') &&
          !manifestError.message?.includes('403')
        ) {
          console.warn('[Viewer] 그래프/매니페스트 조회 실패:', manifestError);
        }
        setApiError((prev) => prev ?? '그래프 데이터를 서버에서 가져올 수 없습니다.');
        setManifestLoaded(true);
      }
    } catch (error) {
      console.error('[Viewer] Manifest 로드 중 오류:', error);
      setManifestLoaded(true);
    }
  }, [book, bookId]);

  // 진도 복원은 EpubViewer에서 이미 수행하므로 여기서는 제거
  // EpubViewer의 loadBook()에서 apiProgressData를 사용하여 displayTarget을 설정하고
  // rendition.display()를 호출하므로 중복 복원을 방지

  useEffect(() => {
    testProgressAPI();
  }, [testProgressAPI]);

  const [manifestLoaded, setManifestLoaded] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [manifestData, setManifestData] = useState(null);
  
  const apiCallRef = useRef(null);
  const initialGraphEventLoadedRef = useRef(false);
  const isChapterTransitionRef = useRef(false);
  const chapterTransitionDirectionRef = useRef(null);
  const forcedChapterEventIdxRef = useRef(null);
  const sequentialPrefetchStatusRef = useRef(new Map());
  const setElementsRef = useRef(setElements);
  const previousGraphDataRef = useRef({ elements: [], eventIdx: 0, chapterIdx: 0 });
  const chapterEventDiscoveryRef = useRef(new Map()); // 챕터별 이벤트 탐색 상태
  
  useEffect(() => {
    setElementsRef.current = setElements;
  }, [setElements]);

  useEffect(() => {
    // book.id 변경 시 완전 초기화
    initialGraphEventLoadedRef.current = false;
    apiCallRef.current = null;
    setManifestLoaded(false);
    setManifestData(null);
    setApiError(null);
  }, [book?.id]);
  
  useEffect(() => {
    // currentChapter 변경 시 해당 챕터의 API 호출 상태 초기화
    // (새 챕터에서 첫 호출을 위해)
    if (book?.id && currentChapter) {
      const chapterApiKey = `${book.id}-${currentChapter}`;
      // 현재 ref가 챕터 키와 다르면 초기화 (새 챕터 진입)
      if (typeof initialGraphEventLoadedRef.current === 'string' && 
          !initialGraphEventLoadedRef.current.startsWith(chapterApiKey)) {
        // 새 챕터 진입이므로 초기화하지 않고, 챕터별로 개별 추적
      }
    }
    apiCallRef.current = null;
  }, [book?.id, currentChapter]);
  
  useEffect(() => {
    if (transitionState.type === 'chapter') {
      isChapterTransitionRef.current = true;
      chapterTransitionDirectionRef.current = transitionState.direction;
    } else if (!transitionState.inProgress) {
      isChapterTransitionRef.current = false;
      chapterTransitionDirectionRef.current = null;
    }
  }, [transitionState.type, transitionState.direction, transitionState.inProgress]);
  
  // 챕터별 이벤트 탐색 (챕터 변경 시)
  useEffect(() => {
    let isMounted = true;
    
    const discoverEvents = async () => {
      const isApiBook = bookUtils.isApiBook(book);
      
      if (!isApiBook || !book?.id || !currentChapter) {
        return;
      }
      
      // 이미 탐색 중이거나 완료된 챕터는 스킵
      const discoveryKey = `${book.id}-${currentChapter}`;
      if (chapterEventDiscoveryRef.current.has(discoveryKey)) {
        return;
      }
      
      // 탐색 시작 표시
      chapterEventDiscoveryRef.current.set(discoveryKey, 'discovering');
      
      const cached = getCachedChapterEvents(book.id, currentChapter);
      if (cached) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'completed');
        return;
      }

      if (isMounted) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
        setApiError((prev) => prev ?? '그래프 이벤트 캐시가 없습니다. 마이페이지에서 데이터를 준비해주세요.');
      }
    };
    
    discoverEvents();
    
    return () => {
      isMounted = false;
    };
  }, [book?.id, currentChapter]);
  
  useEffect(() => {
    let isMounted = true;
    
    const loadGraphData = async () => {
        const isApiBook = bookUtils.isApiBook(book);
        
        if (isApiBook) {
          if (!book?.id || !currentChapter) {
            return;
          }
          
          // manifestLoaded가 false인 경우, 캐시 확인으로 빠르게 체크
          if (!manifestLoaded) {
            const serverBookId = getServerBookId(book);
            if (serverBookId) {
              const cachedManifest = getManifestFromCache(serverBookId);
              if (cachedManifest) {
                // 캐시에 있으면 즉시 manifestLoaded 설정하고 계속 진행
                setManifestData(cachedManifest);
                setManifestLoaded(true);
              } else {
                // 캐시에 없으면 manifest 로드 완료 대기
                return;
              }
            } else {
              // 서버 bookId가 없으면 로컬 책이므로 manifestLoaded 불필요
              setManifestLoaded(true);
              return;
            }
          }
          
          // currentEvent가 아직 없어도 초기 이벤트(1)로 즉시 로드
          
          let eventIdx = currentEvent?.eventNum || currentEvent?.eventIdx || 1;
          
          // 챕터 전환 강제 인덱스 우선 적용
          if (isChapterTransitionRef.current) {
            let forced = forcedChapterEventIdxRef.current;
            if (forced === 'max') {
              const chapterCache = getCachedChapterEvents(book.id, currentChapter);
              const maxEventIdx = eventUtils.getMaxEventIdx(chapterCache);
              forced = maxEventIdx > 0 ? maxEventIdx : 1;
              forcedChapterEventIdxRef.current = forced;
            }
            if (forced && Number.isFinite(forced)) {
              eventIdx = forced;
            } else {
              const direction = chapterTransitionDirectionRef.current || transitionState.direction;
              if (direction === 'backward') {
                const chapterCache = getCachedChapterEvents(book.id, currentChapter);
                const maxEventIdx = eventUtils.getMaxEventIdx(chapterCache);
                eventIdx = maxEventIdx > 0 ? maxEventIdx : 1;
                forcedChapterEventIdxRef.current = eventIdx;
              } else if (direction === 'forward') {
                eventIdx = 1;
                forcedChapterEventIdxRef.current = 1;
              }
            }
          }
          
          const apiEventIdx = eventIdx;
          
          const callKey = `${book.id}-${currentChapter}-${apiEventIdx}`;
          if (apiCallRef.current === callKey) {
            return;
          }
          // 전환 중에는 강제 인덱스 외 호출 차단
          if (isChapterTransitionRef.current) {
            const forced = forcedChapterEventIdxRef.current;
            if (forced && forced !== 'max' && apiEventIdx !== forced) {
              return;
            }
          }
          apiCallRef.current = callKey;
         
        try {
          if (!book?.id || !currentChapter || apiEventIdx < 1) {
            setElementsRef.current([]);
            setIsDataReady(true);
            transitionUtils.reset(setTransitionState);
            return;
          }
          
          let resultData = null;
          let usedCache = true;

          // 챕터별 첫 API 호출 감지 (이벤트 인덱스별로)
          const chapterEventApiKey = `${book.id}-${currentChapter}-${apiEventIdx}`;
          const hasCalledApiForEvent = initialGraphEventLoadedRef.current === chapterEventApiKey;
          
          if (!hasCalledApiForEvent) {
            // 캐시에 이미 있는지 먼저 확인
            const cachedBeforeApi = getGraphEventState(book.id, currentChapter, apiEventIdx);
            if (!cachedBeforeApi) {
              initialGraphEventLoadedRef.current = chapterEventApiKey;
              try {
                const apiResponse = await getFineGraph(book.id, currentChapter, apiEventIdx);
                
                // API 응답 유효성 검증
                if (apiResponse && (apiResponse.isSuccess !== false)) {
                  const apiResult = apiResponse?.result ?? apiResponse?.data ?? null;
                  if (apiResult) {
                    resultData = {
                      characters: Array.isArray(apiResult.characters) ? apiResult.characters : [],
                      relations: Array.isArray(apiResult.relations) ? apiResult.relations : [],
                      event: apiResult.event ?? null,
                      elements: null,
                    };
                    usedCache = false;
                    
                    // API 응답을 apiEventCacheRef에 저장
                    const cacheKey = `${currentChapter}-${apiEventIdx}`;
                    if (apiEventCacheRef.current) {
                      apiEventCacheRef.current.set(cacheKey, resultData);
                    }
                  }
                }
              } catch (apiError) {
                // API 호출 실패 시 캐시 재확인은 아래 로직에서 수행
              }
            }
          }

          // API 호출 결과가 없으면 캐시에서 가져오기
          if (!resultData) {
            const reconstructed = getGraphEventState(book.id, currentChapter, apiEventIdx);
            if (reconstructed) {
              // 캐시에서 가져올 때는 elements가 있으면 우선 사용
              // relations는 elements가 없을 때만 변환 (일관성 유지)
              const hasElements = Array.isArray(reconstructed.elements) && reconstructed.elements.length > 0;
              resultData = {
                characters: reconstructed.characters || [],
                relations: hasElements ? [] : eventUtils.convertElementsToRelations(reconstructed.elements || []),
                event: reconstructed.eventMeta || null,
                elements: reconstructed.elements || [],
              };
              usedCache = true;
            }
          }
          
          // API 응답은 받았지만 데이터가 비어있는 경우 캐시 재확인
          if (resultData && !usedCache) {
            const hasValidData = 
              (Array.isArray(resultData.characters) && resultData.characters.length > 0) ||
              (Array.isArray(resultData.relations) && resultData.relations.length > 0) ||
              (Array.isArray(resultData.elements) && resultData.elements.length > 0);
              
            if (!hasValidData) {
              const cached = getGraphEventState(book.id, currentChapter, apiEventIdx);
              if (cached) {
                const hasElements = Array.isArray(cached.elements) && cached.elements.length > 0;
                resultData = {
                  characters: cached.characters || [],
                  relations: hasElements ? [] : eventUtils.convertElementsToRelations(cached.elements || []),
                  event: cached.eventMeta || null,
                  elements: cached.elements || [],
                };
                usedCache = true;
              }
            }
          }

          if (!isMounted) return;
          
          const cacheKey = `${currentChapter}-${apiEventIdx}`;
          
          // 데이터 유효성 검사: 캐시는 elements 우선, API는 relations 우선
          const hasCacheElements = Array.isArray(resultData?.elements) && resultData.elements.length > 0;
          const hasApiRelations = Array.isArray(resultData?.relations) && resultData.relations.length > 0;
          const hasApiCharacters = Array.isArray(resultData?.characters) && resultData.characters.length > 0;
          
          // 캐시 사용 시: elements가 있으면 그것을 사용, 없으면 relations+characters 확인
          // API 사용 시: relations+characters 확인
          const hasGraphData = usedCache 
            ? (hasCacheElements || (hasApiRelations && hasApiCharacters))
            : (hasApiRelations && hasApiCharacters);
          
          if (!hasGraphData) {
            eventUtils.updateGraphDataRef(previousGraphDataRef, [], apiEventIdx, currentChapter);
            setElementsRef.current([]);

            if (isMounted) {
              setIsDataReady(true);
              setLoading(false);
              transitionUtils.reset(setTransitionState);
              setApiError(null);
            }

            return;
          }
          
          if (apiEventCacheRef.current) {
            apiEventCacheRef.current.set(cacheKey, resultData);
          }

          const filteredRelations = !usedCache
            ? await filterRelationsByTimeline({
                relations: resultData.relations,
                mode: "api",
                bookId: book.id,
                chapterNum: currentChapter,
                eventNum: apiEventIdx,
                cacheRef: apiEventCacheRef,
                eventUtils,
                getCachedChapterEvents,
                getGraphEventState,
                getEventDataByIndex,
                getRelationKeyFromRelation
              })
            : (resultData.relations || []);

          if (!Array.isArray(filteredRelations) || filteredRelations.length === 0) {
            eventUtils.updateGraphDataRef(previousGraphDataRef, [], apiEventIdx, currentChapter);
            setElementsRef.current([]);

            const emptyEvent = eventUtils.createEmptyEvent(currentChapter, apiEventIdx, resultData?.event);

            setCurrentEvent(emptyEvent);

            setEvents((prevEvents) => {
              if (!Array.isArray(prevEvents) || prevEvents.length === 0) {
                return [emptyEvent];
              }
              const updated = prevEvents.map((evt) =>
                (evt?.eventIdx ?? evt?.eventNum) === apiEventIdx ? { ...evt, ...emptyEvent } : evt
              );
              const exists = updated.some((evt) => (evt?.eventIdx ?? evt?.eventNum) === apiEventIdx);
              if (!exists) {
                updated.push(emptyEvent);
              }
              return updated;
            });

            if (apiEventCacheRef.current) {
              apiEventCacheRef.current.set(cacheKey, { ...resultData, relations: [] });
            }

            if (isMounted) {
              setIsDataReady(true);
              setLoading(false);
              transitionUtils.reset(setTransitionState);
              setApiError(null);
            }

            return;
          }

          resultData = { ...resultData, relations: filteredRelations };
          if (apiEventCacheRef.current) {
            apiEventCacheRef.current.set(cacheKey, resultData);
          }
          
          const apiEvent = resultData.event;
          const normalizedEvent = apiEvent ? {
            chapter: apiEvent.chapterIdx ?? currentChapter,
            chapterIdx: apiEvent.chapterIdx ?? currentChapter,
            eventNum: apiEvent.event_id ?? apiEventIdx,
            eventIdx: apiEvent.event_id ?? apiEventIdx,
            event_id: apiEvent.event_id ?? apiEventIdx,
            start: apiEvent.start,
            end: apiEvent.end,
            ...apiEvent
          } : null;
          
          let convertedElements = [];
          
          // 데이터 변환: 캐시는 elements 우선, API는 relations+characters 변환
          if (usedCache && Array.isArray(resultData.elements) && resultData.elements.length > 0) {
            // 캐시에서 가져온 elements가 있으면 우선 사용 (이미 변환된 상태)
            convertedElements = resultData.elements;
          } 
          // 캐시 elements가 없거나 API 응답인 경우: characters와 relations를 변환
          else if (resultData.characters && resultData.relations && 
            Array.isArray(resultData.characters) && resultData.characters.length > 0 && 
            Array.isArray(resultData.relations) && resultData.relations.length > 0) {
            
            const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = createCharacterMaps(resultData.characters);
            
            const nodeWeights = buildNodeWeights(resultData.characters);
            
            convertedElements = convertRelationsToElements(
              resultData.relations,
              idToName,
              idToDesc,
              idToDescKo,
              idToMain,
              idToNames,
              'api',
              Object.keys(nodeWeights).length > 0 ? nodeWeights : null,
              null,
              normalizedEvent,
              idToProfileImage
            );
          }
          
          // convertedElements가 있으면 처리
          if (convertedElements.length > 0 && isMounted) {
              // 캐시 사용 시 diff 기반 누적, 아니면 기존 병합 로직
              if (usedCache) {
                // diff 기반이므로 이미 누적된 상태
                eventUtils.updateGraphDataRef(previousGraphDataRef, convertedElements, apiEventIdx, currentChapter);
                setElementsRef.current(convertedElements);
              } else {
                // API 직접 호출 시 기존 병합 로직
                const prevData = previousGraphDataRef.current;
                
                if (prevData.chapterIdx !== currentChapter) {
                  eventUtils.updateGraphDataRef(previousGraphDataRef, convertedElements, apiEventIdx, currentChapter);
                  setElementsRef.current(convertedElements);
                } else {
                  if (apiEventIdx > prevData.eventIdx) {
                    const existingNodeIds = new Set(
                      prevData.elements
                        .filter(e => e.data && !e.data.source)
                        .map(e => e.data.id)
                    );
                    
                    const newNodes = convertedElements.filter(e => 
                      e.data && !e.data.source && !existingNodeIds.has(e.data.id)
                    );
                    
                    const allEdges = convertedElements.filter(e => e.data && e.data.source);
                    
                    const mergedElements = [
                      ...prevData.elements.filter(e => e.data && !e.data.source),
                      ...newNodes,
                      ...allEdges
                    ];
                    
                    eventUtils.updateGraphDataRef(previousGraphDataRef, mergedElements, apiEventIdx, currentChapter);
                    setElementsRef.current(mergedElements);
                  } else {
                    eventUtils.updateGraphDataRef(previousGraphDataRef, convertedElements, apiEventIdx, currentChapter);
                    setElementsRef.current(convertedElements);
                  }
                }
              }
            
            const resolvedEventIdx = apiEventIdx;
            const originalEventIdx = normalizedEvent ? eventUtils.extractRawEventIdx(normalizedEvent) : resolvedEventIdx;

            const nextEventData = normalizedEvent ? {
              ...normalizedEvent,
              chapter: normalizedEvent.chapter ?? currentChapter,
              chapterIdx: normalizedEvent.chapterIdx ?? currentChapter,
              eventNum: resolvedEventIdx,
              eventIdx: resolvedEventIdx,
              event_id: resolvedEventIdx,
              resolvedEventIdx,
              originalEventIdx,
              relations: resultData.relations || [],
              characters: resultData.characters || []
            } : {
              chapter: currentChapter,
              chapterIdx: currentChapter,
              eventNum: resolvedEventIdx,
              eventIdx: resolvedEventIdx,
              event_id: resolvedEventIdx,
              resolvedEventIdx,
              originalEventIdx: resolvedEventIdx,
              relations: resultData.relations || [],
              characters: resultData.characters || []
            };

            const hasGraphPayload = Array.isArray(resultData.relations) && resultData.relations.length > 0;
            const hasCharacterPayload = Array.isArray(resultData.characters) && resultData.characters.length > 0;

            setEvents(prevEvents => {
              const previous = Array.isArray(prevEvents) ? prevEvents : [];
              const otherChapterEvents = previous.filter(evt => Number(evt?.chapter ?? evt?.chapterIdx) !== currentChapter);

              if (!hasGraphPayload && !hasCharacterPayload) {
                return otherChapterEvents;
              }

              const currentChapterEvents = previous.filter(evt => Number(evt?.chapter ?? evt?.chapterIdx) === currentChapter);
              const targetIdx = eventUtils.extractRawEventIdx(nextEventData);
              const existingIdx = currentChapterEvents.findIndex(evt => eventUtils.extractRawEventIdx(evt) === targetIdx);

              let updatedCurrent = [];
              if (existingIdx >= 0) {
                updatedCurrent = currentChapterEvents.map((evt, idx) =>
                  idx === existingIdx ? { ...evt, ...nextEventData } : evt
                );
              } else {
                updatedCurrent = [...currentChapterEvents, nextEventData];
              }

              updatedCurrent.sort((a, b) => eventUtils.extractRawEventIdx(a) - eventUtils.extractRawEventIdx(b));
              return [...otherChapterEvents, ...updatedCurrent];
            });

            if (!hasGraphPayload && !hasCharacterPayload) {
              const fallbackEvent = {
                ...nextEventData,
                placeholder: true,
                relations: [],
                characters: []
              };
              setCurrentEvent(fallbackEvent);
              setElementsRef.current([]);
              forcedChapterEventIdxRef.current = null;
              chapterTransitionDirectionRef.current = null;
              isChapterTransitionRef.current = false;
            } else {
              setCurrentEvent(prev => {
                if (!prev || Number(prev?.chapter ?? prev?.chapterIdx) !== currentChapter) {
                  return nextEventData;
                }

                const prevIdx = eventUtils.extractRawEventIdx(prev);
                const nextIdx = eventUtils.extractRawEventIdx(nextEventData);
                if (prevIdx !== nextIdx) {
                  return nextEventData;
                }

                return { ...prev, ...nextEventData };
              });

              const appliedIdx = eventUtils.extractRawEventIdx(nextEventData);
              if (
                forcedChapterEventIdxRef.current &&
                Number.isFinite(forcedChapterEventIdxRef.current) &&
                appliedIdx === forcedChapterEventIdxRef.current
              ) {
                forcedChapterEventIdxRef.current = null;
                chapterTransitionDirectionRef.current = null;
                isChapterTransitionRef.current = false;
              }
            }
            
            // 변환된 elements가 있지만 원본 데이터가 비어있으면 elements 비우기
            if (!resultData.relations?.length && !resultData.characters?.length && !usedCache) {
              eventUtils.updateGraphDataRef(previousGraphDataRef, [], apiEventIdx, currentChapter);
              setElementsRef.current([]);
            }
          } else {
            // 변환 실패 또는 데이터 없음
            if (!usedCache || !Array.isArray(resultData.elements) || resultData.elements.length === 0) {
              console.warn('⚠️ 그래프 데이터 변환 실패: characters, relations, 또는 elements가 비어있음');
            }
            
            // 변환 실패 시 elements 비우기
            eventUtils.updateGraphDataRef(previousGraphDataRef, [], apiEventIdx, currentChapter);
            setElementsRef.current([]);
          }
          
          if (transitionState.type === 'chapter' && transitionState.direction && currentChapter !== prevChapterRef.current) {
            if (!hasGraphPayload && !hasCharacterPayload) {
              setEvents([]);
              setCurrentEvent(null);
              setElementsRef.current([]);
              eventUtils.updateGraphDataRef(previousGraphDataRef, [], 0, currentChapter);
            } else {
              previousGraphDataRef.current = {
                ...previousGraphDataRef.current,
                chapterIdx: currentChapter
              };
            }
          }

          prevChapterRef.current = currentChapter;
          prevEventRef.current = apiEventIdx;

          if (isChapterTransitionRef.current) {
            isChapterTransitionRef.current = false;
          }
          
          if (isMounted) {
            setIsDataReady(true);
            setLoading(false);
            transitionUtils.reset(setTransitionState);
            setApiError(null);
          }
          
        } catch (error) {
          if (isMounted) {
            // 404 에러는 데이터 없음으로 정상 상황 (eventIdx=0 등)
            if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
              // 빈 elements로 설정하고 에러로 표시하지 않음
              setElementsRef.current([]);
              setApiError(null);
              setIsDataReady(true);
              setLoading(false);
              transitionUtils.reset(setTransitionState);
            } else {
              // 재시도 가능한 에러
              const maxRetries = 3;
              const retryCount = (error.retryCount || 0) + 1;
              
              if (retryCount < maxRetries) {
                // 재시도 전 대기
                setTimeout(() => {
                  if (isMounted) {
                    apiCallRef.current = null;
                    // 재시도를 위해 강제로 useEffect 재실행
                    setLoading(prev => !prev);
                  }
                }, 1000 * retryCount);
                
                setApiError({
                  message: '그래프 데이터를 불러오는데 실패했습니다.',
                  details: `${error.message || '알 수 없는 오류'} (재시도 ${retryCount}/${maxRetries})`,
                  retry: () => {
                    setApiError(null);
                    apiCallRef.current = null;
                    setLoading(prev => !prev);
                  }
                });
              } else {
                // 최대 재시도 횟수 초과
                setApiError({
                  message: '그래프 데이터를 불러오는데 실패했습니다.',
                  details: error.message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                  retry: () => {
                    setApiError(null);
                    apiCallRef.current = null;
                    initialGraphEventLoadedRef.current = false;
                    setLoading(prev => !prev);
                  }
                });
              }
              
              setIsDataReady(true);
              setLoading(false);
              transitionUtils.reset(setTransitionState);
            }
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
          transitionUtils.reset(setTransitionState);
          return;
        }
        
        const localEvents = getEventsForChapter(currentChapter, folderKey);
        
        const validEvents = localEvents.filter(event => {
          return event.chapter === currentChapter;
        });
        
        if (!isMounted) return;
        
        setEvents(validEvents);
        
        setIsDataReady(true);
      } catch (error) {
        if (isMounted) {
          setIsDataReady(true);
          transitionUtils.reset(setTransitionState);
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
      if (!currentChapter) return;
      if (!bookKey) return;
      
      try {
        // bookKey를 bookId로 사용 (로컬 책과 서버 책 모두 지원)
        const progressData = {
          bookId: bookKey,
          chapterIdx: currentChapter || 1,
          eventIdx: currentEvent?.eventNum || 0,
          cfi: currentEvent?.cfi || null
        };
        
        // 로컬 캐시에 저장 (모든 책 - 로컬/서버 구분 없음)
        setProgressToCache(progressData);
        
      } catch (error) {
        // 에러는 조용히 처리
      }
    };

    const timeoutId = setTimeout(autoSaveProgress, 2000);
    return () => clearTimeout(timeoutId);
  }, [bookKey, currentChapter, currentEvent]);

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
          transitionUtils.reset(setTransitionState);
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
    fitNodeIds,
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
    prevElementsRef.current = elements;
  }, [elements]);



  useEffect(() => {
    if (!folderKey || !bookKey) {
      return;
    }
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
          const storageKey = createStorageKey.chapterNodePositions(bookKey, chapterNum);
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
  }, [folderKey, bookKey]);


  return (
    <div
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
              fitNodeIds,
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
            cachedLocation={cachedLocation}
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
            const prev = Number(currentChapter || 0);
            const next = Number(chapter || 0);
            if (prev && next && prev !== next) {
              isChapterTransitionRef.current = true;
              chapterTransitionDirectionRef.current = prev > next ? 'backward' : 'forward';
              const forcedIdx = chapterTransitionDirectionRef.current === 'forward' ? 1 : 'max';
              forcedChapterEventIdxRef.current = forcedIdx;
              
              if (Number.isFinite(forcedIdx)) {
                setCurrentEvent({
                  chapter: next,
                  chapterIdx: next,
                  eventIdx: forcedIdx,
                  eventNum: forcedIdx,
                  event_id: forcedIdx,
                  relations: [],
                  characters: [],
                  placeholder: true
                });
              }
            }
            setCurrentChapter(chapter);
          }}
          settings={settings}
          onCurrentLineChange={(charIndex, totalEvents, receivedEvent) => {
            setCurrentCharIndex(charIndex);
            
            if (receivedEvent) {
              if (receivedEvent.chapter && receivedEvent.chapter !== currentChapter) {
                setCurrentChapter(receivedEvent.chapter);
              }

              const forcedIdx = forcedChapterEventIdxRef.current;
              const rawIdx = eventUtils.extractRawEventIdx(receivedEvent);

              let shouldReleaseForced = false;
              let nextEvent = receivedEvent;

              if (Number.isFinite(forcedIdx)) {
                if (rawIdx > 0 && rawIdx !== forcedIdx) {
                  shouldReleaseForced = true;
                } else {
                  nextEvent = {
                    ...receivedEvent,
                    eventIdx: forcedIdx,
                    eventNum: forcedIdx,
                    event_id: forcedIdx,
                    resolvedEventIdx: forcedIdx,
                    originalEventIdx: rawIdx || forcedIdx
                  };
                  shouldReleaseForced = true;
                }
              }

              const resolvedIdxForEvent = eventUtils.extractRawEventIdx(nextEvent);
              if (!Number.isFinite(nextEvent.resolvedEventIdx) || nextEvent.resolvedEventIdx <= 0) {
                nextEvent = {
                  ...nextEvent,
                  resolvedEventIdx: resolvedIdxForEvent > 0 ? resolvedIdxForEvent : undefined
                };
              }
              
              setCurrentEvent(nextEvent);

              if (shouldReleaseForced) {
                forcedChapterEventIdxRef.current = null;
                chapterTransitionDirectionRef.current = null;
                isChapterTransitionRef.current = false;
              }
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
                위치: {bm.title || (() => {
                  const cfi = bm.cfi || bm.startCfi || '';
                  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
                  const chapter = chapterMatch ? parseInt(chapterMatch[1]) : null;
                  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
                  const page = pageMatch ? parseInt(pageMatch[1]) : null;
                  if (page && chapter) return `${page}페이지 (${chapter}챕터)`;
                  if (page) return `${page}페이지`;
                  if (chapter) return `${chapter}챕터`;
                  return cfi;
                })()}
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
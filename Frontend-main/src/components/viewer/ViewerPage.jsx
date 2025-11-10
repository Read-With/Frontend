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
import { saveProgress, getBookProgress, getFineGraph } from "../../utils/common/api";
import { getGraphEventState, getCachedReaderProgress, setCachedReaderProgress, getCachedChapterEvents } from "../../utils/common/chapterEventCache";
import { getManifestFromCache } from "../../utils/common/manifestCache";
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
  getEventDataByIndex
} from "../../utils/graphData";
import { calcGraphDiff, convertRelationsToElements, filterMainCharacters } from "../../utils/graphDataUtils";
import { createCharacterMaps } from "../../utils/characterUtils";
import { processTooltipData } from "../../utils/graphUtils";
import { safeNum } from "../../utils/relationUtils";

const createRelationKey = (a, b) => {
  const first = safeNum(a);
  const second = safeNum(b);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }
  const min = first <= second ? first : second;
  const max = first <= second ? second : first;
  return `${min}-${max}`;
};

const getRelationKeyFromRelation = (relation) => {
  if (!relation || typeof relation !== "object") {
    return null;
  }
  return createRelationKey(relation.id1 ?? relation.source, relation.id2 ?? relation.target);
};

const collectLocalRelationKeys = (folderKey, chapterNum, eventNum, targetKeys) => {
  const seen = new Set();
  if (!folderKey || !Number.isFinite(chapterNum) || !Number.isFinite(eventNum) || eventNum < 1) {
    return seen;
  }

  for (let idx = 1; idx <= eventNum; idx += 1) {
    const eventData = getEventDataByIndex(folderKey, chapterNum, idx);
    const relations = eventData?.relations;
    if (!Array.isArray(relations) || relations.length === 0) {
      continue;
    }

    for (const rel of relations) {
      const key = getRelationKeyFromRelation(rel);
      if (!key) {
        continue;
      }
      if (!targetKeys || targetKeys.has(key)) {
        seen.add(key);
        if (targetKeys && seen.size === targetKeys.size) {
          return seen;
        }
      }
    }
  }

  return seen;
};

const collectApiRelationKeys = async (bookId, chapterNum, eventNum, targetKeys) => {
  const seen = new Set();
  if (!bookId || !Number.isFinite(chapterNum) || !Number.isFinite(eventNum) || eventNum < 1) {
    return seen;
  }

  for (let idx = 1; idx <= eventNum; idx += 1) {
    const state = getGraphEventState(bookId, chapterNum, idx);
    const result = state
      ? {
          relations: state.eventMeta?.relations ?? state.relations ?? [],
        }
      : null;
    const relations = result?.relations;
    if (!Array.isArray(relations) || relations.length === 0) {
      continue;
    }

    for (const rel of relations) {
      const key = getRelationKeyFromRelation(rel);
      if (!key) {
        continue;
      }
      if (!targetKeys || targetKeys.has(key)) {
        seen.add(key);
        if (targetKeys && seen.size === targetKeys.size) {
          return seen;
        }
      }
    }
  }

  return seen;
};

const filterRelationsByTimeline = async ({
  relations,
  mode,
  bookId,
  folderKey,
  chapterNum,
  eventNum,
  cacheRef
}) => {
  if (!Array.isArray(relations) || relations.length === 0) {
    return [];
  }

  if (!Number.isFinite(chapterNum) || chapterNum < 1 || !Number.isFinite(eventNum) || eventNum < 1) {
    return relations;
  }

  const targetKeys = new Set();
  for (const rel of relations) {
    const key = getRelationKeyFromRelation(rel);
    if (key) {
      targetKeys.add(key);
    }
  }

  if (targetKeys.size === 0) {
    return relations;
  }

  try {
    let seenKeys = null;
    if (mode === "api") {
      if (!bookId) {
        return relations;
      }
      seenKeys = await collectApiRelationKeys(bookId, chapterNum, eventNum, targetKeys);
    } else if (mode === "local") {
      if (!folderKey) {
        return relations;
      }
      seenKeys = collectLocalRelationKeys(folderKey, chapterNum, eventNum, targetKeys);
    } else {
      return relations;
    }

    if (!(seenKeys instanceof Set)) {
      return relations;
    }

    return relations.filter((rel) => {
      const key = getRelationKeyFromRelation(rel);
      if (!key) {
        return true;
      }
      return seenKeys.has(key);
    });
  } catch (error) {
    return relations;
  }
};

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
    if (book && (typeof book.id === 'number' || book.isFromAPI === true)) {
      return true;
    }
    if (bookId && (typeof bookId === 'number' || !isNaN(parseInt(bookId, 10)))) {
      return true;
    }
    return false;
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
  const currentEventIdx = currentEvent?.eventIdx;
  const currentEventNum = currentEvent?.eventNum;
  const currentEventId = currentEvent?.id;

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

  const handleClearTooltipAndGraph = useCallback(() => {
    handleClearTooltip();
  }, [handleClearTooltip]);

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

  const resolveEventIndex = useCallback((event) => {
    const resolvedCandidate = Number(
      event?.resolvedEventIdx ??
      event?.eventIdx ??
      event?.eventNum ??
      event?.event_id ??
      event?.idx ??
      event?.id
    );

    if (Number.isFinite(resolvedCandidate) && resolvedCandidate > 0) {
      return resolvedCandidate;
    }

    if (event?.event?.eventIdx) {
      const nestedIdx = Number(event.event.eventIdx);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }

    if (event?.event?.idx) {
      const nestedIdx = Number(event.event.idx);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }

    if (event?.originalEventIdx) {
      const originalIdx = Number(event.originalEventIdx);
      if (Number.isFinite(originalIdx) && originalIdx > 0) {
        return originalIdx;
      }
    }

    return 0;
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

    const resolvedIdx = resolveEventIndex(currentEvent);
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
  }, [bookKey, currentChapter, currentEvent, cachedLocation, resolveEventIndex, book?.id]);

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
        const normalizedIdx = Number(event?.eventIdx) || 0;
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

          const targetIdx = resolveEventIndex(normalizedEvent);
          const existingIdx = currentChapterEvents.findIndex(
            (evt) => resolveEventIndex(evt) === targetIdx
          );

          let updatedCurrent = [];
          if (existingIdx >= 0) {
            updatedCurrent = currentChapterEvents.map((evt, mapIdx) =>
              mapIdx === existingIdx ? { ...evt, ...normalizedEvent } : evt
            );
          } else {
            updatedCurrent = [...currentChapterEvents, normalizedEvent];
          }

          updatedCurrent.sort((a, b) => resolveEventIndex(a) - resolveEventIndex(b));
          return [...otherChapterEvents, ...updatedCurrent];
        });
      });

      sequentialPrefetchStatusRef.current.set(key, 'completed');
    } catch (error) {
      console.error('❌ 챕터 이벤트 사전 로드 중 오류:', error);
      sequentialPrefetchStatusRef.current.delete(key);
    }
  }, [book?.id, resolveEventIndex, setEvents]);

  useEffect(() => {
    if (!book?.id || typeof book.id !== 'number') {
      return;
    }

    if (!currentChapter || currentChapter < 1) {
      return;
    }

    prefetchChapterEventsSequentially(currentChapter);
  }, [book?.id, currentChapter, prefetchChapterEventsSequentially]);

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

    const isLocalBook =
      !book.id ||
      typeof book.id === 'string' ||
      bookId.includes('.epub') ||
      isNaN(parseInt(bookId, 10));

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
        if (
          !progressError.message.includes('404') &&
          !progressError.message.includes('찾을 수 없습니다')
        ) {
          console.error('독서 진도 조회 실패:', progressError);
        }
      }
    } finally {
      const manifest = getManifestFromCache(book.id);
      if (manifest) {
        setManifestData(manifest);
      } else {
        console.warn('[Viewer] 그래프/매니페스트 캐시가 없습니다. 마이페이지에서 사전 준비가 필요합니다.', { bookId: book.id });
        setApiError((prev) => prev ?? '그래프 데이터 캐시가 없습니다. 마이페이지에서 책을 한번 열어주세요.');
      }
      setManifestLoaded(true);
      setIsProgressLoaded(true);
    }
  }, [book?.id, bookId]);

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
  
  // 모든 챕터의 eventIdx 정보 확인 (디버깅용)
  useEffect(() => {
    const logAllChapterEventInfo = async () => {
      const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
      
      if (!isApiBook || !book?.id || !manifestLoaded || !manifestData?.chapters) {
        return;
      }
      
      // 인증 토큰 확인 (로그아웃 상태 체크)
      const token = localStorage.getItem('accessToken');
      if (!token) {
        // 로그아웃 상태에서는 실행하지 않음
        return;
      }
      
      
      const allChapterInfo = [];
      
            for (let i = 0; i < manifestData.chapters.length; i++) {
        const chapterInfo = manifestData.chapters[i];
        
        // 다양한 필드명 시도 (배열 인덱스도 고려)
        let chapterIdx = chapterInfo?.chapterIdx || chapterInfo?.chapter || chapterInfo?.index || chapterInfo?.number || chapterInfo?.id;
        
        // chapterIdx가 없으면 배열 인덱스 + 1 사용 (1-based)
        if (!chapterIdx || chapterIdx === undefined || chapterIdx === null) {
          chapterIdx = i + 1;
        }
        
                // eventCount 추출 (배열이면 length 사용, 숫자면 그대로)
        let eventCount = chapterInfo?.eventCount || chapterInfo?.events || chapterInfo?.event_count || 0;
        if (Array.isArray(eventCount)) {
          eventCount = eventCount.length;
        } else if (typeof eventCount !== 'number' || isNaN(eventCount)) {
          eventCount = 0;
        }

        const chapterData = {
          chapterIdx,
          eventCount,
          eventIndices: []
        };
        
        // chapterIdx가 유효하지 않으면 스킵
        if (!chapterIdx || chapterIdx === undefined) {
          continue;
        }
        
        // 각 eventIdx에 대해 정보 수집
        // eventCount가 0이면 최대 이벤트 수를 시도해보기 위해 일단 작은 범위로 테스트
        const chapterCache = getCachedChapterEvents(book.id, chapterIdx);
        const maxEventIdx = Number(chapterCache?.maxEventIdx) || eventCount || 0;
        
        for (let eventIdx = 1; eventIdx <= maxEventIdx; eventIdx++) {
          const eventState = getGraphEventState(book.id, chapterIdx, eventIdx);
          if (eventState && Array.isArray(eventState.elements)) {
            const edges = eventState.elements.filter(el => el?.data?.source && el?.data?.target);
            chapterData.eventIndices.push({
              eventIdx,
              hasData: edges.length > 0 || (eventState.eventMeta && Object.keys(eventState.eventMeta).length > 0),
              charactersCount: Array.isArray(eventState.characters) ? eventState.characters.length : 0,
              relationsCount: edges.length,
              hasEvent: !!eventState.eventMeta
            });
          } else {
            chapterData.eventIndices.push({
              eventIdx,
              hasData: false
            });
          }
        }
        
        allChapterInfo.push(chapterData);
      }
      
    };
    
    // manifest 로드 후 실행
    if (manifestLoaded && manifestData?.chapters) {
      logAllChapterEventInfo();
    }
  }, [book?.id, manifestLoaded, manifestData]);
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
    initialGraphEventLoadedRef.current = false;
  }, [book?.id]);
  
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
      const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
      
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
        const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
        
        if (isApiBook) {
          if (!book?.id || !currentChapter || !manifestLoaded) {
            return;
          }
          
          // currentEvent가 아직 없어도 초기 이벤트(1)로 즉시 로드
          
          let eventIdx = currentEvent?.eventNum || currentEvent?.eventIdx || 1;
          
          // 챕터 전환 강제 인덱스 우선 적용
          if (isChapterTransitionRef.current) {
            let forced = forcedChapterEventIdxRef.current;
            if (forced === 'max') {
              const chapterCache = getCachedChapterEvents(book.id, currentChapter);
              const maxEventIdx = Number(chapterCache?.maxEventIdx) || (Array.isArray(chapterCache?.events) ? chapterCache.events.length : 0);
              forced = maxEventIdx > 0 ? maxEventIdx : 1;
              forcedChapterEventIdxRef.current = forced;
            }
            if (forced && Number.isFinite(forced)) {
              eventIdx = forced;
            } else {
              const direction = chapterTransitionDirectionRef.current || transitionState.direction;
              if (direction === 'backward') {
                const chapterCache = getCachedChapterEvents(book.id, currentChapter);
                const maxEventIdx = Number(chapterCache?.maxEventIdx) || (Array.isArray(chapterCache?.events) ? chapterCache.events.length : 0);
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
            setTransitionState({ type: null, inProgress: false, error: false, direction: null });
            return;
          }
          
          let resultData = null;
          let usedCache = true;

          if (!initialGraphEventLoadedRef.current) {
            initialGraphEventLoadedRef.current = true;
            try {
              const apiResponse = await getFineGraph(book.id, currentChapter, apiEventIdx);
              const apiResult = apiResponse?.result ?? apiResponse?.data ?? null;
              if (apiResult) {
                resultData = {
                  characters: Array.isArray(apiResult.characters) ? apiResult.characters : [],
                  relations: Array.isArray(apiResult.relations) ? apiResult.relations : [],
                  event: apiResult.event ?? null,
                  elements: null,
                };
                usedCache = false;
              }
            } catch (apiError) {
              console.error('초기 그래프 이벤트 API 호출 실패', {
                bookId: book.id,
                chapterIdx: currentChapter,
                eventIdx: apiEventIdx,
                error: apiError,
              });
            }
          }

          if (!resultData) {
            const reconstructed = getGraphEventState(book.id, currentChapter, apiEventIdx);
            resultData = reconstructed
              ? {
                  characters: reconstructed.characters || [],
                  relations: (reconstructed.elements || [])
                    .filter((el) => el?.data?.source && el?.data?.target)
                    .map((edge) => ({
                      id1: edge.data.source,
                      id2: edge.data.target,
                      relation: edge.data.relation || [],
                      positivity: edge.data.positivity,
                      count: edge.data.count || 1,
                    })),
                  event: reconstructed.eventMeta || null,
                  elements: reconstructed.elements || [],
                }
              : null;
            usedCache = Boolean(reconstructed);
          }

          if (
            (!resultData || (
              !usedCache &&
              (!Array.isArray(resultData.characters) || resultData.characters.length === 0) &&
              (!Array.isArray(resultData.relations) || resultData.relations.length === 0)
            ))
          ) {
            const fallback = getGraphEventState(book.id, currentChapter, apiEventIdx);
            if (fallback) {
              resultData = {
                characters: fallback.characters || [],
                relations: (fallback.elements || [])
                  .filter((el) => el?.data?.source && el?.data?.target)
                  .map((edge) => ({
                    id1: edge.data.source,
                    id2: edge.data.target,
                    relation: edge.data.relation || [],
                    positivity: edge.data.positivity,
                    count: edge.data.count || 1,
                  })),
                event: fallback.eventMeta || null,
                elements: fallback.elements || [],
              };
              usedCache = true;
            }
          }

          if (!isMounted) return;
          
          const cacheKey = `${currentChapter}-${apiEventIdx}`;
          
          const hasCacheElements = Array.isArray(resultData?.elements) && resultData.elements.length > 0;
          const hasApiRelations = Array.isArray(resultData?.relations) && resultData.relations.length > 0;
          const hasGraphData = usedCache ? hasCacheElements : hasApiRelations;
          
          if (!hasGraphData) {
            previousGraphDataRef.current = {
              elements: [],
              eventIdx: apiEventIdx,
              chapterIdx: currentChapter
            };
            setElementsRef.current([]);

            if (isMounted) {
              setIsDataReady(true);
              setLoading(false);
              setTransitionState({ type: null, inProgress: false, error: false, direction: null });
              setApiError(null);
              console.warn('⚠️ 이벤트 데이터 없음: 그래프 클리어', {
                chapterIdx: currentChapter,
                eventIdx: apiEventIdx
              });
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
                cacheRef: apiEventCacheRef
              })
            : (resultData.relations || []);

          if (!Array.isArray(filteredRelations) || filteredRelations.length === 0) {
            previousGraphDataRef.current = {
              elements: [],
              eventIdx: apiEventIdx,
              chapterIdx: currentChapter
            };
            setElementsRef.current([]);

            const emptyEvent = {
              chapter: currentChapter,
              chapterIdx: currentChapter,
              eventNum: apiEventIdx,
              eventIdx: apiEventIdx,
              relations: [],
              characters: [],
              start: resultData?.event?.start,
              end: resultData?.event?.end,
              event_id: resultData?.event?.event_id ?? apiEventIdx,
              ...resultData?.event
            };

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
              setTransitionState({ type: null, inProgress: false, error: false, direction: null });
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
                    if (resultData.characters && resultData.relations && 
            resultData.characters.length > 0 && resultData.relations.length > 0) {
            
            const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = createCharacterMaps(resultData.characters);
            
            const nodeWeights = {};
            if (resultData.characters) {
              resultData.characters.forEach(char => {
                if (char.id !== undefined && char.weight !== undefined && char.weight > 0) {
                  const nodeId = String(char.id);
                  nodeWeights[nodeId] = {
                    weight: char.weight,
                    count: char.count || 1
                  };
                }
              });
            }
            
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
            
            if (convertedElements.length > 0 && isMounted) {
              // 캐시 사용 시 diff 기반 누적, 아니면 기존 병합 로직
              if (usedCache) {
                // diff 기반이므로 이미 누적된 상태
                previousGraphDataRef.current = {
                  elements: convertedElements,
                  eventIdx: apiEventIdx,
                  chapterIdx: currentChapter
                };
                setElementsRef.current(convertedElements);
              } else {
                // API 직접 호출 시 기존 병합 로직
                const prevData = previousGraphDataRef.current;
                
                if (prevData.chapterIdx !== currentChapter) {
                  previousGraphDataRef.current = {
                    elements: convertedElements,
                    eventIdx: apiEventIdx,
                    chapterIdx: currentChapter
                  };
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
                    
                    previousGraphDataRef.current = {
                      elements: mergedElements,
                      eventIdx: apiEventIdx,
                      chapterIdx: currentChapter
                    };
                    
                    setElementsRef.current(mergedElements);
                  } else {
                    previousGraphDataRef.current = {
                      elements: convertedElements,
                      eventIdx: apiEventIdx,
                      chapterIdx: currentChapter
                    };
                    setElementsRef.current(convertedElements);
                  }
                }
              }
            
            const extractRawEventIdx = event =>
              Number(
                event?.eventIdx ??
                event?.eventNum ??
                event?.event_id ??
                event?.idx ??
                event?.id ??
                0
              );

            const resolvedEventIdx = apiEventIdx;
            const originalEventIdx = normalizedEvent ? extractRawEventIdx(normalizedEvent) : resolvedEventIdx;

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
              const targetIdx = resolveEventIndex(nextEventData);
              const existingIdx = currentChapterEvents.findIndex(evt => resolveEventIndex(evt) === targetIdx);

              let updatedCurrent = [];
              if (existingIdx >= 0) {
                updatedCurrent = currentChapterEvents.map((evt, idx) =>
                  idx === existingIdx ? { ...evt, ...nextEventData } : evt
                );
              } else {
                updatedCurrent = [...currentChapterEvents, nextEventData];
              }

              updatedCurrent.sort((a, b) => resolveEventIndex(a) - resolveEventIndex(b));
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

                const prevIdx = resolveEventIndex(prev);
                const nextIdx = resolveEventIndex(nextEventData);
                if (prevIdx !== nextIdx) {
                  return nextEventData;
                }

                return { ...prev, ...nextEventData };
              });

              const appliedIdx = resolveEventIndex(nextEventData);
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

              if (!resultData.relations?.length && !resultData.characters?.length) {
                previousGraphDataRef.current = {
                  elements: [],
                  eventIdx: apiEventIdx,
                  chapterIdx: currentChapter
                };
                setElementsRef.current([]);
              }
            }
          } else {
            console.warn('⚠️ 그래프 데이터 변환 실패: characters 또는 relations가 비어있음');
          }
          
          if (transitionState.type === 'chapter' && transitionState.direction && currentChapter !== prevChapterRef.current) {
            if (!hasGraphPayload && !hasCharacterPayload) {
              setEvents([]);
              setCurrentEvent(null);
              setElementsRef.current([]);
              previousGraphDataRef.current = { elements: [], eventIdx: 0, chapterIdx: currentChapter };
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
            setTransitionState({ type: null, inProgress: false, error: false, direction: null });
            setApiError(null);
          }
          
        } catch (error) {
          if (isMounted) {
            // 404 에러는 데이터 없음으로 정상 상황 (eventIdx=0 등)
            if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다')) {
              // 빈 elements로 설정하고 에러로 표시하지 않음
              setElementsRef.current([]);
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
            setLoading(false);
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
        setPreviousEventsRef(validEvents);
        
        setIsDataReady(true);
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
              const rawIdx = Number(
                receivedEvent?.eventIdx ??
                receivedEvent?.eventNum ??
                receivedEvent?.event_id ??
                receivedEvent?.idx ??
                receivedEvent?.id ??
                0
              );

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

              const resolvedIdxForEvent = resolveEventIndex(nextEvent);
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
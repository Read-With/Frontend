import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import ViewerLayout from "./ViewerLayout";
import XhtmlViewer from "./xhtml/XhtmlViewer";
import BookmarkPanel from "./bookmark/BookmarkPanel";
import ViewerSettings from "./ui/ViewerSettings";
import { useViewerPage } from "../../hooks/viewer/useViewerPage";
import { useGraphSearch } from "../../hooks/graph/useGraphSearch";
import { useTransitionState } from "../../hooks/ui/useTransitionState";
import { useProgressAutoSave } from "../../hooks/viewer/useProgressAutoSave";
import { useTooltipState } from "../../hooks/ui/useTooltipState";
import { useCachedLocation } from "../../hooks/viewer/useCachedLocation";
import { getFineGraph, saveProgress } from "../../utils/api/api";
import { getProgressFromCache } from "../../utils/common/cache/progressCache";
import { anchorToLocators } from "../../utils/common/locatorUtils";
import { getGraphEventState, getCachedChapterEvents, getCachedReaderProgress, isGraphBookCacheBuilding, ensureGraphBookCache } from "../../utils/common/cache/chapterEventCache";
import { 
  getServerBookId,
  eventUtils,
  bookUtils,
  graphDataCacheUtils,
  eventIdxUtils,
  graphDataTransformUtils,
  cacheKeyUtils
} from "../../utils/viewer/viewerUtils";
import { restoreGraphLayout, preloadChapterLayouts } from "../../utils/graph/graphLayoutUtils";
import { removeBookmarkHighlights } from "./bookmark/BookmarkManager";
import { 
  getEventsForChapter,
  getEventDataByIndex
} from "../../utils/graph/graphData";
import { convertRelationsToElements, filterRelationsByTimeline } from "../../utils/graph/graphDataUtils";
import { buildNodeWeights, createCharacterMaps } from "../../utils/graph/characterUtils";
import { getRelationKeyFromRelation } from "../../utils/graph/relationUtils";
import { errorUtils } from "../../utils/common/errorUtils";
import GraphSplitArea from "./GraphSplitArea";

const ViewerPage = () => {
  const {
    viewerRef, reloadKey, progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal,
    settings, currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    events: _events, setEvents, showGraph, elements, setElements, setGraphViewState,
    setCurrentCharIndex,
    loading, setLoading,
    isDataReady, setIsDataReady, isReloading, setIsReloading: _setIsReloading,
    isGraphLoading, setIsGraphLoading, showToolbar, setShowToolbar,
    bookmarks, showBookmarkList, setShowBookmarkList: _setShowBookmarkList,
    prevElementsRef, book, folderKey, currentChapterData,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, toggleGraph, handleLocationChange: _handleLocationChange,
    graphState, graphActions, viewerState, searchState, graphFullScreen, setGraphFullScreen: _setGraphFullScreen,
    previousPage, isFromLibrary, bookId, cleanBookId, exitToMypage,
    manifestLoaded,
    readingFromPath,
  } = useViewerPage();

  const bookKey = useMemo(() => {
    const id = bookId ?? book?.id;
    if (id == null) return null;
    const trimmed = String(id).trim();
    return trimmed || null;
  }, [bookId, book?.id]);

  const { cachedLocation, saveLocation } = useCachedLocation(bookKey);

  const graphClearRef = useRef(null);
  const apiEventCacheRef = useRef(new Map());
  const apiCallRef = useRef(null);
  const initialGraphEventLoadedRef = useRef(false);
  const sequentialPrefetchStatusRef = useRef(new Map());
  const setElementsRef = useRef(setElements);
  const previousGraphDataRef = useRef({ elements: [], eventIdx: 0, chapterIdx: 0 });
  const chapterEventDiscoveryRef = useRef(new Map());
  const retryTimeoutRef = useRef(null);
  
  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);
  
  const clearGraphElements = useCallback((eventIdx, chapterIdx) => {
    eventUtils.updateGraphDataRef(previousGraphDataRef, [], eventIdx || 0, chapterIdx || 0);
    setElementsRef.current([]);
  }, []);
  
  const {
    transitionState,
    isChapterTransitionRef,
    chapterTransitionDirectionRef,
    forcedChapterEventIdxRef,
    startChapterTransition,
    releaseForcedEventIdx,
    resetTransition
  } = useTransitionState({
    currentEvent,
    currentChapter,
    loading,
    isReloading,
    isGraphLoading,
    isDataReady
  });
  
  const [apiError, setApiError] = useState(null);
  
  const updateLoadingState = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    setIsDataReady(isReady);
    setLoading(isLoading);
    if (shouldResetTransition) resetTransition();
    setApiError(error);
  }, [setIsDataReady, setLoading, setApiError, resetTransition]);

  const triggerGraphRetry = useCallback((resetInitialGraphEvent = false) => {
    clearRetryTimeout();
    setApiError(null);
    apiCallRef.current = null;
    if (resetInitialGraphEvent) {
      initialGraphEventLoadedRef.current = false;
    }
    setLoading((prev) => !prev);
  }, [clearRetryTimeout, setLoading]);

  const buildGraphLoadError = useCallback((details, retryHandler) => ({
    message: '그래프 데이터를 불러오는데 실패했습니다.',
    details,
    retry: retryHandler,
  }), []);

  const resetGraphOnNotFound = useCallback(() => {
    clearGraphElements(0, currentChapter);
    updateLoadingState(true, false);
  }, [clearGraphElements, currentChapter, updateLoadingState]);
  
  useEffect(() => {
    apiEventCacheRef.current.clear();
  }, [book?.id, currentChapter]);

  const {
    activeTooltip,
    handleClearTooltip,
    handleSetActiveTooltip
  } = useTooltipState({
    onError: () => {
      toast.error("툴팁 표시에 문제가 발생했습니다. 페이지를 새로고침 해주세요.", {
        autoClose: 2000,
        closeOnClick: true,
        pauseOnHover: true
      });
    },
    graphClearRef
  });


  const currentEventKey = useMemo(() => {
    if (!currentEvent || currentEvent.placeholder) return null;
    if (currentEvent.chapter && Number(currentEvent.chapter) !== Number(currentChapter)) return null;
    return {
      chapter: currentChapter,
      eventIdx: eventUtils.extractRawEventIdx(currentEvent),
      eventNum: currentEvent.eventNum ?? currentEvent.eventIdx,
    };
  }, [currentChapter, currentEvent?.eventNum, currentEvent?.eventIdx, currentEvent?.placeholder, currentEvent?.chapter]);

  useEffect(() => {
    if (!bookKey || !currentEventKey) {
      return;
    }

    const resolvedIdx = currentEventKey.eventIdx;
    const currentCachedLocation = getCachedReaderProgress(bookKey);
    const cachedChapterIdx = currentCachedLocation ? Number(currentCachedLocation.chapterIdx) : null;
    const cachedEventIdxValue = currentCachedLocation
      ? Number(currentCachedLocation.eventIdx ?? currentCachedLocation.eventNum ?? 0)
      : null;
    const hasCachedEventIdx =
      cachedEventIdxValue !== null && Number.isFinite(cachedEventIdxValue) && cachedEventIdxValue > 0;
    const isSameChapter =
      cachedChapterIdx !== null &&
      Number.isFinite(cachedChapterIdx) &&
      cachedChapterIdx > 0 &&
      Number(cachedChapterIdx) === Number(currentEventKey.chapter);
    const cachedStart =
      currentCachedLocation?.startLocator ??
      currentCachedLocation?.anchor?.startLocator ??
      currentCachedLocation?.anchor?.start;
    const keyStart =
      currentEvent?.anchor?.startLocator ?? currentEvent?.anchor?.start;
    const sameByLocator = keyStart && cachedStart &&
      cachedStart.chapterIndex === keyStart.chapterIndex &&
      (cachedStart.blockIndex ?? 0) === (keyStart.blockIndex ?? 0) &&
      (cachedStart.offset ?? 0) === (keyStart.offset ?? 0);
    const isSameEvent =
      isSameChapter &&
      hasCachedEventIdx &&
      cachedEventIdxValue === resolvedIdx &&
      sameByLocator;

    if (isSameEvent) {
      return;
    }

    const anchor = currentEvent?.anchor;
    const startL = anchor?.startLocator ?? anchor?.start;
    const endL = anchor?.endLocator ?? anchor?.end ?? startL;
    saveLocation({
      bookId: typeof book?.id === 'number' ? book.id : null,
      chapterIdx: currentEventKey.chapter,
      eventIdx: resolvedIdx,
      eventNum: currentEventKey.eventNum ?? resolvedIdx,
      eventId: currentEvent?.event_id ?? currentEvent?.eventId ?? currentEvent?.id ?? null,
      startLocator: startL ?? undefined,
      endLocator: endL ?? undefined,
      eventName:
        currentEvent?.event?.name ??
        currentEvent?.event?.title ??
        currentEvent?.title ??
        currentEvent?.name ??
        null,
      chapterProgress: currentEvent?.chapterProgress ?? null,
      source: 'runtime'
    });
  }, [bookKey, currentEventKey, book?.id, currentEvent, saveLocation]);

  const prefetchChapterEventsSequentially = useCallback(async (targetChapter) => {
    if (!book?.id || typeof book.id !== 'number') {
      return;
    }

    if (!targetChapter || targetChapter < 1) {
      return;
    }

    const bookId = book.id;
    const key = cacheKeyUtils.createChapterKey(bookId, targetChapter);
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

      const normalizedEvents = sortedEvents.reduce((acc, event) => {
        const normalizedIdx = eventUtils.normalizeEventIdx(event) || 0;
        if (!normalizedIdx) return acc;
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
        return eventUtils.updateEventsInState(acc, normalizedEvent, targetChapter);
      }, []);

      setEvents((prev) =>
        normalizedEvents.length > 0
          ? normalizedEvents.reduce((p, evt) => eventUtils.updateEventsInState(p, evt, targetChapter), prev)
          : prev
      );

      sequentialPrefetchStatusRef.current.set(key, 'completed');
    } catch (error) {
      errorUtils.logError('[ViewerPage] 챕터 이벤트 사전 로드 중 오류', error);
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

  // 컴포넌트 언마운트 시 모든 timeout과 ref 정리
  useEffect(() => {
    return () => {
      clearRetryTimeout();
      if (apiEventCacheRef.current) {
        apiEventCacheRef.current.clear();
      }
      if (sequentialPrefetchStatusRef.current) {
        sequentialPrefetchStatusRef.current.clear();
      }
      if (chapterEventDiscoveryRef.current) {
        chapterEventDiscoveryRef.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    setElementsRef.current = setElements;
  }, [setElements]);

  useEffect(() => {
    initialGraphEventLoadedRef.current = false;
    apiCallRef.current = null;
    setApiError(null);
  }, [book?.id]);
  
  useEffect(() => {
    // currentChapter 변경 시 해당 챕터의 API 호출 상태 초기화
    apiCallRef.current = null;
  }, [book?.id, currentChapter]);
  
  // 챕터별 이벤트 탐색 (챕터 변경 시)
  useEffect(() => {
    let isMounted = true;
    let checkInterval = null;
    
    const discoverEvents = async () => {
      const isApiBook = bookUtils.isApiBook(book);
      
      if (!isApiBook || !book?.id || !currentChapter) {
        return;
      }
      
      // 이미 탐색 중이거나 완료된 챕터는 스킵
      const discoveryKey = cacheKeyUtils.createChapterKey(book.id, currentChapter);
      const currentStatus = chapterEventDiscoveryRef.current.get(discoveryKey);
      if (currentStatus === 'completed' || currentStatus === 'loading') {
        return;
      }
      
      const cached = getCachedChapterEvents(book.id, currentChapter);
      if (cached) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'completed');
        if (isMounted) {
          setApiError(null);
        }
        return;
      }

      let isBuilding = isGraphBookCacheBuilding(book.id);
      if (!isBuilding) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'loading');
        if (isMounted) {
          setIsGraphLoading(true);
          setApiError(null);
        }
        ensureGraphBookCache(book.id).catch(() => {});
      }

      if (isBuilding || chapterEventDiscoveryRef.current.get(discoveryKey) === 'loading') {
        if (isMounted) {
          setIsGraphLoading(true);
          setApiError(null);
        }
        checkInterval = setInterval(() => {
          if (!isMounted) {
            if (checkInterval) clearInterval(checkInterval);
            return;
          }
          const stillBuilding = isGraphBookCacheBuilding(book.id);
          const nowCached = getCachedChapterEvents(book.id, currentChapter);
          if (nowCached) {
            chapterEventDiscoveryRef.current.set(discoveryKey, 'completed');
            if (checkInterval) clearInterval(checkInterval);
            if (isMounted) {
              setIsGraphLoading(false);
              setApiError(null);
            }
          } else if (!stillBuilding) {
            chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
            if (checkInterval) clearInterval(checkInterval);
            if (isMounted) {
              setIsGraphLoading(false);
              setApiError((prev) => prev ?? '그래프 이벤트 캐시가 없습니다. 마이페이지에서 데이터를 준비해주세요.');
            }
          }
        }, 500);
        return;
      }

      if (isMounted) {
        chapterEventDiscoveryRef.current.set(discoveryKey, 'missing');
        setIsGraphLoading(false);
        setApiError((prev) => prev ?? '그래프 이벤트 캐시가 없습니다. 마이페이지에서 데이터를 준비해주세요.');
      }
    };
    
    discoverEvents();
    
    return () => {
      isMounted = false;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  }, [book?.id, currentChapter, setIsGraphLoading, setApiError]);
  
  useEffect(() => {
    let isMounted = true;
    
    const loadGraphData = async () => {
        const isApiBook = bookUtils.isApiBook(book);
        
        if (isApiBook) {
          if (!book?.id || !currentChapter) {
            return;
          }
          
          if (!manifestLoaded) {
            return;
          }
          
          const apiEventIdx = eventIdxUtils.calculateEventIdxForTransition(
            currentEvent,
            isChapterTransitionRef.current,
            forcedChapterEventIdxRef,
            chapterTransitionDirectionRef,
            book.id,
            currentChapter,
            getCachedChapterEvents,
            eventUtils
          );
          
          const callKey = cacheKeyUtils.createEventKey(book.id, currentChapter, apiEventIdx);
          if (apiCallRef.current === callKey) {
            return;
          }
          
          if (eventIdxUtils.shouldBlockApiCall(isChapterTransitionRef.current, forcedChapterEventIdxRef, apiEventIdx)) {
            return;
          }
          
          apiCallRef.current = callKey;
         
        try {
          if (!book?.id || !currentChapter || apiEventIdx < 1) {
            clearGraphElements(0, currentChapter);
            updateLoadingState(true, false);
            return;
          }
          
          const chapterEventApiKey = cacheKeyUtils.createEventKey(book.id, currentChapter, apiEventIdx);
          const hasCalledApiForEvent = initialGraphEventLoadedRef.current === chapterEventApiKey;
          
          if (!hasCalledApiForEvent) {
            initialGraphEventLoadedRef.current = chapterEventApiKey;
          }

          let { resultData, usedCache } = await graphDataCacheUtils.getGraphDataFromApiOrCache(
            book.id,
            currentChapter,
            apiEventIdx,
            getFineGraph,
            getGraphEventState,
            eventUtils,
            apiEventCacheRef,
            hasCalledApiForEvent
          );

          if (!isMounted || apiCallRef.current !== callKey) return;

          const cacheKey = cacheKeyUtils.createCacheKey(currentChapter, apiEventIdx);
          
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
            clearGraphElements(apiEventIdx, currentChapter);

            if (isMounted) {
              updateLoadingState(true, false);
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

          if (!isMounted || apiCallRef.current !== callKey) return;

          if (!Array.isArray(filteredRelations) || filteredRelations.length === 0) {
            clearGraphElements(apiEventIdx, currentChapter);

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
              updateLoadingState(true, false);
            }

            return;
          }

          resultData = { ...resultData, relations: filteredRelations };
          if (apiEventCacheRef.current) {
            apiEventCacheRef.current.set(cacheKey, resultData);
          }
          
          const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(
            resultData.event,
            currentChapter,
            apiEventIdx
          );
          
          const convertedElements = graphDataTransformUtils.convertToElements(
            resultData,
            usedCache,
            normalizedEvent,
            createCharacterMaps,
            buildNodeWeights,
            convertRelationsToElements
          );
          
          const hasGraphPayload = Array.isArray(resultData?.relations) && resultData.relations.length > 0;
          const hasCharacterPayload = Array.isArray(resultData?.characters) && resultData.characters.length > 0;
          
          if (convertedElements.length > 0 && isMounted) {
            let finalElements = convertedElements;
            
            if (usedCache) {
              eventUtils.updateGraphDataRef(previousGraphDataRef, convertedElements, apiEventIdx, currentChapter);
              setElementsRef.current(convertedElements);
            } else {
              const prevData = previousGraphDataRef.current;
              finalElements = graphDataTransformUtils.mergeElementsWithPrevious(
                convertedElements,
                prevData,
                currentChapter,
                apiEventIdx
              );
              eventUtils.updateGraphDataRef(previousGraphDataRef, finalElements, apiEventIdx, currentChapter);
              setElementsRef.current(finalElements);
            }
            if (graphActions.setIsDataEmpty) graphActions.setIsDataEmpty(false);

            const nextEventData = graphDataTransformUtils.createNextEventData(
              normalizedEvent,
              currentChapter,
              apiEventIdx,
              resultData,
              eventUtils
            );

            setEvents(prevEvents => 
              eventUtils.updateEventsInState(
                prevEvents, 
                nextEventData, 
                currentChapter, 
                !hasGraphPayload && !hasCharacterPayload
              )
            );

            if (!hasGraphPayload && !hasCharacterPayload) {
              const fallbackEvent = {
                ...nextEventData,
                placeholder: true,
                relations: [],
                characters: []
              };
              setCurrentEvent(fallbackEvent);
              clearGraphElements(apiEventIdx, currentChapter);
              releaseForcedEventIdx();
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
              const forced = forcedChapterEventIdxRef.current;
              if (
                forced &&
                forced !== 'max' &&
                Number.isFinite(Number(forced)) &&
                appliedIdx === Number(forced)
              ) {
                releaseForcedEventIdx();
              }
            }
            
            // 변환된 elements가 있지만 원본 데이터가 비어있으면 elements 비우기
            if (!resultData.relations?.length && !resultData.characters?.length && !usedCache) {
              clearGraphElements(apiEventIdx, currentChapter);
            }
          } else {
            if (!usedCache || !Array.isArray(resultData.elements) || resultData.elements.length === 0) {
              errorUtils.logWarning('[ViewerPage] 그래프 데이터 변환 실패', 'characters, relations, 또는 elements가 비어있음');
            }
            
            clearGraphElements(apiEventIdx, currentChapter);
          }
          
          const isChapterTransition = transitionState.type === 'chapter' && 
                                     transitionState.direction;
          
          if (isChapterTransition) {
            if (!hasGraphPayload && !hasCharacterPayload) {
              setEvents([]);
              setCurrentEvent(null);
              clearGraphElements(0, currentChapter);
            } else {
              previousGraphDataRef.current = {
                ...previousGraphDataRef.current,
                chapterIdx: currentChapter
              };
            }
          }

          if (isMounted) {
            updateLoadingState(true, false);
          }
          
        } catch (error) {
          if (isMounted) {
            const status = error?.status;
            const message = error?.message || '';
            const isNotFound = status === 404 || message.includes('404') || message.includes('찾을 수 없습니다');
            
            if (isNotFound) {
              resetGraphOnNotFound();
            } else {
              const maxRetries = 3;
              const retryCount = (error.retryCount || 0) + 1;
              
              if (retryCount < maxRetries) {
                clearRetryTimeout();
                retryTimeoutRef.current = setTimeout(() => {
                  if (isMounted) {
                    apiCallRef.current = null;
                    setLoading((prev) => !prev);
                  }
                  retryTimeoutRef.current = null;
                }, 1000 * retryCount);
                
                setApiError(buildGraphLoadError(
                  `${message || '알 수 없는 오류'} (재시도 ${retryCount}/${maxRetries})`,
                  () => triggerGraphRetry(false)
                ));
              } else {
                clearRetryTimeout();
                setApiError(buildGraphLoadError(
                  message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                  () => triggerGraphRetry(true)
                ));
              }
              
              updateLoadingState(true, false);
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
          updateLoadingState(true, false, null, true);
          return;
        }
        
        const localEvents = getEventsForChapter(currentChapter, folderKey);
        
        if (!isMounted) return;
        
        setEvents(localEvents);
        
        updateLoadingState(true, false, null, false);
      } catch (error) {
        errorUtils.logError('[ViewerPage] 로컬 이벤트 로드 오류', error);
        if (isMounted) {
          updateLoadingState(true, false, null, true);
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
    folderKey
  ]);

  useProgressAutoSave({
    bookKey,
    currentChapter,
    currentEvent
  });

  useEffect(() => {
    if (!bookmarks?.length) return undefined;
    const timer = setTimeout(() => {
      removeBookmarkHighlights();
    }, 500);
    return () => {
      clearTimeout(timer);
      removeBookmarkHighlights();
    };
  }, [bookmarks, currentChapter]);

  const {
    searchTerm, isSearchActive, filteredElements,
    fitNodeIds,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    selectSuggestion, handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  const memoizedEventsForChapter = useMemo(
    () => getEventsForChapter(currentChapter, folderKey),
    [currentChapter, folderKey]
  );

  // ─── JSX용 콜백 ─────────────────────────────────────────────────────────────
  const handleCurrentChapterChange = useCallback((chapter) => {
    const prev = Number(currentChapter || 0);
    const next = Number(chapter || 0);
    if (prev && next && prev !== next) {
      const transitionInfo = startChapterTransition(prev, next);
      if (transitionInfo && transitionInfo.forcedIdx === 1) {
        setCurrentEvent({
          chapter: next, chapterIdx: next,
          eventIdx: 1, eventNum: 1, event_id: 1,
          relations: [], characters: [],
          placeholder: true,
        });
      }
    }
    setCurrentChapter(chapter);
  }, [currentChapter, startChapterTransition, setCurrentEvent, setCurrentChapter]);

  const handleCurrentLineChange = useCallback((charIndex, _totalEvents, receivedEvent) => {
    setCurrentCharIndex(charIndex);
    if (!receivedEvent) return;

    const chapter =
      receivedEvent.chapter ??
      receivedEvent.anchor?.startLocator?.chapterIndex ??
      receivedEvent.anchor?.start?.chapterIndex ??
      null;
    if (chapter && chapter !== currentChapter) {
      setCurrentChapter(chapter);
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
          originalEventIdx: rawIdx || forcedIdx,
        };
        shouldReleaseForced = true;
      }
    }

    const resolvedIdxForEvent = eventUtils.extractRawEventIdx(nextEvent);
    if (!Number.isFinite(nextEvent.resolvedEventIdx) || nextEvent.resolvedEventIdx <= 0) {
      nextEvent = {
        ...nextEvent,
        resolvedEventIdx: resolvedIdxForEvent > 0 ? resolvedIdxForEvent : undefined,
      };
    }
    setCurrentEvent(nextEvent);
    if (shouldReleaseForced) releaseForcedEventIdx();
  }, [currentChapter, setCurrentChapter, setCurrentCharIndex, setCurrentEvent, releaseForcedEventIdx]);

  const handleExitToMypage = useCallback(async () => {
    try {
      const serverBookId = getServerBookId(book);
      if (serverBookId && viewerRef.current?.getCurrentLocator) {
        const loc = await viewerRef.current.getCurrentLocator();
        const { startLocator } = anchorToLocators(loc);
        if (startLocator) {
          const res = await saveProgress({
            bookId: String(serverBookId),
            startLocator,
            locator: startLocator,
          });
          if (!res?.isSuccess) {
            errorUtils.logWarning('[ViewerPage] 종료 시 진도 저장 실패', res?.message || '응답 실패', {
              bookId: serverBookId,
            });
          }
        }
      }
    } catch (_e) {
      // 종료 동작은 항상 진행
    } finally {
      exitToMypage();
    }
  }, [book, viewerRef, exitToMypage]);

  // ─── GraphSplitArea 전달 props 메모이제이션 ──────────────────────────────────
  const graphStateProp = useMemo(() => ({
    ...graphState,
    prevValidEvent: currentEvent?.chapter === currentChapter ? currentEvent : null,
    events: memoizedEventsForChapter,
  }), [graphState, currentEvent, currentChapter, memoizedEventsForChapter]);

  const searchStateProp = useMemo(() => ({
    ...searchState,
    searchTerm,
    isSearchActive,
    elements,
    filteredElements,
    isResetFromSearch,
    fitNodeIds,
    suggestions,
    showSuggestions,
    selectedIndex,
  }), [searchState, searchTerm, isSearchActive, elements, filteredElements,
      isResetFromSearch, fitNodeIds, suggestions, showSuggestions, selectedIndex]);

  const searchActionsProp = useMemo(() => ({
    onSearchSubmit: handleSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions: setSearchTerm,
    selectSuggestion,
    handleKeyDown,
  }), [handleSearchSubmit, clearSearch, closeSuggestions, setSearchTerm, selectSuggestion, handleKeyDown]);

  const tooltipPropsProp = useMemo(() => ({
    activeTooltip,
    onClearTooltip: handleClearTooltip,
    onSetActiveTooltip: handleSetActiveTooltip,
    graphClearRef,
  }), [activeTooltip, handleClearTooltip, handleSetActiveTooltip]);

  useEffect(() => {
    if (!isDataReady || !currentEvent) return;
    
    const restoredLayout = restoreGraphLayout(currentEvent, currentChapter);
    if (restoredLayout) {
      setGraphViewState(restoredLayout);
    }
  }, [isDataReady, currentEvent, currentChapter]);

  useEffect(() => {
    if (!elements) return;
    prevElementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    if (!folderKey || !bookKey) {
      return;
    }
    
    const abortController = new AbortController();
    
    preloadChapterLayouts({
      folderKey,
      bookKey,
      signal: abortController.signal
    });
    
    return () => {
      abortController.abort();
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
        currentChapter={currentChapter}
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
        onExitToMypage={handleExitToMypage}
        rightSideContent={
          <GraphSplitArea
            graphState={graphStateProp}
            graphActions={graphActions}
            viewerState={viewerState}
            searchState={searchStateProp}
            searchActions={searchActionsProp}
            tooltipProps={tooltipPropsProp}
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
        {(() => {
          const initialProgressFromServer = Number(book?.progress);
          const resolvedInitialProgress = Number.isFinite(initialProgressFromServer)
            ? initialProgressFromServer
            : progress;
          const useProgressForPosition = Number.isFinite(resolvedInitialProgress) && resolvedInitialProgress > 0;
          const progressKey = cleanBookId ?? bookKey;
          const cachedProgress = getProgressFromCache(progressKey);
          const anchor = readingFromPath ? undefined : (cachedProgress?.anchor ?? undefined);
          return (
            <XhtmlViewer
              key={reloadKey}
              ref={viewerRef}
              book={book}
              manifestReady={manifestLoaded}
              initialChapter={currentChapter}
              initialProgress={readingFromPath ? 0 : resolvedInitialProgress}
              onProgressChange={setProgress}
              onCurrentPageChange={setCurrentPage}
              onTotalPagesChange={setTotalPages}
              onCurrentChapterChange={handleCurrentChapterChange}
              settings={settings}
              onCurrentLineChange={handleCurrentLineChange}
              bookId={progressKey}
              initialAnchor={anchor}
              initialPage={useProgressForPosition && !readingFromPath ? undefined : currentPage}
            />
          );
        })()}
        {showBookmarkList && bookKey && (
          <BookmarkPanel bookId={bookKey} onSelect={handleBookmarkSelect} />
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
import React, { useRef, useState, useEffect, useCallback } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import ViewerLayout from "./ViewerLayout";
import EpubViewer from "./epub/EpubViewer";
import BookmarkPanel from "./bookmark/BookmarkPanel";
import ViewerSettings from "./epub/ViewerSettings";
import { useViewerPage } from "../../hooks/viewer/useViewerPage";
import { useGraphSearch } from "../../hooks/graph/useGraphSearch";
import { useTransitionState } from "../../hooks/ui/useTransitionState";
import { useProgressAutoSave } from "../../hooks/viewer/useProgressAutoSave";
import { useTooltipState } from "../../hooks/ui/useTooltipState";
import { useCachedLocation } from "../../hooks/viewer/useCachedLocation";
import { getBookProgress, getFineGraph, getBookManifest } from "../../utils/api/api";
import { getGraphEventState, getCachedChapterEvents } from "../../utils/common/cache/chapterEventCache";
import { getManifestFromCache } from "../../utils/common/cache/manifestCache";
import { 
  getServerBookId,
  eventUtils,
  bookUtils,
  graphDataCacheUtils,
  eventIdxUtils,
  graphDataTransformUtils,
  cacheKeyUtils
} from "../../utils/viewerUtils";
import { restoreGraphLayout, preloadChapterLayouts } from "../../utils/graphLayoutUtils";
import { applyBookmarkHighlights, removeBookmarkHighlights } from "./bookmark/BookmarkManager";
import { 
  getEventsForChapter,
  getEventDataByIndex
} from "../../utils/graphData";
import { convertRelationsToElements, filterRelationsByTimeline } from "../../utils/graphDataUtils";
import { buildNodeWeights, createCharacterMaps } from "../../utils/characterUtils";
import { getRelationKeyFromRelation } from "../../utils/relationUtils";
import { errorUtils } from "../../utils/common/errorUtils";
import GraphSplitArea from "./GraphSplitArea";

const ViewerPage = () => {
  const {
    viewerRef, reloadKey, progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal,
    settings, currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    events, setEvents, showGraph, elements, setElements, setGraphViewState,
    setCurrentCharIndex,
    loading, setLoading,
    isDataReady, setIsDataReady, isReloading, setIsReloading,
    isGraphLoading, setIsGraphLoading, showToolbar, setShowToolbar,
    bookmarks, showBookmarkList, setShowBookmarkList,
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
  
  const [manifestLoaded, setManifestLoaded] = useState(false);
  const [apiError, setApiError] = useState(null);
  
  const updateLoadingState = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    setIsDataReady(isReady);
    setLoading(isLoading);
    if (shouldResetTransition) {
      resetTransition();
    }
    if (error !== null) {
      setApiError(error);
    } else {
      setApiError(null);
    }
  }, [resetTransition]);
  
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


  const currentEventKey = React.useMemo(() => {
    if (!currentEvent || currentEvent.placeholder) return null;
    if (currentEvent.chapter && Number(currentEvent.chapter) !== Number(currentChapter)) return null;
    
    return {
      chapter: currentChapter,
      eventIdx: eventUtils.extractRawEventIdx(currentEvent),
      eventNum: currentEvent.eventNum ?? currentEvent.eventIdx,
      cfi: currentEvent.cfi ?? null
    };
  }, [currentChapter, currentEvent?.eventNum, currentEvent?.eventIdx, currentEvent?.cfi, currentEvent?.placeholder, currentEvent?.chapter]);

  useEffect(() => {
    if (!bookKey || !currentEventKey) {
      return;
    }

    const resolvedIdx = currentEventKey.eventIdx;
    const currentCachedLocation = cachedLocation;
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
    const isSameEvent =
      isSameChapter &&
      hasCachedEventIdx &&
      cachedEventIdxValue === resolvedIdx &&
      ((currentCachedLocation?.cfi ?? null) === currentEventKey.cfi);

    if (isSameEvent) {
      return;
    }

    saveLocation({
      bookId: typeof book?.id === 'number' ? book.id : null,
      chapterIdx: currentEventKey.chapter,
      eventIdx: resolvedIdx,
      eventNum: currentEventKey.eventNum ?? resolvedIdx,
      eventId: currentEvent?.event_id ?? currentEvent?.eventId ?? currentEvent?.id ?? null,
      cfi: currentEventKey.cfi,
      eventName:
        currentEvent?.event?.name ??
        currentEvent?.event?.title ??
        currentEvent?.title ??
        currentEvent?.name ??
        null,
      chapterProgress: currentEvent?.chapterProgress ?? null,
      source: 'runtime'
    });
  }, [bookKey, currentEventKey, book?.id, currentEvent, cachedLocation, saveLocation]);

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

        setEvents((prevEvents) => 
          eventUtils.updateEventsInState(prevEvents, normalizedEvent, targetChapter)
        );
      });

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

  const testProgressAPI = useCallback(async () => {
    const serverBookId = getServerBookId(book);
    const isServerBook = !!serverBookId;

    if (!isServerBook || !serverBookId) {
      setManifestLoaded(true);
      return;
    }

    try {
      try {
        await getBookProgress(serverBookId);
      } catch (progressError) {
        // 조용히 처리
      }

      let manifest = getManifestFromCache(serverBookId);
      
      if (manifest) {
        setManifestLoaded(true);
        return;
      }
      
      try {
        const manifestResponse = await getBookManifest(serverBookId);
        if (manifestResponse?.isSuccess && manifestResponse?.result) {
          manifest = manifestResponse.result;
          setManifestLoaded(true);
        } else {
          errorUtils.logWarning('[Viewer] 그래프/매니페스트를 서버에서 가져올 수 없습니다', '', { bookId: serverBookId });
          setApiError((prev) => prev ?? '그래프 데이터를 서버에서 가져올 수 없습니다.');
          setManifestLoaded(true);
        }
      } catch (manifestError) {
        const status = manifestError?.status;
        const message = manifestError?.message || '';
        const isSilentError = status === 404 || status === 403 || message.includes('404') || message.includes('403');
        
        if (!isSilentError) {
          errorUtils.logWarning('[Viewer] 그래프/매니페스트 조회 실패', message, { status });
        }
        setApiError((prev) => prev ?? '그래프 데이터를 서버에서 가져올 수 없습니다.');
        setManifestLoaded(true);
      }
    } catch (error) {
      errorUtils.logError('[Viewer] Manifest 로드 중 오류', error);
      setManifestLoaded(true);
    }
  }, [book?.id, bookId]);

  // 진도 복원은 EpubViewer에서 이미 수행하므로 여기서는 제거
  // EpubViewer의 loadBook()에서 apiProgressData를 사용하여 displayTarget을 설정하고
  // rendition.display()를 호출하므로 중복 복원을 방지

  useEffect(() => {
    testProgressAPI();
  }, [testProgressAPI]);
  
  useEffect(() => {
    setElementsRef.current = setElements;
  }, [setElements]);

  useEffect(() => {
    // book.id 변경 시 완전 초기화
    initialGraphEventLoadedRef.current = false;
    apiCallRef.current = null;
    setManifestLoaded(false);
    setApiError(null);
  }, [book?.id]);
  
  useEffect(() => {
    // currentChapter 변경 시 해당 챕터의 API 호출 상태 초기화
    apiCallRef.current = null;
  }, [book?.id, currentChapter]);
  
  // 챕터별 이벤트 탐색 (챕터 변경 시)
  useEffect(() => {
    let isMounted = true;
    
    const discoverEvents = async () => {
      const isApiBook = bookUtils.isApiBook(book);
      
      if (!isApiBook || !book?.id || !currentChapter) {
        return;
      }
      
      // 이미 탐색 중이거나 완료된 챕터는 스킵
      const discoveryKey = cacheKeyUtils.createChapterKey(book.id, currentChapter);
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

          if (!isMounted) return;
          
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
              clearGraphElements(0, currentChapter);
              updateLoadingState(true, false);
            } else {
              const maxRetries = 3;
              const retryCount = (error.retryCount || 0) + 1;
              
              if (retryCount < maxRetries) {
                clearRetryTimeout();
                retryTimeoutRef.current = setTimeout(() => {
                  if (isMounted) {
                    apiCallRef.current = null;
                    setLoading(prev => !prev);
                  }
                  retryTimeoutRef.current = null;
                }, 1000 * retryCount);
                
                setApiError({
                  message: '그래프 데이터를 불러오는데 실패했습니다.',
                  details: `${message || '알 수 없는 오류'} (재시도 ${retryCount}/${maxRetries})`,
                  retry: () => {
                    clearRetryTimeout();
                    setApiError(null);
                    apiCallRef.current = null;
                    setLoading(prev => !prev);
                  }
                });
              } else {
                clearRetryTimeout();
                setApiError({
                  message: '그래프 데이터를 불러오는데 실패했습니다.',
                  details: message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                  retry: () => {
                    clearRetryTimeout();
                    setApiError(null);
                    apiCallRef.current = null;
                    initialGraphEventLoadedRef.current = false;
                    setLoading(prev => !prev);
                  }
                });
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

  const {
    searchTerm, isSearchActive, filteredElements,
    fitNodeIds,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    selectSuggestion, handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  const memoizedEventsForChapter = React.useMemo(() => {
    return getEventsForChapter(currentChapter, folderKey);
  }, [currentChapter, folderKey]);

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
              events: memoizedEventsForChapter
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
              const transitionInfo = startChapterTransition(prev, next);
              if (transitionInfo && transitionInfo.forcedIdx === 1) {
                setCurrentEvent({
                  chapter: next,
                  chapterIdx: next,
                  eventIdx: 1,
                  eventNum: 1,
                  event_id: 1,
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
                releaseForcedEventIdx();
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
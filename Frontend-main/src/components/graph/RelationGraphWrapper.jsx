import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import GraphSidebar from "./tooltip/GraphSidebar";
import "./RelationGraph.css";

import { createGraphStylesheet, getEdgeStyle, getWideLayout } from "../../utils/styles/graphStyles";
import { ANIMATION_VALUES } from "../../utils/styles/animations";
import { sidebarStyles, topBarStyles, graphStyles, createButtonStyle, createAdvancedButtonHandlers, COLORS } from "../../utils/styles/styles.js";
import { useGraphSearch } from '../../hooks/useGraphSearch.jsx';
import { useGraphDataLoader } from '../../hooks/useGraphDataLoader.js';
import { useLocalStorageNumber } from '../../hooks/useLocalStorage.js';
import { getMacroGraph, getFineGraph, getBookManifest } from '../../utils/common/api.js';
import { getMaxChapter, getManifestFromCache } from '../../utils/common/manifestCache';
import { getGraphBookCache, getCachedChapterEvents } from '../../utils/common/chapterEventCache';
import { convertRelationsToElements, filterMainCharacters } from '../../utils/graphDataUtils';
import { createCharacterMaps } from '../../utils/characterUtils';
import { getFolderKeyFromFilename, getLastEventIndexForChapter } from '../../utils/graphData';
import { processTooltipData } from '../../utils/graphUtils.js';
import useGraphInteractions from "../../hooks/useGraphInteractions";
import { useChapterPovSummaries } from '../../hooks/useChapterPovSummaries';

const getEdgeStyleForGraph = () => getEdgeStyle('graph');

const logApiCall = (type, data) => {
  // console.log(`🔍 ${type} API 호출 시작:`, data);
};

const logApiResponse = (type, data) => {
  // console.log(`✅ ${type} API 응답:`, data);
};

const logApiError = (type, error, data) => {
  // console.error(`❌ ${type} API 호출 실패:`, {
  //   error: error.message,
  //   status: error.status,
  //   ...data,
  //   timestamp: new Date().toISOString()
  // });
};

const logApiFallback = (type) => {
  // console.log(`🔄 ${type} API 호출 실패, 로컬 데이터 사용으로 전환`);
};

const calculateMaxChapterFromChapters = (chapters) => {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return 1;
  }
  let maxChapterIdx = 1;
  for (const chapterInfo of chapters) {
    const chapterIdx = chapterInfo?.idx || chapterInfo?.chapterIdx || chapterInfo?.chapter || chapterInfo?.index || chapterInfo?.number || chapterInfo?.id;
    if (typeof chapterIdx === 'number' && !isNaN(chapterIdx) && chapterIdx > 0 && chapterIdx > maxChapterIdx) {
      maxChapterIdx = chapterIdx;
    }
  }
  return maxChapterIdx;
};

const saveToLocalStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (storageError) {
    // localStorage 저장 실패는 무시 (캐시는 선택사항)
  }
};

const getChapterEventFallbackData = (targetBookId, currentChapter, eventIdx) => {
  const fallbackChapterCache = getCachedChapterEvents(targetBookId, currentChapter);
  if (fallbackChapterCache?.events && Array.isArray(fallbackChapterCache.events)) {
    const fallbackEvent = fallbackChapterCache.events.find(e => 
      Number(e.eventIdx) === eventIdx || Number(e.idx) === eventIdx
    );
    
    if (fallbackEvent && (fallbackEvent.characters || fallbackEvent.relations)) {
      return {
        characters: Array.isArray(fallbackEvent.characters) ? fallbackEvent.characters : [],
        relations: Array.isArray(fallbackEvent.relations) ? fallbackEvent.relations : [],
        event: fallbackEvent.event || null,
        userCurrentChapter: 0
      };
    }
  }
  return null;
};

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  
  const initialChapter = useMemo(() => {
    if (typeof window === 'undefined') {
      return 1;
    }
    try {
      const searchParams = new URLSearchParams(location.search || '');
      const chapterParam = Number(searchParams.get('chapter'));
      if (Number.isFinite(chapterParam) && chapterParam >= 1) {
        return Math.floor(chapterParam);
      }
    } catch (error) {
    }
    return 1;
  }, [location.search]);
  
  const isBookId = !isNaN(filename) && filename.length > 0;
  const bookId = isBookId ? parseInt(filename) : null;
  
  const [currentChapter, setCurrentChapter] = useLocalStorageNumber(
    `lastGraphChapter_${filename}`,
    initialChapter,
    { forceInitialValue: true }
  );
  const [currentEvent, setCurrentEvent] = useState(1);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  const [filterStage, setFilterStage] = useState(0);
  const [hasShownGraphOnce, setHasShownGraphOnce] = useState(false);
  
  const [apiMacroData, setApiMacroData] = useState(null);
  const [apiFineData, setApiFineData] = useState(null);
  const [apiFineLoading, setApiFineLoading] = useState(false);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [manifestData, setManifestData] = useState(null);
  const [apiMaxChapter, setApiMaxChapter] = useState(1);
  
  // 서버 bookId 계산 (book.id 또는 book._bookId 중 숫자인 것 우선 사용)
  const serverBookId = useMemo(() => {
    if (book?.id && typeof book.id === 'number') {
      return book.id;
    }
    if (book?._bookId && typeof book._bookId === 'number') {
      return book._bookId;
    }
    if (Number.isFinite(bookId) && bookId > 0) {
      return bookId;
    }
    return null;
  }, [book?.id, book?._bookId, bookId]);
  
  const { povSummaries } = useChapterPovSummaries(
    serverBookId, 
    currentChapter
  );
  
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const prevChapterNum = useRef(currentChapter);
  const prevEventNum = useRef();
  const isMacroGraphLoadingRef = useRef(false);
  const timeoutRef = useRef(null);

  const isApiBook = !!serverBookId || (book && book.isFromAPI === true);

  const loaderBookKey = useMemo(() => {
    if (isApiBook && serverBookId) {
      return serverBookId;
    }
    return filename || null;
  }, [isApiBook, serverBookId, filename]);

  const loaderEventIdx = useMemo(() => {
    return Number.isFinite(currentEvent) && currentEvent > 0 ? currentEvent : null;
  }, [currentEvent]);

  useEffect(() => {
    const loadManifestData = async () => {
      if (!isApiBook || !serverBookId) {
        // 로컬 책인 경우 로딩 상태 해제
        setIsGraphLoading(false);
        return;
      }
      
      const targetBookId = serverBookId;
      
      // manifest 로드 시작 시 로딩 상태 유지
      setIsGraphLoading(true);
      
      // 2번: Graph Book 캐시에서 최대 챕터 수 먼저 확인
      const graphCache = getGraphBookCache(targetBookId);
      if (graphCache?.maxChapter && graphCache.maxChapter > 0) {
        setApiMaxChapter(graphCache.maxChapter);
        setIsGraphLoading(false);
      }
      
      try {
        // 1번: Manifest 캐시 우선 확인
        const cachedManifest = getManifestFromCache(targetBookId);
        if (cachedManifest) {
          // 캐시된 Manifest 데이터 사용
          setManifestData(cachedManifest);
          
          // 최대 챕터 수가 아직 설정되지 않았다면 Manifest에서 확인
          if (!graphCache?.maxChapter) {
            const cachedMaxChapter = getMaxChapter(targetBookId);
            if (cachedMaxChapter && cachedMaxChapter > 0) {
              setApiMaxChapter(cachedMaxChapter);
            } else {
              const maxChapterFromMetadata = cachedManifest.progressMetadata?.maxChapter;
              if (maxChapterFromMetadata && maxChapterFromMetadata > 0) {
                setApiMaxChapter(maxChapterFromMetadata);
              } else {
                const maxChapterIdx = calculateMaxChapterFromChapters(cachedManifest.chapters);
                setApiMaxChapter(maxChapterIdx);
              }
            }
          }
          
          // 캐시가 있으면 API 호출 생략
          setIsGraphLoading(false);
          return;
        }
        
        // 캐시가 없을 때만 API 호출
        const manifestResponse = await getBookManifest(targetBookId);
        
        if (manifestResponse?.isSuccess && manifestResponse?.result) {
          setManifestData(manifestResponse.result);
          
          // 최대 챕터 수가 아직 설정되지 않았다면 API 응답에서 확인
          if (!graphCache?.maxChapter) {
            const cachedMaxChapter = getMaxChapter(targetBookId);
            if (cachedMaxChapter && cachedMaxChapter > 0) {
              setApiMaxChapter(cachedMaxChapter);
            } else {
              const maxChapterFromMetadata = manifestResponse.result.progressMetadata?.maxChapter;
              if (maxChapterFromMetadata && maxChapterFromMetadata > 0) {
                setApiMaxChapter(maxChapterFromMetadata);
              } else {
                const maxChapterIdx = calculateMaxChapterFromChapters(manifestResponse.result.chapters);
                setApiMaxChapter(maxChapterIdx);
              }
            }
          }
          
          setIsGraphLoading(false);
        } else {
          // manifest 로드 실패 시에도 기본값 설정 후 로딩 해제
          if (!graphCache?.maxChapter) {
            const cachedMaxChapter = getMaxChapter(targetBookId);
            setApiMaxChapter(cachedMaxChapter || 1);
          }
          setIsGraphLoading(false);
        }
      } catch (error) {
        // 에러 발생 시에도 기본값 설정 후 로딩 해제
        if (!graphCache?.maxChapter) {
          const cachedMaxChapter = getMaxChapter(targetBookId);
          setApiMaxChapter(cachedMaxChapter || 1);
        }
        setIsGraphLoading(false);
      }
    };
    
    loadManifestData();
  }, [isApiBook, serverBookId]);
  
  useEffect(() => {
    const loadMacroGraphData = async () => {
      if (!isApiBook || !serverBookId) {
        return;
      }
      
      const targetBookId = serverBookId;
      
      if (isMacroGraphLoadingRef.current) {
        return;
      }
      
      isMacroGraphLoadingRef.current = true;
      setApiFineLoading(true);
      
      try {
        // 3번: localStorage 캐시 먼저 확인
        const cacheKey = `graph_macro_${targetBookId}_${currentChapter}`;
        const cachedData = localStorage.getItem(cacheKey);
        
        if (cachedData) {
          try {
            const parsedData = JSON.parse(cachedData);
            if (parsedData && parsedData.characters && parsedData.relations) {
              // 캐시된 데이터 사용, API 호출 생략
              setApiMacroData(parsedData);
              setApiFineData(parsedData);
              if (parsedData.userCurrentChapter !== undefined) {
                setUserCurrentChapter(parsedData.userCurrentChapter);
              }
              isMacroGraphLoadingRef.current = false;
              setApiFineLoading(false);
              return;
            }
          } catch (parseError) {
            // 캐시 파싱 실패 시 삭제하고 API 호출
            localStorage.removeItem(cacheKey);
          }
        }
        
        // 캐시가 없을 때만 API 호출
        logApiCall('거시 그래프', {
          targetBookId,
          uptoChapter: currentChapter,
          timestamp: new Date().toISOString()
        });
        
        const macroData = await getMacroGraph(targetBookId, currentChapter);
        
        logApiResponse('거시 그래프', {
          isSuccess: macroData?.isSuccess,
          hasResult: !!macroData?.result,
          resultKeys: macroData?.result ? Object.keys(macroData.result) : [],
          charactersCount: macroData?.result?.characters?.length || 0,
          relationsCount: macroData?.result?.relations?.length || 0
        });
        
        if (macroData?.isSuccess && macroData?.result) {
          saveToLocalStorage(cacheKey, macroData.result);
          setApiMacroData(macroData.result);
          setApiFineData(macroData.result);
          if (macroData.result.userCurrentChapter !== undefined) {
            setUserCurrentChapter(macroData.result.userCurrentChapter);
          }
        } else {
          setApiMacroData(null);
          setApiFineData(null);
        }
        
      } catch (error) {
        logApiError('거시 그래프', error, {
          targetBookId,
          uptoChapter: currentChapter
        });
        
        logApiFallback('거시 그래프');
        setApiMacroData(null);
        setApiFineData(null);
      } finally {
        isMacroGraphLoadingRef.current = false;
        setApiFineLoading(false);
      }
    };

    loadMacroGraphData();
  }, [isApiBook, serverBookId, currentChapter]);

  useEffect(() => {
    const loadFineGraphData = async () => {
      if (!isApiBook || !serverBookId) return;
      
      const targetBookId = serverBookId;
      const currentApiMacroData = apiMacroData;
      
      if (!currentApiMacroData) {
        // 거시 그래프 캐시 확인
        const macroCacheKey = `graph_macro_${targetBookId}_${currentChapter}`;
        const cachedMacroData = localStorage.getItem(macroCacheKey);
        
        if (cachedMacroData) {
          try {
            const parsedData = JSON.parse(cachedMacroData);
            if (parsedData && parsedData.characters && parsedData.relations) {
              setApiMacroData(parsedData);
              if (parsedData.userCurrentChapter !== undefined) {
                setUserCurrentChapter(parsedData.userCurrentChapter);
              }
              return;
            }
          } catch (parseError) {
            // 캐시 파싱 실패 시 API 호출
            try {
              const macroData = await getMacroGraph(targetBookId, currentChapter);
              if (macroData?.isSuccess && macroData?.result) {
                saveToLocalStorage(macroCacheKey, macroData.result);
                setApiMacroData(macroData.result);
                if (macroData.result.userCurrentChapter !== undefined) {
                  setUserCurrentChapter(macroData.result.userCurrentChapter);
                }
                return;
              }
            } catch (error) {
              logApiError('거시 그래프 (폴백)', error, {
                targetBookId,
                uptoChapter: currentChapter,
                context: 'loadFineGraphData - 캐시 파싱 실패 후 API 호출'
              });
            }
          }
        } else {
          // 캐시가 없을 때만 API 호출
          try {
            const macroData = await getMacroGraph(targetBookId, currentChapter);
            if (macroData?.isSuccess && macroData?.result) {
              saveToLocalStorage(macroCacheKey, macroData.result);
              setApiMacroData(macroData.result);
              if (macroData.result.userCurrentChapter !== undefined) {
                setUserCurrentChapter(macroData.result.userCurrentChapter);
              }
              return;
            }
          } catch (error) {
            logApiError('거시 그래프 (폴백)', error, {
              targetBookId,
              uptoChapter: currentChapter,
              context: 'loadFineGraphData - 캐시 없음 상태에서 API 호출'
            });
          }
        }
      }
      
      const eventIdx = currentEvent >= 1 ? currentEvent - 1 : 0;
      
      if (eventIdx < 1) {
      const fallbackData = currentApiMacroData || null;
      if (fallbackData) {
        setApiFineData(fallbackData);
      }
      setApiFineLoading(false);
      return;
      }
      
      setApiFineLoading(true);
      
      try {
        // 4번: localStorage 캐시 먼저 확인
        const cacheKey = `graph_fine_${targetBookId}_${currentChapter}_${eventIdx}`;
        const cachedData = localStorage.getItem(cacheKey);
        
        if (cachedData) {
          try {
            const parsedData = JSON.parse(cachedData);
            if (parsedData && parsedData.characters && parsedData.relations) {
              // 캐시된 데이터 사용, API 호출 생략
              setApiFineData(parsedData);
              setApiFineLoading(false);
              return;
            }
          } catch (parseError) {
            // 캐시 파싱 실패 시 삭제하고 계속 진행
            localStorage.removeItem(cacheKey);
          }
        }
        
        // 5번: Chapter Events 캐시 확인 (API 호출 전)
        const chapterCache = getCachedChapterEvents(targetBookId, currentChapter);
        if (chapterCache?.events && Array.isArray(chapterCache.events)) {
          const targetEvent = chapterCache.events.find(e => 
            Number(e.eventIdx) === eventIdx || Number(e.idx) === eventIdx
          );
          
          if (targetEvent && (targetEvent.characters || targetEvent.relations)) {
            // Chapter Events 캐시에서 데이터 구성
            const cachedEventData = {
              characters: Array.isArray(targetEvent.characters) ? targetEvent.characters : [],
              relations: Array.isArray(targetEvent.relations) ? targetEvent.relations : [],
              event: targetEvent.event || null,
              userCurrentChapter: 0
            };
            
            saveToLocalStorage(cacheKey, cachedEventData);
            setApiFineData(cachedEventData);
            setApiFineLoading(false);
            return;
          }
        }
        
        // 캐시가 없을 때만 API 호출
        logApiCall('세밀 그래프', {
          targetBookId,
          chapterIdx: currentChapter,
          eventIdx: eventIdx,
          timestamp: new Date().toISOString()
        });
        
        const fineData = await getFineGraph(targetBookId, currentChapter, eventIdx);
        
        logApiResponse('세밀 그래프', {
          isSuccess: fineData?.isSuccess,
          hasResult: !!fineData?.result,
          resultKeys: fineData?.result ? Object.keys(fineData.result) : [],
          charactersCount: fineData?.result?.characters?.length || 0,
          relationsCount: fineData?.result?.relations?.length || 0,
          eventInfo: fineData?.result?.event
        });
        
        if (fineData?.isSuccess && fineData?.result) {
          saveToLocalStorage(cacheKey, fineData.result);
          setApiFineData(fineData.result);
        } else {
          // API 응답 실패 시 Chapter Events 캐시로 폴백 (5번)
          const fallbackEventData = getChapterEventFallbackData(targetBookId, currentChapter, eventIdx);
          if (fallbackEventData) {
            setApiFineData(fallbackEventData);
          } else {
            // Chapter Events 캐시에도 없으면 거시 그래프로 폴백
            if (currentApiMacroData) {
              setApiFineData(currentApiMacroData);
            }
          }
        }
        
      } catch (error) {
        if (error.status === 404 || error.message?.includes('찾을 수 없습니다')) {
          // 404 에러 시 Chapter Events 캐시로 폴백 (5번)
          const fallbackEventData = getChapterEventFallbackData(targetBookId, currentChapter, eventIdx);
          if (fallbackEventData) {
            setApiFineData(fallbackEventData);
            setApiFineLoading(false);
            return;
          }
          // 404 에러는 데이터 없음으로 정상 상황, 거시 그래프로 폴백
        } else {
          logApiError('세밀 그래프', error, {
            targetBookId,
            chapterIdx: currentChapter,
            eventIdx: eventIdx
          });
        }
        
        // 에러 발생 시 Chapter Events 캐시로 폴백 (5번)
        const fallbackEventData = getChapterEventFallbackData(targetBookId, currentChapter, eventIdx);
        if (fallbackEventData) {
          setApiFineData(fallbackEventData);
          setApiFineLoading(false);
          return;
        }
        
        // Chapter Events 캐시에도 없으면 거시 그래프로 폴백
        if (currentApiMacroData) {
          setApiFineData(currentApiMacroData);
        }
      } finally {
        setApiFineLoading(false);
      }
    };

    loadFineGraphData();
  }, [currentEvent, currentChapter, isApiBook, serverBookId]);

  const {
    elements: localElements,
    newNodeIds,
    currentChapterData,
    eventNum,
    maxChapter,
    loading
  } = useGraphDataLoader(loaderBookKey, currentChapter, loaderEventIdx);

  const effectiveMaxChapter = isApiBook ? apiMaxChapter : maxChapter;

  // 로컬 책인 경우 maxChapter가 준비될 때까지 로딩 상태 유지
  useEffect(() => {
    if (!isApiBook && maxChapter > 0) {
      setIsGraphLoading(false);
    }
  }, [isApiBook, maxChapter]);

  useEffect(() => {
    if (effectiveMaxChapter > 0 && currentChapter > effectiveMaxChapter) {
      setCurrentChapter(effectiveMaxChapter);
    }
  }, [effectiveMaxChapter, currentChapter, setCurrentChapter]);
  
  const apiElements = useMemo(() => {
    if (!apiFineData?.characters || !apiFineData?.relations) {
      return [];
    }
    
    try {
      const { idToName, idToDesc, idToMain, idToNames, idToProfileImage } = createCharacterMaps(apiFineData.characters);
      
      const apiEvent = apiFineData.event;
      const normalizedEvent = apiEvent ? {
        chapter: apiEvent.chapterIdx ?? currentChapter,
        chapterIdx: apiEvent.chapterIdx ?? currentChapter,
        eventNum: apiEvent.event_id ?? (currentEvent - 1),
        event_id: apiEvent.event_id ?? (currentEvent - 1),
        start: apiEvent.start,
        end: apiEvent.end,
        ...apiEvent
      } : null;
      
      const nodeWeights = {};
      if (apiFineData.characters) {
        apiFineData.characters.forEach(char => {
          if (char.id !== undefined && char.weight !== undefined && char.weight > 0) {
            const nodeId = String(char.id);
            nodeWeights[nodeId] = {
              weight: char.weight,
              count: char.count || 1
            };
          }
        });
      }
      
      const convertedElements = convertRelationsToElements(
        apiFineData.relations,
        idToName,
        idToDesc,
        idToDesc,
        idToMain,
        idToNames,
        'api',
        Object.keys(nodeWeights).length > 0 ? nodeWeights : null,
        null,
        normalizedEvent,
        idToProfileImage
      );
      
      return convertedElements;
    } catch (error) {
      return [];
    }
  }, [apiFineData, currentChapter, currentEvent]);
  
  const elements = (isApiBook && apiElements.length > 0) ? apiElements : localElements;
  
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

  const handleGenerateSuggestions = useCallback((searchTerm) => {
    setSearchTerm(searchTerm);
  }, [setSearchTerm]);

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


  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    setForceClose(false);
    setIsSidebarClosing(false);
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

  const onShowEdgeTooltip = useCallback(({ edge, edgeCenter, mouseX, mouseY }) => {
    setForceClose(false);
    setIsSidebarClosing(false);
    const edgeData = edge.data();
    
    const finalX = mouseX !== undefined ? mouseX : edgeCenter?.x || 0;
    const finalY = mouseY !== undefined ? mouseY : edgeCenter?.y || 0;
    
    const tooltipData = {
      type: 'edge',
      id: edge.id(),
      x: finalX,
      y: finalY,
      data: edgeData,
      sourceNode: edge.source(),
      targetNode: edge.target(),
      edgeCenter,
    };
    
    const processedTooltipData = processTooltipData(tooltipData, 'edge');
    
    setActiveTooltip(processedTooltipData);
    
    centerElementBetweenSidebars(edge.id(), 'edge');
  }, [centerElementBetweenSidebars]);

  const onClearTooltip = useCallback(() => {
    setForceClose(true);
  }, []);

  const handleStartClosing = useCallback(() => {
    setIsSidebarClosing(true);
  }, []);

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

  const handleEventChange = useCallback((eventNum) => {
    clearAll();
    setCurrentEvent(eventNum);
  }, [clearAll]);

  const handleClearGraph = useCallback(() => {
    clearAll();
  }, [clearAll]);

  // 챕터 변경 시 검색 초기화 및 선택 효과 제거
  useEffect(() => {
    if (prevChapterNum.current !== undefined && prevChapterNum.current !== currentChapter) {
      if (isSearchActive) {
        clearSearch();
      }
      clearAll();
    }
    prevChapterNum.current = currentChapter;
    prevEventNum.current = eventNum;
  }, [currentChapter, eventNum, isSearchActive, clearSearch, clearAll]);
  
  // 이벤트 변경 시 선택 효과 제거
  useEffect(() => {
    if (prevEventNum.current !== undefined && prevEventNum.current !== eventNum) {
      clearAll();
    }
  }, [eventNum, clearAll]);

  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  const filteredMainCharacters = useMemo(() => {
    return filterMainCharacters(elements, filterStage);
  }, [elements, filterStage]);

  const nodeCount = useMemo(() => {
    if (filterStage > 0) {
      return filteredMainCharacters.filter(el => el.data && el.data.id && !el.data.source).length;
    }
    return elements.filter(el => el.data && el.data.id && !el.data.source).length;
  }, [filterStage, filteredMainCharacters, elements]);

  const relationCount = useMemo(() => {
    if (filterStage > 0) {
      return filteredMainCharacters.filter(el => el.data && el.data.source && el.data.target).length;
    }
    return elements.filter(el => el.data && el.data.source && el.data.target).length;
  }, [filterStage, filteredMainCharacters, elements]);

  const finalElements = useMemo(() => {
    if (isSearchActive && filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return sortedElements;
  }, [isSearchActive, filteredElements, sortedElements, filterStage, filteredMainCharacters]);

  const edgeStyle = getEdgeStyleForGraph();
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );
  const layout = useMemo(() => getWideLayout(), []);

  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  useEffect(() => {
    if (activeTooltip && cyRef.current && !isSidebarClosing) {
      const elementId = activeTooltip.id;
      const elementType = activeTooltip.type;
      
      const animationDuration = 700;
      const timeoutId = setTimeout(() => {
        centerElementBetweenSidebars(elementId, elementType);
      }, animationDuration + 100);
      
      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [activeTooltip, isSidebarOpen, isSidebarClosing, centerElementBetweenSidebars]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  const [isDropdownSelection, setIsDropdownSelection] = useState(false);

  const handleChapterSelect = useCallback((chapter) => {
    if (chapter !== currentChapter) {
      setIsDropdownSelection(true);
      clearAll();
      setCurrentChapter(chapter);
      
      let lastEventNum = 1;
      
      if (isApiBook) {
        if (manifestData?.chapters) {
          const chapterInfo = manifestData.chapters.find(
            ch => (ch.chapterIdx === chapter || ch.chapter === chapter || ch.index === chapter || ch.number === chapter)
          );
          
          if (chapterInfo) {
            let eventCount = chapterInfo.eventCount || chapterInfo.events || chapterInfo.event_count || 0;
            if (Array.isArray(eventCount)) {
              eventCount = eventCount.length;
            } else if (typeof eventCount !== 'number' || isNaN(eventCount)) {
              eventCount = 0;
            }
            
            lastEventNum = eventCount > 0 ? eventCount : 1;
          }
        }
      } else {
        const folderKey = getFolderKeyFromFilename(filename);
        if (folderKey) {
          const lastEventIndex = getLastEventIndexForChapter(folderKey, chapter);
          lastEventNum = lastEventIndex > 0 ? lastEventIndex : 1;
        }
      }
      
      setCurrentEvent(lastEventNum);
    }
  }, [currentChapter, setCurrentChapter, isApiBook, manifestData, filename, clearAll]);

  useEffect(() => {
    if (isDropdownSelection) {
      const timeoutId = setTimeout(() => {
        setIsDropdownSelection(false);
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [isDropdownSelection]);


  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible(prev => !prev);
  }, []);

  const handleBackToViewer = useCallback(() => {
    const retainedSearch = location.state?.viewerSearch || '';
    const nextSearch = retainedSearch && retainedSearch.startsWith('?')
      ? retainedSearch
      : retainedSearch
        ? `?${retainedSearch}`
        : '';

    const nextState = {
      ...(location.state || {}),
      from: (location.state && location.state.from) || { pathname: location.pathname, search: location.search },
      fromGraph: true,
    };

    if (book || location.state?.book) {
      nextState.book = book || location.state?.book;
    }

    navigate(`/user/viewer/${filename}${nextSearch}`, {
      state: nextState,
      replace: false,
    });
  }, [navigate, filename, book, location.pathname, location.search, location.state]);

  const backButtonHandlers = createAdvancedButtonHandlers('default');

  const handleGlobalClick = useCallback((e) => {
    if (!activeTooltip || isSidebarClosing) return;
    
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
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setForceClose(true);
      timeoutRef.current = null;
    }, 100);
  }, [activeTooltip, isSidebarClosing, clearAll]);

  const handleCanvasClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      
      const isDragEndEvent = e.detail && e.detail.type === 'dragend';
      if (isDragEndEvent) return;
      
      if (activeTooltip && !isSidebarClosing) {
        clearAll();
        
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          setForceClose(true);
          timeoutRef.current = null;
        }, 100);
      }
    }
  }, [activeTooltip, isSidebarClosing, clearAll]);

  useEffect(() => {
    if (activeTooltip && !isSidebarClosing) {
      const handleDocumentClick = (e) => {
        const graphCanvas = e.target.closest('.graph-canvas-area');
        if (graphCanvas) return;
        
        handleGlobalClick(e);
      };

      const handleDragEnd = (e) => {
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

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);
  
  const chapterList = useMemo(() => 
    Array.from({ length: effectiveMaxChapter }, (_, i) => i + 1), 
    [effectiveMaxChapter]
  );

  // 로딩 상태: 그래프 데이터 로딩 또는 챕터 리스트 준비 대기
  // 챕터 드롭다운이 표시되려면 effectiveMaxChapter가 준비되어야 함
  const isLoading = (isApiBook && (apiFineLoading || isGraphLoading)) || (!isApiBook && (loading || isGraphLoading));
  
  useEffect(() => {
    if (!isLoading) {
      setHasShownGraphOnce(true);
    }
  }, [isLoading]);
  
  const isBlockingInitialLoad = isLoading && !hasShownGraphOnce;
  
  if (isBlockingInitialLoad) {
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
          {isGraphLoading
            ? '챕터 정보를 준비하고 있습니다. 잠시만 기다려주세요...'
            : isApiBook 
              ? 'API에서 관계 데이터를 가져오고 있습니다. 잠시만 기다려주세요...'
              : '로컬 파일에서 관계 데이터를 분석하고 있습니다. 잠시만 기다려주세요...'
          }
        </p>
        <div style={{
          fontSize: '12px',
          color: COLORS.textSecondary,
          marginTop: '8px',
          fontStyle: 'italic'
        }}>
          {isGraphLoading ? '챕터 드롭다운 준비 중...' : '데이터 처리 중...'}
        </div>
        <div style={{
          width: '200px',
          height: '4px',
          backgroundColor: COLORS.backgroundLight,
          borderRadius: '2px',
          marginTop: '16px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.primary,
            borderRadius: '2px',
            animation: 'loadingProgress 2s ease-in-out infinite'
          }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLORS.backgroundLighter, overflow: 'hidden' }}>
      <style>
        {`
          @keyframes loadingProgress {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
          }
        `}
      </style>
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
          
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(Number(e.target.value))}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: `1px solid ${filterStage > 0 ? COLORS.primary : COLORS.border}`,
              background: filterStage > 0 ? COLORS.primary : COLORS.background,
              color: filterStage > 0 ? '#fff' : COLORS.textPrimary,
              fontSize: 14,
              fontWeight: 700,
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
                {isApiBook 
                  ? (apiFineData?.event ? '세밀 그래프' : '거시 그래프')
                  : '로컬 그래프'
                }
              </h2>
              <div style={{
                background: COLORS.backgroundLight,
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                color: COLORS.textSecondary,
                fontWeight: '500'
              }}>
                {isApiBook 
                  ? (apiFineData?.event 
                      ? `Chapter ${currentChapter}, Event ${currentEvent}` 
                      : `Chapter 1 ~ ${currentChapter} 누적`)
                  : `Chapter 1 ~ ${currentChapter} 누적`
                }
              </div>
              {isApiBook && userCurrentChapter !== null && (
                <div style={{
                  background: COLORS.primary + '20',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '11px',
                  color: COLORS.primary,
                  fontWeight: '600'
                }}>
                  독서 진행: Chapter {userCurrentChapter}
                </div>
              )}
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
                  ? `${nodeCount}명 (필터링됨)`
                  : `${nodeCount}명`
                }
              </span>
              <span>•</span>
              <span>
                {filterStage > 0 
                  ? `${relationCount}관계 (필터링됨)`
                  : `${relationCount}관계`
                }
              </span>
              {isApiBook && (
                <>
                  <span>•</span>
                  <span style={{ 
                    color: COLORS.primary,
                    fontWeight: '600'
                  }}>
                    API
                  </span>
                </>
              )}
              {!isApiBook && (
                <>
                  <span>•</span>
                  <span style={{ 
                    color: COLORS.textSecondary,
                    fontWeight: '600'
                  }}>
                    로컬
                  </span>
                </>
              )}
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
                  eventNum={isApiBook ? Math.max(currentEvent, 1) : eventNum}
                  maxChapter={effectiveMaxChapter}
                  filename={filename}
                elements={elements}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                searchTerm={searchTerm}
                povSummaries={povSummaries}
                apiMacroData={apiMacroData}
                apiFineData={apiFineData}
                bookId={serverBookId}
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
              {isLoading && hasShownGraphOnce && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255, 255, 255, 0.75)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                    fontSize: '16px',
                    fontWeight: 600,
                    color: COLORS.primary,
                    letterSpacing: '0.02em'
                  }}
                >
                  그래프 업데이트 중...
                </div>
              )}
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
                isDataRefreshing={isLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;
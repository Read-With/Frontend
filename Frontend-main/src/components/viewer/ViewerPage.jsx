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
import { calcGraphDiff, convertRelationsToElements } from "../../utils/graphDataUtils";
import { createCharacterMaps } from "../../utils/characterUtils";


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
  isEventTransition,
}) {
  const graphContainerRef = React.useRef(null);
  const { isSearchActive, filteredElements, isResetFromSearch } = searchState;
  const { loading, isReloading, isGraphLoading, isDataReady } = viewerState;
  const { elements } = graphState;
  const { filterStage } = graphActions;

  // 3단계 필터링 로직 (GraphSplitArea용)
  const filteredMainCharacters = React.useMemo(() => {
    if (filterStage === 0 || !elements) return elements;
    
    // 핵심 인물 (main_character: true) 노드들
    const coreNodes = elements.filter(el => 
      el.data && 
      el.data.id && 
      !el.data.source && 
      el.data.main_character === true
    );
    
    const coreNodeIds = new Set(coreNodes.map(node => node.data.id));
    
    // 주요 인물 (main_character: false이지만 중요한 인물) 노드들
    const importantNodes = elements.filter(el => 
      el.data && 
      el.data.id && 
      !el.data.source && 
      el.data.main_character === false &&
      el.data.importance && el.data.importance > 0.5 // 중요도 임계값
    );
    
    const importantNodeIds = new Set(importantNodes.map(node => node.data.id));
    
    let filteredNodes = [];
    let filteredEdges = [];
    
    if (filterStage === 1) {
      // 1단계: 핵심인물끼리의 연결만
      filteredNodes = coreNodes;
      filteredEdges = elements.filter(el => 
        el.data && 
        el.data.source && 
        el.data.target &&
        coreNodeIds.has(el.data.source) && 
        coreNodeIds.has(el.data.target)
      );
    } else if (filterStage === 2) {
      // 2단계: 핵심인물과 핵심인물에 연결된 노드(핵심인물, 비핵심인물) + 간선
      // 핵심 인물과 연결된 간선들 찾기
      const connectedEdges = elements.filter(el => 
        el.data && 
        el.data.source && 
        el.data.target &&
        // 최소 하나의 노드는 핵심 인물이어야 함
        (coreNodeIds.has(el.data.source) || coreNodeIds.has(el.data.target))
      );
      
      // 연결된 노드들의 ID 수집
      const connectedNodeIds = new Set();
      connectedEdges.forEach(edge => {
        if (edge.data.source) connectedNodeIds.add(edge.data.source);
        if (edge.data.target) connectedNodeIds.add(edge.data.target);
      });
      
      // 핵심 인물과 연결된 모든 노드들
      const connectedNodes = elements.filter(el => 
        el.data && 
        el.data.id && 
        !el.data.source && 
        connectedNodeIds.has(el.data.id)
      );
      
      filteredNodes = connectedNodes;
      filteredEdges = connectedEdges;
    }
    
    return [...filteredNodes, ...filteredEdges];
  }, [elements, filterStage]);

  // 최종 elements 결정 (검색 > main_character 필터링 > 기본 elements 순)
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
          // 로딩 중인 경우 로딩 메시지 표시
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
              그래프 정보를 불러오는 중...
            </h3>
            <p style={{
              color: '#6c757d',
              marginBottom: '20px',
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              관계 데이터를 분석하고 있습니다.
            </p>
          </div>
        ) : isEventUndefined ? (
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


  // 툴팁 상태 관리
  const [activeTooltip, setActiveTooltip] = useState(null);
  
  // 그래프 상태 초기화를 위한 ref
  const graphClearRef = useRef(null);
  
  // 이벤트 상태 관리
  const [isEventUndefined, setIsEventUndefined] = useState(false);
  
  // 이벤트 전환 감지를 위한 상태
  const [isEventTransition, setIsEventTransition] = useState(false);
  const prevEventRef = useRef(null);
  
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

  // 툴팁 설정 함수 - API 데이터 구조에 맞게 수정
  const handleSetActiveTooltip = useCallback((tooltipData) => {
    // API 데이터 구조에 맞게 툴팁 데이터 처리
    if (tooltipData.type === 'node') {
      const nodeData = tooltipData;
      
      // API 데이터의 names 필드 처리
      let names = nodeData.names;
      if (typeof names === "string") {
        try { 
          names = JSON.parse(names); 
        } catch { 
          names = [names]; 
        }
      }
      
      // main_character 필드 처리
      let main = nodeData.main_character;
      if (typeof main === "string") {
        main = main === "true";
      }
      
      const processedTooltipData = {
        ...tooltipData,
        names: names,
        main_character: main,
        // 기존 필드명과 호환성을 위한 매핑
        main: main,
        common_name: nodeData.common_name || nodeData.label,
        description: nodeData.description || '',
        image: nodeData.image || '',
        weight: nodeData.weight || 1
      };
      
      setActiveTooltip(processedTooltipData);
      
    } else if (tooltipData.type === 'edge') {
      const edgeData = tooltipData;
      
      // API 데이터의 relation 필드 처리
      let relation = edgeData.data?.relation;
      if (typeof relation === "string") {
        try { 
          relation = JSON.parse(relation); 
        } catch { 
          relation = [relation]; 
        }
      }
      
      const processedTooltipData = {
        ...tooltipData,
        data: {
          ...edgeData.data,
          relation: relation,
          // 기존 필드명과 호환성을 위한 매핑
          label: edgeData.data?.label || (Array.isArray(relation) ? relation[0] : relation),
          positivity: edgeData.data?.positivity || 0,
          count: edgeData.data?.count || 1
        }
      };
      
      setActiveTooltip(processedTooltipData);
      
    } else {
      setActiveTooltip(tooltipData);
    }
  }, [currentEvent, currentChapter]);

  // 전역 클릭 감지를 위한 ref - 툴팁이 활성화된 경우에만 감지
  // 툴팁 닫기와 동시에 그래프 스타일도 초기화
  const viewerPageRef = useClickOutside(handleClearTooltipAndGraph, !!activeTooltip);

   // 독서 진도 API 테스트 - 페이지 진입 시 한 번만 호출
   useEffect(() => {
     const testProgressAPI = async () => {
       if (!book?.id) return;
       
       try {
         console.log('🔍 API 테스트 시작 - 책 ID:', book.id);
         
         // 1. 사용자의 모든 독서 진도 조회
         const allProgress = await getAllProgress();
         console.log('✅ 모든 독서 진도 조회 성공:', allProgress);
         
         // 2. 특정 책의 독서 진도 조회 (404 에러는 정상 - 아직 진도가 없을 수 있음)
         try {
           const bookProgress = await getBookProgress(book.id);
           console.log('✅ 특정 책 독서 진도 조회 성공:', bookProgress);
         } catch (progressError) {
           if (progressError.message.includes('404') || progressError.message.includes('찾을 수 없습니다')) {
             console.log('ℹ️ 아직 독서 진도가 없습니다. 새로 생성합니다.');
           } else {
             console.error('❌ 독서 진도 조회 실패:', progressError);
           }
         }
         
         // 3. 책 구조 패키지 조회
         const manifest = await getBookManifest(book.id);
         console.log('✅ 책 구조 패키지 조회 성공:', manifest);
         
         // 4. 책 구조 패키지 조회 완료 후 그래프 API 호출 트리거
         console.log('🚀 책 구조 패키지 조회 완료 - 그래프 API 호출 준비');
         setManifestLoaded(true);
         
       } catch (error) {
         console.error('독서 진도 API 호출 실패:', error);
       }
     };

     testProgressAPI();
   }, [book?.id]); // book.id만 의존성으로 설정

  // API 거시 그래프 데이터 상태 관리
  const [manifestLoaded, setManifestLoaded] = useState(false);
  const apiCallRef = useRef(null);
  
   // API로 가져온 책의 거시그래프 데이터 로딩
   useEffect(() => {
     const loadMacroGraphData = async () => {
       // API 책인지 확인 (숫자 ID를 가진 책이거나 isFromAPI가 true인 경우)
       const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
       
       if (!book?.id || !isApiBook || !currentChapter || !manifestLoaded) {
         if (!manifestLoaded) {
           console.log('⏳ 책 구조 패키지 로딩 대기 중...');
         }
         return;
       }
       
         // 중복 호출 방지 - 챕터 1, 이벤트 3으로 고정
         const eventIdx = 3; // 확인용으로 이벤트 3 고정
         const callKey = `${book.id}-${currentChapter}-${eventIdx}`;
         if (apiCallRef.current === callKey) {
           console.log('⏳ 세밀그래프 API 호출 중복 방지:', callKey);
           return;
         }
         apiCallRef.current = callKey;
       
       try {
          // API 호출 전 파라미터 검증
          if (!book?.id || !currentChapter || eventIdx < 0) {
            console.log('❌ 세밀그래프 API 호출 파라미터 부족:', {
              bookId: book?.id,
              chapterIdx: currentChapter,
              eventIdx: eventIdx
            });
            setApiMacroData(null);
            return;
          }
          
           console.log('🔗 세밀그래프 API 호출 (챕터 1, 이벤트 3 고정):', {
            bookId: book.id,
            bookTitle: book.title,
            chapterIdx: currentChapter,
            eventIdx: eventIdx,
            note: '확인용으로 이벤트 3 고정'
          });
          
          const fineData = await getFineGraph(book.id, currentChapter, eventIdx);
        console.log('✅ 세밀그래프 데이터 로딩 성공:', {
          event: fineData.result.event,
          charactersCount: fineData.result.characters.length,
          relationsCount: fineData.result.relations.length
        });
        
        // API 데이터를 그래프 요소로 변환
        let convertedElements = [];
        if (fineData.result.characters && fineData.result.relations) {
          const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(fineData.result.characters);
          convertedElements = convertRelationsToElements(
            fineData.result.relations,
            idToName,
            idToDesc,
            idToMain,
            idToNames,
            'api', // API 데이터임을 표시
            null, // nodeWeights
            null  // previousRelations
          );
          
          // API 데이터를 그래프 상태에 적용
          if (convertedElements.length > 0) {
            graphActions.setElements(convertedElements);
            console.log('✅ API 그래프 데이터를 그래프 상태에 적용 완료');
            
            // API 책인 경우 기본 이벤트 설정 (로컬 이벤트 데이터가 없으므로)
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
              console.log('✅ API 책 기본 이벤트 설정 완료:', {
                chapter: defaultEvent.chapter,
                eventNum: defaultEvent.eventNum,
                start: defaultEvent.start,
                end: defaultEvent.end
              });
            }
          }
          
          console.log('✅ API 그래프 데이터 변환 완료:', {
            변환된요소수: convertedElements.length,
            노드수: convertedElements.filter(el => el.data && el.data.id && !el.data.source).length,
            엣지수: convertedElements.filter(el => el.data && el.data.source && el.data.target).length
          });
        }
        
        // 상세한 그래프 정보 출력
        console.log('📊 세밀그래프 상세 정보:', {
          전체응답: fineData,
          이벤트정보: fineData.result.event,
          캐릭터목록: fineData.result.characters,
          관계목록: fineData.result.relations,
          변환된요소: convertedElements
        });
        
        // 변환된 요소 상세 정보
        if (convertedElements.length > 0) {
          console.log('🔄 세밀그래프 변환된 요소:', {
            노드수: convertedElements.filter(el => el.data && el.data.id && !el.data.source).length,
            엣지수: convertedElements.filter(el => el.data && el.data.source && el.data.target).length,
            전체요소: convertedElements
          });
        }
        
       } catch (error) {
         console.error('❌ 세밀그래프 API 호출 실패:', error);
       }
    };

    loadMacroGraphData();
  }, [book?.id, currentChapter, manifestLoaded]); // currentEvent 의존성 제거 (이벤트 3 고정)

   // 진도 변경 시 자동 저장 (API 책인 경우에만)
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
         console.log('✅ 진도 자동 저장 완료');
         
       } catch (error) {
         console.error('❌ 진도 자동 저장 실패:', error);
       }
     };

     // 진도가 변경될 때마다 자동 저장 (디바운스 적용)
     const timeoutId = setTimeout(autoSaveProgress, 2000);
     return () => clearTimeout(timeoutId);
   }, [book?.id, currentChapter, currentEvent]);

  // 북마크 하이라이트 적용
  useEffect(() => {
    if (bookmarks && bookmarks.length > 0) {
      // DOM이 준비된 후 하이라이트 적용
      const timer = setTimeout(() => {
        applyBookmarkHighlights(bookmarks);
      }, 500);
      
      return () => {
        clearTimeout(timer);
        removeBookmarkHighlights();
      };
    }
  }, [bookmarks, currentChapter]);

  // 이벤트 상태 감지 및 새로고침 메시지 표시
  useEffect(() => {
    const checkEventStatus = () => {
      if (loading || isReloading || isGraphLoading || !isDataReady) {
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
  }, [currentEvent, currentChapter, events, loading, isReloading, isDataReady, isGraphLoading]);

  // 이벤트 전환 감지
  useEffect(() => {
    if (currentEvent && prevEventRef.current) {
      const prevEvent = prevEventRef.current;
      const isEventChanged = 
        prevEvent.eventNum !== currentEvent.eventNum ||
        prevEvent.chapter !== currentEvent.chapter;
      
      if (isEventChanged) {
        setIsEventTransition(true);
        
        // 짧은 지연 후 이벤트 전환 상태 해제
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
    const loadEventsData = async () => {
      // API 책인 경우 로컬 데이터 로딩 건너뛰기
      const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
      if (isApiBook) {
        console.log('📚 API 책이므로 로컬 이벤트 데이터 로딩 건너뛰기');
        setIsDataReady(true);
        return;
      }
      
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
        
        
        setEvents(validEvents);
        
        try {
          // 현재 챕터의 인물 데이터만 로딩 (누적 방식 제거)
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
  }, [currentChapter, currentChapterData, folderKey, graphState.isInitialChapterDetected, book]);


  const {
    searchTerm, isSearchActive, filteredElements,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    selectSuggestion, handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  // elements는 useGraphDataLoader에서 관리됨

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
  }, [isDataReady, currentEvent, elements, currentChapter]);

  // elements가 바뀔 때마다 diff 계산
  useEffect(() => {
    if (!elements) return;
    const prev = prevElementsRef.current || [];
    const diff = calcGraphDiff(prev, elements);
    setGraphDiff(diff);
    prevElementsRef.current = elements;
  }, [elements]);



  // 최초 진입 시 모든 챕터의 전체 노드 위치 미리 저장
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
              activeTooltip={activeTooltip}
              onClearTooltip={handleClearTooltip}
              onSetActiveTooltip={handleSetActiveTooltip}
              graphClearRef={graphClearRef}
              isEventUndefined={isEventUndefined}
              isEventTransition={isEventTransition}
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
                  fontFamily: "Noto Serif KR",
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


import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
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
import { useClickOutside } from "../../hooks/useClickOutside";
import { createStorageKey } from "../../hooks/useLocalStorage";
import { getAllProgress, saveProgress, getBookProgress, getBookManifest, getMacroGraph, getFineGraph } from "../../utils/api";
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
import { createCharacterMaps } from "../../utils/graphData";


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
}) {
  const graphContainerRef = React.useRef(null);
  const { isSearchActive, filteredElements, isResetFromSearch } = searchState;
  const { loading, isReloading, isGraphLoading, isDataReady } = viewerState;

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
            elements={isSearchActive && filteredElements && filteredElements.length > 0 ? filteredElements : graphState.elements}
            isResetFromSearch={isResetFromSearch}
            // ViewerTopBar와 동일한 이벤트 정보 전달 - 현재 챕터의 이벤트만 전달
            prevValidEvent={graphState.currentEvent && graphState.currentEvent.chapter === graphState.currentChapter ? graphState.currentEvent : null}
            events={graphState.events || []}
            // 툴팁 관련 props 추가
            activeTooltip={activeTooltip}
            onClearTooltip={onClearTooltip}
            onSetActiveTooltip={onSetActiveTooltip}
            graphClearRef={graphClearRef}
          />
        )}
      </div>
    </div>
  );
}

const ViewerPage = () => {
  const {
    filename, location, navigate, viewerRef,
    reloadKey, setReloadKey, failCount, setFailCount,
    progress, setProgress, currentPage, setCurrentPage,
    totalPages, setTotalPages, showSettingsModal, setShowSettingsModal,
    settings, setSettings,
    currentChapter, setCurrentChapter, currentEvent, setCurrentEvent,
    prevEvent, setPrevEvent, events, setEvents, maxChapter, setMaxChapter,
    graphFullScreen, setGraphFullScreen, showGraph, setShowGraph,
    elements, graphViewState, setGraphViewState,
    hideIsolated, setHideIsolated, edgeLabelVisible, setEdgeLabelVisible,
    graphDiff, setGraphDiff,
    currentCharIndex, setCurrentCharIndex, currentPageWords, setCurrentPageWords,
    totalChapterWords, setTotalChapterWords, loading, setLoading,
    chapterText, setChapterText, isDataReady, setIsDataReady,
    characterData, setCharacterData, isReloading, setIsReloading,
    eventNum, setEventNum, isGraphLoading, setIsGraphLoading,
    showToolbar, setShowToolbar,
    cleanFilename, bookmarks, setBookmarks, showBookmarkList, setShowBookmarkList,
    prevValidEventRef, prevElementsRef, prevChapterNumRef, prevEventNumRef,
    book, folderKey,
    graphElements, newNodeIds, currentChapterData, maxEventNum,
    graphEventNum, detectedMaxChapter, graphLoading, graphError,
    handlePrevPage, handleNextPage, handleAddBookmark, handleBookmarkSelect,
    handleOpenSettings, handleCloseSettings, handleApplySettings,
    onToggleBookmarkList, handleSliderChange, handleDeleteBookmark,
    handleRemoveBookmark, toggleGraph, handleFitView, handleLocationChange,
    graphState, graphActions, viewerState, searchState,
  } = useViewerPage();


  // 툴팁 상태 관리
  const [activeTooltip, setActiveTooltip] = useState(null);
  
  // 그래프 상태 초기화를 위한 ref
  const graphClearRef = useRef(null);
  
  // 이벤트 상태 관리
  const [isEventUndefined, setIsEventUndefined] = useState(false);
  
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
  const [apiMacroData, setApiMacroData] = useState(null);
  const [apiMacroLoading, setApiMacroLoading] = useState(false);
  const [manifestLoaded, setManifestLoaded] = useState(false); // 책 구조 패키지 로딩 완료 상태
  const apiCallRef = useRef(null); // 중복 호출 방지용 ref
  
   // API로 가져온 책의 거시그래프 데이터 로딩
   useEffect(() => {
     const loadMacroGraphData = async () => {
       // API 책인지 확인 (숫자 ID를 가진 책이거나 isFromAPI가 true인 경우)
       const isApiBook = book && (typeof book.id === 'number' || book.isFromAPI === true);
       
       if (!book?.id || !isApiBook || !currentChapter || !manifestLoaded) {
         if (!manifestLoaded) {
           console.log('⏳ 책 구조 패키지 로딩 대기 중...');
         }
         setApiMacroData(null);
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
       
       setApiMacroLoading(true);
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
        setApiMacroData(fineData.result);
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
         
         // 500 에러 또는 404 에러인 경우 특별한 처리
         if (error.message.includes('500') || error.message.includes('서버 에러') || 
             error.message.includes('404') || error.message.includes('찾을 수 없습니다')) {
           if (error.message.includes('404') || error.message.includes('찾을 수 없습니다')) {
             console.log('⚠️ 404 에러 발생 - 해당 이벤트가 존재하지 않습니다.');
           } else {
             console.log('⚠️ 서버 에러 발생 - API 서버가 해당 데이터를 처리할 수 없습니다.');
           }
           console.log('📋 요청 정보:', {
             bookId: book.id,
             chapterIdx: currentChapter,
             eventIdx: eventIdx,
             bookTitle: book.title
           });
           
           // 500/404 에러 시 다른 이벤트 및 챕터 시도
           const fallbackEventIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(id => id !== eventIdx);
           const fallbackChapters = [1, 2, 3].filter(ch => ch !== currentChapter);
           let fallbackSuccess = false;
           
           // Fallback 시도 중에는 중복 방지 비활성화
           const originalCallKey = apiCallRef.current;
           apiCallRef.current = null;
           
           // 1단계: 같은 챕터의 다른 이벤트 시도
           for (const fallbackEventId of fallbackEventIds) {
             try {
               console.log(`🔄 Fallback 시도 - Chapter ${currentChapter}, eventIdx: ${fallbackEventId} (${fallbackEventIds.indexOf(fallbackEventId) + 1}/${fallbackEventIds.length})`);
               const fallbackData = await getFineGraph(book.id, currentChapter, fallbackEventId);
               setApiMacroData(fallbackData.result);
               console.log(`✅ Fallback 성공 - Chapter ${currentChapter}, eventIdx: ${fallbackEventId}`, {
                 charactersCount: fallbackData.result.characters.length,
                 relationsCount: fallbackData.result.relations.length,
                 event: fallbackData.result.event
               });
               fallbackSuccess = true;
               break;
             } catch (fallbackError) {
               console.log(`❌ Fallback 실패 - Chapter ${currentChapter}, eventIdx: ${fallbackEventId}:`, fallbackError.message);
             }
           }
           
           // 2단계: 다른 챕터의 이벤트 시도 (1단계 실패 시)
           if (!fallbackSuccess) {
             console.log('🔄 1단계 실패 - 다른 챕터의 이벤트 시도');
             for (const fallbackChapter of fallbackChapters) {
               for (const fallbackEventId of [0, 1, 2, 3, 4, 5]) {
                 try {
                   console.log(`🔄 Fallback 시도 - Chapter ${fallbackChapter}, eventIdx: ${fallbackEventId}`);
                   const fallbackData = await getFineGraph(book.id, fallbackChapter, fallbackEventId);
                   setApiMacroData(fallbackData.result);
                   console.log(`✅ Fallback 성공 - Chapter ${fallbackChapter}, eventIdx: ${fallbackEventId}`, {
                     charactersCount: fallbackData.result.characters.length,
                     relationsCount: fallbackData.result.relations.length,
                     event: fallbackData.result.event
                   });
                   fallbackSuccess = true;
                   break;
                 } catch (fallbackError) {
                   console.log(`❌ Fallback 실패 - Chapter ${fallbackChapter}, eventIdx: ${fallbackEventId}:`, fallbackError.message);
                 }
               }
               if (fallbackSuccess) break;
             }
           }
           
           // 중복 방지 복원
           apiCallRef.current = originalCallKey;
           
           if (!fallbackSuccess) {
             console.log('🔄 모든 Fallback 시도 실패 - 로컬 데이터 사용');
             console.log('📋 시도한 조합:', {
               originalRequest: { chapter: currentChapter, eventIdx: eventIdx },
               fallbackEvents: fallbackEventIds,
               fallbackChapters: fallbackChapters,
               totalAttempts: fallbackEventIds.length + (fallbackChapters.length * 6)
             });
             setApiMacroData(null);
           }
         } else {
           setApiMacroData(null);
         }
       } finally {
         setApiMacroLoading(false);
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
      // 로딩 중인 경우는 제외하고 이벤트가 정해지지 않은 경우들만 체크
      if (loading || isReloading || isGraphLoading || !isDataReady) {
        setIsEventUndefined(false);
        return;
      }

      // 로딩이 완료된 후 이벤트가 정해지지 않은 경우들
      const isEventInvalid = 
        // 1. currentEvent가 null이거나 undefined인 경우
        !currentEvent ||
        // 2. currentEvent.eventNum이 undefined이거나 null인 경우
        currentEvent.eventNum === undefined || currentEvent.eventNum === null ||
        // 3. currentEvent.chapter가 undefined이거나 null인 경우
        currentEvent.chapter === undefined || currentEvent.chapter === null ||
        // 4. events 배열이 비어있는 경우
        !events || events.length === 0;

      if (isEventInvalid) {
        setIsEventUndefined(true);
        
      } else {
        setIsEventUndefined(false);
      }
    };

    checkEventStatus();
  }, [currentEvent, currentChapter, events, loading, isReloading, isDataReady, isEventUndefined, isGraphLoading]);

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
        
        if (validEvents.length === 0 && events.length > 0) {
        }
        
        setEvents(validEvents);
        
        try {
          const allCharacterData = [];
          for (let chapter = 1; chapter <= currentChapter; chapter++) {
            const charData = getCharactersData(folderKey, chapter);
            if (charData && charData.characters) {
              allCharacterData.push(...charData.characters);
            }
          }
          
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
          if (currentChapterData) {
            setCharacterData(currentChapterData.characters || currentChapterData);
          }
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

  // currentEventElements는 useGraphDataLoader에서 관리됨

  const {
    searchTerm, isSearchActive, filteredElements, fitNodeIds,
    isResetFromSearch, suggestions, showSuggestions, selectedIndex,
    selectSuggestion, handleKeyDown, closeSuggestions,
    handleSearchSubmit, clearSearch, setSearchTerm,
  } = useGraphSearch(elements, null, currentChapterData);

  // elements는 useGraphDataLoader에서 관리됨

  // === [제거] 중복된 useEffect - 위의 통합 로직으로 대체됨 ===

  // 그래프 위치는 useGraphDataLoader에서 관리됨

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
  }, [isDataReady, currentEvent, elements, currentChapter, hideIsolated]);

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


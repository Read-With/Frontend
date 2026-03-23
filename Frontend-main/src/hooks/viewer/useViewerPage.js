import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useLocalStorage, useLocalStorageNumber } from '../common/useLocalStorage';
import { useGraphDataLoader } from '../graph/useGraphDataLoader';
import { useServerBookMatching } from '../books/useServerBookMatching';
import { useViewerUrlParams } from './useViewerUrlParams';
import { 
  defaultSettings, 
  loadSettings, 
  saveViewerMode, 
  loadViewerMode,
  settingsUtils,
  errorUtils,
  bookUtils
} from '../../utils/viewerUtils';
import { getFolderKeyFromFilename } from '../../utils/graph/graphData';
import { useBookmarks } from '../bookmarks/useBookmarks';
import { getBookManifest } from '../../utils/api/api';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';

export function useViewerPage() {
  const { filename: bookId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  // 이전 페이지 정보 추출
  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/user/mypage' || location.state?.fromLibrary === true;
  
  // URL 파라미터 관리
  const {
    urlSearchParams,
    savedChapter,
    savedPage,
    savedProgress,
    savedGraphMode,
    initialGraphMode,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
    currentChapterRef,
    updateURL,
    prevUrlStateRef
  } = useViewerUrlParams();
  
  // 서버 책 매칭
  const {
    serverBook,
    loadingServerBook,
    matchedServerBook
  } = useServerBookMatching(bookId);
  
  const viewerRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(1);
  const [isInitialChapterDetected, setIsInitialChapterDetected] = useState(false);
  
  const [graphFullScreen, setGraphFullScreen] = useState(initialGraphMode.fullScreen);
  const [showGraph, setShowGraph] = useState(initialGraphMode.show);
  const isInitialMountRef = useRef(true);
  
  // savedGraphMode 변경 시 상태 동기화
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    
    if (savedGraphMode === 'graph') {
      setGraphFullScreen(true);
      setShowGraph(true);
    } else if (savedGraphMode === 'split') {
      setGraphFullScreen(false);
      setShowGraph(true);
    } else if (savedGraphMode === 'viewer') {
      setGraphFullScreen(false);
      setShowGraph(false);
    }
  }, [savedGraphMode]);
  
  
  // useGraphDataLoader는 아래에서 사용됨
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [currentPageWords, setCurrentPageWords] = useState(0);
  const [totalChapterWords, setTotalChapterWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterText, setChapterText] = useState("");
  const [isDataReady, setIsDataReady] = useState(true);
  const [graphViewState, setGraphViewState] = useState(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [filterStage, setFilterStage] = useState(0); // 0: 전체, 1: 핵심-핵심, 2: 핵심-핵심+핵심-주요, 3: 핵심-핵심+핵심-주요+주요-주요
  const [characterData, setCharacterData] = useState(null);
  const [isReloading, setIsReloading] = useState(false);
  const [eventNum, setEventNum] = useState(0);
  // isGraphLoading: 내부 상태, 챕터 변경 시 그래프 UI 로딩 상태 관리
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false);
  
  const prevValidEventRef = useRef(null);
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
  const eventsRef = useRef([]);
  const [maxChapterEvents, setMaxChapterEvents] = useState(new Map());
  
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });
  

  const book = useMemo(() => {
    return bookUtils.createBookObject({
      stateBook: location.state?.book,
      matchedServerBook,
      serverBook,
      bookId,
      loadingServerBook
    });
  }, [location.state?.book, matchedServerBook, bookId, serverBook, loadingServerBook]);

  const isLocalBook = useMemo(
    () => !(book?.id && typeof book.id === 'number'),
    [book]
  );

  // 서버 bookId 추출 유틸리티 함수
  const getServerBookId = useCallback((bookObj) => {
    return (bookObj?.id && typeof bookObj.id === 'number' ? bookObj.id : null) || 
           (bookObj?._bookId && typeof bookObj._bookId === 'number' ? bookObj._bookId : null);
  }, []);

  // 서버 bookId를 우선 사용, 없으면 URL 파라미터의 bookId 사용
  const cleanBookId = useMemo(() => {
    const serverId = getServerBookId(book);
    if (serverId) {
      return String(serverId);
    }
    return bookId?.trim() || '';
  }, [book, bookId, getServerBookId]);

  const [progress, setProgress] = useLocalStorageNumber(`progress_${cleanBookId}`, 0);
  const [settings, setSettings] = useLocalStorage('xhtml_viewer_settings', defaultSettings);

  const folderKey = useMemo(() => {
    const key = getFolderKeyFromFilename(bookId);
    if (!key) {
      // folderKey가 null인 경우 무시
    }
    return key;
  }, [bookId]);
  
  // 그래프 데이터 로더에 서버 bookId 전달 (숫자인 경우만)
  const graphBookId = useMemo(() => {
    const serverId = getServerBookId(book);
    if (serverId) {
      return String(serverId);
    }
    return bookId;
  }, [book, bookId, getServerBookId]);

  const {
    elements,
    setElements,
    setIsDataEmpty,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum: graphEventNum,
    maxChapter: detectedMaxChapter,
    loading: graphLoading,
    error: graphError,
    isDataEmpty
  } = useGraphDataLoader(graphBookId, currentChapter, currentEvent?.eventNum || 1);
  
  // maxChapter 설정 (통합)
  useEffect(() => {
    const serverBookId = getServerBookId(book);
    
    if (serverBookId) {
      // 서버 책인 경우: manifest 조회 후 캐시 확인
      const fetchBookInfo = async () => {
        try {
          const manifestData = await getBookManifest(serverBookId);
          if (manifestData && manifestData.isSuccess && manifestData.result) {
            const cachedMaxChapter = getMaxChapter(serverBookId);
            if (cachedMaxChapter && cachedMaxChapter > 0) {
              setMaxChapter(cachedMaxChapter);
              return;
            }
          }
        } catch (error) {
          // 에러 발생 시에도 캐시 확인
        }
        
        // manifest 조회 실패 또는 캐시에 없는 경우
        const cachedMaxChapter = getMaxChapter(serverBookId);
        if (cachedMaxChapter && cachedMaxChapter > 0) {
          setMaxChapter(cachedMaxChapter);
        } else if (detectedMaxChapter > 0) {
          setMaxChapter(detectedMaxChapter);
        }
      };
      
      fetchBookInfo();
    } else {
      // 로컬 책인 경우
      if (detectedMaxChapter > 0) {
        setMaxChapter(detectedMaxChapter);
      }
    }
  }, [detectedMaxChapter, book, getServerBookId]);
  
  // showGraph/graphFullScreen 상태 변경 시 localStorage에 저장
  useEffect(() => {
    if (graphFullScreen) {
      saveViewerMode("graph");
    } else if (showGraph) {
      saveViewerMode("split");
    } else {
      saveViewerMode("viewer");
    }
  }, [showGraph, graphFullScreen]);

  
  useEffect(() => {
    if (failCount >= 2) {
      toast.info("🔄 계속 실패하면 브라우저 새로고침을 해주세요!");
    }
  }, [failCount]);
  
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);
  
  // 북마크 관리 훅 (통합)
  const {
    bookmarks,
    setBookmarks,
    loading: bookmarksLoading,
    showBookmarkList,
    setShowBookmarkList,
    handleAddBookmark,
    handleRemoveBookmark,
    handleBookmarkSelect,
    handleDeleteBookmark
  } = useBookmarks(cleanBookId, {
    isLocalBook,
    viewerRef,
    setFailCount
  });
  
  // 페이지 변경 시 현재 챕터 번호 업데이트
  // handleLocationChange에서 locator 기반 챕터 업데이트와 중복 방지
  
  // currentChapter가 바뀔 때 즉시 상태 초기화
  useEffect(() => {
    // 챕터 변경 시 즉시 currentEvent 초기화하여 로딩 상태 방지
    setCurrentEvent(null);
    setPrevEvent(null);
    setEvents([]);
    setCharacterData(null);
    // elements는 useGraphDataLoader에서 관리됨
    setIsDataReady(false);
    setIsGraphLoading(true);
    
    // 이전 챕터의 유효한 이벤트 참조도 초기화
    prevValidEventRef.current = null;
    
    // 초기 챕터 감지 완료 표시
    setIsInitialChapterDetected(true);
    
  }, [currentChapter]);
  
  // currentEvent가 null이 아닐 때만 이전 값 갱신 (현재 챕터의 이벤트만)
  useEffect(() => {
    if (currentEvent && currentEvent.chapter === currentChapter) {
      prevValidEventRef.current = currentEvent;
    }
  }, [currentEvent, currentChapter]);
  
  // events 변경 시 ref 동기화
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  
  // elements가 변경될 때 로딩 상태 업데이트
  useEffect(() => {
    // graphLoading이 false이면 로딩 완료 (데이터가 있든 없든)
    // elements가 있을 때만 로딩 완료로 설정했던 것을 수정하여
    // 데이터가 없어도 로딩이 완료된 것으로 처리
    if (!graphLoading) {
      setIsGraphLoading(false);
    }
  }, [elements, graphLoading, isDataEmpty]);
  
  // elements, chapterNum, eventNum이 바뀔 때마다 이전 값 저장
  useEffect(() => {
    prevElementsRef.current = elements;
    prevChapterNumRef.current = currentChapter;
    prevEventNumRef.current = currentEvent?.eventNum;
  }, [elements, currentChapter, currentEvent]);
  
  // 새로고침 감지 및 완료 처리
  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") {
        setIsReloading(true);
        setIsGraphLoading(true);
        
        // 새로고침 시 모든 상태 초기화
        setCurrentEvent(null);
        setPrevEvent(null);
        setEvents([]);
        setCharacterData(null);
        setIsDataReady(false);
        setIsInitialChapterDetected(false);
        prevValidEventRef.current = null;
        
        // URL 파라미터가 없으면 localStorage에서 그래프 모드 복원
        if (!savedGraphMode) {
          const saved = loadViewerMode();
          if (saved === "graph") {
            setGraphFullScreen(true);
            setShowGraph(true);
          } else if (saved === "split") {
            setGraphFullScreen(false);
            setShowGraph(true);
          } else if (saved === "viewer") {
            setGraphFullScreen(false);
            setShowGraph(false);
          }
        }
        
        // 새로고침 완료 후 일정 시간 후에 isReloading을 false로 설정
        const timer = setTimeout(() => {
          setIsReloading(false);
          setIsGraphLoading(false);
        }, 1000);
        
        return () => clearTimeout(timer);
      }
    }
  }, [savedGraphMode]);
  
  // currentEvent가 변경될 때마다 eventNum 업데이트
  useEffect(() => {
    if (currentEvent) {
      setEventNum(currentEvent.event_id ?? 0);
    }
  }, [currentEvent]);
  
  const handlePrevPage = useCallback(() => {
    if (viewerRef.current) {
      try {
        viewerRef.current.prevPage();
      } catch (error) {
        toast.error('이전 페이지로 이동할 수 없습니다.');
      }
    } else {
      toast.error('뷰어가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    }
  }, []);
  
  const handleNextPage = useCallback(() => {
    if (viewerRef.current) {
      try {
        viewerRef.current.nextPage();
      } catch (error) {
        toast.error('다음 페이지로 이동할 수 없습니다.');
      }
    } else {
      toast.error('뷰어가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    }
  }, []);
  
  const handleOpenSettings = useCallback(() => {
    setShowSettingsModal(true);
  }, []);
  
  const handleCloseSettings = useCallback(() => {
    setShowSettingsModal(false);
  }, []);
  
  const handleApplySettings = useCallback((newSettings) => {
    const result = settingsUtils.applySettings(
      newSettings,
      settings,
      setSettings,
      setShowGraph,
      setReloadKey,
      viewerRef,
      cleanBookId
    );
    
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  }, [settings, cleanBookId]);
  
  const onToggleBookmarkList = useCallback(() => {
    navigate(`/viewer/${bookId}/bookmarks`);
  }, [navigate, bookId]);
  
  const handleSliderChange = useCallback(async (value) => {
    setProgress(value);
    
    // 뷰어가 준비될 때까지 대기 (최대 3초)
    let attempts = 0;
    while (attempts < 30) {
      if (viewerRef.current?.moveToProgress) {
        try {
          await viewerRef.current.moveToProgress(value);
          return;
        } catch (e) {
          console.error('프로그레스 이동 실패:', e);
          // 재시도
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }
    
    // 최종 실패 시 경고만 표시 (새로고침하지 않음)
    console.warn('프로그레스 이동 실패: 뷰어가 준비되지 않았습니다.');
  }, [setProgress, viewerRef]);
  
  // 그래프 표시 토글 함수
  const toggleGraph = useCallback(() => {
    const newShowGraph = !showGraph;
    setShowGraph(newShowGraph);

    // 설정에도 그래프 표시 여부 업데이트 (pageMode는 유지)
    const updatedSettings = {
      ...settings,
      showGraph: newShowGraph,
      // pageMode는 기존 설정 유지
    };
    setSettings(updatedSettings);

    const applyAndSync = async () => {
      try {
        // 뷰어 준비 대기 (최대 2초)
        let attempts = 0;
        while (attempts < 20 && !viewerRef.current?.applySettings) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        const saved = await viewerRef.current?.getCurrentLocator?.();
        let displayTarget =
          saved?.startLocator
            ? saved
            : saved?.start
              ? { startLocator: saved.start, endLocator: saved.end ?? saved.start }
              : saved && typeof saved === 'object'
                ? saved
                : null;

        viewerRef.current?.applySettings?.();
        await new Promise(resolve => setTimeout(resolve, 150));

        if (displayTarget && viewerRef.current?.displayAt) {
          await viewerRef.current.displayAt(displayTarget);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (e) {
        toast.error('화면 모드 전환 중 오류가 발생했습니다.');
      }
    };

    applyAndSync();
  }, [showGraph, settings, viewerRef, setTotalPages, setCurrentPage, setProgress]);
  
  const handleFitView = useCallback(() => {
    // TODO: 그래프 뷰 포커스 기능 구현 예정
  }, []);
  
  const handleLocationChange = useCallback(async () => {
    if (!viewerRef.current) return;
    try {
      const loc = await viewerRef.current.getCurrentLocator?.();
      const start = loc?.startLocator ?? loc?.start;
      if (start) {
        const end = loc?.endLocator ?? loc?.end ?? start;
        const anchor = loc?.startLocator ? { startLocator: loc.startLocator, endLocator: end } : { start, end };
        setCurrentChapter(start.chapterIndex);
        setCurrentEvent({
          anchor,
          chapter: start.chapterIndex,
          chapterIdx: start.chapterIndex,
          eventIdx: 1,
          eventNum: 1,
          placeholder: true,
        });
      }
    } catch (_) {}
  }, []);
  
  // 상태 변경 시 URL 업데이트
  useEffect(() => {
    const graphModeValue = graphFullScreen ? 'graph' : (showGraph ? 'split' : 'viewer');
    const prev = prevUrlStateRef.current;
    const updates = {};

    if (currentChapter !== prev.chapter) {
      updates.chapter = currentChapter;
    }
    if (currentPage !== prev.page) {
      updates.page = currentPage;
    }
    if (progress !== prev.progress) {
      updates.progress = progress;
    }
    if (graphModeValue !== prev.graphMode) {
      updates.graphMode = graphModeValue;
    }

    if (Object.keys(updates).length > 0) {
      updateURL(updates);
      prevUrlStateRef.current = {
        chapter: currentChapter,
        page: currentPage,
        progress,
        graphMode: graphModeValue
      };
    }
  }, [currentChapter, currentPage, progress, graphFullScreen, showGraph, updateURL]);
  
  return {
    // 라우터 관련
    filename: bookId, // 호환성을 위해 filename으로 반환
    bookId,
    location,
    navigate,
    
    // 이전 페이지 정보
    previousPage,
    isFromLibrary,
    
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
    
    savedProgress,

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
    cleanBookId,
    bookmarks,
    setBookmarks,
    bookmarksLoading,
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
    elements,
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
    toggleGraph,
    handleFitView,
    handleLocationChange,
    
    // 그룹화된 상태들 (컴포넌트용)
    graphState: {
      currentChapter,
      currentEvent,
      prevValidEvent: prevValidEventRef.current,
      elements,
      graphViewState,
      hideIsolated,
      edgeLabelVisible,
      graphDiff,
      currentCharIndex,
      graphFullScreen,
      showGraph,
      loading: isGraphLoading,
      isDataReady,
      isInitialChapterDetected,
      maxChapterEvents
    },
    
    graphActions: {
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setHideIsolated,
      setEdgeLabelVisible,
      handleFitView,
      setElements,
      setIsDataEmpty,
      filterStage,
      setFilterStage
    },
    
    viewerState: {
      filename: bookId,
      bookId,
      navigate,
      viewerRef,
      book,
      currentPage,
      totalPages,
      progress,
      settings,
      loading,
      isReloading,
      isGraphLoading,
      graphLoading,
      isDataReady,
      showToolbar,
      isDataEmpty
    },
    
    searchState: {
      // 검색 상태는 useGraphSearch 훅에서 관리됨
      // 여기서는 기본 구조만 제공
    }
  };
}

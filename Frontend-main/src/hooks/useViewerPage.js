// ViewerPage 전용 커스텀 훅
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useLocalStorage, useLocalStorageNumber } from './useLocalStorage';
import { useGraphDataLoader } from './useGraphDataLoader';
import { 
  defaultSettings, 
  loadSettings, 
  saveViewerMode, 
  loadViewerMode,
  getCurrentChapterFromViewer,
  findClosestEvent,
  bookmarkUtils,
  settingsUtils
} from '../utils/viewerUtils';
import { getFolderKeyFromFilename } from '../utils/graphData';
import { loadBookmarks, saveBookmarks } from '../components/viewer/bookmark/BookmarkManager';

/**
 * ViewerPage의 메인 상태와 로직을 관리하는 커스텀 훅
 * @param {boolean} initialDarkMode - 초기 다크모드 설정
 * @returns {Object} ViewerPage에 필요한 모든 상태와 함수들
 */
export function useViewerPage(initialDarkMode = false) {
  // 라우터 관련
  const { filename } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  // 기본 상태들
  const viewerRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // 설정 관련 - darkMode는 settings가 로드된 후 초기화
  const [darkMode, setDarkMode] = useState(initialDarkMode);
  
  // 챕터 및 이벤트 관련
  const [currentChapter, setCurrentChapter] = useState(1);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(1);
  
  // 그래프 관련
  const [graphFullScreen, setGraphFullScreen] = useState(() => {
    const saved = loadViewerMode();
    if (saved === "graph") return true;
    if (saved === "split") return false;
    if (saved === "viewer") return false;
    return false;
  });
  
  const [showGraph, setShowGraph] = useState(() => {
    const saved = loadViewerMode();
    if (saved === "graph" || saved === "split") return true;
    if (saved === "viewer") return false;
    return loadSettings().showGraph;
  });
  
  // 기타 상태들
  const [elements, setElements] = useState([]);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [currentPageWords, setCurrentPageWords] = useState(0);
  const [totalChapterWords, setTotalChapterWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterText, setChapterText] = useState("");
  const [isDataReady, setIsDataReady] = useState(true);
  const [graphViewState, setGraphViewState] = useState(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [characterData, setCharacterData] = useState(null);
  const [isReloading, setIsReloading] = useState(false);
  const [eventNum, setEventNum] = useState(0);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  
  // 북마크 관련
  const cleanFilename = filename?.trim() || '';
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(cleanFilename));
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  
  // localStorage 연동 상태들
  const [progress, setProgress] = useLocalStorageNumber(`progress_${cleanFilename}`, 0);
  const [settings, setSettings] = useLocalStorage('epub_viewer_settings', defaultSettings);
  const [lastCFI, setLastCFI] = useLocalStorage(`readwith_${cleanFilename}_lastCFI`, null);
  
  // 이전 상태 추적용 ref들
  const prevValidEventRef = useRef(null);
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
  
  // 그래프 diff 상태
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });
  
  // book 정보 생성
  const book = useMemo(() => 
    location.state?.book || {
      title: filename?.replace(".epub", "") || '',
      path: `/${filename}`,
      filename: filename,
    }, [location.state?.book, filename]
  );
  
  // 폴더 키 추출
  const folderKey = useMemo(() => getFolderKeyFromFilename(filename), [filename]);
  
  // 그래프 데이터 로더 훅 사용
  const {
    elements: graphElements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum: graphEventNum,
    maxChapter: detectedMaxChapter,
    loading: graphLoading,
    error: graphError
  } = useGraphDataLoader(filename, currentChapter);
  
  // maxChapter 설정
  useEffect(() => {
    if (detectedMaxChapter > 0) {
      setMaxChapter(detectedMaxChapter);
    }
  }, [detectedMaxChapter]);
  
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
  
  // 실패 횟수에 따른 토스트 메시지
  useEffect(() => {
    if (failCount >= 2) {
      toast.info("🔄 계속 실패하면 브라우저 새로고침을 해주세요!");
    }
  }, [failCount]);
  
  // body overflow 설정
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);
  
  // progress는 이제 useLocalStorageNumber로 자동 저장됨
  
  // settings 로드 후 darkMode 초기화
  useEffect(() => {
    if (settings && !initialDarkMode) {
      setDarkMode(settings.theme === "dark");
    }
  }, [settings, initialDarkMode]);
  
  // 북마크 로드
  useEffect(() => {
    setBookmarks(loadBookmarks(cleanFilename));
  }, [cleanFilename]);
  
  // 페이지 변경 시 현재 챕터 번호 업데이트
  useEffect(() => {
    const updateCurrentChapter = async () => {
      const chapter = await getCurrentChapterFromViewer(viewerRef);
      if (chapter) {
        setCurrentChapter(chapter);
      }
    };
    updateCurrentChapter();
  }, [currentPage]);
  
  // currentChapter가 바뀔 때 currentEvent, prevEvent 초기화
  useEffect(() => {
    setCurrentEvent(null);
    setPrevEvent(null);
  }, [currentChapter]);
  
  // currentEvent가 null이 아닐 때만 이전 값 갱신
  useEffect(() => {
    if (currentEvent) {
      prevValidEventRef.current = currentEvent;
    }
  }, [currentEvent]);
  
  // elements가 변경될 때 로딩 상태 업데이트
  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);
  
  // elements, chapterNum, eventNum이 바뀔 때마다 이전 값 저장
  useEffect(() => {
    prevElementsRef.current = elements;
    prevChapterNumRef.current = currentChapter;
    prevEventNumRef.current = currentEvent?.eventNum;
  }, [elements, currentChapter, currentEvent]);
  
  // 새로고침 감지
  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") {
        setIsReloading(true);
      }
    }
  }, []);
  
  // currentEvent가 변경될 때마다 eventNum 업데이트
  useEffect(() => {
    if (currentEvent) {
      setEventNum(currentEvent.event_id ?? 0);
    }
  }, [currentEvent]);
  
  // 이벤트 핸들러들
  const handlePrevPage = useCallback(() => {
    if (viewerRef.current) viewerRef.current.prevPage();
  }, []);
  
  const handleNextPage = useCallback(() => {
    if (viewerRef.current) viewerRef.current.nextPage();
  }, []);
  
  const handleAddBookmark = useCallback(async () => {
    if (!viewerRef.current) {
      toast.error("❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }
    
    let cfi = null;
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
    } catch (e) {
      // getCurrentCfi 에러 처리
    }
    
    if (!cfi) {
      toast.error("❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }

    setFailCount(0);

    const result = await bookmarkUtils.toggleBookmark(
      cfi, 
      cleanFilename, 
      bookmarks, 
      loadBookmarks, 
      saveBookmarks
    );
    
    setBookmarks(result.bookmarks);
    saveBookmarks(cleanFilename, result.bookmarks);
    toast.success(result.message);
  }, [cleanFilename, bookmarks]);
  
  const handleBookmarkSelect = useCallback((cfi) => {
    viewerRef.current?.displayAt(cfi);
    setShowBookmarkList(false);
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
      setDarkMode,
      setShowGraph,
      setReloadKey,
      viewerRef,
      cleanFilename
    );
    
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  }, [settings, cleanFilename]);
  
  const onToggleBookmarkList = useCallback(() => {
    navigate(`/viewer/${filename}/bookmarks`);
  }, [navigate, filename]);
  
  const handleSliderChange = useCallback(async (value) => {
    setProgress(value);
    if (viewerRef.current?.moveToProgress) {
      try {
        await viewerRef.current.moveToProgress(value);
        setTimeout(() => {
          // progress가 여전히 value와 다르면 새로고침
          if (progress !== value) {
            window.location.reload();
          }
        }, 1000);
      } catch (e) {
        window.location.reload();
      }
    }
  }, [progress]);
  
  const handleDeleteBookmark = useCallback((cfi) => {
    const result = bookmarkUtils.deleteBookmark(cfi, cleanFilename, bookmarks, saveBookmarks);
    if (result.success) {
      setBookmarks(result.bookmarks);
    } else {
      toast.error(result.message);
    }
  }, [cleanFilename, bookmarks]);
  
  const handleRemoveBookmark = useCallback((cfi) => {
    const result = bookmarkUtils.deleteBookmark(cfi, cleanFilename, bookmarks, saveBookmarks);
    if (result.success) {
      setBookmarks(result.bookmarks);
    } else {
      toast.error(result.message);
    }
  }, [cleanFilename, bookmarks]);
  
  // 그래프 표시 토글 함수
  const toggleGraph = useCallback(() => {
    const newShowGraph = !showGraph;
    setShowGraph(newShowGraph);

    // 설정에도 그래프 표시 여부 업데이트
    const updatedSettings = {
      ...settings,
      showGraph: newShowGraph,
    };
    setSettings(updatedSettings);

    // 설정은 이제 useLocalStorage로 자동 저장됨

    // EPUB 뷰어 다시 로드
    const saveCurrent = async () => {
      try {
        let cfi = null;

        if (viewerRef.current?.getCurrentCfi) {
          cfi = await viewerRef.current.getCurrentCfi();
          if (cfi) {
            setLastCFI(cfi);
          }
        }

        // 즉시 뷰어 다시 로드
        setReloadKey((prev) => prev + 1);
      } catch (e) {
        // 설정 적용 오류 처리
        setReloadKey((prev) => prev + 1);
      }
    };

    saveCurrent();
  }, [showGraph, settings, cleanFilename]);
  
  const handleFitView = useCallback(() => {
    // Implementation of handleFitView
  }, []);
  
  // EpubViewer에서 페이지/스크롤 이동 시 CFI 받아와서 글자 인덱스 갱신
  const handleLocationChange = useCallback(async () => {
    if (viewerRef.current && viewerRef.current.getCurrentCfi) {
      try {
        const cfi = await viewerRef.current.getCurrentCfi();
        // 현재 챕터 추출
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        let chapterNum = currentChapter;
        if (chapterMatch) chapterNum = parseInt(chapterMatch[1]);

        // 챕터 번호 업데이트
        setCurrentChapter(chapterNum);

        // 현재 위치에 해당하는 이벤트 찾기
        const currentEvents = events; // getEventsForChapter(chapterNum) 대신 현재 events 사용
        if (currentEvents && currentEvents.length > 0) {
          const closestEvent = findClosestEvent(cfi, chapterNum, currentEvents);
          if (closestEvent) {
            setCurrentEvent(closestEvent);
          }
        }
      } catch (e) {
        // 위치 계산 오류 처리
      }
    }
  }, [currentChapter, events]);
  
  return {
    // 라우터 관련
    filename,
    location,
    navigate,
    
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
    darkMode,
    setDarkMode,
    
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
    elements,
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
    cleanFilename,
    bookmarks,
    setBookmarks,
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
    graphElements,
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
    handleRemoveBookmark,
    toggleGraph,
    handleFitView,
    handleLocationChange,
    
    // 그룹화된 상태들 (GraphSplitArea용)
    graphState: {
      currentCharIndex,
      hideIsolated,
      edgeLabelVisible,
      currentChapter,
      maxChapter,
      loading,
      isDataReady,
      showGraph,
      graphFullScreen,
      elements,
      currentEvent,
      prevEvent,
      events,
      graphDiff,
      prevElements: prevElementsRef.current,
      currentElements: elements
    },
    graphActions: {
      setHideIsolated,
      setEdgeLabelVisible,
      handleFitView,
      setCurrentChapter,
      setGraphFullScreen
    },
    viewerState: {
      navigate,
      filename,
      book,
      viewerRef
    },
    searchState: {
      currentChapterData
    }
  };
}

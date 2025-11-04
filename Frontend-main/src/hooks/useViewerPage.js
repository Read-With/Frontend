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
  calculateChapterProgress,
  bookmarkUtils,
  settingsUtils
} from '../utils/viewerUtils';
import { getFolderKeyFromFilename } from '../utils/graphData';
import { loadBookmarks, addBookmark, removeBookmark } from '../components/viewer/bookmark/BookmarkManager';
import { getBookManifest } from '../utils/common/api';
import { getMaxChapter } from '../utils/common/manifestCache';

export function useViewerPage() {
  const { filename: bookId } = useParams(); // filename을 bookId로 rename
  const location = useLocation();
  const navigate = useNavigate();
  
  // 이전 페이지 정보 추출
  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/user/mypage' || location.state?.fromLibrary === true;
  
  // URL 쿼리 파라미터에서 상태 복원
  const urlParams = new URLSearchParams(location.search);
  const savedChapter = urlParams.get('chapter');
  const savedPage = urlParams.get('page');
  const savedProgress = urlParams.get('progress');
  const savedGraphMode = urlParams.get('graphMode');
  
  const viewerRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(() => {
    return savedPage ? parseInt(savedPage, 10) : 1;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  const [currentChapter, setCurrentChapter] = useState(() => {
    return savedChapter ? parseInt(savedChapter, 10) : 1;
  });
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(1);
  const [isInitialChapterDetected, setIsInitialChapterDetected] = useState(false);
  
  const [graphFullScreen, setGraphFullScreen] = useState(() => {
    if (savedGraphMode === 'graph') return true;
    if (savedGraphMode === 'split') return false;
    if (savedGraphMode === 'viewer') return false;
    
    const saved = loadViewerMode();
    if (saved === "graph") return true;
    if (saved === "split") return false;
    if (saved === "viewer") return false;
    return false;
  });
  
  const [showGraph, setShowGraph] = useState(() => {
    if (savedGraphMode === 'graph' || savedGraphMode === 'split') return true;
    if (savedGraphMode === 'viewer') return false;
    
    const saved = loadViewerMode();
    if (saved === "graph" || saved === "split") return true;
    if (saved === "viewer") return false;
    return loadSettings().showGraph;
  });
  
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
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false);
  
  const cleanBookId = bookId?.trim() || '';
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  
  const [progress, setProgress] = useLocalStorageNumber(`progress_${cleanBookId}`, 0);
  const [settings, setSettings] = useLocalStorage('epub_viewer_settings', defaultSettings);
  const [lastCFI, setLastCFI] = useLocalStorage(`readwith_${cleanBookId}_lastCFI`, null);
  
  const prevValidEventRef = useRef(null);
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
  
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });
  
  const book = useMemo(() => {
    if (location.state?.book) {
      // API 책인 경우 (숫자 ID)
      if (typeof location.state.book.id === 'number') {
        return {
          ...location.state.book,
          path: location.state.book.epubPath || `/${bookId}`,
          epubPath: location.state.book.epubPath || `/${bookId}`,
          filename: bookId,
        };
      }
      // 로컬 책인 경우 (문자열 ID로 시작하는 경우)
      return {
        ...location.state.book,
        path: location.state.book.epubPath || `/${bookId}`,
        epubPath: location.state.book.epubPath || `/${bookId}`,
        filename: bookId, // 로컬 책의 경우 bookId가 filename이 됨
      };
    }
    
    // state가 없는 경우 (직접 URL 접근)
    // bookId가 숫자인지 문자열인지로 API 책인지 로컬 책인지 판단
    const isNumericId = !isNaN(bookId) && !isNaN(parseFloat(bookId));
    
    if (isNumericId) {
      // API 책으로 추정
      return {
        title: `Book ${bookId}`,
        path: `/${bookId}`,
        epubPath: `/${bookId}`,
        filename: bookId,
        id: parseInt(bookId, 10)
      };
    } else {
      // 로컬 책으로 추정
      return {
        title: bookId?.replace(".epub", "") || '',
        path: `/${bookId}`,
        epubPath: `/${bookId}`,
        filename: bookId,
      };
    }
  }, [location.state?.book, bookId]);

  // API로 받아온 도서의 메타데이터와 manifest 정보를 콘솔에 출력
  useEffect(() => {
    const fetchBookInfo = async () => {
      // API 책인지 확인 (숫자 ID를 가진 책)
      if (book && typeof book.id === 'number' && location.state?.book) {
        // manifest API 호출
        try {
          const manifestData = await getBookManifest(book.id);
          
          if (manifestData && manifestData.isSuccess && manifestData.result) {
            // 캐시에서 maxChapter 가져오기 (getBookManifest에서 자동 저장됨)
            const cachedMaxChapter = getMaxChapter(book.id);
            if (cachedMaxChapter && cachedMaxChapter > 0) {
              setMaxChapter(cachedMaxChapter);
            }
          }
        } catch (error) {
          // 에러 발생 시 캐시에서 확인 시도
          const cachedMaxChapter = getMaxChapter(book.id);
          if (cachedMaxChapter && cachedMaxChapter > 0) {
            setMaxChapter(cachedMaxChapter);
          }
        }
      }
    };

    fetchBookInfo();
  }, [book.id, location.state?.book]); // book.id와 location.state?.book만 의존성으로 설정
  
  const folderKey = useMemo(() => {
    const key = getFolderKeyFromFilename(bookId);
    if (!key) {
      // folderKey가 null인 경우 무시
    }
    return key;
  }, [bookId]);
  
  const {
    elements,
    setElements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum: graphEventNum,
    maxChapter: detectedMaxChapter,
    loading: graphLoading,
    error: graphError
  } = useGraphDataLoader(bookId, currentChapter, currentEvent?.eventNum || 1);
  
  // maxChapter 설정
  useEffect(() => {
    // API 책인 경우 캐시에서 확인
    if (book && typeof book.id === 'number') {
      const cachedMaxChapter = getMaxChapter(book.id);
      if (cachedMaxChapter && cachedMaxChapter > 0) {
        setMaxChapter(cachedMaxChapter);
      } else if (detectedMaxChapter > 0) {
        // 캐시에 없으면 로컬 책처럼 detectedMaxChapter 사용
        setMaxChapter(detectedMaxChapter);
      }
    } else {
      // 로컬 책인 경우
      if (detectedMaxChapter > 0) {
        setMaxChapter(detectedMaxChapter);
      }
    }
  }, [detectedMaxChapter, book]);
  
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
  
  useEffect(() => {
    const fetchBookmarks = async () => {
      if (!cleanBookId) return;
      const isLocalBook = !book.id || typeof book.id === 'string' || bookId.includes('.epub') || isNaN(parseInt(bookId, 10));
      
      if (isLocalBook) {
        setBookmarksLoading(true);
        try {
          const localBookmarks = JSON.parse(localStorage.getItem(`bookmarks_${cleanBookId}`) || '[]');
          setBookmarks(localBookmarks);
        } catch (error) {
          setBookmarks([]);
        } finally {
          setBookmarksLoading(false);
        }
      } else {
        setBookmarksLoading(true);
        try {
          const bookmarksData = await loadBookmarks(cleanBookId);
          setBookmarks(bookmarksData);
        } catch (error) {
          setBookmarks([]);
        } finally {
          setBookmarksLoading(false);
        }
      }
    };

    fetchBookmarks();
  }, [cleanBookId, book.id]);
  
  // 페이지 변경 시 현재 챕터 번호 업데이트
  useEffect(() => {
    const updateCurrentChapter = async () => {
      // viewerRef가 준비되었는지 확인
      if (!viewerRef?.current) {
        return;
      }
      
      const chapter = await getCurrentChapterFromViewer(viewerRef);
      if (chapter) {
        setCurrentChapter(chapter);
      }
    };
    
    // 약간의 지연을 두어 rendition이 완전히 준비되도록 함
    const timeoutId = setTimeout(updateCurrentChapter, 100);
    return () => clearTimeout(timeoutId);
  }, [currentPage]);
  
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
  
  // 새로고침 감지 및 완료 처리
  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") {
        setIsReloading(true);
        setIsGraphLoading(true); // 새로고침 시 그래프 로딩 상태도 true로 설정
        
        // 새로고침 시 모든 상태 초기화
        setCurrentEvent(null);
        setPrevEvent(null);
        setEvents([]);
        setCharacterData(null);
        // elements는 useGraphDataLoader에서 관리됨
        setIsDataReady(false);
        setIsInitialChapterDetected(false);
        prevValidEventRef.current = null;
        
        
        // 새로고침 완료 후 일정 시간 후에 isReloading을 false로 설정
        const timer = setTimeout(() => {
          setIsReloading(false);
          setIsGraphLoading(false); // 새로고침 완료 시 그래프 로딩 상태도 false로 설정
        }, 1000); // 1초 후 새로고침 완료로 간주
        
        return () => clearTimeout(timer);
      }
    }
  }, []);
  
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

    // 로컬 책인지 API 책인지 구분
    // bookId가 숫자가 아니거나 .epub로 끝나는 경우 로컬 책
    const isLocalBook = !book.id || typeof book.id === 'string' || bookId.includes('.epub') || isNaN(parseInt(bookId, 10));
    
    // 기존 북마크가 있는지 확인
    const existingBookmark = bookmarks.find(b => b.startCfi === cfi);
    
    if (existingBookmark) {
      // 이미 북마크가 있으면 삭제
      if (isLocalBook) {
        // 로컬 책의 경우 로컬 스토리지에서 제거
        const updatedBookmarks = bookmarks.filter(b => b.id !== existingBookmark.id);
        setBookmarks(updatedBookmarks);
        localStorage.setItem(`bookmarks_${cleanBookId}`, JSON.stringify(updatedBookmarks));
        toast.success("📖 북마크가 제거되었습니다");
      } else {
        // API 책의 경우 서버에서 제거
        const result = await removeBookmark(existingBookmark.id);
        if (result.success) {
          setBookmarks(prev => prev.filter(b => b.id !== existingBookmark.id));
          toast.success("📖 북마크가 제거되었습니다");
        } else {
          toast.error(result.message || "북마크 제거에 실패했습니다");
        }
      }
    } else {
      // 새 북마크 추가
      if (isLocalBook) {
        // 로컬 책의 경우 로컬 스토리지에 추가
        const newBookmark = {
          id: Date.now().toString(),
          startCfi: cfi,
          title: `북마크 ${bookmarks.length + 1}`,
          createdAt: new Date().toISOString()
        };
        const updatedBookmarks = [...bookmarks, newBookmark];
        setBookmarks(updatedBookmarks);
        localStorage.setItem(`bookmarks_${cleanBookId}`, JSON.stringify(updatedBookmarks));
        toast.success("📖 북마크가 추가되었습니다");
      } else {
        // API 책의 경우 서버에 추가
        const result = await addBookmark(cleanBookId, cfi);
        if (result.success) {
          setBookmarks(prev => [...prev, result.bookmark]);
          toast.success("📖 북마크가 추가되었습니다");
        } else {
          toast.error(result.message || "북마크 추가에 실패했습니다");
        }
      }
    }
  }, [cleanBookId, bookmarks]);
  
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
  
  const handleDeleteBookmark = useCallback(async (bookmarkId) => {
    try {
      const result = await removeBookmark(bookmarkId);
      if (result.success) {
        setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
        toast.success("북마크가 삭제되었습니다");
      } else {
        toast.error(result.message || "북마크 삭제에 실패했습니다");
      }
    } catch (error) {
      toast.error("북마크 삭제에 실패했습니다");
    }
  }, []);
  
  const handleRemoveBookmark = useCallback(async (bookmarkId) => {
    try {
      const result = await removeBookmark(bookmarkId);
      if (result.success) {
        setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
        toast.success("북마크가 삭제되었습니다");
      } else {
        toast.error(result.message || "북마크 삭제에 실패했습니다");
      }
    } catch (error) {
      toast.error("북마크 삭제에 실패했습니다");
    }
  }, []);
  
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
  }, [showGraph, settings, cleanBookId]);
  
  const handleFitView = useCallback(() => {
    // Implementation of handleFitView
  }, []);
  
  // EpubViewer에서 페이지/스크롤 이동 시 CFI 받아와서 글자 인덱스 갱신 (개선된 버전)
  const handleLocationChange = useCallback(async () => {
    if (viewerRef.current && viewerRef.current.getCurrentCfi) {
      try {
        const cfi = await viewerRef.current.getCurrentCfi();
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        let chapterNum = currentChapter;
        if (chapterMatch) chapterNum = parseInt(chapterMatch[1]);

        // 챕터 번호 업데이트
        setCurrentChapter(chapterNum);

        const currentEvents = events;
        if (currentEvents && currentEvents.length > 0) {
          const bookInstance = viewerRef.current?.bookRef?.current;
          const progressInfo = calculateChapterProgress(cfi, chapterNum, currentEvents, bookInstance);
          const closestEvent = findClosestEvent(cfi, chapterNum, currentEvents, progressInfo.currentChars, bookInstance);
          if (closestEvent) {
            closestEvent.chapterProgress = progressInfo.progress;
            closestEvent.currentChars = progressInfo.currentChars;
            closestEvent.totalChars = progressInfo.totalChars;
            closestEvent.eventIndex = progressInfo.eventIndex;
            closestEvent.calculationMethod = progressInfo.calculationMethod;
            
            setCurrentEvent(closestEvent);
          }
        }
      } catch (e) {
      }
    }
  }, [currentChapter, events]);
  
  // URL 업데이트 함수
  const updateURL = useCallback((updates = {}) => {
    const currentParams = new URLSearchParams(location.search);
    
    // 업데이트할 파라미터들
    if (updates.chapter !== undefined) {
      currentParams.set('chapter', updates.chapter);
    }
    if (updates.page !== undefined) {
      currentParams.set('page', updates.page);
    }
    if (updates.progress !== undefined) {
      currentParams.set('progress', updates.progress);
    }
    if (updates.graphMode !== undefined) {
      currentParams.set('graphMode', updates.graphMode);
    }
    
    // URL 업데이트 (히스토리 스택에 추가하지 않음)
    const newURL = `${location.pathname}?${currentParams.toString()}`;
    window.history.replaceState({}, '', newURL);
  }, [location.pathname, location.search]);
  
  // 상태 변경 시 URL 업데이트
  useEffect(() => {
    updateURL({
      chapter: currentChapter,
      page: currentPage,
      progress: progress,
      graphMode: graphFullScreen ? 'graph' : (showGraph ? 'split' : 'viewer')
    });
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
    handleRemoveBookmark,
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
      isInitialChapterDetected
    },
    
    graphActions: {
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setHideIsolated,
      setEdgeLabelVisible,
      handleFitView,
      setElements,
      filterStage,
      setFilterStage
    },
    
    viewerState: {
      filename: bookId, // 호환성을 위해 filename으로 반환
      bookId,
      currentPage,
      totalPages,
      progress,
      settings,
      book,
      loading,
      isReloading,
      isGraphLoading,
      isDataReady,
      showToolbar
    },
    
    searchState: {
      // 검색 상태는 useGraphSearch 훅에서 관리됨
      // 여기서는 기본 구조만 제공
    }
  };
}

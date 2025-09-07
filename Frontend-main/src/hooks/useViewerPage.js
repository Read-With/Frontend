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
import { getBookManifest } from '../utils/api';

export function useViewerPage() {
  const { filename } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  const viewerRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  const [currentChapter, setCurrentChapter] = useState(1);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(1);
  
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
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false);
  
  const cleanFilename = filename?.trim() || '';
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(cleanFilename));
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  
  const [progress, setProgress] = useLocalStorageNumber(`progress_${cleanFilename}`, 0);
  const [settings, setSettings] = useLocalStorage('epub_viewer_settings', defaultSettings);
  const [lastCFI, setLastCFI] = useLocalStorage(`readwith_${cleanFilename}_lastCFI`, null);
  
  const prevValidEventRef = useRef(null);
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
  
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });
  
  const book = useMemo(() => 
    location.state?.book || {
      title: filename?.replace(".epub", "") || '',
      path: `/${filename}`,
      filename: filename,
    }, [location.state?.book, filename]
  );

  // API로 받아온 도서의 메타데이터와 manifest 정보를 콘솔에 출력
  useEffect(() => {
    const fetchBookInfo = async () => {
      // API 책인지 확인 (숫자 ID를 가진 책)
      if (book && typeof book.id === 'number' && location.state?.book) {
        // 도서 기본 정보 출력
        console.log('📚 도서 정보:', {
          제목: book.title,
          저자: book.author,
          메타데이터: {
            id: book.id,
            coverImgUrl: book.coverImgUrl,
            epubPath: book.epubPath,
            summary: book.summary,
            default: book.default,
            favorite: book.favorite,
            updatedAt: book.updatedAt
          }
        });

        // manifest API 호출
        try {
          console.log('🔍 Manifest API 호출 중...', { bookId: book.id });
          const manifestData = await getBookManifest(book.id);
          
          if (manifestData && manifestData.isSuccess && manifestData.result) {
            console.log('📖 책 구조 패키지 (Manifest):', {
              책_정보: {
                id: manifestData.result.book.id,
                제목: manifestData.result.book.title,
                저자: manifestData.result.book.author,
                언어: manifestData.result.book.language,
                기본책: manifestData.result.book.isDefault,
                요약여부: manifestData.result.book.summary,
                표지이미지: manifestData.result.book.coverImgUrl,
                요약URL: manifestData.result.book.summaryUrl,
                EPUB경로: manifestData.result.book.epubPath
              },
              챕터_정보: manifestData.result.chapters.map(chapter => ({
                인덱스: chapter.idx,
                제목: chapter.title,
                시작위치: chapter.startPos,
                끝위치: chapter.endPos,
                원문길이: chapter.rawText?.length || 0,
                요약텍스트: chapter.summaryText,
                요약업로드URL: chapter.summaryUploadUrl,
                요약캐시여부: chapter.povSummariesCached,
                이벤트수: chapter.events?.length || 0
              })),
              인물_정보: manifestData.result.characters.map(character => ({
                id: character.id,
                이름: character.name,
                다른이름들: character.names,
                프로필이미지: character.profileImage,
                주인공여부: character.isMainCharacter,
                첫등장챕터: character.firstChapterIdx,
                성격설명: character.personalityText,
                프로필설명: character.profileText
              }))
            });
          } else {
            console.warn('⚠️ Manifest API 응답이 예상과 다릅니다:', manifestData);
          }
        } catch (error) {
          console.error('❌ Manifest API 호출 실패:', error);
        }
      }
    };

    fetchBookInfo();
  }, [book.id, location.state?.book]); // book.id와 location.state?.book만 의존성으로 설정
  
  const folderKey = useMemo(() => getFolderKeyFromFilename(filename), [filename]);
  
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
  
  // currentChapter가 바뀔 때 이전 챕터와 다른 경우에만 초기화
  // 단, 즉시 초기화하지 않고 EpubViewer에서 새 이벤트가 올 때까지 대기
  useEffect(() => {
    // 챕터 변경을 감지했지만 즉시 초기화하지 않음
    // EpubViewer의 relocated 이벤트에서 새로운 이벤트를 설정할 때까지 대기
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
  
  // 새로고침 감지 및 완료 처리
  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") {
        setIsReloading(true);
        setIsGraphLoading(true); // 새로고침 시 그래프 로딩 상태도 true로 설정
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
      isDataReady
    },
    
    graphActions: {
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setHideIsolated,
      setEdgeLabelVisible,
      handleFitView
    },
    
    viewerState: {
      filename,
      currentPage,
      totalPages,
      progress,
      settings,
      book,
      loading,
      showToolbar
    },
    
    searchState: {
      // 검색 상태는 useGraphSearch 훅에서 관리됨
      // 여기서는 기본 구조만 제공
    }
  };
}

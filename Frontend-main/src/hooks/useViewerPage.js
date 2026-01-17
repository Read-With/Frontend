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
  findClosestEvent,
  calculateChapterProgress,
  settingsUtils,
  ensureLocations
} from '../utils/viewerUtils';
import { getFolderKeyFromFilename } from '../utils/graphData';
import { useBookmarks } from './useBookmarks';
import { getBookManifest } from '../utils/api/api';
import { getMaxChapter } from '../utils/common/cache/manifestCache';
import { normalizeTitle } from '../utils/stringUtils';

export function useViewerPage() {
  const { filename: bookId } = useParams(); // filename을 bookId로 rename
  const location = useLocation();
  const navigate = useNavigate();
  
  // 이전 페이지 정보 추출
  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/user/mypage' || location.state?.fromLibrary === true;
  
  // URL 쿼리 파라미터 파싱 (통합)
  const urlSearchParams = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      chapter: params.get('chapter'),
      page: params.get('page'),
      progress: params.get('progress'),
      graphMode: params.get('graphMode')
    };
  }, [location.search]);
  
  const savedChapter = urlSearchParams.chapter;
  const savedPage = urlSearchParams.page;
  const savedProgress = urlSearchParams.progress;
  const savedGraphMode = urlSearchParams.graphMode;
  
  const viewerRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(() => {
    return savedPage ? parseInt(savedPage, 10) : 1;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // 초기 상태 계산 (통합)
  const initialGraphMode = useMemo(() => {
    if (savedGraphMode === 'graph') return { fullScreen: true, show: true };
    if (savedGraphMode === 'split') return { fullScreen: false, show: true };
    if (savedGraphMode === 'viewer') return { fullScreen: false, show: false };
    
    const saved = loadViewerMode();
    if (saved === "graph") return { fullScreen: true, show: true };
    if (saved === "split") return { fullScreen: false, show: true };
    if (saved === "viewer") return { fullScreen: false, show: false };
    return { fullScreen: false, show: loadSettings().showGraph };
  }, [savedGraphMode]);

  const [currentChapter, setCurrentChapter] = useState(() => {
    return savedChapter ? parseInt(savedChapter, 10) : 1;
  });
  
  const prevUrlChapterRef = useRef(savedChapter ? parseInt(savedChapter, 10) : null);
  
  // URL 파라미터 변경 시 currentChapter 업데이트 (중복 제거)
  useEffect(() => {
    const chapterParam = urlSearchParams.chapter;
    if (chapterParam) {
      const chapterNum = parseInt(chapterParam, 10);
      if (chapterNum && chapterNum > 0 && chapterNum !== currentChapter) {
        if (prevUrlChapterRef.current !== chapterNum) {
          prevUrlChapterRef.current = chapterNum;
          setCurrentChapter(chapterNum);
        }
      }
    } else {
      prevUrlChapterRef.current = null;
    }
  }, [urlSearchParams, currentChapter]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(1);
  const [isInitialChapterDetected, setIsInitialChapterDetected] = useState(false);
  const [matchedServerBook, setMatchedServerBook] = useState(null);
  
  const [graphFullScreen, setGraphFullScreen] = useState(initialGraphMode.fullScreen);
  const [showGraph, setShowGraph] = useState(initialGraphMode.show);
  
  // 새로고침 시 localStorage에서 분할 모드 복원
  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") {
        // URL 파라미터가 없으면 localStorage에서 복원
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
      }
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
  const matchedServerBookRef = useRef(null);
  const prevNormalizedTitleRef = useRef(null);
  const [maxChapterEvents, setMaxChapterEvents] = useState(new Map());
  
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });
  
  // 서버에서 책 정보 가져오기 (URL 직접 접근 시)
  // 서버에는 EPUB 파일을 제외한 메타데이터만 있음
  const [serverBook, setServerBook] = useState(null);
  const [loadingServerBook, setLoadingServerBook] = useState(false);
  
  useEffect(() => {
    const fetchServerBook = async () => {
      // location.state?.book이 있으면 서버 호출 불필요
      if (location.state?.book) {
        return;
      }
      
      const numericBookId = parseInt(bookId, 10);
      if (isNaN(numericBookId)) {
        return;
      }
      
      setLoadingServerBook(true);
      try {
        const { getBook } = await import('../utils/api/booksApi');
        const response = await getBook(numericBookId);
        
        if (response && response.isSuccess && response.result) {
          const bookData = response.result;
          setServerBook(bookData);
        }
      } catch (error) {
        // 에러는 조용히 처리
      } finally {
        setLoadingServerBook(false);
      }
    };
    
    fetchServerBook();
  }, [bookId, location.state?.book]);
  
  // matchedServerBook을 ref로 추적하여 의존성 문제 방지
  useEffect(() => {
    matchedServerBookRef.current = matchedServerBook;
  }, [matchedServerBook]);

  useEffect(() => {
    const stateBook = location.state?.book;
    if (!stateBook || typeof stateBook.id === 'number') {
      if (matchedServerBookRef.current) {
        setMatchedServerBook(null);
      }
      prevNormalizedTitleRef.current = null;
      return;
    }

    const normalizedTitle = normalizeTitle(stateBook.title);
    if (!normalizedTitle) {
      if (matchedServerBookRef.current) {
        setMatchedServerBook(null);
      }
      prevNormalizedTitleRef.current = null;
      return;
    }

    // 이미 같은 제목으로 검색했으면 스킵
    if (prevNormalizedTitleRef.current === normalizedTitle) {
      const currentMatched = matchedServerBookRef.current;
      if (
        currentMatched &&
        typeof currentMatched.id === 'number' &&
        normalizeTitle(currentMatched.title) === normalizedTitle
      ) {
        return;
      }
    }

    prevNormalizedTitleRef.current = normalizedTitle;
    let cancelled = false;

    const fetchMatchingServerBook = async () => {
      try {
        const { getBooks } = await import('../utils/api/booksApi');
        const response = await getBooks({ q: stateBook.title });

        if (cancelled) {
          return;
        }

        if (response?.isSuccess && Array.isArray(response.result)) {
          const matched = response.result.filter(
            (item) => normalizeTitle(item.title) === normalizedTitle && typeof item.id === 'number'
          );
          
          if (matched.length > 0) {
            const sortedMatched = matched.sort((a, b) => {
              const aId = Number(a?.id) || Number.MAX_SAFE_INTEGER;
              const bId = Number(b?.id) || Number.MAX_SAFE_INTEGER;
              return aId - bId;
            });
            
            setMatchedServerBook(sortedMatched[0]);
            return;
          }
        }

        setMatchedServerBook(null);
      } catch (error) {
        if (!cancelled) {
          setMatchedServerBook(null);
        }
      }
    };

    fetchMatchingServerBook();

    return () => {
      cancelled = true;
    };
  }, [location.state?.book]);

  useEffect(() => {
    if (!matchedServerBook || typeof matchedServerBook.id !== 'number') {
      return;
    }

    const numericId = matchedServerBook.id;
    if (`${numericId}` === bookId) {
      return;
    }

    const stateBook = location.state?.book;
    // 로컬 bookID는 사용하지 않음 - bookId를 IndexedDB 키로 사용
    const indexedDbKey = String(numericId);

    navigate(`/user/viewer/${numericId}${location.search || ''}`, {
      replace: true,
      state: {
        ...location.state,
        book: {
          ...matchedServerBook,
          epubFile: stateBook?.epubFile,
          epubArrayBuffer: stateBook?.epubArrayBuffer,
          filename: String(numericId),
          _indexedDbId: indexedDbKey,
          _bookId: numericId,
          _needsLoad: !stateBook?.epubFile && !stateBook?.epubArrayBuffer,
          epubPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined
        }
      }
    });
  }, [matchedServerBook, bookId, location.search, location.state, navigate]);

  const book = useMemo(() => {
    if (location.state?.book) {
      const stateBook = location.state.book;

      if (matchedServerBook && typeof matchedServerBook.id === 'number') {
        // 로컬 bookID는 사용하지 않음 - bookId를 IndexedDB 키로 사용
        const indexedDbKey = String(matchedServerBook.id);

        return {
          ...matchedServerBook,
          epubFile: stateBook.epubFile,
          epubArrayBuffer: stateBook.epubArrayBuffer,
          filename: String(matchedServerBook.id ?? bookId),
          _indexedDbId: indexedDbKey,
          _needsLoad: !stateBook.epubFile && !stateBook.epubArrayBuffer,
          _bookId: matchedServerBook.id,
          epubPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined
        };
      }

      // 로컬 bookID는 사용하지 않음 - bookId를 IndexedDB 키로 사용
      const stateBookId = stateBook.id || stateBook._bookId || bookId;
      const indexedDbKey = stateBookId ? String(stateBookId) : null;

      return {
        ...stateBook,
        epubFile: stateBook.epubFile,
        epubArrayBuffer: stateBook.epubArrayBuffer,
        filename: bookId,
        _indexedDbId: indexedDbKey,
        _needsLoad: !stateBook.epubFile && !stateBook.epubArrayBuffer,
        _bookId: stateBook.id || stateBook._bookId || bookId,
        epubPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }
    
    // URL 직접 접근: 서버에서 가져온 책 메타데이터 사용
    if (serverBook) {
      // 로컬 bookID는 사용하지 않음 - bookId를 IndexedDB 키로 사용
      const indexedDbKey = serverBook.id ? String(serverBook.id) : null;
      
      return {
        ...serverBook,
        filename: bookId,
        _needsLoad: true, // IndexedDB에서 EPUB 로드 필요
        _indexedDbId: indexedDbKey, // bookId로 IndexedDB 접근
        _bookId: serverBook.id,
        epubPath: undefined,
        filePath: undefined,
        s3Path: undefined,
        fileUrl: undefined
      };
    }
    
    // 서버 책 정보 로딩 중이거나 실패한 경우 기본값
    const numericBookId = parseInt(bookId, 10);
    const indexedDbKey = !isNaN(numericBookId) ? String(numericBookId) : bookId;
    
    return {
      title: loadingServerBook ? '로딩 중...' : `Book ${bookId}`,
      filename: bookId,
      id: !isNaN(numericBookId) ? numericBookId : null,
      _needsLoad: true,
      _indexedDbId: indexedDbKey, // bookId로 IndexedDB 접근
      _bookId: !isNaN(numericBookId) ? numericBookId : bookId,
      epubPath: undefined
    };
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
  const [settings, setSettings] = useLocalStorage('epub_viewer_settings', defaultSettings);

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
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum: graphEventNum,
    maxChapter: detectedMaxChapter,
    loading: graphLoading, // graphLoading: useGraphDataLoader에서 반환, 그래프 데이터 로딩 상태
    error: graphError
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
  // handleLocationChange에서 이미 로컬 CFI 기반으로 챕터를 업데이트하므로 중복 제거
  
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

        // applySettings 호출 전에 현재 CFI를 저장
        const savedCfi = await viewerRef.current?.getCurrentCfi?.();
        
        // 레이아웃만 갱신
        viewerRef.current?.applySettings?.();
        
        // 렌더링이 완료될 때까지 대기 (spread 변경 후 리렌더링 시간 확보)
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // 저장된 CFI로 다시 이동하여 위치 유지
        if (savedCfi && viewerRef.current?.displayAt) {
          await viewerRef.current.displayAt(savedCfi);
          // displayAt 호출 후 위치 안정화 대기
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 최종 위치 동기화
        const finalCfi = await viewerRef.current?.getCurrentCfi?.();
        const bookInstance = viewerRef.current?.getBookInstance?.();

        if (bookInstance) {
          await ensureLocations(bookInstance, 2000);
          const total = Math.max(1, Number(bookInstance.locations?.length?.()) || 1);
          setTotalPages(total);

          if (finalCfi) {
            const locIdx = bookInstance.locations?.locationFromCfi?.(finalCfi);
            if (Number.isFinite(locIdx) && locIdx >= 0) {
              const pageNum = Math.min(locIdx + 1, total);
              setCurrentPage(pageNum);
              const progressValue = total > 1
                ? Math.round((locIdx / (total - 1)) * 100)
                : (locIdx > 0 ? 100 : 0);
              setProgress(progressValue);
            }
          }
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
  
  const prevUrlStateRef = useRef({
    chapter: null,
    page: null,
    progress: null,
    graphMode: null
  });

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

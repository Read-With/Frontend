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
  bookmarkUtils,
  settingsUtils
} from '../utils/viewerUtils';
import { getFolderKeyFromFilename } from '../utils/graphData';
import { loadBookmarks, addBookmark, removeBookmark } from '../components/viewer/bookmark/BookmarkManager';
import { getBookManifest } from '../utils/common/api';
import { getMaxChapter } from '../utils/common/manifestCache';

const normalizeTitle = (title) => {
  if (!title) return '';
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s/g, '');
};

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
  
  const prevUrlChapterRef = useRef(savedChapter ? parseInt(savedChapter, 10) : null);
  
  // URL 파라미터 변경 시 currentChapter 업데이트
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const chapterParam = urlParams.get('chapter');
    if (chapterParam) {
      const chapterNum = parseInt(chapterParam, 10);
      if (chapterNum && chapterNum > 0) {
        // URL의 chapter 값이 실제로 변경되었는지 확인
        if (prevUrlChapterRef.current !== chapterNum) {
          prevUrlChapterRef.current = chapterNum;
          if (chapterNum !== currentChapter) {
            setCurrentChapter(chapterNum);
          }
        }
      }
    } else {
      prevUrlChapterRef.current = null;
    }
  }, [location.search]);
  
  // currentChapter가 변경되면 ref도 업데이트
  useEffect(() => {
    prevUrlChapterRef.current = currentChapter;
  }, [currentChapter]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(1);
  const [isInitialChapterDetected, setIsInitialChapterDetected] = useState(false);
  const [matchedServerBook, setMatchedServerBook] = useState(null);
  
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
  
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  
  const prevValidEventRef = useRef(null);
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
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
  
  useEffect(() => {
    const stateBook = location.state?.book;
    if (!stateBook || typeof stateBook.id === 'number') {
      if (matchedServerBook) {
        setMatchedServerBook(null);
      }
      return;
    }

    const normalizedTitle = normalizeTitle(stateBook.title);
    if (!normalizedTitle) {
      if (matchedServerBook) {
        setMatchedServerBook(null);
      }
      return;
    }

    if (
      matchedServerBook &&
      typeof matchedServerBook.id === 'number' &&
      normalizeTitle(matchedServerBook.title) === normalizedTitle
    ) {
      return;
    }

    let cancelled = false;

    const fetchMatchingServerBook = async () => {
      try {
        const { getBooks } = await import('../utils/api/booksApi');
        const response = await getBooks({ q: stateBook.title });

        if (cancelled) {
          return;
        }

        if (response?.isSuccess && Array.isArray(response.result)) {
          // 정규화된 제목으로 매칭
          const matched = response.result.filter(
            (item) => normalizeTitle(item.title) === normalizedTitle && typeof item.id === 'number'
          );
          
          if (matched.length > 0) {
            // 동일한 책 제목이 여러 개인 경우, bookId 중 가장 작은 수를 선택
            const sortedMatched = matched.sort((a, b) => {
              const aId = Number(a?.id) || Number.MAX_SAFE_INTEGER;
              const bId = Number(b?.id) || Number.MAX_SAFE_INTEGER;
              return aId - bId;
            });
            
            // 가장 작은 bookId 선택
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
  }, [location.state?.book, matchedServerBook]);

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

  // 서버 bookId를 우선 사용, 없으면 URL 파라미터의 bookId 사용
  const cleanBookId = useMemo(() => {
    if (book?.id && typeof book.id === 'number') {
      return String(book.id);
    }
    if (book?._bookId && typeof book._bookId === 'number') {
      return String(book._bookId);
    }
    return bookId?.trim() || '';
  }, [book?.id, book?._bookId, bookId]);

  const [progress, setProgress] = useLocalStorageNumber(`progress_${cleanBookId}`, 0);
  const [settings, setSettings] = useLocalStorage('epub_viewer_settings', defaultSettings);
  const [lastCFI, setLastCFI] = useLocalStorage(`readwith_${cleanBookId}_lastCFI`, null);

  // API로 받아온 도서의 메타데이터와 manifest 정보를 콘솔에 출력
  useEffect(() => {
    const fetchBookInfo = async () => {
      // 서버 bookId 확인 (book.id 또는 book._bookId 중 숫자인 것 사용)
      const serverBookId = (book?.id && typeof book.id === 'number' ? book.id : null) || 
                           (book?._bookId && typeof book._bookId === 'number' ? book._bookId : null);
      
      if (!serverBookId) {
        return;
      }

      try {
        const manifestData = await getBookManifest(serverBookId);

        if (manifestData && manifestData.isSuccess && manifestData.result) {
          const cachedMaxChapter = getMaxChapter(serverBookId);
          if (cachedMaxChapter && cachedMaxChapter > 0) {
            setMaxChapter(cachedMaxChapter);
          }
        }
      } catch (error) {
        const cachedMaxChapter = getMaxChapter(serverBookId);
        if (cachedMaxChapter && cachedMaxChapter > 0) {
          setMaxChapter(cachedMaxChapter);
        }
      }
    };

    fetchBookInfo();
  }, [book]);
  
  const folderKey = useMemo(() => {
    const key = getFolderKeyFromFilename(bookId);
    if (!key) {
      // folderKey가 null인 경우 무시
    }
    return key;
  }, [bookId]);
  
  // 그래프 데이터 로더에 서버 bookId 전달 (숫자인 경우만)
  const graphBookId = useMemo(() => {
    if (book?.id && typeof book.id === 'number') {
      return String(book.id);
    }
    if (book?._bookId && typeof book._bookId === 'number') {
      return String(book._bookId);
    }
    return bookId;
  }, [book?.id, book?._bookId, bookId]);

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
  } = useGraphDataLoader(graphBookId, currentChapter, currentEvent?.eventNum || 1);
  
  // maxChapter 설정
  useEffect(() => {
    // 서버 bookId 확인 (book.id 또는 book._bookId 중 숫자인 것 사용)
    const serverBookId = (book?.id && typeof book.id === 'number' ? book.id : null) || 
                         (book?._bookId && typeof book._bookId === 'number' ? book._bookId : null);
    
    // API 책인 경우 캐시에서 확인
    if (serverBookId) {
      const cachedMaxChapter = getMaxChapter(serverBookId);
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
      
      // 서버 bookId를 사용하여 북마크 로드
      setBookmarksLoading(true);
      try {
        const bookmarksData = await loadBookmarks(cleanBookId);
        setBookmarks(bookmarksData);
      } catch (error) {
        setBookmarks([]);
      } finally {
        setBookmarksLoading(false);
      }
    };

    fetchBookmarks();
  }, [cleanBookId]);
  
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
  
  const handleAddBookmark = useCallback(async () => {
    if (!viewerRef.current) {
      toast.error("❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }
    
    let cfi = null;
    let pageNum = null;
    let chapterNum = null;
    
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
      
      // 로컬 CFI에서 페이지와 챕터 정보 추출
      if (cfi) {
        // 챕터 번호 추출
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        if (chapterMatch) {
          chapterNum = parseInt(chapterMatch[1]);
        }
        
        // 페이지 번호 추출 (bookInstance를 통해 정확한 페이지 번호 얻기)
        try {
          const bookInstance = viewerRef.current?.bookRef?.current;
          if (bookInstance?.locations) {
            const locIdx = bookInstance.locations.locationFromCfi?.(cfi);
            if (Number.isFinite(locIdx) && locIdx >= 0) {
              const totalLocations = bookInstance.locations.length?.() || 1;
              pageNum = Math.max(1, Math.min(locIdx + 1, totalLocations));
            }
          }
        } catch (e) {
          // bookInstance 접근 실패 시 CFI에서 직접 파싱
          const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
          if (pageMatch) {
            pageNum = parseInt(pageMatch[1]);
          }
        }
      }
    } catch (e) {
      // getCurrentCfi 에러 처리
    }
    
    if (!cfi) {
      toast.error("❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }

    setFailCount(0);

    // 로컬 책인지 확인 (서버 bookId가 없으면 로컬 책)
    const isLocalBook = !book.id || typeof book.id !== 'number';
    
    // 북마크 제목 생성: "몇페이지 (챕터 몇)" 형식
    let bookmarkTitle = '';
    if (pageNum && chapterNum) {
      bookmarkTitle = `${pageNum}페이지 (${chapterNum}챕터)`;
    } else if (pageNum) {
      bookmarkTitle = `${pageNum}페이지`;
    } else if (chapterNum) {
      bookmarkTitle = `${chapterNum}챕터`;
    } else {
      bookmarkTitle = `북마크 ${bookmarks.length + 1}`;
    }
    
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
        // 서버 책의 경우 서버에서 제거 (서버 bookId 사용)
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
          title: bookmarkTitle,
          pageNum: pageNum,
          chapterNum: chapterNum,
          createdAt: new Date().toISOString()
        };
        const updatedBookmarks = [...bookmarks, newBookmark];
        setBookmarks(updatedBookmarks);
        localStorage.setItem(`bookmarks_${cleanBookId}`, JSON.stringify(updatedBookmarks));
        toast.success("📖 북마크가 추가되었습니다");
      } else {
        // 서버 책의 경우 서버에 추가 (서버 bookId 사용, title 포함)
        const result = await addBookmark(cleanBookId, cfi, null, '#28B532', '', bookmarkTitle);
        if (result.success) {
          // 서버 응답에 title이 없으면 추가
          const bookmarkWithTitle = {
            ...result.bookmark,
            title: bookmarkTitle,
            pageNum: pageNum,
            chapterNum: chapterNum
          };
          setBookmarks(prev => [...prev, bookmarkWithTitle]);
          toast.success("📖 북마크가 추가되었습니다");
        } else {
          toast.error(result.message || "북마크 추가에 실패했습니다");
        }
      }
    }
  }, [cleanBookId, bookmarks, book]);
  
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
    if (!viewerRef.current?.moveToProgress) return;
    try {
      await viewerRef.current.moveToProgress(value);
    } catch (e) {
      window.location.reload();
    }
  }, [setProgress, viewerRef]);
  
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

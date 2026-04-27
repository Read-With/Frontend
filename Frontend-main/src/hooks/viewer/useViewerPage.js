import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useLocalStorage } from '../common/useLocalStorage';
import { useGraphDataLoader } from '../graph/useGraphDataLoader';
import { useServerBookMatching } from '../books/useServerBookMatching';
import { useBooksServerQuery } from '../books/useBooksServerQuery';
import { useViewerUrlParams } from './useViewerUrlParams';
import { useViewerGraphSync } from './useViewerGraphSync';
import { flagsFromGraphMode } from './graphModeFlags';
import { 
  defaultSettings, 
  saveViewerMode, 
  loadViewerMode,
  settingsUtils,
  bookUtils
} from '../../utils/viewer/viewerUtils';
import { getFolderKeyFromFilename } from '../../utils/graph/graphData';
import { useBookmarks } from '../bookmarks/useBookmarks';
import { getBookManifest } from '../../utils/api/api';
import { getManifestFromCache, getMaxChapter } from '../../utils/common/cache/manifestCache';
import { userViewerBookmarksPath } from '../../utils/navigation/viewerPaths';
import { anchorToLocators, toEventAnchorPayload } from '../../utils/common/locatorUtils';

function runViewerPaging(viewerRef, direction) {
  const ref = viewerRef.current;
  if (!ref) {
    toast.error('뷰어가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  try {
    if (direction === 'prev') ref.prevPage();
    else ref.nextPage();
  } catch {
    toast.error(
      direction === 'prev'
        ? '이전 페이지로 이동할 수 없습니다.'
        : '다음 페이지로 이동할 수 없습니다.'
    );
  }
}

// Waits for two animation frames — enough for a layout recalculation to flush to the screen.
const waitForPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// 매 렌더 새 객체 방지
const EMPTY_VIEWER_SEARCH_STATE = Object.freeze({});

export function useViewerPage() {
  const { filename: bookId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const skipViewerHistoryMutationRef = useRef(false);

  useEffect(() => {
    skipViewerHistoryMutationRef.current = false;
  }, [bookId]);

  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/user/mypage' || location.state?.fromLibrary === true;

  const {
    urlSearchParams: _urlSearchParams,
    savedChapter: _savedChapter,
    savedPage: _savedPage,
    savedGraphMode: _savedGraphMode,
    initialGraphMode,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
    currentChapterRef: _currentChapterRef,
  } = useViewerUrlParams({ skipHistoryMutationsRef: skipViewerHistoryMutationRef });

  const {
    serverBook,
    loadingServerBook,
    matchedServerBook
  } = useServerBookMatching(bookId, { skipBookIdRedirectRef: skipViewerHistoryMutationRef });

  const { data: serverBooksListData } = useBooksServerQuery();

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
  
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [currentPageWords, setCurrentPageWords] = useState(0);
  const [totalChapterWords, setTotalChapterWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterText, setChapterText] = useState("");
  const [isDataReady, setIsDataReady] = useState(true);
  const [graphViewState, setGraphViewState] = useState(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [filterStage, setFilterStage] = useState(0);
  const [characterData, setCharacterData] = useState(null);
  const [isReloading, setIsReloading] = useState(false);
  const [eventNum, setEventNum] = useState(0);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  // 확정 전 중간 이벤트로 그래프를 보이지 않게 할 때 사용
  const [isFineGraphLoading, setFineGraphLoading] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
  const eventsRef = useRef([]);
  const [maxChapterEvents, _setMaxChapterEvents] = useState(new Map());
  
  const [graphDiff, setGraphDiff] = useState({
    added: [],
    removed: [],
    updated: [],
  });

  const [manifestLoaded, setManifestLoaded] = useState(false);

  const book = useMemo(() => {
    const base = bookUtils.createBookObject({
      stateBook: location.state?.book,
      matchedServerBook,
      serverBook,
      bookId,
      loadingServerBook
    });
    const idStr = bookId != null ? String(bookId).trim() : '';
    if (!idStr) return base;
    const row = (serverBooksListData?.books || []).find((b) => String(b?.id) === idStr);
    if (!row) return base;
    const serverP = Number(row.progress);
    const listProgress = Number.isFinite(serverP)
      ? Math.min(100, Math.max(0, Math.round(serverP)))
      : 0;
    return { ...base, progress: listProgress };
  }, [
    location.state?.book,
    matchedServerBook,
    bookId,
    serverBook,
    loadingServerBook,
    serverBooksListData?.books,
  ]);

  const getServerBookId = useCallback((bookObj) => {
    const primaryId = Number(bookObj?.id);
    if (Number.isFinite(primaryId) && primaryId > 0) {
      return primaryId;
    }
    const fallbackId = Number(bookObj?._bookId);
    if (Number.isFinite(fallbackId) && fallbackId > 0) {
      return fallbackId;
    }
    return null;
  }, []);

  const cleanBookId = useMemo(() => {
    const serverId = getServerBookId(book);
    if (serverId) {
      return String(serverId);
    }
    return bookId?.trim() || '';
  }, [book, bookId, getServerBookId]);

  const [progress, setProgress] = useState(0);
  const [settings, setSettings] = useLocalStorage('xhtml_viewer_settings', defaultSettings);
  const lastSyncedServerProgressRef = useRef({ bookKey: null, value: null });

  const folderKey = useMemo(() => getFolderKeyFromFilename(bookId), [bookId]);

  useEffect(() => {
    lastSyncedServerProgressRef.current = { bookKey: null, value: null };
    setProgress(0);
  }, [cleanBookId]);

  useEffect(() => {
    const p = Number(book?.progress);
    if (!cleanBookId || !Number.isFinite(p) || p < 0) return;
    const prev = lastSyncedServerProgressRef.current;
    if (prev.bookKey === cleanBookId && prev.value === p) return;
    lastSyncedServerProgressRef.current = { bookKey: cleanBookId, value: p };
    setProgress(Math.min(100, Math.max(0, Math.round(p))));
  }, [cleanBookId, book?.progress, setProgress]);

  const graphBookId = useMemo(() => {
    const serverId = getServerBookId(book);
    if (serverId) {
      return String(serverId);
    }
    return bookId;
  }, [book, bookId, getServerBookId]);

  // currentEvent가 잠깐 null/플레이스홀더일 때 그래프가 1번으로 깜빡이는 것 방지
  const graphLoaderLastGoodRef = useRef({ chapter: 0, eventNum: 1 });
  const graphLoaderEventIdx = useMemo(() => {
    const ch = Number(currentChapter);
    if (!Number.isFinite(ch) || ch < 1) return 1;

    if (currentEvent && typeof currentEvent === 'object') {
      const evCh = Number(currentEvent.chapter ?? currentEvent.chapterIdx ?? ch);
      const raw = Number(currentEvent.eventNum ?? currentEvent.eventIdx);
      if (Number.isFinite(raw) && raw >= 1 && evCh === ch) {
        graphLoaderLastGoodRef.current = { chapter: ch, eventNum: raw };
        return raw;
      }
    }

    const saved = graphLoaderLastGoodRef.current;
    if (saved.chapter === ch && saved.eventNum >= 1) return saved.eventNum;
    return 1;
  }, [currentChapter, currentEvent]);

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
  } = useGraphDataLoader(graphBookId, currentChapter, graphLoaderEventIdx);

  const { prevValidEvent, prevValidEventRef, graphPhase, resetPrevValidEvent } = useViewerGraphSync({
    currentChapter,
    currentEvent,
    isReloading,
    isFineGraphLoading,
    isGraphLoading,
    graphLoading,
  });

  const manifestServerBookId = useMemo(() => {
    const fromBook = getServerBookId(book);
    if (fromBook) return fromBook;
    const fromUrl = Number(bookId);
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    return null;
  }, [book, bookId, getServerBookId]);

  useEffect(() => {
    if (!manifestServerBookId) {
      setManifestLoaded(true);
      return;
    }
    setManifestLoaded(false);
    if (getManifestFromCache(manifestServerBookId)) {
      setManifestLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await getBookManifest(manifestServerBookId);
      } catch (_e) {
        void 0;
      } finally {
        if (!cancelled) setManifestLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manifestServerBookId]);

  useEffect(() => {
    const serverBookId = getServerBookId(book);
    if (serverBookId) {
      if (!manifestLoaded) return;
      const cachedMaxChapter = getMaxChapter(serverBookId);
      if (cachedMaxChapter && cachedMaxChapter > 0) {
        setMaxChapter(cachedMaxChapter);
      } else if (detectedMaxChapter > 0) {
        setMaxChapter(detectedMaxChapter);
      }
    } else if (detectedMaxChapter > 0) {
      setMaxChapter(detectedMaxChapter);
    }
  }, [manifestLoaded, book, detectedMaxChapter, getServerBookId]);
  
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
  
  const {
    bookmarks,
    setBookmarks,
    loading: bookmarksLoading,
    showBookmarkList,
    setShowBookmarkList,
    handleAddBookmark,
    handleRemoveBookmark: _handleRemoveBookmark,
    handleBookmarkSelect,
    handleDeleteBookmark
  } = useBookmarks(cleanBookId, {
    viewerRef,
    setFailCount
  });
  
  const resetGraphTransientState = useCallback((initialChapterDetected) => {
    setCurrentEvent(null);
    setPrevEvent(null);
    setEvents([]);
    setCharacterData(null);
    setIsDataReady(false);
    setIsGraphLoading(true);
    resetPrevValidEvent();
    setIsInitialChapterDetected(initialChapterDetected);
  }, [resetPrevValidEvent]);

  const waitForViewerMethod = useCallback((methodName, timeoutMs = 3000) => {
    if (viewerRef.current?.[methodName]) return Promise.resolve(true);
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const id = setInterval(() => {
        if (viewerRef.current?.[methodName]) {
          clearInterval(id);
          resolve(true);
        } else if (Date.now() >= deadline) {
          clearInterval(id);
          resolve(false);
        }
      }, 100);
    });
  }, []);

  useEffect(() => {
    resetGraphTransientState(true);
  }, [currentChapter, resetGraphTransientState]);
  
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (!graphLoading) {
      setIsGraphLoading(false);
    }
  }, [elements, graphLoading, isDataEmpty]);
  
  useEffect(() => {
    prevElementsRef.current = elements;
    prevChapterNumRef.current = currentChapter;
    prevEventNumRef.current = currentEvent?.eventNum;
  }, [elements, currentChapter, currentEvent]);
  
  useEffect(() => {
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") {
        setIsReloading(true);
        resetGraphTransientState(false);
        
        const flags = flagsFromGraphMode(loadViewerMode());
        if (flags) {
          setGraphFullScreen(flags.fullScreen);
          setShowGraph(flags.show);
        }
        
        const timer = setTimeout(() => {
          setIsReloading(false);
          setIsGraphLoading(false);
        }, 1000);
        
        return () => clearTimeout(timer);
      }
    }
  }, [resetGraphTransientState]);
  
  useEffect(() => {
    if (!currentEvent) return;
    const n = Number(currentEvent.eventNum);
    if (Number.isFinite(n) && n > 0) {
      setEventNum(n);
      return;
    }
    const idx = Number(currentEvent.eventIdx);
    setEventNum(Number.isFinite(idx) && idx > 0 ? idx : 0);
  }, [currentEvent]);
  
  const handlePrevPage = useCallback(() => runViewerPaging(viewerRef, 'prev'), []);
  const handleNextPage = useCallback(() => runViewerPaging(viewerRef, 'next'), []);
  
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
    navigate(userViewerBookmarksPath(bookId), {
      state: {
        ...(location.state || {}),
        book,
      },
    });
  }, [navigate, bookId, location.state, book]);
  
  const handleSliderChange = useCallback(async (value) => {
    setProgress(value);
    const ready = await waitForViewerMethod('moveToProgress');
    if (!ready) {
      console.warn('프로그레스 이동 실패: 뷰어가 준비되지 않았습니다.');
      return;
    }
    try {
      await viewerRef.current.moveToProgress(value);
    } catch (e) {
      console.error('프로그레스 이동 실패:', e);
    }
  }, [setProgress, viewerRef, waitForViewerMethod]);
  
  const toggleGraph = useCallback(() => {
    const newShowGraph = !showGraph;
    setShowGraph(newShowGraph);

    const updatedSettings = {
      ...settings,
      showGraph: newShowGraph,
    };
    setSettings(updatedSettings);

    const applyAndSync = async () => {
      try {
        await waitForViewerMethod('applySettings', 20, 100);
        const locWrap = viewerRef.current?.getCurrentLocator?.();
        const start = locWrap?.startLocator ?? locWrap?.start;
        const end = locWrap?.endLocator ?? locWrap?.end ?? start;

        viewerRef.current?.applySettings?.();
        await waitForPaint();

        if (start && viewerRef.current?.displayAt) {
          const anchor = { startLocator: start, endLocator: end ?? start };
          const moved = viewerRef.current.displayAt(anchor);
          if (!moved) {
            const pct = Number(progress);
            if (Number.isFinite(pct) && pct >= 0) {
              await viewerRef.current.moveToProgress?.(pct);
            }
          }
        } else {
          const pct = Number(progress);
          if (Number.isFinite(pct) && pct >= 0) {
            await viewerRef.current?.moveToProgress?.(pct);
          }
        }
        await waitForPaint();
      } catch (_e) {
        toast.error('화면 모드 전환 중 오류가 발생했습니다.');
      }
    };

    applyAndSync();
  }, [showGraph, settings, setSettings, viewerRef, waitForViewerMethod, progress]);
  
  const handleFitView = useCallback(() => {
  }, []);
  
  const handleLocationChange = useCallback(async () => {
    if (!viewerRef.current) return;
    try {
      const loc = await viewerRef.current.getCurrentLocator?.();
      const { startLocator: start } = anchorToLocators(loc);
      if (start) {
        const anchor = toEventAnchorPayload(loc);
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
  
  const exitToMypage = useCallback(() => {
    skipViewerHistoryMutationRef.current = true;
    const prefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const path = `${prefix}/mypage`.replace(/\/{2,}/g, '/');
    navigate(path, { replace: true });
  }, [navigate]);

  const graphState = useMemo(
    () => ({
      currentChapter,
      currentEvent,
      prevValidEvent,
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
      maxChapterEvents,
    }),
    [
      currentChapter,
      currentEvent,
      prevValidEvent,
      elements,
      graphViewState,
      hideIsolated,
      edgeLabelVisible,
      graphDiff,
      currentCharIndex,
      graphFullScreen,
      showGraph,
      isGraphLoading,
      isDataReady,
      isInitialChapterDetected,
      maxChapterEvents,
    ]
  );

  const graphActions = useMemo(
    () => ({
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setHideIsolated,
      setEdgeLabelVisible,
      handleFitView,
      setElements,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    }),
    [
      setCurrentChapter,
      setGraphFullScreen,
      setShowGraph,
      setHideIsolated,
      setEdgeLabelVisible,
      handleFitView,
      setElements,
      setIsDataEmpty,
      filterStage,
      setFilterStage,
    ]
  );

  const viewerState = useMemo(
    () => ({
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
      graphPhase,
      isDataReady,
      showToolbar,
      isDataEmpty,
    }),
    [
      bookId,
      navigate,
      book,
      currentPage,
      totalPages,
      progress,
      settings,
      loading,
      graphPhase,
      isDataReady,
      showToolbar,
      isDataEmpty,
    ]
  );

  return {
    filename: bookId,
    bookId,
    location,
    navigate,
    previousPage,
    isFromLibrary,
    viewerRef,
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
    settings,
    setSettings,
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
    isFineGraphLoading,
    setFineGraphLoading,
    showToolbar,
    setShowToolbar,
    cleanBookId,
    bookmarks,
    setBookmarks,
    bookmarksLoading,
    showBookmarkList,
    setShowBookmarkList,
    prevValidEventRef,
    prevElementsRef,
    prevChapterNumRef,
    prevEventNumRef,
    book,
    manifestLoaded,
    folderKey,
    elements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    graphEventNum,
    detectedMaxChapter,
    graphLoading,
    graphError,
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
    exitToMypage,
    graphState,
    graphActions,
    viewerState,
    searchState: EMPTY_VIEWER_SEARCH_STATE,
  };
}

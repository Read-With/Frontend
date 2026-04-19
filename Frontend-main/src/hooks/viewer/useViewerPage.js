import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useLocalStorage } from '../common/useLocalStorage';
import { useGraphDataLoader } from '../graph/useGraphDataLoader';
import { useServerBookMatching } from '../books/useServerBookMatching';
import { useBooksServerQuery } from '../books/useBooksServerQuery';
import { useViewerUrlParams } from './useViewerUrlParams';
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
import {
  pickReadingEvent,
  resolveViewerGraphEventFromManifest,
} from '../../utils/viewer/eventDisplayUtils';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getAnchorLocators = (anchor) => {
  const startLocator = anchor?.startLocator ?? anchor?.start ?? null;
  if (!startLocator) return { startLocator: null, endLocator: null };
  const endLocator = anchor?.endLocator ?? anchor?.end ?? startLocator;
  return { startLocator, endLocator };
};

const toAnchorPayload = (anchor) => {
  const { startLocator, endLocator } = getAnchorLocators(anchor);
  if (!startLocator) return null;
  if (anchor?.startLocator) return { startLocator, endLocator };
  return { start: startLocator, end: endLocator };
};

export function useViewerPage() {
  const { filename: bookId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const skipViewerHistoryMutationRef = useRef(false);

  useEffect(() => {
    skipViewerHistoryMutationRef.current = false;
  }, [bookId]);

  // 이전 페이지 정보 추출
  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/user/mypage' || location.state?.fromLibrary === true;
  
  // URL 파라미터 관리
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

  // 서버 책 매칭
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
  const lastViewerEventDebugKeyRef = useRef('');
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

  // 서버 bookId 추출 유틸리티 함수
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

  // 서버 bookId를 우선 사용, 없으면 URL 파라미터의 bookId 사용
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

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const reading = pickReadingEvent(currentEvent, prevValidEventRef.current);
    if (!reading) {
      lastViewerEventDebugKeyRef.current = '';
      return;
    }
    const manifestBid = Number(getServerBookId(book)) || Number(bookId);
    const fromManifest =
      manifestBid > 0
        ? resolveViewerGraphEventFromManifest(reading, manifestBid)
        : { eventId: '', manifestEvent: null };
    if (!fromManifest.eventId) {
      lastViewerEventDebugKeyRef.current = '';
      return;
    }
    const key = `${bookId}|${fromManifest.eventId}`;
    if (key === lastViewerEventDebugKeyRef.current) return;
    lastViewerEventDebugKeyRef.current = key;
    const me = fromManifest.manifestEvent;
    const meta =
      me && typeof me === 'object'
        ? {
            eventId: me.eventId,
            idx: me.idx,
            eventNum: me.eventNum ?? me.eventIdx,
            startTxtOffset: me.startTxtOffset,
            endTxtOffset: me.endTxtOffset,
          }
        : null;
    console.log('[뷰어 이벤트 위치]', {
      eventId: fromManifest.eventId,
      matched: !!fromManifest.manifestEvent,
      chapterIdx: fromManifest.chapterIdx || null,
      eventNum: fromManifest.eventNum || null,
      meta,
    });
  }, [bookId, currentEvent, book, getServerBookId]);

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

  const manifestServerBookId = useMemo(
    () => getServerBookId(book),
    [book?.id, book?._bookId, getServerBookId]
  );

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
    handleRemoveBookmark: _handleRemoveBookmark,
    handleBookmarkSelect,
    handleDeleteBookmark
  } = useBookmarks(cleanBookId, {
    viewerRef,
    setFailCount
  });
  
  // 페이지 변경 시 현재 챕터 번호 업데이트
  // handleLocationChange에서 locator 기반 챕터 업데이트와 중복 방지
  
  // currentChapter가 바뀔 때 즉시 상태 초기화
  const resetGraphTransientState = useCallback((initialChapterDetected) => {
    setCurrentEvent(null);
    setPrevEvent(null);
    setEvents([]);
    setCharacterData(null);
    setIsDataReady(false);
    setIsGraphLoading(true);
    prevValidEventRef.current = null;
    setIsInitialChapterDetected(initialChapterDetected);
  }, []);

  const waitForViewerMethod = useCallback(async (methodName, maxAttempts = 30, interval = 100) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
      if (viewerRef.current?.[methodName]) return true;
      await sleep(interval);
      attempts += 1;
    }
    return false;
  }, []);

  useEffect(() => {
    resetGraphTransientState(true);
  }, [currentChapter, resetGraphTransientState]);
  
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
        resetGraphTransientState(false);
        
        const flags = flagsFromGraphMode(loadViewerMode());
        if (flags) {
          setGraphFullScreen(flags.fullScreen);
          setShowGraph(flags.show);
        }
        
        // 새로고침 완료 후 일정 시간 후에 isReloading을 false로 설정
        const timer = setTimeout(() => {
          setIsReloading(false);
          setIsGraphLoading(false);
        }, 1000);
        
        return () => clearTimeout(timer);
      }
    }
  }, [resetGraphTransientState]);
  
  // currentEvent가 변경될 때마다 eventNum 업데이트
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

    // 뷰어가 준비될 때까지 대기 (최대 3초)
    let attempts = 0;
    while (attempts < 30) {
      if (await waitForViewerMethod('moveToProgress', 1, 100)) {
        try {
          await viewerRef.current.moveToProgress(value);
          return;
        } catch (e) {
          console.error('프로그레스 이동 실패:', e);
        }
      }
      attempts += 1;
    }

    // 최종 실패 시 경고만 표시 (새로고침하지 않음)
    console.warn('프로그레스 이동 실패: 뷰어가 준비되지 않았습니다.');
  }, [setProgress, viewerRef, waitForViewerMethod]);
  
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
        await waitForViewerMethod('applySettings', 20, 100);
        const locWrap = viewerRef.current?.getCurrentLocator?.();
        const start = locWrap?.startLocator ?? locWrap?.start;
        const end = locWrap?.endLocator ?? locWrap?.end ?? start;

        viewerRef.current?.applySettings?.();
        await sleep(150);

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
        await sleep(100);
      } catch (_e) {
        toast.error('화면 모드 전환 중 오류가 발생했습니다.');
      }
    };

    applyAndSync();
  }, [showGraph, settings, setSettings, viewerRef, waitForViewerMethod, progress]);
  
  const handleFitView = useCallback(() => {
    // TODO: 그래프 뷰 포커스 기능 구현 예정
  }, []);
  
  const handleLocationChange = useCallback(async () => {
    if (!viewerRef.current) return;
    try {
      const loc = await viewerRef.current.getCurrentLocator?.();
      const { startLocator: start } = getAnchorLocators(loc);
      if (start) {
        const anchor = toAnchorPayload(loc);
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
    manifestLoaded,
    
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
    exitToMypage,

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
    },
  };
}

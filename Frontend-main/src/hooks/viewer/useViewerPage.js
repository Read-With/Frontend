/** 뷰어 페이지: URL·책·북마크·설정·진도·그래프 파이프라인 오케스트레이션 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useServerBookMatching } from '../bookHooks';
import { useViewerProgress } from './useViewerProgress';
import { useProgressAutoSave } from './useProgressAutoSave';
import { useViewerGraphState } from './useViewerGraph';
import { useViewerGraphPipeline } from './useViewerGraphPipeline';
import { useManifestLoaded, useLatestRef, useBodyScrollLock } from '../common/hooksShared';
import { resolveServerBookId, resolveViewerBookKey } from '../../utils/common/bookNormalize';
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  waitForViewerMethod,
  runViewerPaging,
  restoreViewerPosition,
  parseReadingLocatorKey,
} from '../../utils/viewer/viewerSession';
import { normalizeStartEndLocatorsForServer } from '../../utils/common/cache/progressCache';
import { bookmarkPositionKey } from '../../utils/bookmarkUtils';
import { resolveChapterIndex, errorUtils, toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import { toViewerResumeAnchor } from '../../utils/common/locator';
import { useBookmarks } from '../bookmarkHooks';
import {
  parseViewerReaderSplat,
  resolveViewerReadingPosition,
  userViewerReadingPath,
  userViewerBookmarksPath,
} from '../../utils/common/urlUtils';

const BOOK_PATH_KEYS = ['xhtmlPath', 'filePath', 's3Path', 'fileUrl'];

function bookWithoutStoredPaths(base, overrides = {}) {
  const next = { ...base, ...overrides };
  for (const key of BOOK_PATH_KEYS) next[key] = undefined;
  return next;
}

function makeLoadedBook(base, bookId, resolvedBookId) {
  return bookWithoutStoredPaths(base, {
    filename: String(resolvedBookId ?? bookId),
    _needsLoad: true,
    _bookId: resolvedBookId,
  });
}

/** 라우트 state·서버 매칭 결과로 뷰어용 book 객체 생성 */
function createBookObject({ stateBook, matchedServerBook, serverBook, bookId, loadingServerBook }) {
  if (matchedServerBook && typeof matchedServerBook.id === 'number') {
    return makeLoadedBook(matchedServerBook, bookId, matchedServerBook.id);
  }

  if (stateBook) {
    if (serverBook && typeof serverBook.id === 'number') {
      return makeLoadedBook({ ...stateBook, ...serverBook }, bookId, serverBook.id);
    }

    const { xhtmlFile: _xf, xhtmlArrayBuffer: _xb, ...stateRest } = stateBook;
    return makeLoadedBook(stateRest, bookId, stateBook._bookId || stateBook.id || bookId);
  }

  if (serverBook) {
    return makeLoadedBook(serverBook, bookId, serverBook.id);
  }

  const numericBookId = toPositiveNumberOrNull(bookId);
  const resolvedId = loadingServerBook ? null : numericBookId;
  return {
    title: loadingServerBook ? '로딩 중...' : `Book ${bookId}`,
    filename: bookId,
    id: resolvedId,
    _needsLoad: true,
    _bookId: resolvedId ?? bookId,
    xhtmlPath: undefined,
  };
}

const EVENT_TRANSITION_FALLBACK_MS = 50;
const IDLE_TRANSITION = { type: null, inProgress: false };
const SETTINGS_SAVE_ERROR_MESSAGE = '설정 저장 중 오류가 발생했습니다.';

function reportSettingsSaveFailure(result) {
  if (result.success) return true;
  const message = result.message || SETTINGS_SAVE_ERROR_MESSAGE;
  errorUtils.logWarning('useViewerPage', message, { action: 'saveSettings' });
  toast.error(message);
  return false;
}

function resolveResumeChapter(resumeAnchor) {
  return resolveChapterIndex(resumeAnchor?.startLocator ?? resumeAnchor?.start);
}

/** URL: `/user/viewer/:id/c/:chapter/p/:page` 동기화 */
function useViewerUrlParams() {
  const { filename, '*': splat } = useParams();

  const parsedPath = useMemo(() => parseViewerReaderSplat(splat), [splat]);
  const readingPosition = useMemo(
    () => resolveViewerReadingPosition(parsedPath),
    [parsedPath]
  );

  const [currentPage, setCurrentPage] = useState(readingPosition.page);
  const [currentChapter, setCurrentChapter] = useState(readingPosition.chapter);

  const internalNavigationRef = useRef(false);
  const initializedBookRef = useRef(null);
  const positionRef = useRef(readingPosition);

  useEffect(() => {
    positionRef.current = { chapter: currentChapter, page: currentPage };
  }, [currentChapter, currentPage]);

  // URL(splat) → chapter/page. 내부 navigate로 바뀐 URL은 역동기화 스킵
  useEffect(() => {
    if (!filename) return;

    if (initializedBookRef.current !== filename) {
      initializedBookRef.current = filename;
      setCurrentChapter(readingPosition.chapter);
      setCurrentPage(readingPosition.page);
      return;
    }

    if (internalNavigationRef.current) {
      internalNavigationRef.current = false;
      return;
    }

    const { chapter, page } = positionRef.current;
    if (readingPosition.chapter !== chapter) setCurrentChapter(readingPosition.chapter);
    if (readingPosition.page !== page) setCurrentPage(readingPosition.page);
  }, [filename, readingPosition]);

  return {
    bookId: filename,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
    internalNavigationRef,
  };
}

/** chapter/page → URL (replace). resume 완료 전·mypage 이탈 중에는 생략 */
function useViewerUrlWrite({
  bookId,
  currentChapter,
  currentPage,
  enabled,
  skipHistoryMutationsRef,
  internalNavigationRef,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const targetReadingPath = useMemo(() => {
    if (!bookId) return null;
    return userViewerReadingPath(bookId, currentChapter, currentPage);
  }, [bookId, currentChapter, currentPage]);

  useEffect(() => {
    if (!targetReadingPath || !enabled) return;
    if (skipHistoryMutationsRef.current) return;
    if (location.pathname === targetReadingPath) return;
    internalNavigationRef.current = true;
    navigate(targetReadingPath, { replace: true });
  }, [
    targetReadingPath,
    location.pathname,
    navigate,
    enabled,
    skipHistoryMutationsRef,
    internalNavigationRef,
  ]);
}

/** 챕터/이벤트 전환 상태 */
function useViewerTransition({ currentEvent, currentChapter, isDataReady }) {
  const [transitionState, setTransitionState] = useState(IDLE_TRANSITION);
  const prevEventRef = useRef(null);
  const [prevChapter, setPrevChapter] = useState(currentChapter);

  const resetTransition = useCallback(() => {
    setTransitionState((prev) => (
      prev.type == null && !prev.inProgress ? prev : IDLE_TRANSITION
    ));
  }, []);

  useEffect(() => {
    let timeoutId = null;
    const prev = prevEventRef.current;

    if (
      currentEvent &&
      prev &&
      (prev.eventNum !== currentEvent.eventNum || prev.chapter !== currentEvent.chapter)
    ) {
      setTransitionState({ type: 'event', inProgress: true });
      timeoutId = setTimeout(resetTransition, EVENT_TRANSITION_FALLBACK_MS);
    }

    if (currentEvent) prevEventRef.current = currentEvent;

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [currentEvent, resetTransition]);

  // 렌더 중 조정: 챕터 전환 시작 / 데이터 준비 시 종료
  if (prevChapter !== currentChapter) {
    setPrevChapter(currentChapter);
    if (prevChapter != null) setTransitionState({ type: 'chapter', inProgress: true });
  } else if (
    isDataReady &&
    transitionState.inProgress &&
    (transitionState.type === 'event' || transitionState.type === 'chapter')
  ) {
    setTransitionState(IDLE_TRANSITION);
  }

  return { transitionState, resetTransition };
}

function resolveMypagePath() {
  const prefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${prefix}/mypage`.replace(/\/{2,}/g, '/');
}

function usePersistedViewerSettings() {
  const [settings, setSettingsState] = useState(() => loadSettings());

  const setSettings = useCallback((value) => {
    let saveResult = { success: true };
    setSettingsState((prev) => {
      const next = normalizeSettings(typeof value === 'function' ? value(prev) : value);
      saveResult = saveSettings(next);
      return saveResult.success ? next : prev;
    });
    return saveResult;
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== SETTINGS_STORAGE_KEY || e.newValue == null) return;
      try {
        setSettingsState(normalizeSettings(JSON.parse(e.newValue)));
      } catch (err) {
        errorUtils.logDebug('useViewerPage', '설정 storage 동기화 파싱 실패', {
          message: err?.message,
        });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [settings, setSettings];
}

/**
 * 툴바 북마크: 현재 위치 북마크 여부 · 추가(이미 있으면 삭제 확인) · 삭제 확인 다이얼로그 상태
 * @returns {{ isBookmarked: boolean, onAdd: Function, deleteConfirm: { isOpen, busy, onClose, onConfirm } }}
 */
function useViewerBookmarks({ serverBookId, bookKey, readingLocatorKey, viewerRef, setFailCount }) {
  const { bookmarks, handleAddBookmark, removeBookmark, isMutating } =
    useBookmarks(serverBookId, { viewerRef, setFailCount });
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // 북마크 위치 키는 목록이 바뀔 때만 계산 — 읽는 위치가 바뀔 때마다 목록 전체를 비교하지 않음 (O(B) → O(1))
  const bookmarkPositionKeys = useMemo(
    () => new Set((bookmarks || []).map(bookmarkPositionKey).filter(Boolean)),
    [bookmarks]
  );

  const isBookmarked = useMemo(() => {
    if (!bookmarkPositionKeys.size || !readingLocatorKey || !bookKey) return false;
    const { start, end } = parseReadingLocatorKey(readingLocatorKey);
    if (!start) return false;
    const { startLocator, endLocator } = normalizeStartEndLocatorsForServer(bookKey, start, end ?? start);
    if (!startLocator) return false;
    return bookmarkPositionKeys.has(
      bookmarkPositionKey({ startLocator, endLocator: endLocator ?? startLocator })
    );
  }, [bookmarkPositionKeys, readingLocatorKey, bookKey]);

  const onAdd = useCallback(async () => {
    const result = await handleAddBookmark();
    if (result?.needsConfirm) setDeleteConfirmId(result.bookmarkId);
  }, [handleAddBookmark]);

  const closeDeleteConfirm = useCallback(() => setDeleteConfirmId(null), []);

  const confirmDelete = useCallback(async () => {
    if (deleteConfirmId == null) return;
    try {
      await removeBookmark(deleteConfirmId);
      setDeleteConfirmId(null);
    } catch (error) {
      errorUtils.logError('[ViewerPage] 북마크 삭제 실패', error, { bookmarkId: deleteConfirmId });
      toast.error('북마크 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, [deleteConfirmId, removeBookmark]);

  return {
    isBookmarked,
    onAdd,
    deleteConfirm: {
      isOpen: deleteConfirmId != null,
      busy: isMutating,
      onClose: closeDeleteConfirm,
      onConfirm: confirmDelete,
    },
  };
}

export function useViewerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const skipViewerHistoryMutationRef = useRef(false);
  const viewerRef = useRef(null);

  const {
    bookId,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
    internalNavigationRef,
  } = useViewerUrlParams();

  useEffect(() => {
    skipViewerHistoryMutationRef.current = false;
  }, [bookId]);


  const {
    serverBook,
    loadingServerBook,
    matchedServerBook,
  } = useServerBookMatching(bookId, { skipBookIdRedirectRef: skipViewerHistoryMutationRef });

  const [reloadKey, setReloadKey] = useState(0);
  const failCountRef = useRef(0);
  const setFailCount = useCallback((value) => {
    failCountRef.current = typeof value === 'function' ? value(failCountRef.current) : value;
    if (failCountRef.current >= 2) {
      toast.info('계속 실패하면 브라우저를 새로고침해 주세요.');
    }
  }, []);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [settings, setSettings] = usePersistedViewerSettings();

  const book = useMemo(
    () =>
      createBookObject({
        stateBook: location.state?.book,
        matchedServerBook,
        serverBook,
        bookId,
        loadingServerBook,
      }),
    [location.state?.book, matchedServerBook, bookId, serverBook, loadingServerBook]
  );

  const bookKey = useMemo(
    () => resolveViewerBookKey(book, bookId) || null,
    [book, bookId]
  );

  const {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    dispatchGraphLoad,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  } = useViewerGraphState({
    currentChapter,
    bookKey,
    showGraph: settings.showGraph,
  });

  // 서버 bookId (manifest·북마크 공용). 없으면 라우트 id가 숫자일 때 그 값
  const serverBookId = useMemo(
    () => resolveServerBookId(book, bookId),
    [book, bookId]
  );
  const { loaded: manifestLoaded, ready: manifestReady } = useManifestLoaded(serverBookId);

  const preferredResumeAnchor = useMemo(
    () => toViewerResumeAnchor(location.state?.resumeAnchor),
    [location.state]
  );

  const clearPreferredResumeAnchor = useCallback(() => {
    if (!location.state?.resumeAnchor) return;
    const { resumeAnchor: _removed, ...rest } = location.state;
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: Object.keys(rest).length ? rest : undefined }
    );
  }, [location.pathname, location.search, location.state, navigate]);

  const {
    progress,
    setProgress,
    progressTopBar,
    setProgressTopBar,
    progressMetricsReady,
    readingLocatorKey,
    serverResumeAnchor,
    applyReadingLocator,
    markViewerPageReady,
    isViewerPageReady,
    isResumePending,
  } = useViewerProgress({
    bookKey,
    manifestLoaded,
    setReloadKey,
    viewerRef,
    reloadKey,
    preferredResumeAnchor,
    onPreferredResumeApplied: clearPreferredResumeAnchor,
    // 숫자 bookId가 아직 없을 때만 매칭 대기 (이미 숫자면 진도 fetch를 막지 않음)
    awaitingBookId: Boolean(
      loadingServerBook && bookKey && !(Number(bookKey) > 0)
    ),
  });

  const progressRef = useLatestRef(progress);
  const resumeAnchor = preferredResumeAnchor ?? serverResumeAnchor;

  // resume 완료 전 URL 챕터를 앵커 기준으로 시드 (urlSync 켜질 때 c/1로 튕기지 않도록)
  useEffect(() => {
    if (isViewerPageReady) return;
    const chapter = resolveResumeChapter(resumeAnchor);
    if (!(Number.isFinite(chapter) && chapter > 0)) return;
    setCurrentChapter((prev) => (prev === chapter ? prev : chapter));
  }, [resumeAnchor, isViewerPageReady, setCurrentChapter]);

  useViewerUrlWrite({
    bookId,
    currentChapter,
    currentPage,
    enabled: isViewerPageReady,
    skipHistoryMutationsRef: skipViewerHistoryMutationRef,
    internalNavigationRef,
  });

  const { transitionState, resetTransition } = useViewerTransition({
    currentEvent,
    currentChapter,
    isDataReady: graphViewerState.isDataReady,
  });

  const { graphApiError } = useViewerGraphPipeline({
    book,
    currentChapter,
    currentEvent,
    manifestLoaded: manifestReady,
    isViewerPageReady,
    resetTransition,
    setElements,
    setEvents,
    dispatchGraphLoad,
  });

  const { cachedLocation, flushProgressAsync } = useProgressAutoSave({
    bookId: bookKey,
    currentEvent,
    readingLocatorKey,
    getCurrentLocator: () => viewerRef.current?.getCurrentLocator?.(),
    metricsReady: progressMetricsReady,
    canPersist: isViewerPageReady,
  });

  const bookmarkUi = useViewerBookmarks({
    serverBookId,
    bookKey,
    readingLocatorKey,
    viewerRef,
    setFailCount,
  });

  useBodyScrollLock();

  const handleApplySettings = useCallback(
    (newSettings) => {
      let graphChanged = false;
      const result = setSettings((prev) => {
        const next = typeof newSettings === 'function' ? newSettings(prev) : newSettings;
        graphChanged = Boolean(next?.showGraph) !== Boolean(prev.showGraph);
        return next;
      });
      if (!reportSettingsSaveFailure(result)) return;
      if (graphChanged) setReloadKey((k) => k + 1);
      toast.success('설정이 적용되었습니다');
    },
    [setSettings]
  );

  /** 분할/전체화면/탭·그래프 토글 등 레이아웃 전환 후 본문 진도 위치 복원 */
  const restoreAfterViewerLayoutChange = useCallback(async () => {
    try {
      const ready = await waitForViewerMethod(viewerRef, 'refreshLayout');
      if (!ready) return false;
      await restoreViewerPosition(viewerRef, progressRef.current);
      return true;
    } catch (err) {
      errorUtils.logWarning('useViewerPage', '레이아웃 전환 후 위치 복원 실패', {
        action: 'restoreAfterLayout',
        message: err?.message,
      });
      return false;
    }
  }, [progressRef]);

  const toggleGraph = useCallback(async () => {
    const result = setSettings((prev) => ({ ...prev, showGraph: !prev.showGraph }));
    if (!reportSettingsSaveFailure(result)) return;

    const restored = await restoreAfterViewerLayoutChange();
    if (!restored) {
      toast.error('보기 방식 전환 중 오류가 발생했습니다.');
    }
  }, [setSettings, restoreAfterViewerLayoutChange]);

  const handleSliderChange = useCallback(async (value) => {
    setProgress(value);
    const ready = await waitForViewerMethod(viewerRef, 'moveToProgress');
    if (!ready) return;
    try {
      await viewerRef.current.moveToProgress(value);
    } catch (err) {
      errorUtils.logDebug('useViewerPage', '진도 슬라이더 seek 실패', {
        message: err?.message,
        value,
      });
    }
  }, [setProgress]);

  const onToggleBookmarkList = useCallback(() => {
    const path = userViewerBookmarksPath(serverBookId);
    if (!path) {
      errorUtils.logWarning('useViewerPage', '북마크 목록 경로 생성 실패', {
        action: 'openBookmarks',
        bookId: serverBookId ?? bookId,
      });
      toast.error('책 정보가 없어 북마크 목록을 열 수 없습니다.');
      return;
    }
    navigate(path, {
      state: { ...(location.state || {}), book },
    });
  }, [navigate, serverBookId, bookId, location.state, book]);

  const openSettings = useCallback(() => setShowSettingsModal(true), []);
  const closeSettings = useCallback(() => setShowSettingsModal(false), []);

  const exitToMypage = useCallback(() => {
    skipViewerHistoryMutationRef.current = true;
    navigate(resolveMypagePath(), { replace: true });
  }, [navigate]);

  const handlePrevPage = useCallback(() => runViewerPaging(viewerRef, 'prev'), []);
  const handleNextPage = useCallback(() => runViewerPaging(viewerRef, 'next'), []);

  const graphStateWithProgress = useMemo(
    () => ({ ...graphState, progressTopBar, progressMetricsReady }),
    [graphState, progressTopBar, progressMetricsReady]
  );

  const viewerState = useMemo(
    () => ({
      bookKey,
      routeBookId: bookId,
      book,
      currentPage,
      totalPages,
      progress,
      settings,
      showToolbar,
      ...graphViewerState,
    }),
    [
      bookKey,
      bookId,
      book,
      currentPage,
      totalPages,
      progress,
      settings,
      showToolbar,
      graphViewerState,
    ]
  );

  return {
    viewerRef,
    reloadKey,
    // 툴바·다이얼로그 묶음
    bookmarkUi: { ...bookmarkUi, onOpenList: onToggleBookmarkList },
    settingsUi: {
      isOpen: showSettingsModal,
      open: openSettings,
      close: closeSettings,
      apply: handleApplySettings,
    },
    setCurrentPage,
    setTotalPages,
    setCurrentChapter,
    setCurrentEvent,
    setShowToolbar,
    manifestLoaded,
    handlePrevPage,
    handleNextPage,
    handleSliderChange,
    toggleGraph,
    restoreAfterViewerLayoutChange,
    exitToMypage,
    graphStateWithProgress,
    graphActions,
    viewerState,
    searchState,
    searchActions,
    setProgressTopBar,
    serverResumeAnchor: resumeAnchor,
    applyReadingLocator,
    markViewerPageReady,
    isViewerPageReady,
    isResumePending,
    cachedLocation,
    transitionState,
    graphApiError,
    flushProgressAsync,
  };
}

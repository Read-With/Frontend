/** 뷰어 페이지: URL·책·북마크·설정·진도·그래프 파이프라인 오케스트레이션 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useServerBookMatching } from '../books/bookHooks';
import { useViewerUrlParams } from './useViewerUrlParams';
import { useViewerGraphState } from './useViewerGraphState';
import { useViewerProgress } from './useViewerProgress';
import { useViewerTransition } from './useViewerTransition';
import { useViewerGraphPipeline } from './useViewerGraphPipeline';
import { useProgressAutoSave } from './useProgressAutoSave';
import { useManifestLoaded } from '../common/manifestEnsure';
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from '../../utils/common/settingsUtils';
import {
  bookUtils,
  waitForViewerMethod,
} from '../../utils/viewer/viewerCoreStateUtils';
import {
  runViewerPaging,
  restoreViewerPosition,
} from '../../utils/viewer/viewerPageNavUtils';
import { resolveServerBookIdOrFallback, resolveViewerBookKey } from '../common/hooksShared';
import { toViewerResumeAnchor } from '../../utils/common/locatorUtils';
import { resolveChapterIndex } from '../../utils/common/valueUtils';
import { useBookmarks } from '../bookmarks/bookmarkHooks';
import { userViewerBookmarksPath } from '../../utils/navigation/viewerPaths';

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
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [settings, setSettings];
}

export function useViewerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const skipViewerHistoryMutationRef = useRef(false);
  const viewerRef = useRef(null);

  const [urlSyncEnabled, setUrlSyncEnabled] = useState(false);

  const {
    filename: bookId,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
  } = useViewerUrlParams({
    skipHistoryMutationsRef: skipViewerHistoryMutationRef,
    urlSyncEnabled,
  });

  useEffect(() => {
    skipViewerHistoryMutationRef.current = false;
    setUrlSyncEnabled(false);
  }, [bookId]);

  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/mypage' || location.state?.fromLibrary === true;

  const {
    serverBook,
    loadingServerBook,
    matchedServerBook,
  } = useServerBookMatching(bookId, { skipBookIdRedirectRef: skipViewerHistoryMutationRef });

  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [progress, setProgress] = useState(null);
  const [settings, setSettings] = usePersistedViewerSettings();

  const book = useMemo(
    () =>
      bookUtils.createBookObject({
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

  useEffect(() => {
    setProgress(null);
  }, [bookKey]);

  const {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    setIsDataReady,
    setIsGraphLoading,
    setFineGraphLoading,
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

  const manifestServerBookId = useMemo(
    () => resolveServerBookIdOrFallback(book, bookId),
    [book, bookId]
  );
  const manifestLoaded = useManifestLoaded(manifestServerBookId);

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
    progress,
    setProgress,
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

  const effectiveResumeAnchor = preferredResumeAnchor ?? serverResumeAnchor;

  // resume 완료 전 URL 챕터를 앵커 기준으로 시드 (urlSync 켜질 때 c/1로 튕기지 않도록)
  useEffect(() => {
    if (isViewerPageReady) return;
    const chapter = resolveChapterIndex(
      effectiveResumeAnchor?.startLocator ?? effectiveResumeAnchor?.start
    );
    if (!(Number.isFinite(chapter) && chapter > 0)) return;
    setCurrentChapter((prev) => (prev === chapter ? prev : chapter));
  }, [effectiveResumeAnchor, isViewerPageReady, setCurrentChapter]);

  useEffect(() => {
    setUrlSyncEnabled(isViewerPageReady);
  }, [isViewerPageReady]);

  const { isDataReady } = graphViewerState;

  const { transitionState, resetTransition } = useViewerTransition({
    currentEvent,
    currentChapter,
    isDataReady,
  });

  const { graphApiError } = useViewerGraphPipeline({
    book,
    currentChapter,
    currentEvent,
    setIsDataEmpty: graphActions.setIsDataEmpty,
    manifestLoaded,
    isViewerPageReady,
    resetTransition,
    setElements,
    setEvents,
    setIsGraphLoading,
    setFineGraphLoading,
    setIsDataReady,
  });

  const { cachedLocation, flushProgressAsync } = useProgressAutoSave({
    bookId: bookKey,
    currentEvent,
    readingLocatorKey,
    getCurrentLocator: () => viewerRef.current?.getCurrentLocator?.(),
    metricsReady: progressMetricsReady,
    canPersist: isViewerPageReady,
  });

  const {
    bookmarks,
    handleAddBookmark,
    removeBookmark,
    isMutating: isBookmarkMutating,
  } = useBookmarks(bookKey, { viewerRef, setFailCount });

  useEffect(() => {
    if (failCount >= 2) {
      toast.info('계속 실패하면 브라우저를 새로고침해 주세요.');
    }
  }, [failCount]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  const handleApplySettings = useCallback(
    (newSettings) => {
      const normalized = normalizeSettings(newSettings);
      const graphChanged = normalized.showGraph !== settings.showGraph;
      const result = setSettings(normalized);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (graphChanged) setReloadKey((k) => k + 1);
      toast.success('설정이 적용되었습니다');
    },
    [settings.showGraph, setSettings]
  );

  const toggleGraph = useCallback(async () => {
    const newShowGraph = !settings.showGraph;
    const result = setSettings((prev) => ({ ...prev, showGraph: newShowGraph }));
    if (!result.success) {
      toast.error(result.message || '설정 저장 중 오류가 발생했습니다.');
      return;
    }

    try {
      const ready = await waitForViewerMethod(viewerRef, 'refreshLayout');
      if (!ready) return;
      await restoreViewerPosition(viewerRef, progress);
    } catch {
      toast.error('화면 모드 전환 중 오류가 발생했습니다.');
    }
  }, [settings.showGraph, setSettings, progress]);

  const handleSliderChange = useCallback(async (value) => {
    setProgress(value);
    const ready = await waitForViewerMethod(viewerRef, 'moveToProgress');
    if (!ready) return;
    try {
      await viewerRef.current.moveToProgress(value);
    } catch {
      /* ignore seek errors */
    }
  }, []);

  const onToggleBookmarkList = useCallback(() => {
    navigate(userViewerBookmarksPath(bookKey || bookId), {
      state: { ...(location.state || {}), book },
    });
  }, [navigate, bookKey, bookId, location.state, book]);

  const exitToMypage = useCallback(() => {
    skipViewerHistoryMutationRef.current = true;
    navigate(resolveMypagePath(), { replace: true });
  }, [navigate]);

  const handlePrevPage = useCallback(() => runViewerPaging(viewerRef, 'prev'), []);
  const handleNextPage = useCallback(() => runViewerPaging(viewerRef, 'next'), []);
  const handleOpenSettings = useCallback(() => setShowSettingsModal(true), []);
  const handleCloseSettings = useCallback(() => setShowSettingsModal(false), []);

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
    showSettingsModal,
    setProgress,
    setCurrentPage,
    setTotalPages,
    setCurrentChapter,
    setCurrentEvent,
    setShowToolbar,
    bookmarks,
    book,
    bookKey,
    manifestLoaded,
    previousPage,
    isFromLibrary,
    handlePrevPage,
    handleNextPage,
    handleAddBookmark,
    removeBookmark,
    isBookmarkMutating,
    handleOpenSettings,
    handleCloseSettings,
    handleApplySettings,
    onToggleBookmarkList,
    handleSliderChange,
    toggleGraph,
    exitToMypage,
    graphState,
    graphStateWithProgress,
    graphActions,
    viewerState,
    searchState,
    searchActions,
    setProgressTopBar,
    progressMetricsReady,
    readingLocatorKey,
    serverResumeAnchor: effectiveResumeAnchor,
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

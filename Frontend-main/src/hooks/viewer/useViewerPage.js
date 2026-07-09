/** 뷰어 페이지: URL·책·북마크·설정·진도·그래프 파이프라인 오케스트레이션 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useLocalStorage } from '../common/useLocalStorage';
import { useServerBookMatching } from '../books/bookHooks';
import { useViewerUrlParams } from './useViewerUrlParams';
import { useViewerManifest } from './useViewerManifest';
import { useViewerGraphState } from './useViewerGraphState';
import { useViewerProgress } from './useViewerProgress';
import { useViewerTransition } from './useViewerTransition';
import { useViewerGraphPipeline } from './useViewerGraphPipeline';
import { useProgressAutoSave } from './useProgressAutoSave';
import { defaultSettings, settingsUtils } from '../../utils/common/settingsUtils';
import {
  bookUtils,
  waitForPaint,
  waitForViewerMethod,
} from '../../utils/viewer/viewerCoreStateUtils';
import { resolveServerBookIdOrFallback, resolveViewerBookKey } from '../common/hooksShared';
import { anchorToLocators } from '../../utils/common/locatorUtils';
import { getFolderKeyFromFilename } from '../../utils/graph/graphData';
import { useBookmarks } from '../bookmarks/bookmarkHooks';
import { userViewerBookmarksPath } from '../../utils/navigation/viewerPaths';
import { debugChapterGraphFromServer } from '../../utils/viewer/debugChapterGraph';

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
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
  } = useViewerUrlParams({ skipHistoryMutationsRef: skipViewerHistoryMutationRef });

  const {
    serverBook,
    loadingServerBook,
    matchedServerBook
  } = useServerBookMatching(bookId, { skipBookIdRedirectRef: skipViewerHistoryMutationRef });

  const viewerRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

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

  const [progress, setProgress] = useState(null);
  const [settings, setSettings] = useLocalStorage('xhtml_viewer_settings', defaultSettings);

  const folderKey = useMemo(() => getFolderKeyFromFilename(bookId), [bookId]);

  useEffect(() => {
    setProgress(null);
  }, [bookKey]);

  const {
    currentEvent,
    setCurrentEvent,
    setEvents,
    setElements,
    setGraphViewState,
    setCurrentCharIndex,
    setIsDataReady,
    setIsGraphLoading,
    setFineGraphLoading,
    setShowGraph,
    graphState,
    graphActions,
    graphViewerState,
    searchState,
    searchActions,
  } = useViewerGraphState({ currentChapter, setCurrentChapter, bookKey });

  const manifestServerBookId = useMemo(
    () => resolveServerBookIdOrFallback(book, bookId),
    [book, bookId]
  );

  const { manifestLoaded } = useViewerManifest(manifestServerBookId);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const serverBookId = book?.id ?? manifestServerBookId;
    if (!manifestLoaded || !serverBookId) return;

    const readwith = window.__readwith ?? (window.__readwith = {});
    readwith.debugChapterGraph = (chapterIdx = 1, options) =>
      debugChapterGraphFromServer(serverBookId, chapterIdx, options);
  }, [manifestLoaded, book?.id, manifestServerBookId]);

  const {
    progressTopBar,
    setProgressTopBar,
    progressMetricsReady,
    readingLocatorKey,
    serverResumeAnchor,
    applyReadingLocator,
    updateReadingPercent,
    markViewerPageReady,
    isViewerPageReady,
  } = useViewerProgress({
    bookKey,
    manifestLoaded,
    progress,
    setProgress,
    setReloadKey,
    viewerRef,
    reloadKey,
  });

  const { fineGraphLoading, graphPhase, isDataReady } = graphViewerState;

  const { transitionState, resetTransition } = useViewerTransition({
    currentEvent,
    currentChapter,
    fineGraphLoading,
    isReloading: graphPhase === 'reloading',
    graphPhase,
    isDataReady,
  });

  const { graphApiError } = useViewerGraphPipeline({
    book,
    currentChapter,
    currentEvent,
    graphActions,
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
  });

  const graphStateWithProgress = useMemo(
    () => ({ ...graphState, progressTopBar, progressMetricsReady }),
    [graphState, progressTopBar, progressMetricsReady]
  );

  useEffect(() => {
    if (failCount >= 2) {
      toast.info('🔄 계속 실패하면 브라우저 새로고침을 해주세요!');
    }
  }, [failCount]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  const {
    bookmarks,
    showBookmarkList,
    handleAddBookmark,
    handleBookmarkSelect,
  } = useBookmarks(bookKey, {
    viewerRef,
    setFailCount
  });

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
      bookKey
    );

    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  }, [settings, bookKey, setShowGraph]);

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
    const ready = await waitForViewerMethod(viewerRef, 'moveToProgress');
    if (!ready) {
      return;
    }
    try {
      await viewerRef.current.moveToProgress(value);
    } catch {}
  }, []);

  const toggleGraph = useCallback(() => {
    setShowGraph((prevShowGraph) => {
      const newShowGraph = !prevShowGraph;
      setSettings((prevSettings) => ({
        ...prevSettings,
        showGraph: newShowGraph,
      }));
      return newShowGraph;
    });

    const applyAndSync = async () => {
      try {
        await waitForViewerMethod(viewerRef, 'applySettings');
        const { startLocator: start, endLocator: end } = anchorToLocators(
          viewerRef.current?.getCurrentLocator?.()
        );

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
      } catch {
        toast.error('화면 모드 전환 중 오류가 발생했습니다.');
      }
    };

    applyAndSync();
  }, [setSettings, setShowGraph, progress]);

  const exitToMypage = useCallback(() => {
    skipViewerHistoryMutationRef.current = true;
    const prefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const path = `${prefix}/mypage`.replace(/\/{2,}/g, '/');
    navigate(path, { replace: true });
  }, [navigate]);

  const viewerState = useMemo(
    () => ({
      bookKey,
      routeBookId: bookId,
      navigate,
      viewerRef,
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
      navigate,
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
    setGraphViewState,
    setCurrentCharIndex,
    setShowToolbar,
    bookmarks,
    showBookmarkList,
    book,
    bookKey,
    manifestLoaded,
    folderKey,
    previousPage,
    isFromLibrary,
    handlePrevPage,
    handleNextPage,
    handleAddBookmark,
    handleBookmarkSelect,
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
    serverResumeAnchor,
    applyReadingLocator,
    updateReadingPercent,
    markViewerPageReady,
    cachedLocation,
    transitionState,
    graphApiError,
    flushProgressAsync,
  };
}

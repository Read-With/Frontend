import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { loadViewerMode, loadSettings } from '../../utils/viewer/viewerUtils';
import { flagsFromGraphMode } from './graphModeFlags';
import {
  parseViewerReaderSplat,
  userViewerReadingPath,
} from '../../utils/navigation/viewerPaths';

/**
 * 뷰어 URL: `/user/viewer/:id` 또는 `/user/viewer/:id/c/:chapter/p/:page` (쿼리 없음).
 * chapter/page/graphMode는 graphMode만 스토리지; 읽기 위치는 경로와 상태로 동기화.
 */
export function useViewerUrlParams(options = {}) {
  const { skipHistoryMutationsRef } = options;
  const { filename, '*': splat } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const initialGraphMode = useMemo(() => {
    return (
      flagsFromGraphMode(loadViewerMode()) ?? {
        fullScreen: false,
        show: loadSettings().showGraph,
      }
    );
  }, []);

  const parsedPath = useMemo(() => parseViewerReaderSplat(splat), [splat]);
  const readingFromPath = parsedPath != null;

  const [currentPage, setCurrentPage] = useState(() => parsedPath?.page ?? 1);
  const [currentChapter, setCurrentChapter] = useState(() => parsedPath?.chapter ?? 1);
  const internalNavigationRef = useRef(false);
  const initializedBookRef = useRef(null);

  const currentChapterRef = useRef(1);
  const currentPageRef = useRef(1);

  useEffect(() => {
    currentChapterRef.current = currentChapter;
  }, [currentChapter]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    if (!filename) return;
    const isBookChanged = initializedBookRef.current !== filename;
    if (isBookChanged) {
      initializedBookRef.current = filename;
      if (parsedPath) {
        setCurrentChapter(parsedPath.chapter);
        setCurrentPage(parsedPath.page);
      } else {
        setCurrentChapter(1);
        setCurrentPage(1);
      }
      return;
    }

    // 내부 상태 변경으로 navigate 된 경우 URL -> 상태 역동기화로 덮어쓰지 않음
    if (internalNavigationRef.current) {
      internalNavigationRef.current = false;
      return;
    }

    // 외부 탐색(직접 URL 입력/뒤로가기)인 경우만 반영
    if (parsedPath) {
      if (parsedPath.chapter !== currentChapterRef.current) {
        setCurrentChapter(parsedPath.chapter);
      }
      if (parsedPath.page !== currentPageRef.current) {
        setCurrentPage(parsedPath.page);
      }
    }
  }, [filename, parsedPath?.chapter, parsedPath?.page]);

  const targetReadingPath = useMemo(() => {
    if (!filename) return null;
    return userViewerReadingPath(filename, currentChapter, currentPage);
  }, [filename, currentChapter, currentPage]);

  useEffect(() => {
    if (!targetReadingPath || !filename) return;
    if (skipHistoryMutationsRef?.current) return;
    if (location.pathname === targetReadingPath) return;
    internalNavigationRef.current = true;
    navigate(targetReadingPath, { replace: true });
  }, [targetReadingPath, location.pathname, navigate, filename, skipHistoryMutationsRef]);

  const updateURL = useCallback(() => {}, []);

  const prevUrlStateRef = useRef({
    chapter: null,
    page: null,
    graphMode: null,
  });

  const urlSearchParams = useMemo(
    () => ({ chapter: null, page: null, graphMode: null }),
    []
  );

  return {
    urlSearchParams,
    savedChapter: null,
    savedPage: null,
    savedGraphMode: null,
    initialGraphMode,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
    currentChapterRef,
    updateURL,
    prevUrlStateRef,
    readingFromPath,
  };
}

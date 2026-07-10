/** 뷰어 URL: `/user/viewer/:id/c/:chapter/p/:page` 경로 동기화 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  parseViewerReaderSplat,
  userViewerReadingPath,
} from '../../utils/navigation/viewerPaths';

const DEFAULT_READING_POSITION = { chapter: 1, page: 1 };

export function useViewerUrlParams(options = {}) {
  const { skipHistoryMutationsRef } = options;
  const { filename, '*': splat } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const parsedPath = useMemo(() => parseViewerReaderSplat(splat), [splat]);

  const [currentPage, setCurrentPage] = useState(() => parsedPath?.page ?? DEFAULT_READING_POSITION.page);
  const [currentChapter, setCurrentChapter] = useState(() => parsedPath?.chapter ?? DEFAULT_READING_POSITION.chapter);
  const internalNavigationRef = useRef(false);
  const initializedBookRef = useRef(null);

  const currentChapterRef = useRef(DEFAULT_READING_POSITION.chapter);
  const currentPageRef = useRef(DEFAULT_READING_POSITION.page);

  useEffect(() => {
    currentChapterRef.current = currentChapter;
    currentPageRef.current = currentPage;
  }, [currentChapter, currentPage]);

  useEffect(() => {
    if (!filename) return;

    const isBookChanged = initializedBookRef.current !== filename;
    if (isBookChanged) {
      initializedBookRef.current = filename;
      if (parsedPath) {
        setCurrentChapter(parsedPath.chapter);
        setCurrentPage(parsedPath.page);
      } else {
        setCurrentChapter(DEFAULT_READING_POSITION.chapter);
        setCurrentPage(DEFAULT_READING_POSITION.page);
      }
      return;
    }

    if (internalNavigationRef.current) {
      internalNavigationRef.current = false;
      return;
    }

    if (parsedPath) {
      if (parsedPath.chapter !== currentChapterRef.current) {
        setCurrentChapter(parsedPath.chapter);
      }
      if (parsedPath.page !== currentPageRef.current) {
        setCurrentPage(parsedPath.page);
      }
      return;
    }

    if (currentChapterRef.current !== DEFAULT_READING_POSITION.chapter) {
      setCurrentChapter(DEFAULT_READING_POSITION.chapter);
    }
    if (currentPageRef.current !== DEFAULT_READING_POSITION.page) {
      setCurrentPage(DEFAULT_READING_POSITION.page);
    }
  }, [filename, splat, parsedPath]);

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

  return {
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
  };
}

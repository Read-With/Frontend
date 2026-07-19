/** ?? URL: `/user/viewer/:id/c/:chapter/p/:page` ?? ??? */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  parseViewerReaderSplat,
  resolveViewerReadingPosition,
  userViewerReadingPath,
} from '../../utils/common/urlUtils';

export function useViewerUrlParams(options = {}) {
  const { skipHistoryMutationsRef, urlSyncEnabled = true } = options;
  const { filename, '*': splat } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const parsedPath = useMemo(() => parseViewerReaderSplat(splat), [splat]);
  const initialPosition = resolveViewerReadingPosition(parsedPath);

  const [currentPage, setCurrentPage] = useState(initialPosition.page);
  const [currentChapter, setCurrentChapter] = useState(initialPosition.chapter);

  const internalNavigationRef = useRef(false);
  const initializedBookRef = useRef(null);
  const positionRef = useRef(initialPosition);

  useEffect(() => {
    positionRef.current = { chapter: currentChapter, page: currentPage };
  }, [currentChapter, currentPage]);

  // URL(splat) ? ?? chapter/page. ?? navigate? ?? URL? ? ? ??
  useEffect(() => {
    if (!filename) return;

    const next = resolveViewerReadingPosition(parsedPath);

    if (initializedBookRef.current !== filename) {
      initializedBookRef.current = filename;
      setCurrentChapter(next.chapter);
      setCurrentPage(next.page);
      return;
    }

    if (internalNavigationRef.current) {
      internalNavigationRef.current = false;
      return;
    }

    const { chapter, page } = positionRef.current;
    if (next.chapter !== chapter) setCurrentChapter(next.chapter);
    if (next.page !== page) setCurrentPage(next.page);
  }, [filename, parsedPath]);

  const targetReadingPath = useMemo(() => {
    if (!filename) return null;
    return userViewerReadingPath(filename, currentChapter, currentPage);
  }, [filename, currentChapter, currentPage]);

  // ?? chapter/page ? URL (replace). resume ?? ?�mypage ?? ?? ??
  useEffect(() => {
    if (!targetReadingPath || !filename) return;
    if (!urlSyncEnabled) return;
    if (skipHistoryMutationsRef?.current) return;
    if (location.pathname === targetReadingPath) return;
    internalNavigationRef.current = true;
    navigate(targetReadingPath, { replace: true });
  }, [
    targetReadingPath,
    location.pathname,
    navigate,
    filename,
    skipHistoryMutationsRef,
    urlSyncEnabled,
  ]);

  return {
    filename,
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
  };
}

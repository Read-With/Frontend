/** 뷰어 URL: `/user/viewer/:id/c/:chapter/p/:page` 경로 동기화 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  parseViewerReaderSplat,
  resolveViewerReadingPosition,
  userViewerReadingPath,
} from '../../utils/navigation/viewerPaths';

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

  // URL(splat) → 로컬 chapter/page. 내부 navigate로 바뀐 URL은 한 번 무시
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

  // 로컬 chapter/page → URL (replace). resume 완료 전·mypage 퇴장 등은 차단
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

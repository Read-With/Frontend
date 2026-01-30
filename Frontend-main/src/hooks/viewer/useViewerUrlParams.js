import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { loadViewerMode, loadSettings } from '../../utils/viewerUtils';

/**
 * 뷰어 URL 파라미터 관리 훅
 * URL 쿼리 파라미터를 파싱하고 상태와 동기화합니다.
 * 
 * @returns {Object} URL 파라미터 관련 상태 및 함수
 */
export function useViewerUrlParams() {
  const location = useLocation();
  
  // URL 쿼리 파라미터 파싱
  const urlSearchParams = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      chapter: params.get('chapter'),
      page: params.get('page'),
      progress: params.get('progress'),
      graphMode: params.get('graphMode')
    };
  }, [location.search]);
  
  const savedChapter = urlSearchParams.chapter;
  const savedPage = urlSearchParams.page;
  const savedProgress = urlSearchParams.progress;
  const savedGraphMode = urlSearchParams.graphMode;
  
  // 초기 상태 계산
  const initialGraphMode = useMemo(() => {
    if (savedGraphMode === 'graph') return { fullScreen: true, show: true };
    if (savedGraphMode === 'split') return { fullScreen: false, show: true };
    if (savedGraphMode === 'viewer') return { fullScreen: false, show: false };
    
    const saved = loadViewerMode();
    if (saved === "graph") return { fullScreen: true, show: true };
    if (saved === "split") return { fullScreen: false, show: true };
    if (saved === "viewer") return { fullScreen: false, show: false };
    return { fullScreen: false, show: loadSettings().showGraph };
  }, [savedGraphMode]);
  
  // 초기 상태 설정
  const [currentPage, setCurrentPage] = useState(() => {
    return savedPage ? parseInt(savedPage, 10) : 1;
  });
  
  const [currentChapter, setCurrentChapter] = useState(() => {
    return savedChapter ? parseInt(savedChapter, 10) : 1;
  });
  
  const prevUrlChapterRef = useRef(savedChapter ? parseInt(savedChapter, 10) : null);
  const currentChapterRef = useRef(savedChapter ? parseInt(savedChapter, 10) : 1);
  
  // currentChapter 변경 시 ref 동기화
  useEffect(() => {
    currentChapterRef.current = currentChapter;
  }, [currentChapter]);
  
  // URL 파라미터 변경 시 currentChapter 업데이트
  useEffect(() => {
    const chapterParam = urlSearchParams.chapter;
    if (chapterParam) {
      const chapterNum = parseInt(chapterParam, 10);
      if (chapterNum && chapterNum > 0 && chapterNum !== currentChapterRef.current) {
        if (prevUrlChapterRef.current !== chapterNum) {
          prevUrlChapterRef.current = chapterNum;
          setCurrentChapter(chapterNum);
        }
      }
    } else {
      prevUrlChapterRef.current = null;
    }
  }, [urlSearchParams.chapter]);
  
  // URL 업데이트 함수
  const updateURL = useCallback((updates = {}) => {
    const currentParams = new URLSearchParams(location.search);
    
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
    
    const newURL = `${location.pathname}?${currentParams.toString()}`;
    window.history.replaceState({}, '', newURL);
  }, [location.pathname, location.search]);
  
  const prevUrlStateRef = useRef({
    chapter: null,
    page: null,
    progress: null,
    graphMode: null
  });
  
  return {
    // 파싱된 파라미터
    urlSearchParams,
    savedChapter,
    savedPage,
    savedProgress,
    savedGraphMode,
    initialGraphMode,
    
    // 상태
    currentPage,
    setCurrentPage,
    currentChapter,
    setCurrentChapter,
    currentChapterRef,
    
    // URL 업데이트
    updateURL,
    prevUrlStateRef
  };
}

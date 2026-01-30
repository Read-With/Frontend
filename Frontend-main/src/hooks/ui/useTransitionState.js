/**
 * useTransitionState.js : 전환 상태 관리 훅
 * 
 * [주요 기능]
 * 1. 챕터/이벤트 전환 상태 관리
 * 2. 전환 방향 추적 (forward/backward)
 * 3. 강제 이벤트 인덱스 관리 (챕터 전환 시)
 * 4. 전환 상태 자동 감지 및 업데이트
 * 
 * [사용처]
 * - ViewerPage: 챕터 및 이벤트 전환 상태 관리
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { transitionUtils } from '../../utils/viewerUtils';

/**
 * 전환 상태 관리 훅
 * @param {Object} params - 파라미터 객체
 * @param {Object} params.currentEvent - 현재 이벤트 객체
 * @param {number} params.currentChapter - 현재 챕터 번호
 * @param {boolean} params.loading - 로딩 상태
 * @param {boolean} params.isReloading - 리로딩 상태
 * @param {boolean} params.isGraphLoading - 그래프 로딩 상태
 * @param {boolean} params.isDataReady - 데이터 준비 상태
 * @returns {Object} 전환 상태 및 관리 함수들
 */
export function useTransitionState({
  currentEvent,
  currentChapter,
  loading,
  isReloading,
  isGraphLoading,
  isDataReady
}) {
  const [transitionState, setTransitionState] = useState({
    type: null,
    inProgress: false,
    error: false,
    direction: null
  });

  const isChapterTransitionRef = useRef(false);
  const chapterTransitionDirectionRef = useRef(null);
  const forcedChapterEventIdxRef = useRef(null);
  const prevEventRef = useRef(null);
  const prevChapterRef = useRef(null);

  // transitionState 변경 시 ref 업데이트
  useEffect(() => {
    if (transitionState.type === 'chapter') {
      isChapterTransitionRef.current = true;
      chapterTransitionDirectionRef.current = transitionState.direction;
    } else if (!transitionState.inProgress) {
      isChapterTransitionRef.current = false;
      chapterTransitionDirectionRef.current = null;
    }
  }, [transitionState.type, transitionState.direction, transitionState.inProgress]);

  // 이벤트 전환 감지
  useEffect(() => {
    let timeoutId = null;
    
    if (currentEvent && prevEventRef.current) {
      const prevEvent = prevEventRef.current;
      const isEventChanged = 
        prevEvent.eventNum !== currentEvent.eventNum ||
        prevEvent.chapter !== currentEvent.chapter;
      
      if (isEventChanged) {
        setTransitionState({ type: 'event', inProgress: true, error: false, direction: null });
        
        timeoutId = setTimeout(() => {
          transitionUtils.reset(setTransitionState);
        }, 200);
      }
    }
    
    if (currentEvent) {
      prevEventRef.current = currentEvent;
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [currentEvent]);

  // 챕터 전환 감지
  useEffect(() => {
    const handleChapterTransition = () => {
      if (prevChapterRef.current !== null && prevChapterRef.current !== currentChapter) {
        const direction = prevChapterRef.current > currentChapter ? 'backward' : 'forward';
        setTransitionState({ 
          type: 'chapter', 
          inProgress: true, 
          error: false,
          direction 
        });
      }
      prevChapterRef.current = currentChapter;
    };

    handleChapterTransition();
  }, [currentChapter]);

  // 로딩 상태 변경 시 에러 리셋
  useEffect(() => {
    if (loading || isReloading || isGraphLoading || !isDataReady || transitionState.type === 'chapter') {
      setTransitionState(prev => ({ ...prev, error: false }));
    }
  }, [currentEvent, currentChapter, loading, isReloading, isDataReady, isGraphLoading, transitionState.type]);

  // 챕터 전환 시작 (외부에서 호출)
  const startChapterTransition = useCallback((prevChapter, nextChapter) => {
    if (prevChapter && nextChapter && prevChapter !== nextChapter) {
      isChapterTransitionRef.current = true;
      chapterTransitionDirectionRef.current = prevChapter > nextChapter ? 'backward' : 'forward';
      const direction = chapterTransitionDirectionRef.current;
      const forcedIdx = direction === 'forward' ? 1 : 'max';
      forcedChapterEventIdxRef.current = forcedIdx;
      return { direction, forcedIdx };
    }
    return null;
  }, []);

  // 강제 이벤트 인덱스 해제
  const releaseForcedEventIdx = useCallback(() => {
    forcedChapterEventIdxRef.current = null;
    chapterTransitionDirectionRef.current = null;
    isChapterTransitionRef.current = false;
  }, []);

  // 강제 이벤트 인덱스 설정
  const setForcedEventIdx = useCallback((idx) => {
    forcedChapterEventIdxRef.current = idx;
  }, []);

  // 전환 상태 리셋
  const resetTransition = useCallback(() => {
    transitionUtils.reset(setTransitionState);
  }, []);

  return {
    transitionState,
    setTransitionState,
    isChapterTransitionRef,
    chapterTransitionDirectionRef,
    forcedChapterEventIdxRef,
    startChapterTransition,
    releaseForcedEventIdx,
    setForcedEventIdx,
    resetTransition
  };
}

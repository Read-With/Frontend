/**
 * useTransitionState.js : 전환 상태 관리 훅
 *
 * [주요 기능]
 * 1. 챕터/이벤트 전환 상태 관리
 * 2. 전환 상태 자동 감지 및 업데이트
 *
 * [사용처]
 * - ViewerPage: 챕터 및 이벤트 전환 상태 관리
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { transitionUtils } from '../../utils/viewer/viewerUtils';

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

  const prevEventRef = useRef(null);
  const prevChapterRef = useRef(null);

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
        setTransitionState({
          type: 'chapter',
          inProgress: true,
          error: false,
          direction: null,
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

  // 전환 상태 리셋
  const resetTransition = useCallback(() => {
    transitionUtils.reset(setTransitionState);
  }, []);

  return {
    transitionState,
    setTransitionState,
    resetTransition
  };
}

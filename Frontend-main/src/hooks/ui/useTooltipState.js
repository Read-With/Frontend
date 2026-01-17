/**
 * useTooltipState.js : 툴팁 상태 관리 훅
 * 
 * [주요 기능]
 * 1. 툴팁 활성 상태 관리
 * 2. 툴팁 열기/닫기 핸들러
 * 3. 툴팁 표시 실패 감지
 * 4. 자동 정리 및 메모리 관리
 * 
 * [사용처]
 * - ViewerPage: 그래프 툴팁 상태 관리
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { processTooltipData } from '../../utils/graphUtils';

/**
 * 툴팁 상태 관리 훅
 * @param {Object} options - 옵션 객체
 * @param {Function} options.onError - 툴팁 표시 실패 시 호출되는 콜백 (선택)
 * @param {Object} options.graphClearRef - 그래프 클리어 함수를 담는 ref (선택)
 * @param {number} options.clearDelay - 툴팁 닫기 시 최소 대기 시간 (ms, 기본값: 150)
 * @param {number} options.errorCheckDelay - 에러 체크 딜레이 (ms, 기본값: 220)
 * @returns {Object} 툴팁 상태 및 핸들러
 */
export function useTooltipState({
  onError = null,
  graphClearRef = null,
  clearDelay = 150,
  errorCheckDelay = 220
} = {}) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const tooltipTimeoutRef = useRef(null);
  const lastTooltipOpenAtRef = useRef(0);
  const activeTooltipRef = useRef(null);
  const onErrorRef = useRef(onError);
  const graphClearRefRef = useRef(graphClearRef);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    graphClearRefRef.current = graphClearRef;
  }, [graphClearRef]);

  useEffect(() => {
    activeTooltipRef.current = activeTooltip;
  }, [activeTooltip]);

  const handleClearTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    
    const now = Date.now();
    if (now - lastTooltipOpenAtRef.current < clearDelay) {
      return;
    }
    
    setActiveTooltip(null);
    if (graphClearRefRef.current?.current) {
      graphClearRefRef.current.current();
    }
  }, [clearDelay]);

  const handleSetActiveTooltip = useCallback((tooltipData) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    
    const processedTooltipData = processTooltipData(tooltipData, tooltipData.type);
    lastTooltipOpenAtRef.current = Date.now();
    setActiveTooltip(processedTooltipData);
    
    if (onErrorRef.current) {
      const timeoutId = setTimeout(() => {
        if (!activeTooltipRef.current) {
          onErrorRef.current();
        }
        if (tooltipTimeoutRef.current === timeoutId) {
          tooltipTimeoutRef.current = null;
        }
      }, errorCheckDelay);
      tooltipTimeoutRef.current = timeoutId;
    }
  }, [errorCheckDelay]);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
        tooltipTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    activeTooltip,
    setActiveTooltip,
    handleClearTooltip,
    handleSetActiveTooltip,
    activeTooltipRef
  };
}

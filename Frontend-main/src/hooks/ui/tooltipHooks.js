/** 툴팁: 외부 클릭 감지·드래그 위치·활성 툴팁 상태 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { constrainToGraphCanvas } from '../../utils/graph/graphUtils';

const TOOLTIP_CLEAR_DELAY_MS = 150;
const TOOLTIP_ERROR_CHECK_DELAY_MS = 220;

let globalDragState = {
  isDragging: false,
  dragEndTime: 0,
  ignoreNextClick: false,
};

export function useClickOutside(callback, enabled = true, ignoreDrag = false) {
  const ref = useRef(null);
  const lastClickTime = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const updateDragState = (isDragging) => {
      globalDragState.isDragging = isDragging;
      if (!isDragging) {
        globalDragState.dragEndTime = Date.now();
        globalDragState.ignoreNextClick = true;
        setTimeout(() => {
          globalDragState.ignoreNextClick = false;
        }, 500);
      }
    };

    const handleMouseDown = (event) => {
      const graphContainer =
        event.target.closest('#cy') ||
        event.target.closest('.graph-canvas-area') ||
        event.target.closest('[data-cy]');
      if (graphContainer) {
        globalDragState.isDragging = true;
      }
    };

    const handleMouseUp = () => {
      if (globalDragState.isDragging) {
        updateDragState(false);
      }
    };

    const handleGraphDragEnd = () => {
      updateDragState(false);
    };

    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        const now = Date.now();

        if (ignoreDrag) {
          if (globalDragState.ignoreNextClick) return;
          if (now - globalDragState.dragEndTime < 500) return;
        }

        if (now - lastClickTime.current < 50) return;

        lastClickTime.current = now;
        callback(event);
      }
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('graphDragEnd', handleGraphDragEnd);
    document.addEventListener('click', handleClickOutside, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
      document.removeEventListener('graphDragEnd', handleGraphDragEnd);
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [callback, enabled, ignoreDrag]);

  return ref;
}

export function useTooltipState({
  onError = null,
  graphClearRef = null,
} = {}) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const tooltipTimeoutRef = useRef(null);
  const lastTooltipOpenAtRef = useRef(0);
  const activeTooltipRef = useRef(null);
  const onErrorRef = useRef(onError);
  const graphClearRefRef = useRef(graphClearRef);

  useEffect(() => {
    onErrorRef.current = onError;
    graphClearRefRef.current = graphClearRef;
  }, [onError, graphClearRef]);

  useEffect(() => {
    activeTooltipRef.current = activeTooltip;
  }, [activeTooltip]);

  const handleClearTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }

    const now = Date.now();
    if (now - lastTooltipOpenAtRef.current < TOOLTIP_CLEAR_DELAY_MS) {
      return;
    }

    setActiveTooltip(null);
    if (graphClearRefRef.current?.current) {
      graphClearRefRef.current.current();
    }
  }, []);

  const handleSetActiveTooltip = useCallback((tooltipData) => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }

    // processTooltipData는 openTooltipFromTap에서 이미 수행
    lastTooltipOpenAtRef.current = Date.now();
    setActiveTooltip(tooltipData);

    if (onErrorRef.current) {
      const timeoutId = setTimeout(() => {
        if (!activeTooltipRef.current) {
          onErrorRef.current();
        }
        if (tooltipTimeoutRef.current === timeoutId) {
          tooltipTimeoutRef.current = null;
        }
      }, TOOLTIP_ERROR_CHECK_DELAY_MS);
      tooltipTimeoutRef.current = timeoutId;
    }
  }, []);

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
    handleClearTooltip,
    handleSetActiveTooltip,
  };
}

export function useTooltipPosition(initialX, initialY, options = {}) {
  const enabled = options.enabled !== false;
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const tooltipRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setShowContent(true);
  }, [enabled]);

  const handleMouseDown = (e) => {
    if (!enabled) return;
    if (e.button !== 0) return;
    if (
      e.target.closest(
        '.tooltip-close-btn, button, a, input, textarea, select, [role="button"]'
      )
    ) {
      return;
    }
    if (!tooltipRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = tooltipRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    isDraggingRef.current = true;
    setIsDragging(true);
  };

  useEffect(() => {
    if (!enabled || !isDragging) return undefined;

    const handleMouseMove = (e) => {
      if (!isDraggingRef.current || !tooltipRef.current) return;
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      const constrained = constrainToGraphCanvas(
        newX,
        newY,
        tooltipRect.width,
        tooltipRect.height
      );
      setPosition(constrained);
      setHasDragged(true);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        document.dispatchEvent(
          new CustomEvent('dragend', {
            detail: { type: 'dragend', timestamp: Date.now() },
          })
        );
      }
      isDraggingRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [enabled, isDragging]);

  useEffect(() => {
    if (!enabled) return;
    if (
      initialX !== undefined &&
      initialY !== undefined &&
      tooltipRef.current &&
      !isDragging &&
      !hasDragged
    ) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const constrained = constrainToGraphCanvas(
        initialX,
        initialY,
        tooltipRect.width,
        tooltipRect.height
      );
      setPosition(constrained);
    }
  }, [enabled, initialX, initialY, isDragging, hasDragged]);

  if (!enabled) {
    return {
      position: { x: 0, y: 0 },
      showContent: true,
      isDragging: false,
      tooltipRef,
      handleMouseDown: () => {},
    };
  }

  return {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
  };
}

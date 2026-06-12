/** 툴팁: 외부 클릭 감지·드래그 위치 (그래프 드래그 후 클릭 무시 포함) */

import { useEffect, useRef, useState } from 'react';
import {
  getContainerInfo,
  getViewportInfo,
  calculateCytoscapePosition,
  constrainToViewport,
} from '../../utils/graph/graphUtils';

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

export function useTooltipPosition(initialX, initialY, options = {}) {
  const enabled = options.enabled !== false;
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const [justFinishedDragging, setJustFinishedDragging] = useState(false);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    setShowContent(true);
  }, [enabled]);

  const handleMouseDown = (e) => {
    if (!enabled) return;
    if (e.target.closest('.tooltip-close-btn')) return;
    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e) => {
    if (!enabled || !isDragging) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    const constrained = constrainToViewport(newX, newY, tooltipRect.width, tooltipRect.height);
    setPosition(constrained);
    setHasDragged(true);
  };

  const handleMouseUp = () => {
    if (!enabled) return;
    if (isDragging) {
      setJustFinishedDragging(true);
      document.dispatchEvent(
        new CustomEvent('dragend', {
          detail: { type: 'dragend', timestamp: Date.now() },
        })
      );
      setTimeout(() => {
        setJustFinishedDragging(false);
      }, 150);
    }
    setIsDragging(false);
  };

  useEffect(() => {
    if (!enabled) return;
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.userSelect = '';
    }
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
      const constrained = constrainToViewport(initialX, initialY, tooltipRect.width, tooltipRect.height);
      setPosition(constrained);
    }
  }, [enabled, initialX, initialY, isDragging, hasDragged]);

  if (!enabled) {
    return {
      position: { x: 0, y: 0 },
      showContent: true,
      isDragging: false,
      justFinishedDragging: false,
      tooltipRef,
      handleMouseDown: () => {},
      getContainerInfo,
      getViewportInfo,
      calculateCytoscapePosition,
      constrainToViewport,
    };
  }

  return {
    position,
    showContent,
    isDragging,
    justFinishedDragging,
    tooltipRef,
    handleMouseDown,
    getContainerInfo,
    getViewportInfo,
    calculateCytoscapePosition,
    constrainToViewport,
  };
}

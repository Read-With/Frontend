import { useState, useEffect, useRef } from 'react';
import { getContainerInfo, getViewportInfo, calculateCytoscapePosition, constrainToViewport } from '../../utils/graph/graphUtils';

/**
 * @param {number|undefined} initialX
 * @param {number|undefined} initialY
 * @param {{ enabled?: boolean }} [options] enabled=false일 때 드래그/위치 훅 비활성(사이드바 등)
 */
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
    if (e.target.closest(".tooltip-close-btn")) return;
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
    
    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    const constrained = constrainToViewport(newX, newY, tooltipRect.width, tooltipRect.height);
    setPosition(constrained);
    setHasDragged(true);
  };

  const handleMouseUp = () => {
    if (!enabled) return;
    if (isDragging) {
      setJustFinishedDragging(true);
      
      // 드래그 완료 이벤트 발생
      const dragEndEvent = new CustomEvent('dragend', {
        detail: { type: 'dragend', timestamp: Date.now() }
      });
      document.dispatchEvent(dragEndEvent);
      
      // 드래그 완료 후 잠시 후에 플래그 리셋
      setTimeout(() => {
        setJustFinishedDragging(false);
      }, 150);
    }
    setIsDragging(false);
  };

  useEffect(() => {
    if (!enabled) return;
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    } else {
      document.body.style.userSelect = "";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
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
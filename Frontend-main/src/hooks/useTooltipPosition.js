import { useState, useEffect, useRef, useCallback } from 'react';
import { getContainerInfo, getViewportInfo, calculateCytoscapePosition, constrainToViewport } from '../utils/graphUtils';

export function useTooltipPosition(initialX, initialY) {
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const [justFinishedDragging, setJustFinishedDragging] = useState(false);
  const tooltipRef = useRef(null);

  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
    if (e.target.closest(".tooltip-close-btn")) return;
    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    
    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    const constrained = constrainToViewport(newX, newY, tooltipRect.width, tooltipRect.height);
    setPosition(constrained);
    setHasDragged(true);
  };

  const handleMouseUp = () => {
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
  }, [isDragging]);

  useEffect(() => {
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
  }, [initialX, initialY, isDragging, hasDragged]);

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
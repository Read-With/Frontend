/** 툴팁: 외부 클릭 감지·드래그 위치·활성 툴팁 상태 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { constrainToGraphCanvas } from '../utils/graph/graphLayout';
import { useLatestRef } from './common/hooksShared';

const TOOLTIP_CLEAR_DELAY_MS = 150;

const GRAPH_CANVAS_SELECTOR = '#cy, .graph-canvas-area, [data-cy]';
/** 툴팁이 선택 중심(avoid point)과 띄울 최소 거리 */
const AVOID_PAD = 48;

/** ref 바깥 클릭 시 callback. ignoreDrag면 그래프 캔버스에서 시작된 클릭(드래그 포함)은 무시 */
export function useClickOutside(callback, enabled = true, ignoreDrag = false) {
  const ref = useRef(null);
  const callbackRef = useLatestRef(callback);

  useEffect(() => {
    if (!enabled) return undefined;
    let downOnGraph = false;

    const handleMouseDown = (event) => {
      downOnGraph = Boolean(event.target.closest?.(GRAPH_CANVAS_SELECTOR));
    };

    const handleClick = (event) => {
      // 플래그는 이 mousedown에 이어진 클릭 한 번에만 적용 (키보드·프로그램 클릭은 mousedown 없음)
      const startedOnGraph = downOnGraph;
      downOnGraph = false;
      if (!ref.current || ref.current.contains(event.target)) return;
      if (ignoreDrag && startedOnGraph) return;
      callbackRef.current(event);
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('click', handleClick, true);
    };
  }, [enabled, ignoreDrag, callbackRef]);

  return ref;
}

export function useTooltipState({
  onError = null,
  graphClearRef = null,
} = {}) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const lastTooltipOpenAtRef = useRef(0);
  const onErrorRef = useLatestRef(onError);
  const graphClearRefRef = useLatestRef(graphClearRef);

  const handleClearTooltip = useCallback(() => {
    const now = Date.now();
    if (now - lastTooltipOpenAtRef.current < TOOLTIP_CLEAR_DELAY_MS) {
      return;
    }

    setActiveTooltip(null);
    if (graphClearRefRef.current?.current) {
      graphClearRefRef.current.current();
    }
  }, [graphClearRefRef]);

  const handleSetActiveTooltip = useCallback((tooltipData) => {
    // processTooltipData는 openTooltipFromTap에서 이미 수행. null = 탭한 요소의 정보를 못 읽음
    lastTooltipOpenAtRef.current = Date.now();
    setActiveTooltip(tooltipData);
    if (tooltipData == null) onErrorRef.current?.();
  }, [onErrorRef]);

  return {
    activeTooltip,
    handleClearTooltip,
    handleSetActiveTooltip,
  };
}

/**
 * 그래프 영역 안 툴팁 위치 + 드래그. avoid(x,y): 클릭/선택 focus를 가리지 않도록 실측 후 재배치
 * @param {{ current: HTMLElement | null } | null} boundsRef
 */
function useTooltipPosition(initialX, initialY, { avoid, boundsRef }) {
  const avoidX = Number.isFinite(avoid?.x) ? avoid.x : null;
  const avoidY = Number.isFinite(avoid?.y) ? avoid.y : null;
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const tooltipRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const [layoutRevision, setLayoutRevision] = useState(0);

  const readBoundsRect = useCallback(() => {
    return boundsRef?.current?.getBoundingClientRect?.() ?? null;
  }, [boundsRef]);

  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
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
    if (!isDragging) return undefined;

    const handleMouseMove = (e) => {
      if (!isDraggingRef.current || !tooltipRef.current) return;
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      setPosition(
        constrainToGraphCanvas(newX, newY, tooltipRect.width, tooltipRect.height, readBoundsRect()),
      );
      setHasDragged(true);
    };

    const handleMouseUp = () => {
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
  }, [isDragging, readBoundsRect]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    let updateTimer = 0;
    const observer = new ResizeObserver(() => {
      if (updateTimer) window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => {
        updateTimer = 0;
        setLayoutRevision((value) => value + 1);
      }, 50);
    });
    if (tooltipRef.current) observer.observe(tooltipRef.current);
    if (boundsRef?.current) observer.observe(boundsRef.current);
    return () => {
      observer.disconnect();
      if (updateTimer) window.clearTimeout(updateTimer);
    };
  }, [boundsRef]);

  useEffect(() => {
    if (!hasDragged || isDragging || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    setPosition((current) =>
      constrainToGraphCanvas(current.x, current.y, rect.width, rect.height, readBoundsRect()));
  }, [hasDragged, isDragging, layoutRevision, readBoundsRect]);

  useEffect(() => {
    if (
      initialX === undefined ||
      initialY === undefined ||
      !tooltipRef.current ||
      isDragging ||
      hasDragged
    ) {
      return;
    }

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const width = tooltipRect.width || 1;
    const height = tooltipRect.height || 1;
    let next = constrainToGraphCanvas(initialX, initialY, width, height, readBoundsRect());

    if (avoidX != null && avoidY != null) {
      const tip = {
        left: next.x,
        top: next.y,
        right: next.x + width,
        bottom: next.y + height,
      };
      const overlaps =
        avoidX >= tip.left - AVOID_PAD &&
        avoidX <= tip.right + AVOID_PAD &&
        avoidY >= tip.top - AVOID_PAD &&
        avoidY <= tip.bottom + AVOID_PAD;

      if (overlaps) {
        const candidates = [
          { x: avoidX + AVOID_PAD, y: avoidY - height / 2 },
          { x: avoidX - AVOID_PAD - width, y: avoidY - height / 2 },
          { x: avoidX - width / 2, y: avoidY + AVOID_PAD },
          { x: avoidX - width / 2, y: avoidY - AVOID_PAD - height },
          { x: avoidX + AVOID_PAD, y: avoidY + AVOID_PAD },
          { x: avoidX - AVOID_PAD - width, y: avoidY - AVOID_PAD - height },
        ];
        let best = next;
        let bestDist = Infinity;
        for (const c of candidates) {
          const p = constrainToGraphCanvas(c.x, c.y, width, height, readBoundsRect());
          const covers =
            avoidX >= p.x - 4 &&
            avoidX <= p.x + width + 4 &&
            avoidY >= p.y - 4 &&
            avoidY <= p.y + height + 4;
          if (covers) continue;
          const dist =
            Math.abs(p.x + width / 2 - avoidX) + Math.abs(p.y + height / 2 - avoidY);
          if (dist < bestDist) {
            bestDist = dist;
            best = p;
          }
        }
        next = best;
      }
    }

    setPosition(next);
  }, [
    initialX,
    initialY,
    isDragging,
    hasDragged,
    avoidX,
    avoidY,
    layoutRevision,
    readBoundsRect,
  ]);

  return {
    position,
    showContent,
    isDragging,
    tooltipRef,
    handleMouseDown,
  };
}

/** 캔버스 위 플로팅 툴팁 공통: 위치(노드·간선 중심 회피) + 바깥 클릭 닫기 */
export function useFloatingTooltip(x, y, { center, boundsRef = null, onClose }) {
  const tooltip = useTooltipPosition(x, y, { avoid: center, boundsRef });
  const clickOutsideRef = useClickOutside(() => onClose?.(), tooltip.showContent, true);
  return { ...tooltip, clickOutsideRef };
}

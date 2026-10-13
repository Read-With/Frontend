/** 그래프 전용 페이지 오른쪽 상세 사이드바 (노드/간선), 열림·닫힘 슬라이드 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NodeDetail from './NodeDetail';
import { useGraphPage } from './GraphPageContext';
import { GRAPH_LAYOUT_CONSTANTS } from '../../utils/graph/graphCore.js';

const EdgeDetail = lazy(() => import('./EdgeDetail'));

const {
  TOOLTIP_SIDEBAR_WIDTH: SIDEBAR_WIDTH,
  ANIMATION_MS: ANIMATION_DURATION,
} = GRAPH_LAYOUT_CONSTANTS;

function clearTimeoutRef(timeoutRef) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

export default function GraphPageSidebar({ onRequestFocusCanvas = null }) {
  const {
    activeTooltip,
    closeSidebar: onClose,
    currentChapter,
    eventNum,
    startClosing: onStartClosing,
    clearGraphSelection: onClearGraph,
    isSidebarClosing,
    bookId,
    chapterRailWidth,
    nodeDetail,
  } = useGraphPage();
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);
  const restoreCanvasFocusRef = useRef(false);
  const openAnimationFrameRef = useRef(null);

  const cancelOpenAnimationFrame = useCallback(() => {
    if (openAnimationFrameRef.current != null) {
      cancelAnimationFrame(openAnimationFrameRef.current);
      openAnimationFrameRef.current = null;
    }
  }, []);

  const sidebarStyle = useMemo(() => ({
    right: isClosing || !isVisible ? `-${SIDEBAR_WIDTH}px` : '0px',
  }), [isClosing, isVisible]);

  const finishClose = useCallback(() => {
    onClose();
    setIsClosing(false);
    setIsVisible(false);
    animationTimeoutRef.current = null;
    if (restoreCanvasFocusRef.current) {
      restoreCanvasFocusRef.current = false;
      onRequestFocusCanvas?.();
    }
  }, [onClose, onRequestFocusCanvas]);

  const runCloseAnimation = useCallback(() => {
    clearTimeoutRef(animationTimeoutRef);
    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(finishClose, ANIMATION_DURATION);
  }, [finishClose]);

  const handleClose = useCallback(() => {
    restoreCanvasFocusRef.current = true;
    onClearGraph?.();
    onStartClosing?.();
    runCloseAnimation();
  }, [onClearGraph, onStartClosing, runCloseAnimation]);

  useEffect(() => {
    const prevActiveTooltip = previousActiveTooltipRef.current;

    if (activeTooltip && !prevActiveTooltip) {
      clearTimeoutRef(animationTimeoutRef);
      cancelOpenAnimationFrame();
      setIsClosing(false);
      setIsVisible(false);
      openAnimationFrameRef.current = requestAnimationFrame(() => {
        openAnimationFrameRef.current = requestAnimationFrame(() => {
          openAnimationFrameRef.current = null;
          setIsVisible(true);
        });
      });
    } else if (!activeTooltip && prevActiveTooltip) {
      cancelOpenAnimationFrame();
      runCloseAnimation();
    }

    previousActiveTooltipRef.current = activeTooltip;
  }, [activeTooltip, runCloseAnimation, cancelOpenAnimationFrame]);

  useEffect(() => {
    if (isSidebarClosing && !isClosing) {
      cancelOpenAnimationFrame();
      runCloseAnimation();
    }
  }, [isSidebarClosing, isClosing, runCloseAnimation, cancelOpenAnimationFrame]);

  useEffect(() => () => {
    clearTimeoutRef(animationTimeoutRef);
    cancelOpenAnimationFrame();
  }, [cancelOpenAnimationFrame]);

  if (!isVisible && !isClosing && !activeTooltip) {
    return null;
  }

  const sharedTooltipProps = {
    onClose: handleClose,
    currentChapter,
    eventNum,
  };

  let tooltipContent = null;
  if (activeTooltip?.type === 'node') {
    tooltipContent = (
      <NodeDetail
        displayMode="sidebar"
        data={activeTooltip}
        chapterRailWidth={chapterRailWidth}
        {...nodeDetail}
        {...sharedTooltipProps}
      />
    );
  } else if (activeTooltip) {
    tooltipContent = (
      <Suspense fallback={<div role="status" aria-live="polite">관계 정보를 불러오는 중…</div>}>
        <EdgeDetail
          data={activeTooltip.data}
          variant="graphPage"
          bookId={bookId}
          sourceEndpoint={activeTooltip.sourceEndpoint}
          targetEndpoint={activeTooltip.targetEndpoint}
          {...sharedTooltipProps}
        />
      </Suspense>
    );
  }

  return (
    <div
      className="graph-page-sidebar"
      style={sidebarStyle}
      data-testid="graph-sidebar"
    >
      {tooltipContent}
    </div>
  );
}

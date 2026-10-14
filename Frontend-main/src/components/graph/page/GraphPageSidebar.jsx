/** 그래프 전용 페이지 오른쪽 상세 사이드바 (노드/간선), 열림·닫힘 슬라이드 */

import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import NodeDetail from '../detail/NodeDetail';
import { useGraphPageSidebar } from './GraphPageContext';
import { GRAPH_LAYOUT_CONSTANTS } from '../../../utils/graph/graphCore.js';

const EdgeDetail = lazy(() => import('../detail/EdgeDetail'));

const { TOOLTIP_SIDEBAR_WIDTH: SIDEBAR_WIDTH, ANIMATION_MS } = GRAPH_LAYOUT_CONSTANTS;

/**
 * 닫힘 상태는 페이지(useGraphState)의 isSidebarClosing 하나만 사용.
 * - 닫는 중: ANIMATION_MS 뒤 closeSidebar. cancelClosing(다른 노드 선택 등)이면 타이머가 취소되고 다시 슬라이드 인
 * - 슬라이드 시간은 CSS 변수로 넘겨 JS·CSS가 같은 값(ANIMATION_MS)을 쓴다
 */
function GraphPageSidebar({ onRequestFocusCanvas = null }) {
  const {
    activeTooltip,
    closeSidebar,
    currentChapter,
    eventNum,
    startClosing,
    clearGraphSelection,
    isSidebarClosing,
    bookId,
    chapterRailWidth,
    nodeDetail,
  } = useGraphPageSidebar();
  // 마운트 직후 한 프레임은 화면 밖에 두었다가 들어오게 해야 슬라이드 인 전환이 보임
  const [entered, setEntered] = useState(false);
  const restoreCanvasFocusRef = useRef(false);

  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!isSidebarClosing) {
      // 닫힘이 끝났거나 취소됨(다른 노드 선택) → 닫기 버튼의 포커스 복귀 요청도 무효
      restoreCanvasFocusRef.current = false;
      return undefined;
    }
    const id = setTimeout(() => {
      closeSidebar();
      if (restoreCanvasFocusRef.current) {
        restoreCanvasFocusRef.current = false;
        onRequestFocusCanvas?.();
      }
    }, ANIMATION_MS);
    return () => clearTimeout(id);
  }, [isSidebarClosing, closeSidebar, onRequestFocusCanvas]);

  const handleClose = useCallback(() => {
    restoreCanvasFocusRef.current = true;
    clearGraphSelection?.();
    startClosing();
  }, [clearGraphSelection, startClosing]);

  const shown = entered && !isSidebarClosing && Boolean(activeTooltip);
  const sidebarStyle = {
    right: shown ? '0px' : `-${SIDEBAR_WIDTH}px`,
    '--graph-sidebar-slide-ms': `${ANIMATION_MS}ms`,
  };

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

// 레이아웃이 다시 그려져도(검색 입력 등) 사이드바 값이 그대로면 건너뜀
export default memo(GraphPageSidebar);

/** 그래프 캔버스 영역 (그래프 페이지·뷰어 분할 공용): 키보드 탐색 + 스크린리더 요약 + Cytoscape */

import { useId, useRef } from 'react';
import CytoscapeGraph from './CytoscapeGraph';
import GraphA11yStatus from './GraphA11yStatus';
import { useGraphCanvasKeyboard } from '../../../hooks/graph/useGraphCy.js';

/**
 * 나머지 props(...cyProps)는 CytoscapeGraph로 그대로 전달.
 * children은 캔버스 위 오버레이(로딩 등).
 */
export default function GraphCanvasArea({
  ref,
  activeTooltip = null,
  chapterLabel,
  eventNum,
  filterStage = 0,
  isLoading = false,
  onClick,
  children = null,
  ...cyProps
}) {
  const { cyRef, graphClearRef, onClearTooltip, elements, isSearchActive, filteredElements, searchTerm } = cyProps;
  const selectElementRef = useRef(null);
  const a11yStatusId = useId();
  const a11yElements = isSearchActive && Array.isArray(filteredElements) ? filteredElements : elements;

  const { onKeyDown, liveAnnouncement, ariaLabel } = useGraphCanvasKeyboard({
    cyRef,
    graphClearRef,
    selectElementRef,
    activeTooltip,
    onClearTooltip,
  });

  return (
    <div
      ref={ref}
      className="graph-canvas-area"
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="region"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-describedby={a11yStatusId}
    >
      <GraphA11yStatus
        id={a11yStatusId}
        chapterLabel={chapterLabel}
        eventNum={eventNum}
        elements={a11yElements}
        filterStage={filterStage}
        isSearchActive={isSearchActive}
        searchTerm={searchTerm}
        activeTooltip={activeTooltip}
        isLoading={isLoading}
        liveAnnouncement={liveAnnouncement}
      />
      {children}
      <CytoscapeGraph {...cyProps} graphSelectElementRef={selectElementRef} />
    </div>
  );
}

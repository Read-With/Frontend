/** 뷰어 분할 그래프 상단바: 확대 토글 · 챕터/사건 메타 · 검색·필터 도구 · 전체 관계도 이동 */

import { useMemo, useRef, memo } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { useGraphTopbarToolsReserve } from '../../../hooks/graph/useGraphCy';
import { resolveEventOrdinalForDisplay } from '../../../utils/viewer/viewerSession';
import { resolveViewerSplitChapterMeta } from '../../../utils/viewer/viewerGraph';
import { GraphFloatingControls } from '../../graph/controls/GraphFloatingControls';
import { GraphTopBarMeta } from '../../graph/controls/GraphTopBarMeta';
import '../../graph/styles/graph.css';
import { formatGraphEventMetaLabel } from '../../../utils/graph/graphCore';

/** 분할 상단바: 챕터 + 사건 메타 (계산중 포함) */
function GraphChapterEventMeta({
  bookId,
  progressTopBar,
  currentEvent,
  prevValidEvent,
  resolvedServerChapter,
  chapterDisplayLabel,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter: resolvedServerChapter,
    progressTopBar: progressTopBar ?? { eventNum: null },
    fallback: 0,
  });

  if (bookId && progressTopBar === undefined && !(eventNum > 0)) {
    return <span className="graph-topbar-meta-event">계산중…</span>;
  }

  return (
    <GraphTopBarMeta
      chapterLabel={chapterDisplayLabel}
      eventLabel={formatGraphEventMetaLabel(eventNum > 0 ? eventNum : null)}
    />
  );
}

const FULLSCREEN_TOGGLE = {
  enter: {
    label: '그래프 확대 — 같은 읽기 그래프를 키움',
    title: '그래프 확대 (챕터 탐색은 「전체 관계도」)',
  },
  exit: {
    label: '분할로 — 본문과 함께 보기',
    title: '분할로 (본문+그래프)',
  },
};

export const GraphSplitTopBar = memo(function GraphSplitTopBar({
  graphState,
  graphActions,
  bookId,
  searchState,
  searchActions,
}) {
  const {
    currentChapter,
    currentEvent,
    prevValidEvent,
    graphFullScreen,
    progressTopBar,
    edgeLabelVisible,
  } = graphState;

  const { setGraphFullScreen, setEdgeLabelVisible, filterStage, setFilterStage } = graphActions;

  const chapterMeta = useMemo(
    () => resolveViewerSplitChapterMeta(bookId, currentChapter),
    [bookId, currentChapter],
  );

  const fullscreenCopy = graphFullScreen ? FULLSCREEN_TOGGLE.exit : FULLSCREEN_TOGGLE.enter;

  const topbarRef = useRef(null);
  const toolsRef = useRef(null);
  useGraphTopbarToolsReserve(topbarRef, toolsRef);

  return (
    <div className="graph-split-topbar" ref={topbarRef}>
      <button
        type="button"
        className="graph-fullscreen-btn"
        aria-label={fullscreenCopy.label}
        title={fullscreenCopy.title}
        onClick={() => setGraphFullScreen(!graphFullScreen)}
      >
        {graphFullScreen ? (
          <Minimize size={18} aria-hidden />
        ) : (
          <Maximize size={18} aria-hidden />
        )}
      </button>

      <div className="graph-split-topbar-center">
        <GraphChapterEventMeta
          bookId={bookId}
          progressTopBar={progressTopBar}
          currentEvent={currentEvent}
          prevValidEvent={prevValidEvent}
          resolvedServerChapter={chapterMeta.resolvedServerChapter}
          chapterDisplayLabel={chapterMeta.chapterDisplayLabel}
        />
      </div>

      <div className="graph-split-topbar-tools" ref={toolsRef}>
        <GraphFloatingControls
          searchState={searchState}
          searchActions={searchActions}
          edgeLabelVisible={edgeLabelVisible}
          onToggleEdgeLabel={() => setEdgeLabelVisible((v) => !v)}
          filterStage={filterStage}
          onFilterChange={setFilterStage}
        />
      </div>
    </div>
  );
});

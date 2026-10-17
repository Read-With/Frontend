import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { toast } from 'react-toastify';
import ViewerToolbar from './ViewerToolbar';
import { useIsNarrowViewport, useLatestRef } from '../../hooks/common/hooksShared';
import { readRaw, writeRaw } from '../../utils/common/cache/cacheManager';
import { formatChapterOrdinalLabel } from '../../utils/common/chapterLabel';
import './ViewerToolbar.css';

const SPLIT_STORAGE_KEY = 'viewer-graph-split-percent';
const SPLIT_MIN = 32;
const SPLIT_MAX = 68;
const SPLIT_PERSIST_DEBOUNCE_MS = 300;
/** ViewerToolbar.css의 .viewer-chrome opacity/visibility 전환(0.3s)이 끝난 뒤 resize를 쏘기 위한 지연 — 그 값과 반드시 함께 조정 */
const LAYOUT_SETTLE_DELAY_MS = 300;

function readStoredSplitPercent() {
  const n = Number(readRaw(SPLIT_STORAGE_KEY));
  return Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX ? n : 50;
}

/** 진행률 표시값: 슬라이더 값(0~100), 퍼센트 문구, 스크린리더 문구 */
function resolveProgressDisplay(progress, ready, currentChapter) {
  const hasProgress = progress != null && Number.isFinite(Number(progress));
  const value = hasProgress ? Math.max(0, Math.min(Number(progress), 100)) : 0;
  const chapterLabel = formatChapterOrdinalLabel(Math.max(1, Math.trunc(Number(currentChapter) || 1)));
  const known = ready && hasProgress;
  return {
    value,
    chapterLabel,
    percentLabel: known ? `${Math.round(value)}%` : '계산 중',
    valueText: known ? `${chapterLabel}, ${Math.round(value)}%` : '진행률 계산 중',
  };
}

const ViewerProgressBar = memo(function ViewerProgressBar({
  showToolbar,
  progress,
  onSliderChange,
  currentChapter,
  currentPage,
  totalPages,
  progressMetricsReady,
}) {
  const { value, chapterLabel, percentLabel, valueText } =
    resolveProgressDisplay(progress, progressMetricsReady, currentChapter);

  const onChange = (e) => {
    if (!progressMetricsReady || !onSliderChange) return;
    onSliderChange(Number(e.target.value));
  };

  return (
    <div
      className={`viewer-progress-bar${showToolbar ? '' : ' is-hidden'}`}
    >
      <span className="viewer-progress-primary">
        <span className="viewer-progress-chapter">{chapterLabel}</span>
        <span className="viewer-progress-page" title="뷰포트 기준 가상 페이지">
          {currentPage}/{totalPages}
        </span>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={onChange}
        disabled={!progressMetricsReady}
        aria-label="진행률 슬라이더"
        aria-valuetext={valueText}
        aria-busy={!progressMetricsReady}
        className="progressbar-slider"
      />
      <span className="viewer-progress-pct">{percentLabel}</span>
    </div>
  );
});

const clampSplit = (value) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
const SPLIT_KEY_STEP = { ArrowLeft: -2, ArrowRight: 2 };

const MOBILE_PANE_TABS = [
  { pane: 'reader', label: '본문' },
  { pane: 'graph', label: '그래프' },
];

/** 본문:그래프 분할 비율 — localStorage 복원·디바운스 저장, 구분선 드래그·화살표 키 조절 */
function useSplitDivider(splitRowRef) {
  const [splitPercent, setSplitPercent] = useState(readStoredSplitPercent);
  const [isDragging, setIsDragging] = useState(false);
  const activeDragCleanupRef = useRef(null);

  useEffect(() => {
    // 드래그 중 pointermove마다 splitPercent가 바뀌므로, 값이 잠잠해진 뒤에만 저장
    const id = window.setTimeout(() => {
      writeRaw(SPLIT_STORAGE_KEY, String(splitPercent));
    }, SPLIT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [splitPercent]);

  useEffect(() => () => activeDragCleanupRef.current?.(), []);

  const onPointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const row = splitRowRef.current;
    const target = event.currentTarget;
    if (!row || !target) return;

    const pointerId = event.pointerId;
    setIsDragging(true);
    document.body.classList.add('viewer-split-dragging');
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    const updateFromClientX = (clientX) => {
      const rect = row.getBoundingClientRect();
      if (rect.width > 0) setSplitPercent(clampSplit(((clientX - rect.left) / rect.width) * 100));
    };
    const onMove = (e) => {
      if (e.pointerId === pointerId) updateFromClientX(e.clientX);
    };
    const onEnd = (e) => {
      if (e.pointerId === pointerId) cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      try {
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      document.body.classList.remove('viewer-split-dragging');
      setIsDragging(false);
      activeDragCleanupRef.current = null;
    };

    updateFromClientX(event.clientX);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    activeDragCleanupRef.current = cleanup;
  }, [splitRowRef]);

  const onKeyDown = useCallback((e) => {
    const step = SPLIT_KEY_STEP[e.key];
    if (!step) return;
    e.preventDefault();
    setSplitPercent((p) => clampSplit(p + step));
  }, []);

  return { splitPercent, isDragging, dividerHandlers: { onPointerDown, onKeyDown } };
}

/** 좁은 화면 탭(본문/그래프). 그래프를 새로 켜면 본문 탭에 머물고 안내 토스트 */
function useMobilePane(showGraph, isNarrow) {
  const [mobilePane, setMobilePane] = useState('reader');
  const prevShowGraphRef = useRef(showGraph);

  useEffect(() => {
    const wasShown = prevShowGraphRef.current;
    prevShowGraphRef.current = showGraph;
    if (!showGraph) {
      setMobilePane('reader');
      return;
    }
    if (!wasShown && isNarrow) {
      setMobilePane('reader');
      toast.info('그래프가 켜졌어요. 「그래프」 탭에서 확인할 수 있어요.', { autoClose: 3500 });
    }
  }, [showGraph, isNarrow]);

  return [mobilePane, setMobilePane];
}

/** 레이아웃이 바뀌면 전환 애니메이션 뒤 resize 이벤트 + (본문이 보이면) 위치 복원 콜백. 첫 렌더는 생략 */
function useLayoutSettle(layoutKey, readerVisible, onSettled) {
  const skipInitialRef = useRef(true);
  const onSettledRef = useLatestRef(onSettled);
  const readerVisibleRef = useLatestRef(readerVisible);

  useEffect(() => {
    if (skipInitialRef.current) {
      skipInitialRef.current = false;
      return undefined;
    }
    const visible = readerVisibleRef.current;
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (visible) onSettledRef.current?.();
    }, LAYOUT_SETTLE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [layoutKey, onSettledRef, readerVisibleRef]);
}

function readerPaneState({ showGraph, graphFullScreen, useMobileTabs, showReaderPane }) {
  if (graphFullScreen) return 'is-fullscreen-hidden';
  if (useMobileTabs) return showReaderPane ? 'is-mobile-tab' : 'is-mobile-tab is-hidden';
  return showGraph ? 'is-split' : 'is-alone';
}

function graphPaneState({ graphFullScreen, useMobileTabs, showGraphPane }) {
  if (!showGraphPane) return 'is-hidden';
  if (useMobileTabs) return 'is-mobile-tab';
  return graphFullScreen ? 'is-fullscreen' : 'is-split';
}

/**
 * 화면 배치: 좁은 화면 + 그래프(전체화면 아님)면 본문/그래프 탭, 넓으면 좌우 분할.
 * 각 pane 표시 여부와 상태 클래스를 함께 돌려준다
 */
function resolvePanes({ isNarrow, showGraph, graphFullScreen, mobilePane }) {
  const useMobileTabs = isNarrow && showGraph && !graphFullScreen;
  const flags = {
    showGraph,
    graphFullScreen,
    useMobileTabs,
    isSplitView: showGraph && !graphFullScreen && !useMobileTabs,
    showReaderPane: !useMobileTabs || mobilePane === 'reader',
    showGraphPane: showGraph && (!useMobileTabs || mobilePane === 'graph'),
  };
  return { ...flags, readerState: readerPaneState(flags), graphState: graphPaneState(flags) };
}

function MobilePaneTabs({ value, onChange }) {
  return (
    <div className="viewer-mobile-pane-tabs" role="tablist" aria-label="본문과 그래프 전환">
      {MOBILE_PANE_TABS.map(({ pane, label }) => (
        <button
          key={pane}
          type="button"
          role="tab"
          aria-selected={value === pane}
          className={`viewer-mobile-pane-tab${value === pane ? ' is-active' : ''}`}
          onClick={() => onChange(pane)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** 나머지 props(...toolbarProps)는 ViewerToolbar로 그대로 전달 */
function ViewerLayout({
  children,
  rightSideContent,
  showGraph,
  graphFullScreen,
  showToolbar,
  currentChapter,
  progress,
  progressMetricsReady,
  onSliderChange,
  currentPage,
  totalPages,
  onViewerLayoutSettled,
  ...toolbarProps
}) {
  const splitRowRef = useRef(null);
  const isNarrow = useIsNarrowViewport();
  const { splitPercent, isDragging, dividerHandlers } = useSplitDivider(splitRowRef);
  const [mobilePane, setMobilePane] = useMobilePane(showGraph, isNarrow);
  const panes = resolvePanes({ isNarrow, showGraph, graphFullScreen, mobilePane });

  useLayoutSettle(
    `${showGraph}|${graphFullScreen}|${splitPercent}|${mobilePane}|${isNarrow}|${panes.showReaderPane}`,
    panes.showReaderPane && !graphFullScreen,
    onViewerLayoutSettled,
  );

  const chromeClass = `viewer-chrome${graphFullScreen ? ' is-fullscreen-hidden' : ''}`;

  return (
    <div className="viewer-layout">
      <div className={chromeClass}>
        <ViewerToolbar
          {...toolbarProps}
          showToolbar={showToolbar}
          currentChapter={currentChapter}
          showGraph={showGraph}
        />
      </div>

      {panes.useMobileTabs ? <MobilePaneTabs value={mobilePane} onChange={setMobilePane} /> : null}

      <div
        ref={splitRowRef}
        className={`viewer-split-row${isDragging ? ' is-split-dragging' : ''}`}
        style={panes.isSplitView ? { '--viewer-split-pct': `${splitPercent}%` } : undefined}
      >
        <div
          className={`viewer-pane viewer-pane-reader ${panes.readerState}`}
          data-graph-fullscreen={graphFullScreen}
        >
          {children}
        </div>

        {panes.isSplitView ? (
          <div
            className="viewer-split-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="본문과 그래프 영역 크기 조절"
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-valuenow={Math.round(splitPercent)}
            tabIndex={0}
            {...dividerHandlers}
          >
            <span className="viewer-split-divider-grip" aria-hidden />
          </div>
        ) : null}

        {showGraph ? (
          <div
            className={`viewer-pane viewer-pane-graph ${panes.graphState}`}
            data-graph-fullscreen={graphFullScreen}
            hidden={!panes.showGraphPane}
          >
            {rightSideContent}
          </div>
        ) : null}
      </div>

      <div className={chromeClass}>
        <ViewerProgressBar
          showToolbar={showToolbar}
          progress={progress}
          onSliderChange={onSliderChange}
          currentChapter={currentChapter}
          currentPage={currentPage}
          totalPages={totalPages}
          progressMetricsReady={progressMetricsReady}
        />
      </div>
    </div>
  );
}

export default ViewerLayout;

import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'react-toastify';
import ViewerToolbar from './ViewerToolbar';
import { useIsNarrowViewport, useSessionHint } from '../../hooks/common/hooksShared';
import './ViewerToolbar.css';

const SPLIT_STORAGE_KEY = 'viewer-graph-split-percent';
const CHROME_HINT_SESSION_KEY = 'rw-viewer-chrome-hint-seen';
const SPLIT_MIN = 32;
const SPLIT_MAX = 68;
const SPLIT_PERSIST_DEBOUNCE_MS = 300;
const CHROME_HINT_PANEL_ID = 'viewer-chrome-hint-panel';
/** ViewerToolbar.css의 .viewer-chrome opacity/visibility 전환(0.3s)이 끝난 뒤 resize를 쏘기 위한 지연 — 그 값과 반드시 함께 조정 */
const LAYOUT_SETTLE_DELAY_MS = 300;

function readStoredSplitPercent() {
  try {
    const n = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    if (Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX) return n;
  } catch {
    /* ignore */
  }
  return 50;
}

const ViewerProgressBar = memo(function ViewerProgressBar({
  showToolbar,
  progress = null,
  onSliderChange,
  currentChapter = 1,
  currentPage = 1,
  totalPages = 1,
  progressMetricsReady = true,
}) {
  const hasProgress = progress != null && Number.isFinite(Number(progress));
  const clamped = hasProgress ? Math.max(0, Math.min(Number(progress), 100)) : 0;
  const percentLabel =
    progressMetricsReady && hasProgress ? `${Math.round(clamped)}%` : '계산중';
  const chapterLabel = `챕터 ${Math.max(1, Math.trunc(Number(currentChapter) || 1))}`;

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
        value={clamped}
        onChange={onChange}
        disabled={!progressMetricsReady}
        aria-label="진행률 슬라이더"
        aria-busy={!progressMetricsReady}
        className="progressbar-slider"
      />
      <span className="viewer-progress-pct">{percentLabel}</span>
    </div>
  );
});

ViewerProgressBar.propTypes = {
  showToolbar: PropTypes.bool.isRequired,
  progress: PropTypes.number,
  onSliderChange: PropTypes.func,
  currentChapter: PropTypes.number,
  currentPage: PropTypes.number,
  totalPages: PropTypes.number,
  progressMetricsReady: PropTypes.bool,
};

function ViewerLayout({
  children,
  currentChapter,
  progress,
  progressMetricsReady = true,
  showToolbar,
  onPrev,
  onNext,
  isBookmarked = false,
  onAddBookmark,
  onToggleBookmarkList,
  onOpenSettings,
  onSliderChange,
  currentPage,
  totalPages,
  showGraph,
  onToggleGraph,
  rightSideContent,
  graphFullScreen,
  isFromLibrary = false,
  previousPage = null,
  onExitToMypage,
  onViewerLayoutSettled,
}) {
  const splitRowRef = useRef(null);
  const [splitPercent, setSplitPercent] = useState(readStoredSplitPercent);
  const isNarrow = useIsNarrowViewport();
  const [mobilePane, setMobilePane] = useState('reader');
  const [isSplitDragging, setIsSplitDragging] = useState(false);
  const chromeHint = useSessionHint(CHROME_HINT_SESSION_KEY);
  const { open: chromeHintOpen, dismiss: dismissChromeHint } = chromeHint;
  const prevShowGraphRef = useRef(showGraph);
  const skipInitialLayoutSettleRef = useRef(true);
  const onViewerLayoutSettledRef = useRef(onViewerLayoutSettled);
  onViewerLayoutSettledRef.current = onViewerLayoutSettled;

  useEffect(() => {
    const wasShown = prevShowGraphRef.current;
    prevShowGraphRef.current = showGraph;
    if (!showGraph) {
      setMobilePane('reader');
      return;
    }
    if (!wasShown && showGraph && isNarrow) {
      setMobilePane('reader');
      toast.info('그래프가 켜졌어요. 「그래프」 탭에서 확인할 수 있어요.', {
        autoClose: 3500,
      });
    }
  }, [showGraph, isNarrow]);

  const useMobileTabs = isNarrow && showGraph && !graphFullScreen;
  const showReaderPane = !useMobileTabs || mobilePane === 'reader';
  const showGraphPane = showGraph && (!useMobileTabs || mobilePane === 'graph');

  useEffect(() => {
    if (skipInitialLayoutSettleRef.current) {
      skipInitialLayoutSettleRef.current = false;
      return undefined;
    }
    const readerVisible = Boolean(showReaderPane && !graphFullScreen);
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (readerVisible) {
        onViewerLayoutSettledRef.current?.();
      }
    }, LAYOUT_SETTLE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [
    showGraph,
    graphFullScreen,
    splitPercent,
    mobilePane,
    isNarrow,
    showReaderPane,
  ]);

  useEffect(() => {
    // 드래그 중 pointermove마다 splitPercent가 바뀌므로, 값이 잠잠해진 뒤에만 저장
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPercent));
      } catch {
        /* ignore */
      }
    }, SPLIT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [splitPercent]);

  const activeDragCleanupRef = useRef(null);

  const onDividerPointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const row = splitRowRef.current;
    const target = event.currentTarget;
    if (!row || !target) return;

    const pointerId = event.pointerId;
    setIsSplitDragging(true);
    document.body.classList.add('viewer-split-dragging');

    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    const updateFromClientX = (clientX) => {
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = ((clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next)));
    };

    updateFromClientX(event.clientX);

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      updateFromClientX(e.clientX);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      try {
        if (target.hasPointerCapture?.(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch {
        /* ignore */
      }
      document.body.classList.remove('viewer-split-dragging');
      setIsSplitDragging(false);
      activeDragCleanupRef.current = null;
    };

    const onEnd = (e) => {
      if (e.pointerId !== pointerId) return;
      cleanup();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    activeDragCleanupRef.current = cleanup;
  }, []);

  useEffect(() => {
    return () => {
      activeDragCleanupRef.current?.();
    };
  }, []);

  const readerPaneClass = useMemo(() => {
    const base = 'viewer-pane viewer-pane-reader';
    if (graphFullScreen) return `${base} is-fullscreen-hidden`;
    if (useMobileTabs) {
      return `${base} is-mobile-tab${showReaderPane ? '' : ' is-hidden'}`;
    }
    if (showGraph) return `${base} is-split`;
    return `${base} is-alone`;
  }, [graphFullScreen, useMobileTabs, showReaderPane, showGraph]);

  const graphPaneClass = useMemo(() => {
    const base = 'viewer-pane viewer-pane-graph';
    if (!showGraphPane) return `${base} is-hidden`;
    if (useMobileTabs) return `${base} is-mobile-tab`;
    if (graphFullScreen) return `${base} is-fullscreen`;
    return `${base} is-split`;
  }, [showGraphPane, useMobileTabs, graphFullScreen]);

  const splitRowStyle = useMemo(() => {
    if (!showGraph || graphFullScreen || useMobileTabs) return undefined;
    return { '--viewer-split-pct': `${splitPercent}%` };
  }, [showGraph, graphFullScreen, useMobileTabs, splitPercent]);

  const chromeClass = `viewer-chrome${graphFullScreen ? ' is-fullscreen-hidden' : ''}`;

  return (
    <div className="viewer-layout">
      <div className={chromeClass}>
        <ViewerToolbar
          showToolbar={showToolbar}
          currentChapter={currentChapter}
          onPrev={onPrev}
          onNext={onNext}
          isBookmarked={isBookmarked}
          onAddBookmark={onAddBookmark}
          onToggleBookmarkList={onToggleBookmarkList}
          onOpenSettings={onOpenSettings}
          onToggleGraph={onToggleGraph}
          showGraph={showGraph}
          isFromLibrary={isFromLibrary}
          previousPage={previousPage}
          onExitToMypage={onExitToMypage}
        />
      </div>

      {useMobileTabs ? (
        <div className="viewer-mobile-pane-tabs" role="tablist" aria-label="본문과 그래프 전환">
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === 'reader'}
            className={`viewer-mobile-pane-tab${mobilePane === 'reader' ? ' is-active' : ''}`}
            onClick={() => setMobilePane('reader')}
          >
            본문
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === 'graph'}
            className={`viewer-mobile-pane-tab${mobilePane === 'graph' ? ' is-active' : ''}`}
            onClick={() => setMobilePane('graph')}
          >
            그래프
          </button>
        </div>
      ) : null}

      <div
        ref={splitRowRef}
        className={`viewer-split-row${isSplitDragging ? ' is-split-dragging' : ''}`}
        style={splitRowStyle}
      >
        <div
          className={readerPaneClass}
          data-graph-fullscreen={graphFullScreen}
        >
          {children}
        </div>

        {showGraph && !graphFullScreen && !useMobileTabs ? (
          <div
            className="viewer-split-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="본문과 그래프 영역 크기 조절"
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-valuenow={Math.round(splitPercent)}
            tabIndex={0}
            onPointerDown={onDividerPointerDown}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setSplitPercent((p) => Math.max(SPLIT_MIN, p - 2));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSplitPercent((p) => Math.min(SPLIT_MAX, p + 2));
              }
            }}
          >
            <span className="viewer-split-divider-grip" aria-hidden />
          </div>
        ) : null}

        {showGraph ? (
          <div
            className={graphPaneClass}
            data-graph-fullscreen={graphFullScreen}
            hidden={!showGraphPane}
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

      {chromeHintOpen ? (
        <div className="viewer-chrome-coach" role="status" aria-labelledby={CHROME_HINT_PANEL_ID}>
          <p id={CHROME_HINT_PANEL_ID} className="viewer-chrome-coach-title">
            화면 가운데를 탭하면 도구모음을 열고 닫을 수 있어요
          </p>
          <p className="viewer-chrome-coach-desc">
            좌우 가장자리 탭, 휠, 스와이프로 페이지를 넘길 수 있어요.
          </p>
          <div className="viewer-chrome-coach-actions">
            <button
              type="button"
              className="viewer-chrome-coach-btn viewer-chrome-coach-btn--primary"
              onClick={dismissChromeHint}
            >
              확인
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

ViewerLayout.propTypes = {
  children: PropTypes.node,
  currentChapter: PropTypes.number,
  progress: PropTypes.number,
  progressMetricsReady: PropTypes.bool,
  showToolbar: PropTypes.bool.isRequired,
  onPrev: PropTypes.func,
  onNext: PropTypes.func,
  isBookmarked: PropTypes.bool,
  onAddBookmark: PropTypes.func,
  onToggleBookmarkList: PropTypes.func,
  onOpenSettings: PropTypes.func,
  onSliderChange: PropTypes.func,
  currentPage: PropTypes.number,
  totalPages: PropTypes.number,
  showGraph: PropTypes.bool,
  onToggleGraph: PropTypes.func,
  rightSideContent: PropTypes.node,
  graphFullScreen: PropTypes.bool,
  isFromLibrary: PropTypes.bool,
  previousPage: PropTypes.object,
  onExitToMypage: PropTypes.func,
  onViewerLayoutSettled: PropTypes.func,
};

export default ViewerLayout;

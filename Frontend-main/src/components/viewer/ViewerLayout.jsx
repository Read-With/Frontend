import { createElement, useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkPlus,
  BookMarked,
  Columns2,
  Maximize2,
  Menu,
  Network,
  Settings,
  X,
} from 'lucide-react';
import { findViewerModeOption } from '../../utils/viewer/viewerSession';
import { userViewerPath, userGraphPath } from '../../utils/common/urlUtils';
import { useClickOutside } from '../../hooks/ui/tooltipHooks';
import { toast } from 'react-toastify';
import './ViewerToolbar.css';

const SPLIT_STORAGE_KEY = 'viewer-graph-split-percent';
const MODE_HINT_SESSION_KEY = 'rw-viewer-mode-hint-seen';
const CHROME_HINT_SESSION_KEY = 'rw-viewer-chrome-hint-seen';
const SPLIT_MIN = 32;
const SPLIT_MAX = 68;
const NARROW_MQ = '(max-width: 767px)';
const ICON_SM = 18;
const MODE_HINT_PANEL_ID = 'viewer-mode-hint-panel';
const CHROME_HINT_PANEL_ID = 'viewer-chrome-hint-panel';

function readStoredSplitPercent() {
  try {
    const n = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    if (Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX) return n;
  } catch {
    /* ignore */
  }
  return 50;
}

function readModeHintSeen() {
  try {
    return sessionStorage.getItem(MODE_HINT_SESSION_KEY) === '1';
  } catch {
    return true;
  }
}

function markModeHintSeen() {
  try {
    sessionStorage.setItem(MODE_HINT_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

function readChromeHintSeen() {
  try {
    return sessionStorage.getItem(CHROME_HINT_SESSION_KEY) === '1';
  } catch {
    return true;
  }
}

function markChromeHintSeen() {
  try {
    sessionStorage.setItem(CHROME_HINT_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

function ToolbarButton({
  onClick,
  title,
  ariaLabel,
  className = 'xhtml-toolbar-btn',
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      title={title}
      aria-label={ariaLabel || title}
      {...rest}
    >
      {children}
    </button>
  );
}

function IconLabel({ icon: Icon, label, center = false, strokeWidth = 2 }) {
  return (
    <span className={`viewer-toolbar-label${center ? ' is-centered' : ''}`}>
      {createElement(Icon, { size: ICON_SM, strokeWidth, 'aria-hidden': true })}
      {label != null ? <span className="viewer-toolbar-label-text">{label}</span> : null}
    </span>
  );
}

/** 본문만 ↔ 본문+그래프 토글 + 세션 1회 힌트 */
function ScreenModeToggle({
  showGraph,
  onToggleGraph,
  title,
  className,
  message,
  hintSeen,
  open,
  onDismissHint,
  menu = false,
}) {
  const rootRef = useClickOutside(() => {
    if (open) onDismissHint();
  }, open);

  const handleClick = () => {
    onDismissHint();
    onToggleGraph?.();
  };

  const modeLabel = showGraph ? '본문+그래프' : '본문만';

  return (
    <div className={`viewer-mode-hint${menu ? ' is-menu' : ''}`} ref={rootRef}>
      <ToolbarButton
        onClick={handleClick}
        title={title}
        ariaLabel={`보기 방식 전환, 현재 ${modeLabel}`}
        className={`${className}${!hintSeen ? ' has-hint' : ''}`}
        aria-expanded={open}
        aria-controls={open ? MODE_HINT_PANEL_ID : undefined}
      >
        {menu ? (
          <>
            {showGraph ? (
              <Columns2 size={ICON_SM} strokeWidth={2.5} aria-hidden />
            ) : (
              <Maximize2 size={ICON_SM} aria-hidden />
            )}
            <span className="viewer-mobile-menu-label">{modeLabel}</span>
          </>
        ) : (
          <IconLabel
            icon={showGraph ? Columns2 : Maximize2}
            label={modeLabel}
            center
            strokeWidth={showGraph ? 2.5 : 2}
          />
        )}
        {!hintSeen ? <span className="viewer-mode-hint-dot" aria-hidden /> : null}
      </ToolbarButton>
      {open ? (
        <p id={MODE_HINT_PANEL_ID} className="viewer-mode-hint-panel" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
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

function ViewerToolbar({
  showToolbar,
  currentChapter = 1,
  onPrev,
  onNext,
  isBookmarked = false,
  onAddBookmark,
  onToggleBookmarkList,
  onOpenSettings,
  onToggleGraph,
  showGraph,
  isFromLibrary = false,
  previousPage = null,
  onExitToMypage,
}) {
  const navigate = useNavigate();
  const { filename: bookId } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [modeHintSeen, setModeHintSeen] = useState(readModeHintSeen);
  const [modeHintOpen, setModeHintOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return false;
    }
    return !readModeHintSeen();
  });

  const dismissModeHint = useCallback(() => {
    markModeHintSeen();
    setModeHintSeen(true);
    setModeHintOpen(false);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) setShowMobileMenu(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || modeHintSeen) return;
    setModeHintOpen(showMobileMenu);
  }, [isMobile, showMobileMenu, modeHintSeen]);

  const viewMode = useMemo(() => findViewerModeOption(showGraph), [showGraph]);
  const ModeIcon = viewMode.Icon;
  const bookmarkTitle = isBookmarked
    ? '현재 위치 북마크 제거'
    : '현재 위치에 북마크 추가';
  const graphToggleTitle = showGraph
    ? '본문만 보기로 전환'
    : '본문+그래프로 전환';

  const handleGraphClick = useCallback(() => {
    const bookData =
      book || {
        title: String(bookId || '')
          .replace(/\.(xhtml|html|htm)$/i, '')
          .replace(/([A-Z])/g, ' $1')
          .trim(),
        author: '알 수 없음',
        path: `/${bookId}`,
        filename: bookId,
      };

    const currentPathname = location.pathname || userViewerPath(bookId);
    navigate(userGraphPath(bookId), {
      state: {
        book: bookData,
        selectedChapter: Number(currentChapter) || 1,
        fromLibrary: isFromLibrary,
        from: previousPage || { pathname: currentPathname, search: '' },
      },
      replace: false,
    });
  }, [book, bookId, currentChapter, isFromLibrary, location.pathname, navigate, previousPage]);

  const closeMobileMenu = useCallback(() => setShowMobileMenu(false), []);
  const toggleMobileMenu = useCallback(() => setShowMobileMenu((v) => !v), []);

  /** 메뉴는 햄버거로만 닫힘. 항목 클릭 시 바로 닫지 않아 연속 조작 가능 */
  const runMobileAction = useCallback(
    (action) => () => {
      action?.();
    },
    []
  );

  const graphToggleClass = `xhtml-toolbar-btn xhtml-toolbar-btn--graph-toggle${
    showGraph ? ' is-active' : ''
  }`;
  const mobileGraphToggleClass = `xhtml-toolbar-btn xhtml-toolbar-btn--menu${
    showGraph ? ' is-active' : ''
  }`;

  return (
    <div className={`viewer-toolbar${showToolbar ? '' : ' is-hidden'}`}>
      {isMobile ? (
        <div className="viewer-toolbar-mobile">
          <div className="viewer-toolbar-mobile-nav">
            <ToolbarButton
              onClick={onPrev}
              title="이전 페이지"
              className="xhtml-toolbar-btn xhtml-toolbar-btn--compact"
            >
              <ArrowLeft size={ICON_SM} aria-hidden />
            </ToolbarButton>
            <ToolbarButton
              onClick={onNext}
              title="다음 페이지"
              className="xhtml-toolbar-btn xhtml-toolbar-btn--compact"
            >
              <ArrowRight size={ICON_SM} aria-hidden />
            </ToolbarButton>
          </div>
          <div className="viewer-toolbar-mobile-mode">{viewMode.label}</div>
          <ToolbarButton
            onClick={toggleMobileMenu}
            title={showMobileMenu ? '메뉴 닫기' : '메뉴 열기'}
            ariaLabel={showMobileMenu ? '메뉴 닫기' : '메뉴 열기'}
            className={`xhtml-toolbar-btn xhtml-toolbar-btn--compact${!modeHintSeen ? ' has-hint' : ''}`}
          >
            {showMobileMenu ? (
              <X size={ICON_SM} aria-hidden />
            ) : (
              <Menu size={ICON_SM} aria-hidden />
            )}
            {!modeHintSeen ? <span className="viewer-mode-hint-dot" aria-hidden /> : null}
          </ToolbarButton>
        </div>
      ) : (
        <div className="viewer-toolbar-group-wrap">
          <div className="viewer-toolbar-group-left">
            <div className="toolbar-group toolbar-group--nav">
              <ToolbarButton onClick={onPrev} title="이전 페이지로 이동" ariaLabel="이전 페이지">
                <IconLabel icon={ArrowLeft} label="이전" />
              </ToolbarButton>
              <ToolbarButton onClick={onNext} title="다음 페이지로 이동" ariaLabel="다음 페이지">
                <span className="viewer-toolbar-label">
                  다음
                  <ArrowRight size={ICON_SM} aria-hidden />
                </span>
              </ToolbarButton>
            </div>

            <div className="toolbar-group toolbar-group--bookmark">
              <ToolbarButton
                onClick={onAddBookmark}
                title={bookmarkTitle}
                ariaLabel="북마크"
                className="xhtml-toolbar-btn xhtml-toolbar-btn--w-md"
              >
                <IconLabel
                  icon={isBookmarked ? Bookmark : BookmarkPlus}
                  label="북마크"
                  center
                  strokeWidth={isBookmarked ? 2.5 : 2}
                />
              </ToolbarButton>
              <ToolbarButton
                onClick={onToggleBookmarkList}
                title="북마크 목록 열기"
                ariaLabel="북마크 목록"
                className="xhtml-toolbar-btn xhtml-toolbar-btn--w-lg"
              >
                <IconLabel icon={BookMarked} label="북마크 목록" center />
              </ToolbarButton>
            </div>

            <div className="toolbar-group toolbar-group--mode">
              <ToolbarButton
                onClick={handleGraphClick}
                title="챕터별 전체 관계도 페이지로 이동"
                ariaLabel="전체 관계도"
                className="xhtml-toolbar-btn xhtml-toolbar-btn--w-lg"
              >
                <IconLabel icon={Network} label="전체 관계도" center />
              </ToolbarButton>
              <ScreenModeToggle
                showGraph={showGraph}
                onToggleGraph={onToggleGraph}
                title={graphToggleTitle}
                className={graphToggleClass}
                message={
                  showGraph
                    ? '「본문+그래프」로 읽으면서 관계를 볼 수 있고, 「전체 관계도」는 챕터를 골라 탐색하는 별도 화면입니다.'
                    : '인물 관계를 함께 보려면 「본문+그래프」를 켜 보세요. 「전체 관계도」는 챕터 탐색용 별도 화면입니다.'
                }
                hintSeen={modeHintSeen}
                open={modeHintOpen}
                onDismissHint={dismissModeHint}
              />
              <div
                className={`viewer-view-mode-badge${showGraph ? ' is-graph-on' : ''}`}
                title={viewMode.label}
              >
                <ModeIcon size={ICON_SM} strokeWidth={2.5} aria-hidden />
                <span className="viewer-view-mode-badge-label">{viewMode.label}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-group-right">
            <div className="toolbar-group-right-inner">
              <ToolbarButton
                onClick={onOpenSettings}
                title="뷰어 설정 열기"
                ariaLabel="설정"
                className="xhtml-toolbar-btn xhtml-toolbar-btn--w-sm"
              >
                <span className="viewer-toolbar-settings-label">
                  <Settings size={ICON_SM} aria-hidden />
                  <span className="viewer-toolbar-settings-text">설정</span>
                </span>
              </ToolbarButton>
              <ToolbarButton
                onClick={onExitToMypage}
                title="마이페이지로 돌아가기"
                ariaLabel="닫기"
                className="xhtml-toolbar-btn xhtml-toolbar-btn--icon"
              >
                <X size={ICON_SM} aria-hidden />
              </ToolbarButton>
            </div>
          </div>
        </div>
      )}

      {showMobileMenu ? (
        <div className="viewer-mobile-menu" role="menu" aria-label="뷰어 메뉴">
          <div className="viewer-mobile-menu-grid">
            <ToolbarButton
              onClick={runMobileAction(onAddBookmark)}
              title={bookmarkTitle}
              className="xhtml-toolbar-btn xhtml-toolbar-btn--menu"
            >
              {isBookmarked ? (
                <Bookmark size={ICON_SM} aria-hidden />
              ) : (
                <BookmarkPlus size={ICON_SM} aria-hidden />
              )}
              <span className="viewer-mobile-menu-label">북마크</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={runMobileAction(() => {
                closeMobileMenu();
                onToggleBookmarkList?.();
              })}
              title="북마크 목록 보기"
              className="xhtml-toolbar-btn xhtml-toolbar-btn--menu"
            >
              <BookMarked size={ICON_SM} aria-hidden />
              <span className="viewer-mobile-menu-label">북마크 목록</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={runMobileAction(() => {
                closeMobileMenu();
                handleGraphClick();
              })}
              title="챕터별 전체 관계도 페이지로 이동"
              className="xhtml-toolbar-btn xhtml-toolbar-btn--menu"
            >
              <Network size={ICON_SM} aria-hidden />
              <span className="viewer-mobile-menu-label">전체 관계도</span>
            </ToolbarButton>
            <ScreenModeToggle
              menu
              showGraph={showGraph}
              onToggleGraph={onToggleGraph}
              title={graphToggleTitle}
              className={mobileGraphToggleClass}
              message={
                showGraph
                  ? '「본문+그래프」는 분할 보기, 「전체 관계도」는 챕터 탐색용 별도 화면입니다.'
                  : '인물 관계를 함께 보려면 「본문+그래프」를 켜 보세요. 「전체 관계도」는 챕터 탐색용입니다.'
              }
              hintSeen={modeHintSeen}
              open={modeHintOpen}
              onDismissHint={dismissModeHint}
            />
            <ToolbarButton
              onClick={runMobileAction(() => {
                closeMobileMenu();
                onOpenSettings?.();
              })}
              title="뷰어 설정 열기"
              className="xhtml-toolbar-btn xhtml-toolbar-btn--menu"
            >
              <Settings size={ICON_SM} aria-hidden />
              <span className="viewer-mobile-menu-label">설정</span>
            </ToolbarButton>
            <button
              type="button"
              onClick={runMobileAction(() => {
                closeMobileMenu();
                onExitToMypage?.();
              })}
              className="viewer-mobile-menu-exit"
              title="마이페이지로 돌아가기"
              aria-label="닫기"
            >
              <X size={ICON_SM} aria-hidden />
              <span className="viewer-mobile-menu-label">닫기</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_MQ).matches
  );
  const [mobilePane, setMobilePane] = useState('reader');
  const [isSplitDragging, setIsSplitDragging] = useState(false);
  const [chromeHintOpen, setChromeHintOpen] = useState(() => !readChromeHintSeen());
  const prevShowGraphRef = useRef(showGraph);
  const skipInitialLayoutSettleRef = useRef(true);
  const onViewerLayoutSettledRef = useRef(onViewerLayoutSettled);
  onViewerLayoutSettledRef.current = onViewerLayoutSettled;

  const dismissChromeHint = useCallback(() => {
    markChromeHintSeen();
    setChromeHintOpen(false);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
    }, 300);
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
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPercent));
    } catch {
      /* ignore */
    }
  }, [splitPercent]);

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

    const onEnd = (e) => {
      if (e.pointerId !== pointerId) return;
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
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
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

export default ViewerLayout;

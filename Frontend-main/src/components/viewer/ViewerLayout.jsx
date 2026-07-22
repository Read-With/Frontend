import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { findViewerModeOption } from '../../utils/viewer/viewerSession';
import { userViewerPath, userGraphPath } from '../../utils/common/urlUtils';
import './ViewerToolbar.css';

const PROGRESS_BAR_COLOR = '#5C6F5C';
const PROGRESS_BAR_BG = '#e7eaf7';

const TOOLBAR_BTN = {
  backgroundColor: 'white',
  color: '#1B5E20',
  border: '1px solid #388E3C',
};

const mobileMenuClass = 'flex items-center justify-center gap-2 p-3 rounded-lg transition-colors';
const iconMb = { marginBottom: '-2px' };
const flexLabel = { display: 'flex', alignItems: 'center', gap: '0.45em' };
const flexLabelCenter = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.45em',
  width: '100%',
};

function onBtnOver(e) {
  e.currentTarget.style.backgroundColor = '#e8f5e8';
}

function onBtnOut(e) {
  e.currentTarget.style.backgroundColor = 'white';
}

function ToolbarButton({
  onClick,
  title,
  ariaLabel,
  style,
  className = 'xhtml-toolbar-btn',
  children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={style ? { ...TOOLBAR_BTN, ...style } : TOOLBAR_BTN}
      title={title}
      aria-label={ariaLabel || title}
      onMouseOver={onBtnOver}
      onMouseOut={onBtnOut}
    >
      {children}
    </button>
  );
}

function IconLabel({ icon, label, center = false, boldIcon = false }) {
  return (
    <span style={center ? flexLabelCenter : flexLabel}>
      <span
        className="material-symbols-outlined"
        style={boldIcon ? { ...iconMb, fontWeight: 'bold' } : iconMb}
      >
        {icon}
      </span>
      {label != null && <span style={center ? { fontWeight: '600' } : undefined}>{label}</span>}
    </span>
  );
}

const ViewerProgressBar = memo(function ViewerProgressBar({
  showControls,
  progress = null,
  onSliderChange,
  currentPage = 1,
  totalPages = 1,
  progressMetricsReady = true,
}) {
  const hasProgress = progress != null && Number.isFinite(Number(progress));
  const clamped = hasProgress ? Math.max(0, Math.min(Number(progress), 100)) : 0;
  const percentLabel =
    progressMetricsReady && hasProgress ? `${Math.round(clamped)}%` : '계산중';

  const onChange = (e) => {
    if (!progressMetricsReady || !onSliderChange) return;
    onSliderChange(Number(e.target.value));
  };

  return (
    <div
      className={`w-full z-20 px-6 py-2 flex justify-between items-center shadow-md transition-opacity duration-300 ${
        showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        backdropFilter: 'blur(8px)',
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 16,
        boxShadow: '0 2px 16px rgba(79,109,222,0.10)',
        margin: '0.5rem 0 0.5rem 1rem',
        maxWidth: 700,
      }}
    >
      <span style={{ fontWeight: 700, color: '#22336b', fontSize: '1.08rem', minWidth: 70 }}>
        {currentPage} / {totalPages}
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={clamped}
        onChange={onChange}
        disabled={!progressMetricsReady}
        style={{
          width: '60%',
          accentColor: PROGRESS_BAR_COLOR,
          height: 6,
          borderRadius: 8,
          background: PROGRESS_BAR_BG,
          boxShadow: '0 1px 6px rgba(79,109,222,0.07)',
          outline: 'none',
          appearance: 'none',
          opacity: progressMetricsReady ? 1 : 0.55,
          cursor: progressMetricsReady ? 'pointer' : 'not-allowed',
        }}
        aria-label="진행률 슬라이더"
        aria-busy={!progressMetricsReady}
        className="progressbar-slider"
      />
      <span
        style={{
          fontWeight: 700,
          color: PROGRESS_BAR_COLOR,
          fontSize: '1.08rem',
          minWidth: 60,
          textAlign: 'right',
        }}
      >
        {percentLabel}
      </span>
    </div>
  );
});

function ViewerToolbar({
  showControls,
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

  const viewMode = useMemo(() => findViewerModeOption(showGraph), [showGraph]);
  const bookmarkTitle = isBookmarked
    ? '현재 위치 북마크 제거'
    : '현재 위치에 북마크 추가';
  const graphToggleTitle = showGraph ? '그래프 숨기기' : '그래프 표시';

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

  const runMobileAction = useCallback(
    (action) => () => {
      closeMobileMenu();
      action?.();
    },
    [closeMobileMenu]
  );

  const graphToggleStyleMobile = useMemo(
    () => ({
      border: showGraph ? '2px solid #388E3C' : TOOLBAR_BTN.border,
      boxShadow: showGraph
        ? '0 4px 12px rgba(56, 142, 60, 0.2)'
        : '0 2px 4px rgba(56, 142, 60, 0.1)',
      transform: showGraph ? 'scale(1.05)' : 'scale(1)',
    }),
    [showGraph]
  );

  const graphToggleStyleDesktop = useMemo(
    () => ({
      width: '9rem',
      marginRight: '0.5rem',
      border: showGraph ? '2px solid #388E3C' : TOOLBAR_BTN.border,
    }),
    [showGraph]
  );

  const viewModeBadgeStyle = useMemo(
    () => ({
      padding: '0.5rem 1rem',
      marginLeft: '1rem',
      borderRadius: '1rem',
      backgroundColor: showGraph ? '#E8F5E8' : '#F1F8E9',
      color: '#1B5E20',
      fontWeight: '600',
      fontSize: '0.9rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5em',
      border: showGraph ? '2px solid #388E3C' : '1px solid #388E3C',
      boxShadow: showGraph
        ? '0 2px 8px rgba(56, 142, 60, 0.15)'
        : '0 1px 3px rgba(56, 142, 60, 0.1)',
      transition: 'all 0.2s ease',
    }),
    [showGraph]
  );

  return (
    <div
      className={`w-full z-20 relative transition-all duration-300 ${
        showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        backgroundColor: 'white',
        backdropFilter: 'blur(4px)',
        borderBottom: '1.5px solid #e7eaf7',
        padding: isMobile ? '0.5rem' : '0.4rem 0.7rem',
      }}
    >
      {isMobile ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ToolbarButton
              onClick={onPrev}
              title="이전 페이지"
              className="p-2 rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={onNext}
              title="다음 페이지"
              className="p-2 rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined">arrow_forward</span>
            </ToolbarButton>
          </div>
          <div className="flex-1 text-center">
            <span className="text-xs text-gray-600 font-medium">{viewMode.label}</span>
          </div>
          <ToolbarButton
            onClick={toggleMobileMenu}
            title="메뉴"
            ariaLabel={showMobileMenu ? '메뉴 닫기' : '메뉴 열기'}
            className="p-2 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined">menu</span>
          </ToolbarButton>
        </div>
      ) : (
        <div
          className="viewer-toolbar-group-wrap"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            width: '100%',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              className="toolbar-group"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '2rem' }}
            >
              <ToolbarButton onClick={onPrev} title="이전 페이지로 이동" ariaLabel="이전 페이지">
                <IconLabel icon="arrow_back" label="이전" />
              </ToolbarButton>
              <ToolbarButton onClick={onNext} title="다음 페이지로 이동" ariaLabel="다음 페이지">
                <span style={flexLabel}>
                  다음
                  <span className="material-symbols-outlined" style={iconMb}>
                    arrow_forward
                  </span>
                </span>
              </ToolbarButton>
            </div>

            <div
              className="toolbar-group"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem' }}
            >
              <ToolbarButton
                onClick={onAddBookmark}
                title={bookmarkTitle}
                ariaLabel="북마크"
                style={{ width: '7rem' }}
              >
                <IconLabel
                  icon={isBookmarked ? 'bookmark' : 'bookmark_add'}
                  label="북마크"
                  center
                />
              </ToolbarButton>
              <ToolbarButton
                onClick={onToggleBookmarkList}
                title="북마크 목록 열기"
                ariaLabel="북마크 목록"
                style={{ width: '9rem' }}
              >
                <IconLabel icon="bookmarks" label="북마크 목록" center />
              </ToolbarButton>
            </div>

            <div
              className="toolbar-group"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginLeft: '1rem',
                marginRight: '1rem',
              }}
            >
              <ToolbarButton
                onClick={handleGraphClick}
                title="인물 관계도 페이지로 이동"
                ariaLabel="인물 관계도"
                style={{ width: '9rem' }}
              >
                <IconLabel icon="account_tree" label="인물 관계도" center />
              </ToolbarButton>
              <ToolbarButton
                onClick={onToggleGraph}
                title={graphToggleTitle}
                ariaLabel="그래프 토글"
                style={graphToggleStyleDesktop}
              >
                <IconLabel
                  icon={showGraph ? 'view_column' : 'open_in_full'}
                  label="화면 모드"
                  center
                  boldIcon={showGraph}
                />
              </ToolbarButton>
              <div className="current-view-mode" title={viewMode.label} style={viewModeBadgeStyle}>
                <span className="material-symbols-outlined" style={{ ...iconMb, fontWeight: 'bold' }}>
                  {viewMode.icon}
                </span>
                <span style={{ fontWeight: '600' }}>{viewMode.label}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-group-right" style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginRight: '0.5rem',
              }}
            >
              <ToolbarButton
                onClick={onOpenSettings}
                title="뷰어 설정 열기"
                ariaLabel="설정"
                style={{ width: '5.5rem' }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4em',
                    flexDirection: 'row',
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ marginBottom: '-2px', fontSize: '18px' }}
                  >
                    settings
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>설정</span>
                </span>
              </ToolbarButton>
              <ToolbarButton
                onClick={onExitToMypage}
                title="마이페이지로 돌아가기"
                ariaLabel="닫기"
                style={{ width: 40, minWidth: 40, padding: 0, justifyContent: 'center' }}
              >
                <span className="material-symbols-outlined" style={iconMb}>
                  close
                </span>
              </ToolbarButton>
            </div>
          </div>
        </div>
      )}

      {showMobileMenu && (
        <div className="absolute top-full left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
          <div className="p-4 grid grid-cols-2 gap-3">
            <ToolbarButton
              onClick={runMobileAction(onAddBookmark)}
              title={bookmarkTitle}
              className={mobileMenuClass}
            >
              <span className="material-symbols-outlined">
                {isBookmarked ? 'bookmark' : 'bookmark_add'}
              </span>
              <span className="text-sm font-semibold">북마크</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={runMobileAction(onToggleBookmarkList)}
              title="북마크 목록 보기"
              className={mobileMenuClass}
            >
              <span className="material-symbols-outlined">bookmarks</span>
              <span className="text-sm font-semibold">북마크 목록</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={runMobileAction(handleGraphClick)}
              title="인물 관계도 페이지로 이동"
              className={mobileMenuClass}
            >
              <span className="material-symbols-outlined">account_tree</span>
              <span className="text-sm font-medium">인물 관계도</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={runMobileAction(onToggleGraph)}
              title={graphToggleTitle}
              className={`${mobileMenuClass} transition-all duration-200`}
              style={graphToggleStyleMobile}
            >
              <span
                className="material-symbols-outlined"
                style={showGraph ? { fontWeight: 'bold' } : undefined}
              >
                {showGraph ? 'view_column' : 'open_in_full'}
              </span>
              <span className="text-sm font-semibold">화면 모드</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={runMobileAction(onOpenSettings)}
              title="뷰어 설정 열기"
              className={mobileMenuClass}
            >
              <span className="material-symbols-outlined">settings</span>
              <span className="text-sm font-medium">설정</span>
            </ToolbarButton>
            <button
              type="button"
              onClick={runMobileAction(onExitToMypage)}
              className="flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
              title="마이페이지로 돌아가기"
              aria-label="닫기"
            >
              <span className="material-symbols-outlined">close</span>
              <span className="text-sm font-medium">닫기</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewerLayout({
  children,
  currentChapter,
  progress,
  progressMetricsReady = true,
  showControls,
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
}) {
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
    return () => window.clearTimeout(id);
  }, [showGraph, graphFullScreen]);

  const chromeHiddenStyle = useMemo(
    () => ({
      opacity: graphFullScreen ? 0 : 1,
      visibility: graphFullScreen ? 'hidden' : 'visible',
      transition: 'opacity 0.3s ease, visibility 0.3s ease',
      flexShrink: 0,
      pointerEvents: graphFullScreen ? 'none' : 'auto',
    }),
    [graphFullScreen]
  );

  const readerPaneStyle = useMemo(() => {
    if (graphFullScreen) {
      return { width: '0%', display: 'none', minWidth: '0px', borderRight: 'none' };
    }
    if (showGraph) {
      return { width: '50%', borderRight: '1px solid #e2e8f0', display: 'block', minWidth: 'auto' };
    }
    return { width: '100%', borderRight: 'none', display: 'block', minWidth: 'auto' };
  }, [showGraph, graphFullScreen]);

  const graphPaneStyle = useMemo(
    () => ({
      width: graphFullScreen ? '100%' : '50%',
      position: 'relative',
      boxShadow: graphFullScreen ? 'none' : '-2px 0 10px rgba(0, 0, 0, 0.05)',
      minWidth: graphFullScreen ? '100%' : '50%',
    }),
    [graphFullScreen]
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div style={{ ...chromeHiddenStyle, height: graphFullScreen ? '60px' : 'auto' }}>
        <ViewerToolbar
          showControls={showControls}
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

      <div className="flex-1 overflow-hidden flex" style={{ backgroundColor: '#fdfdfd' }}>
        <div
          className="h-full overflow-hidden relative"
          style={readerPaneStyle}
          data-graph-fullscreen={graphFullScreen}
        >
          {children}
        </div>

        {showGraph && (
          <div
            className="h-full overflow-hidden bg-white"
            style={graphPaneStyle}
            data-graph-fullscreen={graphFullScreen}
          >
            {rightSideContent}
          </div>
        )}
      </div>

      <div style={{ ...chromeHiddenStyle, height: graphFullScreen ? '80px' : 'auto' }}>
        <ViewerProgressBar
          showControls={showControls}
          progress={progress}
          onSliderChange={onSliderChange}
          currentPage={currentPage}
          totalPages={totalPages}
          progressMetricsReady={progressMetricsReady}
        />
      </div>
    </div>
  );
}

export default ViewerLayout;

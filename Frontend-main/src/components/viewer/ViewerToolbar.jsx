import { createElement, useState, useEffect, useMemo } from 'react';
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
import { useIsNarrowViewport } from '../../hooks/common/hooksShared';
import { useOpenGraphPage } from '../../hooks/viewer/useOpenGraphPage';
import './ViewerToolbar.css';

const ICON_SM = 18;

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

/** 본문만 ↔ 본문+그래프 토글 */
function ScreenModeToggle({
  showGraph,
  onToggleGraph,
  title,
  className,
  menu = false,
}) {
  const modeLabel = showGraph ? '본문+그래프' : '본문만';

  return (
    <ToolbarButton
      onClick={onToggleGraph}
      title={title}
      ariaLabel={`보기 방식 전환, 현재 ${modeLabel}`}
      className={className}
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
    </ToolbarButton>
  );
}

const BTN = 'xhtml-toolbar-btn';
const COMPACT_BTN = `${BTN} ${BTN}--compact`;
const MENU_BTN = `${BTN} ${BTN}--menu`;
const EXIT_TITLE = '마이페이지로 돌아가기';
const GRAPH_PAGE_TITLE = '챕터별 전체 관계도 페이지로 이동';

function MobileToolbar({ onPrev, onNext, modeLabel, menuOpen, onToggleMenu }) {
  const menuLabel = menuOpen ? '메뉴 닫기' : '메뉴 열기';
  return (
    <div className="viewer-toolbar-mobile">
      <div className="viewer-toolbar-mobile-nav">
        <ToolbarButton onClick={onPrev} title="이전 페이지 (←)" className={COMPACT_BTN}>
          <ArrowLeft size={ICON_SM} aria-hidden />
        </ToolbarButton>
        <ToolbarButton onClick={onNext} title="다음 페이지 (→)" className={COMPACT_BTN}>
          <ArrowRight size={ICON_SM} aria-hidden />
        </ToolbarButton>
      </div>
      <div className="viewer-toolbar-mobile-mode">{modeLabel}</div>
      <ToolbarButton onClick={onToggleMenu} title={menuLabel} ariaLabel={menuLabel} className={COMPACT_BTN}>
        {menuOpen ? <X size={ICON_SM} aria-hidden /> : <Menu size={ICON_SM} aria-hidden />}
      </ToolbarButton>
    </div>
  );
}

function DesktopToolbar({
  onPrev,
  onNext,
  isBookmarked,
  bookmarkTitle,
  onAddBookmark,
  onToggleBookmarkList,
  onOpenGraphPage,
  showGraph,
  onToggleGraph,
  graphToggleTitle,
  viewMode,
  onOpenSettings,
  onExitToMypage,
}) {
  const ModeIcon = viewMode.Icon;
  return (
    <div className="viewer-toolbar-group-wrap">
      <div className="viewer-toolbar-group-left">
        <div className="toolbar-group toolbar-group--nav">
          <ToolbarButton onClick={onPrev} title="이전 페이지로 이동 (←)" ariaLabel="이전 페이지">
            <IconLabel icon={ArrowLeft} label="이전" />
          </ToolbarButton>
          <ToolbarButton onClick={onNext} title="다음 페이지로 이동 (→)" ariaLabel="다음 페이지">
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
            className={`${BTN} ${BTN}--w-md`}
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
            className={`${BTN} ${BTN}--w-lg`}
          >
            <IconLabel icon={BookMarked} label="북마크 목록" center />
          </ToolbarButton>
        </div>

        <div className="toolbar-group toolbar-group--mode">
          <ToolbarButton
            onClick={onOpenGraphPage}
            title={GRAPH_PAGE_TITLE}
            ariaLabel="전체 관계도"
            className={`${BTN} ${BTN}--w-lg`}
          >
            <IconLabel icon={Network} label="전체 관계도" center />
          </ToolbarButton>
          <ScreenModeToggle
            showGraph={showGraph}
            onToggleGraph={onToggleGraph}
            title={graphToggleTitle}
            className={`${BTN} ${BTN}--graph-toggle${showGraph ? ' is-active' : ''}`}
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
            className={`${BTN} ${BTN}--w-sm`}
          >
            <span className="viewer-toolbar-settings-label">
              <Settings size={ICON_SM} aria-hidden />
              <span className="viewer-toolbar-settings-text">설정</span>
            </span>
          </ToolbarButton>
          <ToolbarButton
            onClick={onExitToMypage}
            title={EXIT_TITLE}
            ariaLabel="닫기"
            className={`${BTN} ${BTN}--icon`}
          >
            <X size={ICON_SM} aria-hidden />
          </ToolbarButton>
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, title, onClick }) {
  return (
    <ToolbarButton onClick={onClick} title={title} className={MENU_BTN}>
      <Icon size={ICON_SM} aria-hidden />
      <span className="viewer-mobile-menu-label">{label}</span>
    </ToolbarButton>
  );
}

/** 모바일 메뉴. 북마크 추가·보기 전환은 메뉴를 열어둔 채 연속 조작, 나머지는 닫고 실행 */
function MobileMenu({
  onClose,
  isBookmarked,
  bookmarkTitle,
  onAddBookmark,
  onToggleBookmarkList,
  onOpenGraphPage,
  showGraph,
  onToggleGraph,
  graphToggleTitle,
  onOpenSettings,
  onExitToMypage,
}) {
  const closeThen = (action) => () => {
    onClose();
    action?.();
  };

  return (
    <div className="viewer-mobile-menu" role="menu" aria-label="뷰어 메뉴">
      <div className="viewer-mobile-menu-grid">
        <MenuItem
          icon={isBookmarked ? Bookmark : BookmarkPlus}
          label="북마크"
          title={bookmarkTitle}
          onClick={onAddBookmark}
        />
        <MenuItem
          icon={BookMarked}
          label="북마크 목록"
          title="북마크 목록 보기"
          onClick={closeThen(onToggleBookmarkList)}
        />
        <MenuItem icon={Network} label="전체 관계도" title={GRAPH_PAGE_TITLE} onClick={closeThen(onOpenGraphPage)} />
        <ScreenModeToggle
          menu
          showGraph={showGraph}
          onToggleGraph={onToggleGraph}
          title={graphToggleTitle}
          className={`${MENU_BTN}${showGraph ? ' is-active' : ''}`}
        />
        <MenuItem icon={Settings} label="설정" title="뷰어 설정 열기" onClick={closeThen(onOpenSettings)} />
        <button
          type="button"
          onClick={closeThen(onExitToMypage)}
          className="viewer-mobile-menu-exit"
          title={EXIT_TITLE}
          aria-label="닫기"
        >
          <X size={ICON_SM} aria-hidden />
          <span className="viewer-mobile-menu-label">닫기</span>
        </button>
      </div>
    </div>
  );
}

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
  onExitToMypage,
}) {
  const isMobile = useIsNarrowViewport();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const openGraphPage = useOpenGraphPage(currentChapter);

  useEffect(() => {
    if (!isMobile) setShowMobileMenu(false);
  }, [isMobile]);

  const viewMode = useMemo(() => findViewerModeOption(showGraph), [showGraph]);
  const shared = {
    isBookmarked,
    bookmarkTitle: isBookmarked ? '현재 위치 북마크 제거' : '현재 위치에 북마크 추가',
    onAddBookmark,
    onToggleBookmarkList,
    onOpenGraphPage: openGraphPage,
    showGraph,
    onToggleGraph,
    graphToggleTitle: showGraph ? '본문만 보기로 전환' : '본문+그래프로 전환',
    onOpenSettings,
    onExitToMypage,
  };

  return (
    <div className={`viewer-toolbar${showToolbar ? '' : ' is-hidden'}`}>
      {isMobile ? (
        <MobileToolbar
          onPrev={onPrev}
          onNext={onNext}
          modeLabel={viewMode.label}
          menuOpen={showMobileMenu}
          onToggleMenu={() => setShowMobileMenu((v) => !v)}
        />
      ) : (
        <DesktopToolbar onPrev={onPrev} onNext={onNext} viewMode={viewMode} {...shared} />
      )}

      {showMobileMenu ? <MobileMenu onClose={() => setShowMobileMenu(false)} {...shared} /> : null}
    </div>
  );
}

export default ViewerToolbar;

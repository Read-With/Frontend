import { createElement, useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
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
import './ViewerToolbar.css';

const MODE_HINT_SESSION_KEY = 'rw-viewer-mode-hint-seen';
const ICON_SM = 18;
const MODE_HINT_PANEL_ID = 'viewer-mode-hint-panel';

/** 세션 1회성 온보딩 힌트의 sessionStorage 읽기·기록 공통화 — ViewerLayout의 도구모음 힌트도 이 팩토리를 재사용 */
// eslint-disable-next-line react-refresh/only-export-components -- 컴포넌트 곁에 둔 순수 유틸이라 새 파일을 만들지 않기로 함
export function createSessionHintStorage(key) {
  return {
    read() {
      try {
        return sessionStorage.getItem(key) === '1';
      } catch {
        return true;
      }
    },
    mark() {
      try {
        sessionStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
    },
  };
}

const modeHintStorage = createSessionHintStorage(MODE_HINT_SESSION_KEY);

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

ToolbarButton.propTypes = {
  onClick: PropTypes.func,
  title: PropTypes.string,
  ariaLabel: PropTypes.string,
  className: PropTypes.string,
  children: PropTypes.node,
};

function IconLabel({ icon: Icon, label, center = false, strokeWidth = 2 }) {
  return (
    <span className={`viewer-toolbar-label${center ? ' is-centered' : ''}`}>
      {createElement(Icon, { size: ICON_SM, strokeWidth, 'aria-hidden': true })}
      {label != null ? <span className="viewer-toolbar-label-text">{label}</span> : null}
    </span>
  );
}

IconLabel.propTypes = {
  icon: PropTypes.elementType.isRequired,
  label: PropTypes.node,
  center: PropTypes.bool,
  strokeWidth: PropTypes.number,
};

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

ScreenModeToggle.propTypes = {
  showGraph: PropTypes.bool,
  onToggleGraph: PropTypes.func,
  title: PropTypes.string,
  className: PropTypes.string,
  message: PropTypes.string,
  hintSeen: PropTypes.bool,
  open: PropTypes.bool,
  onDismissHint: PropTypes.func.isRequired,
  menu: PropTypes.bool,
};

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
  const [modeHintSeen, setModeHintSeen] = useState(modeHintStorage.read);
  const [modeHintOpen, setModeHintOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return false;
    }
    return !modeHintStorage.read();
  });

  const dismissModeHint = useCallback(() => {
    modeHintStorage.mark();
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

ViewerToolbar.propTypes = {
  showToolbar: PropTypes.bool.isRequired,
  currentChapter: PropTypes.number,
  onPrev: PropTypes.func,
  onNext: PropTypes.func,
  isBookmarked: PropTypes.bool,
  onAddBookmark: PropTypes.func,
  onToggleBookmarkList: PropTypes.func,
  onOpenSettings: PropTypes.func,
  onToggleGraph: PropTypes.func,
  showGraph: PropTypes.bool,
  isFromLibrary: PropTypes.bool,
  previousPage: PropTypes.object,
  onExitToMypage: PropTypes.func,
};

export default ViewerToolbar;

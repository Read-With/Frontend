import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import './ViewerToolbar.css';

const TOOLBAR_BTN = {
  backgroundColor: 'white',
  color: '#1B5E20',
  border: '1px solid #388E3C',
};
const onBtnOver = (e) => {
  e.currentTarget.style.backgroundColor = '#e8f5e8';
};
const onBtnOut = (e) => {
  e.currentTarget.style.backgroundColor = 'white';
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

const ViewerToolbar = ({
  showControls,
  currentChapter = 1,
  onPrev,
  onNext,
  onAddBookmark,
  onToggleBookmarkList,
  onOpenSettings,
  onToggleGraph,
  showGraph,
  pageMode,
  isFromLibrary = false,
  previousPage = null,
  onExitToMypage,
}) => {
  const navigate = useNavigate();
  const { filename: bookId } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const viewModeText = useMemo(() => {
    if (pageMode === 'single') {
      return showGraph ? '단일 뷰어&그래프 모드' : '단일 뷰어모드';
    }
    return '분할 뷰어모드';
  }, [pageMode, showGraph]);

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

    const currentPathname = location.pathname || `/user/viewer/${bookId}`;
    const previousLocation = previousPage || {
      pathname: currentPathname,
      search: '',
    };

    navigate(`/user/graph/${bookId}`, {
      state: {
        book: bookData,
        selectedChapter: Number(currentChapter) || 1,
        fromLibrary: isFromLibrary,
        from: previousLocation,
      },
      replace: false,
    });
  }, [book, bookId, currentChapter, isFromLibrary, location.pathname, navigate, previousPage]);

  const toggleMobileMenu = useCallback(() => {
    setShowMobileMenu((v) => !v);
  }, []);

  const graphToggleStyleMobile = useMemo(
    () => ({
      ...TOOLBAR_BTN,
      border: showGraph ? '2px solid #388E3C' : TOOLBAR_BTN.border,
      boxShadow: showGraph ? '0 4px 12px rgba(56, 142, 60, 0.2)' : '0 2px 4px rgba(56, 142, 60, 0.1)',
      transform: showGraph ? 'scale(1.05)' : 'scale(1)',
    }),
    [showGraph]
  );

  const graphToggleStyleDesktop = useMemo(
    () => ({
      ...TOOLBAR_BTN,
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
      boxShadow: showGraph ? '0 2px 8px rgba(56, 142, 60, 0.15)' : '0 1px 3px rgba(56, 142, 60, 0.1)',
      transition: 'all 0.2s ease',
    }),
    [showGraph]
  );

  return (
    <div
      className={`w-full z-20 relative transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
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
            <button type="button" onClick={onPrev} className="p-2 rounded-lg transition-colors" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="이전 페이지">
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <button type="button" onClick={onNext} className="p-2 rounded-lg transition-colors" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="다음 페이지">
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
          <div className="flex-1 text-center">
            <span className="text-xs text-gray-600 font-medium">{viewModeText}</span>
          </div>
          <button type="button" onClick={toggleMobileMenu} className="p-2 rounded-lg transition-colors" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="메뉴">
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>
      ) : (
        <div className="viewer-toolbar-group-wrap" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '2rem' }}>
              <button type="button" onClick={onPrev} className="xhtml-toolbar-btn" aria-label="이전 페이지" title="이전 페이지로 이동" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
                <span style={flexLabel}>
                  <span className="material-symbols-outlined" style={iconMb}>arrow_back</span>
                  이전
                </span>
              </button>
              <button type="button" onClick={onNext} className="xhtml-toolbar-btn" aria-label="다음 페이지" title="다음 페이지로 이동" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
                <span style={flexLabel}>
                  다음
                  <span className="material-symbols-outlined" style={iconMb}>arrow_forward</span>
                </span>
              </button>
            </div>
            <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem' }}>
              <button type="button" onClick={onAddBookmark} className="xhtml-toolbar-btn" aria-label="북마크" title="현재 위치에 북마크 추가" style={{ ...TOOLBAR_BTN, width: '7rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
                <span style={flexLabelCenter}>
                  <span className="material-symbols-outlined" style={iconMb}>bookmark_add</span>
                  북마크
                </span>
              </button>
              <button type="button" onClick={onToggleBookmarkList} className="xhtml-toolbar-btn" aria-label="북마크 목록" title="북마크 목록 보기/숨기기" style={{ ...TOOLBAR_BTN, width: '9rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
                <span style={flexLabelCenter}>
                  <span className="material-symbols-outlined" style={iconMb}>bookmarks</span>
                  북마크 목록
                </span>
              </button>
            </div>
            <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1rem', marginRight: '1rem' }}>
              <button type="button" className="xhtml-toolbar-btn" onClick={handleGraphClick} aria-label="인물 관계도" title="인물 관계도 페이지로 이동" style={{ ...TOOLBAR_BTN, width: '9rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
                <span style={flexLabelCenter}>
                  <span className="material-symbols-outlined" style={iconMb}>account_tree</span>
                  인물 관계도
                </span>
              </button>
              <button
                type="button"
                className="xhtml-toolbar-btn"
                onClick={onToggleGraph}
                aria-label="그래프 토글"
                title={showGraph ? '그래프 숨기기' : '그래프 표시'}
                style={graphToggleStyleDesktop}
                onMouseOver={onBtnOver}
                onMouseOut={onBtnOut}
              >
                <span style={flexLabelCenter}>
                  {showGraph ? (
                    <span className="material-symbols-outlined" style={{ ...iconMb, fontWeight: 'bold' }}>view_column</span>
                  ) : (
                    <span className="material-symbols-outlined" style={iconMb}>open_in_full</span>
                  )}
                  <span style={{ fontWeight: '600' }}>화면 모드</span>
                </span>
              </button>
              <div className="current-view-mode" title={viewModeText} style={viewModeBadgeStyle}>
                {pageMode === 'single' ? (
                  <span className="material-symbols-outlined" style={{ ...iconMb, fontWeight: 'bold' }}>view_column</span>
                ) : (
                  <span className="material-symbols-outlined" style={{ ...iconMb, fontWeight: 'bold' }}>view_column_2</span>
                )}
                <span style={{ fontWeight: '600' }}>{viewModeText}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-group-right" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginRight: '0.5rem' }}>
              <button type="button" className="xhtml-toolbar-btn" aria-label="설정" title="뷰어 설정 열기" onClick={onOpenSettings} style={{ ...TOOLBAR_BTN, width: '5.5rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4em', flexDirection: 'row' }}>
                  <span className="material-symbols-outlined" style={{ marginBottom: '-2px', fontSize: '18px' }}>settings</span>
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>설정</span>
                </span>
              </button>
              <button
                type="button"
                onClick={onExitToMypage}
                className="xhtml-toolbar-btn"
                aria-label="닫기"
                title="마이페이지로 돌아가기"
                style={{
                  ...TOOLBAR_BTN,
                  width: 40,
                  minWidth: 40,
                  padding: 0,
                  justifyContent: 'center',
                }}
                onMouseOver={onBtnOver}
                onMouseOut={onBtnOut}
              >
                <span className="material-symbols-outlined" style={iconMb}>close</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showMobileMenu && (
        <div className="absolute top-full left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50 animate-slide-up">
          <div className="p-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={onAddBookmark} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="현재 위치에 북마크 추가">
              <span className="material-symbols-outlined">bookmark_add</span>
              <span className="text-sm font-semibold">북마크</span>
            </button>
            <button type="button" onClick={onToggleBookmarkList} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="북마크 목록 보기">
              <span className="material-symbols-outlined">bookmarks</span>
              <span className="text-sm font-semibold">북마크 목록</span>
            </button>
            <button type="button" onClick={handleGraphClick} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="인물 관계도 페이지로 이동">
              <span className="material-symbols-outlined">account_tree</span>
              <span className="text-sm font-medium">인물 관계도</span>
            </button>
            <button
              type="button"
              onClick={onToggleGraph}
              className={`${mobileMenuClass} transition-all duration-200`}
              title={showGraph ? '그래프 숨기기' : '그래프 표시'}
              style={graphToggleStyleMobile}
              onMouseOver={onBtnOver}
              onMouseOut={onBtnOut}
            >
              {showGraph ? (
                <span className="material-symbols-outlined" style={{ fontWeight: 'bold' }}>view_column</span>
              ) : (
                <span className="material-symbols-outlined">open_in_full</span>
              )}
              <span className="text-sm font-semibold">화면 모드</span>
            </button>
            <button type="button" onClick={onOpenSettings} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="뷰어 설정 열기">
              <span className="material-symbols-outlined">settings</span>
              <span className="text-sm font-medium">설정</span>
            </button>
            <button type="button" onClick={onExitToMypage} className="flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors" title="마이페이지로 돌아가기">
              <span className="material-symbols-outlined">close</span>
              <span className="text-sm font-medium">닫기</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewerToolbar;

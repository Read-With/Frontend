import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import './ViewerToolbar.css';

const TOOLBAR_BTN = {
  backgroundColor: 'white',
  color: '#1B5E20',
  border: '1px solid #388E3C',
};
const onBtnOver = (e) => { e.currentTarget.style.backgroundColor = '#e8f5e8'; };
const onBtnOut = (e) => { e.currentTarget.style.backgroundColor = 'white'; };

const ViewerToolbar = ({
  showControls,
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

  const getViewModeText = () =>
    pageMode === 'single'
      ? (showGraph ? '단일 뷰어&그래프 모드' : '단일 뷰어모드')
      : '분할 뷰어모드';

  const handleGraphClick = () => {
    const bookData = book || {
      title: String(bookId || '').replace(/\.(xhtml|html|htm)$/i, '').replace(/([A-Z])/g, ' $1').trim(),
      author: '알 수 없음',
      path: `/${bookId}`,
      filename: bookId
    };

    const currentSearch =
      typeof window !== 'undefined' && window.location?.search ? window.location.search : '';
    const currentPathname =
      typeof window !== 'undefined' && window.location?.pathname ? window.location.pathname : `/user/viewer/${bookId}`;
    const previousLocation =
      previousPage ||
      {
        pathname: currentPathname,
        search: currentSearch
      };

    navigate(`/user/graph/${bookId}`, {
      state: {
        book: bookData,
        fromLibrary: isFromLibrary,
        from: previousLocation,
        viewerSearch: currentSearch
      },
      replace: false
    });
  };

  const mobileMenuClass = 'flex items-center justify-center gap-2 p-3 rounded-lg transition-colors';
  const MobileMenu = () =>
    showMobileMenu && (
      <div className="absolute top-full left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50 animate-slide-up">
        <div className="p-4 grid grid-cols-2 gap-3">
          <button onClick={onAddBookmark} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="현재 위치에 북마크 추가">
            <span className="material-symbols-outlined">bookmark_add</span>
            <span className="text-sm font-semibold">북마크</span>
          </button>
          <button onClick={onToggleBookmarkList} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="북마크 목록 보기">
            <span className="material-symbols-outlined">bookmarks</span>
            <span className="text-sm font-semibold">북마크 목록</span>
          </button>
          <button onClick={handleGraphClick} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="인물 관계도 페이지로 이동">
            <span className="material-symbols-outlined">account_tree</span>
            <span className="text-sm font-medium">인물 관계도</span>
          </button>
          <button
            onClick={onToggleGraph}
            className={`${mobileMenuClass} transition-all duration-200`}
            title={showGraph ? '그래프 숨기기' : '그래프 표시'}
            style={{ ...TOOLBAR_BTN, border: showGraph ? '2px solid #388E3C' : TOOLBAR_BTN.border, boxShadow: showGraph ? '0 4px 12px rgba(56, 142, 60, 0.2)' : '0 2px 4px rgba(56, 142, 60, 0.1)', transform: showGraph ? 'scale(1.05)' : 'scale(1)' }}
            onMouseOver={onBtnOver}
            onMouseOut={onBtnOut}
          >
            {showGraph ? <span className="material-symbols-outlined" style={{ fontWeight: 'bold' }}>view_column</span> : <span className="material-symbols-outlined">open_in_full</span>}
            <span className="text-sm font-semibold">화면 모드</span>
          </button>
          <button onClick={onOpenSettings} className={mobileMenuClass} style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="뷰어 설정 열기">
            <span className="material-symbols-outlined">settings</span>
            <span className="text-sm font-medium">설정</span>
          </button>
          <Link to="/mypage" replace className="flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors" title="마이페이지로 돌아가기">
            <span className="material-symbols-outlined">close</span>
            <span className="text-sm font-medium">닫기</span>
          </Link>
        </div>
      </div>
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
            <button onClick={onPrev} className="p-2 rounded-lg transition-colors" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="이전 페이지">
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <button onClick={onNext} className="p-2 rounded-lg transition-colors" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="다음 페이지">
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
          <div className="flex-1 text-center">
            <span className="text-xs text-gray-600 font-medium">{getViewModeText()}</span>
          </div>
          <button onClick={() => setShowMobileMenu(!showMobileMenu)} className="p-2 rounded-lg transition-colors" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut} title="메뉴">
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>
      ) : (
        <div className="viewer-toolbar-group-wrap" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '2rem' }}>
            <button onClick={onPrev} className="xhtml-toolbar-btn" aria-label="이전 페이지" title="이전 페이지로 이동" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45em' }}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>arrow_back</span>
                이전
              </span>
            </button>
            <button onClick={onNext} className="xhtml-toolbar-btn" aria-label="다음 페이지" title="다음 페이지로 이동" style={TOOLBAR_BTN} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45em' }}>
                다음
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>arrow_forward</span>
              </span>
            </button>
          </div>
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem' }}>
            <button onClick={onAddBookmark} className="xhtml-toolbar-btn" aria-label="북마크" title="현재 위치에 북마크 추가" style={{ ...TOOLBAR_BTN, width: '7rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45em', width: '100%' }}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>bookmark_add</span>
                북마크
              </span>
            </button>
            <button onClick={onToggleBookmarkList} className="xhtml-toolbar-btn" aria-label="북마크 목록" title="북마크 목록 보기/숨기기" style={{ ...TOOLBAR_BTN, width: '9rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45em', width: '100%' }}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>bookmarks</span>
                북마크 목록
              </span>
            </button>
          </div>
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1rem', marginRight: '1rem' }}>
            <button className="xhtml-toolbar-btn" onClick={handleGraphClick} aria-label="인물 관계도" title="인물 관계도 페이지로 이동" style={{ ...TOOLBAR_BTN, width: '9rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45em', width: '100%' }}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>account_tree</span>
                인물 관계도
              </span>
            </button>
            <button
              className="xhtml-toolbar-btn"
              onClick={onToggleGraph}
              aria-label="그래프 토글"
              title={showGraph ? '그래프 숨기기' : '그래프 표시'}
              style={{ ...TOOLBAR_BTN, width: '9rem', marginRight: '0.5rem', border: showGraph ? '2px solid #388E3C' : TOOLBAR_BTN.border }}
              onMouseOver={onBtnOver}
              onMouseOut={onBtnOut}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45em', width: '100%' }}>
                {showGraph ? <span className="material-symbols-outlined" style={{ marginBottom: '-2px', fontWeight: 'bold' }}>view_column</span> : <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>open_in_full</span>}
                <span style={{ fontWeight: '600' }}>화면 모드</span>
              </span>
            </button>
            <div
               className="current-view-mode"
               title={getViewModeText()}
               style={{
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
               }}
             >
               {pageMode === 'single' ?
                 <span className="material-symbols-outlined" style={{ marginBottom: '-2px', fontWeight: 'bold' }}>view_column</span> :
                 <span className="material-symbols-outlined" style={{ marginBottom: '-2px', fontWeight: 'bold' }}>view_column_2</span>
               }
               <span style={{ fontWeight: '600' }}>
                 {getViewModeText()}
               </span>
             </div>
          </div>
        </div>

        <div className="toolbar-group-right" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ marginRight: '5rem', gap: '1rem' }}>
            <button className="xhtml-toolbar-btn" aria-label="설정" title="뷰어 설정 열기" onClick={onOpenSettings} style={{ ...TOOLBAR_BTN, width: '5.5rem', marginRight: '0.25rem' }} onMouseOver={onBtnOver} onMouseOut={onBtnOut}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4em', flexDirection: 'row' }}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px', fontSize: '18px' }}>settings</span>
                <span style={{ fontSize: '13px', fontWeight: '700' }}>설정</span>
              </span>
            </button>
          </div>
          <div>
            <Link to="/mypage" replace className="xhtml-toolbar-btn xhtml-close-btn" aria-label="닫기" title="마이페이지로 돌아가기" style={{ width: '2rem', marginRight: '2rem', marginTop: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45em' }}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>close</span>
              </span>
            </Link>
          </div>
        </div>
        </div>
      )}

      <MobileMenu />
    </div>
  );
};

export default ViewerToolbar;

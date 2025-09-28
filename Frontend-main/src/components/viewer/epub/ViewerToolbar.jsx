import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import './ViewerToolbar.css';

const ViewerToolbar = ({ 
  showControls, 
  onPrev, 
  onNext, 
  onAddBookmark, 
  onToggleBookmarkList, 
  onOpenSettings, 
  onToggleGraph,
  showGraph,
  pageMode 
}) => {
  const navigate = useNavigate();
  const { filename } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  
  // 반응형 상태 관리
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // 화면 크기 감지
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 현재 보기 모드 텍스트 생성 (ViewerSettings와 일치)
  const getViewModeText = () => {
    if (pageMode === 'single') {
      return showGraph ? '단일 뷰어&그래프 모드' : '단일 뷰어모드';
    } else {
      return '분할 뷰어모드'; // "분할 뷰어&그래프 모드" 제거 (ViewerSettings와 일치)
    }
  };

  // 그래프 토글 버튼 텍스트 (고정)
  const getGraphToggleText = () => {
    return '화면 모드';
  };

  const handleGraphClick = () => {
    // book 정보가 있으면 함께 전달, 없으면 filename만 사용하여 RelationGraphWrapper로 이동
    const bookData = book || {
      title: filename.replace('.epub', '').replace(/([A-Z])/g, ' $1').trim(),
      author: '알 수 없음',
      path: `/${filename}`,
      filename: filename
    };
    
    // RelationGraphWrapper 컴포넌트로 이동
    navigate(`/user/graph/${filename}`, { state: { book: bookData } });
  };

  // 모바일 메뉴 컴포넌트
  const MobileMenu = () => (
    showMobileMenu && (
      <div className="absolute top-full left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50 animate-slide-up">
        <div className="p-4 grid grid-cols-2 gap-3">
          {/* 북마크 그룹 */}
          <button 
            onClick={onAddBookmark} 
            className="flex items-center justify-center gap-2 p-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors"
            title="현재 위치에 북마크 추가"
          >
            <span className="material-symbols-outlined">bookmark_add</span>
            <span className="text-sm font-medium">북마크</span>
          </button>
          <button 
            onClick={onToggleBookmarkList} 
            className="flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
            title="북마크 목록 보기"
          >
            <span className="material-symbols-outlined">bookmarks</span>
            <span className="text-sm font-medium">북마크 목록</span>
          </button>
          
          {/* 그래프 관련 */}
          <button 
            onClick={handleGraphClick} 
            className="flex items-center justify-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
            title="인물 관계도 페이지로 이동"
          >
            <span className="material-symbols-outlined">account_tree</span>
            <span className="text-sm font-medium">인물 관계도</span>
          </button>
          <button 
            onClick={onToggleGraph} 
            className={`flex items-center justify-center gap-2 p-3 rounded-lg transition-all duration-200 ${
              showGraph 
                ? 'bg-blue-100 text-blue-800 border-2 border-blue-300 shadow-md' 
                : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
            }`}
            title={showGraph ? "그래프 숨기기" : "그래프 표시"}
            style={{
              transform: showGraph ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            {showGraph ? 
              <span className="material-symbols-outlined" style={{ fontWeight: 'bold' }}>view_column</span> : 
              <span className="material-symbols-outlined">open_in_full</span>
            }
            <span className={`text-sm font-medium ${showGraph ? 'font-semibold' : ''}`}>화면 모드</span>
          </button>
          
          {/* 설정 */}
          <button 
            onClick={onOpenSettings} 
            className="flex items-center justify-center gap-2 p-3 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            title="뷰어 설정 열기"
          >
            <span className="material-symbols-outlined">settings</span>
            <span className="text-sm font-medium">설정</span>
          </button>
          <button 
            onClick={() => navigate('/mypage')} 
            className="flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
            title="뷰어 닫기"
          >
            <span className="material-symbols-outlined">close</span>
            <span className="text-sm font-medium">닫기</span>
          </button>
        </div>
      </div>
    )
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
        // 모바일 레이아웃
        <div className="flex items-center justify-between">
          {/* 왼쪽: 네비게이션 버튼들 */}
          <div className="flex items-center gap-2">
            <button 
              onClick={onPrev} 
              className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors"
              title="이전 페이지"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <button 
              onClick={onNext} 
              className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors"
              title="다음 페이지"
            >
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
          
          {/* 중앙: 현재 모드 표시 */}
          <div className="flex-1 text-center">
            <span className="text-xs text-gray-600 font-medium">{getViewModeText()}</span>
          </div>
          
          {/* 오른쪽: 메뉴 토글 */}
          <button 
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
            title="메뉴"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>
      ) : (
        // 데스크톱 레이아웃 (기존 유지)
        <div className="viewer-toolbar-group-wrap" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* 이동 그룹 */}
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem' }}>
            <button
              onClick={onPrev}
              className="epub-toolbar-btn epub-toolbar-btn--gray"
              aria-label="이전 페이지"
              title="이전 페이지로 이동"
            >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>arrow_back</span>
                이전
              </span>
            </button>
            <button
              onClick={onNext}
              className="epub-toolbar-btn epub-toolbar-btn--gray"
              aria-label="다음 페이지"
              title="다음 페이지로 이동"
            >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                다음
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>arrow_forward</span>
              </span>
            </button>
          </div>
          {/* 북마크 그룹 */}
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem' }}>
                         <button
               onClick={onAddBookmark}
               className="epub-toolbar-btn epub-toolbar-btn--purple"
               aria-label="북마크"
               title="현재 위치에 북마크 추가"
               style={{
                 width: '7rem',
                 marginRight: '0.5rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>bookmark_add</span>
                북마크
              </span>
            </button>
                         <button
               onClick={onToggleBookmarkList}
               className="epub-toolbar-btn epub-toolbar-btn--gray"
               aria-label="북마크 목록"
               title="북마크 목록 보기/숨기기"
               style={{
                 width: '8rem',
                 marginRight: '0.5rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>bookmarks</span>
                북마크 목록
              </span>
            </button>
          </div>
          {/* 그래프 관련 그룹 */}
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem' }}>
                         <button
               className="epub-toolbar-btn epub-toolbar-btn--blue"
               onClick={handleGraphClick}
               aria-label="인물 관계도"
               title="인물 관계도 페이지로 이동"
               style={{
                 width: '9rem',
                 marginRight: '0.5rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>account_tree</span>
                인물 관계도
              </span>
            </button>
                         <button
               className={`epub-toolbar-btn ${showGraph ? 'epub-toolbar-btn--blue' : 'epub-toolbar-btn--gray'}`}
               onClick={onToggleGraph}
               aria-label="그래프 토글"
               title={showGraph ? "그래프 숨기기" : "그래프 표시"}
               style={{
                 width: '9rem',
                 marginRight: '0.5rem',
                 border: showGraph ? '2px solid #4F6DDE' : '1px solid #e2e8f0',
                 boxShadow: showGraph ? '0 4px 12px rgba(79, 109, 222, 0.2)' : '0 2px 4px rgba(0, 0, 0, 0.1)',
                 transform: showGraph ? 'scale(1.02)' : 'scale(1)',
                 transition: 'all 0.2s ease',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                {showGraph ? 
                  <span className="material-symbols-outlined" style={{ marginBottom: '-2px', color: '#4F6DDE', fontWeight: 'bold' }}>view_column</span> : 
                  <span className="material-symbols-outlined" style={{ marginBottom: '-2px', color: '#6b7280' }}>open_in_full</span>
                }
                <span style={{ color: showGraph ? '#4F6DDE' : '#6b7280', fontWeight: showGraph ? '600' : '500' }}>
                  {getGraphToggleText()}
                </span>
              </span>
            </button>
            <div 
              className="current-view-mode" 
              title={getViewModeText()}
              style={{ 
                padding: '0.5rem 1rem',
                marginLeft: '0.5rem',
                borderRadius: '1rem',
                backgroundColor: showGraph ? '#EEF2FF' : '#f0f4ff',
                color: showGraph ? '#4F6DDE' : '#4F6DDE',
                fontWeight: '600',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5em',
                border: showGraph ? '2px solid #4F6DDE' : '1px solid #e3e6ef',
                boxShadow: showGraph ? '0 2px 8px rgba(79, 109, 222, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.1)',
                transition: 'all 0.2s ease',
              }}
            >
              {pageMode === 'single' ? 
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px', color: showGraph ? '#4F6DDE' : '#4F6DDE', fontWeight: 'bold' }}>view_column</span> : 
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px', color: showGraph ? '#4F6DDE' : '#4F6DDE', fontWeight: 'bold' }}>view_column_2</span>
              }
              <span style={{ color: showGraph ? '#4F6DDE' : '#4F6DDE', fontWeight: '600' }}>
                {getViewModeText()}
              </span>
            </div>
          </div>
        </div>

        {/* 오른쪽 버튼 그룹 (설정 및 닫기) */}
        <div className="toolbar-group-right" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ marginRight: '5rem' }}>
                         <button
               className="epub-toolbar-btn epub-toolbar-btn--gray"
               aria-label="설정"
               title="뷰어 설정 열기"
               onClick={onOpenSettings}
               style={{
                 width: '5.5rem',
                 marginRight: '0.25rem',
               }}
             >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4em',
                flexDirection: 'row'
              }}>
                <span className="material-symbols-outlined" style={{ 
                  marginBottom: '-2px',
                  fontSize: '18px'
                }}>settings</span>
                <span style={{ fontSize: '13px', fontWeight: '500' }}>설정</span>
              </span>
            </button>
          </div>
          <div>
                         <button
               onClick={() => navigate('/mypage')}
               className="epub-toolbar-btn epub-close-btn"
               aria-label="닫기"
               title="뷰어 닫기"
               style={{
                 width: '2rem',
                 marginRight: '2rem',
                 marginTop: '3px',
               }}
             >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                <span className="material-symbols-outlined" style={{ marginBottom: '-2px' }}>close</span>
              </span>
            </button>
          </div>
        </div>
        </div>
      )}
      
      {/* 모바일 메뉴 */}
      <MobileMenu />
    </div>
  );
};

export default ViewerToolbar;

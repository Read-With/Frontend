import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { FaArrowLeft, FaArrowRight, FaStar, FaBookOpen, FaTimes, FaSitemap, FaCog, FaChartBar, FaColumns, FaExpand, FaBars, FaEllipsisV } from 'react-icons/fa';
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

  // 현재 보기 모드 텍스트 생성
  const getViewModeText = () => {
    if (pageMode === 'single') {
      return showGraph ? '단일 페이지 + 그래프' : '단일 페이지 (전체)';
    } else {
      return showGraph ? '분할 페이지 + 그래프' : '분할 페이지 (전체)';
    }
  };

  // 그래프 토글 버튼 텍스트 생성
  const getGraphToggleText = () => {
    return showGraph ? '그래프 숨기기' : '그래프 표시';
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
          <button onClick={onAddBookmark} className="flex items-center justify-center gap-2 p-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors">
            <FaStar />
            <span className="text-sm font-medium">북마크 추가</span>
          </button>
          <button onClick={onToggleBookmarkList} className="flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
            <FaBookOpen />
            <span className="text-sm font-medium">북마크 목록</span>
          </button>
          
          {/* 그래프 관련 */}
          <button onClick={handleGraphClick} className="flex items-center justify-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors">
            <FaSitemap />
            <span className="text-sm font-medium">관계도</span>
          </button>
          <button onClick={onToggleGraph} className="flex items-center justify-center gap-2 p-3 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors">
            {showGraph ? <FaColumns /> : <FaExpand />}
            <span className="text-sm font-medium">{getGraphToggleText()}</span>
          </button>
          
          {/* 설정 */}
          <button onClick={onOpenSettings} className="flex items-center justify-center gap-2 p-3 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <FaCog />
            <span className="text-sm font-medium">설정</span>
          </button>
          <button onClick={() => navigate('/mypage')} className="flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors">
            <FaTimes />
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
            <button onClick={onPrev} className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors">
              <FaArrowLeft />
            </button>
            <button onClick={onNext} className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors">
              <FaArrowRight />
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
          >
            <FaBars />
          </button>
        </div>
      ) : (
        // 데스크톱 레이아웃 (기존 유지)
        <div className="viewer-toolbar-group-wrap" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* 이동 그룹 */}
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginRight: '1.1rem' }}>
            <button
              onClick={onPrev}
              className="epub-toolbar-btn epub-toolbar-btn--gray"
              aria-label="이전 페이지"
            >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                <FaArrowLeft style={{ marginBottom: '-2px' }} />
                이전
              </span>
            </button>
            <button
              onClick={onNext}
              className="epub-toolbar-btn epub-toolbar-btn--gray"
              aria-label="다음 페이지"
            >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                다음
                <FaArrowRight style={{ marginBottom: '-2px' }} />
              </span>
            </button>
          </div>
          {/* 북마크 그룹 */}
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginRight: '1.1rem' }}>
                         <button
               onClick={onAddBookmark}
               className="epub-toolbar-btn epub-toolbar-btn--purple"
               aria-label="북마크 추가"
               style={{
                 width: 130,
                 marginRight: '0.35rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                <FaStar style={{ marginBottom: '-2px' }} />
                북마크 추가
              </span>
            </button>
                         <button
               onClick={onToggleBookmarkList}
               className="epub-toolbar-btn epub-toolbar-btn--gray"
               aria-label="북마크 목록"
               style={{
                 width: 130,
                 marginRight: '0.35rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                <FaBookOpen style={{ marginBottom: '-2px' }} />
                북마크 목록
              </span>
            </button>
          </div>
          {/* 그래프 관련 그룹 */}
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem' }}>
                         <button
               className="epub-toolbar-btn epub-toolbar-btn--blue"
               onClick={handleGraphClick}
               aria-label="관계도"
               style={{
                 width: 110,
                 marginRight: '0.35rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                <FaSitemap style={{ marginBottom: '-2px' }} />
                관계도
              </span>
            </button>
                         <button
               className={`epub-toolbar-btn ${showGraph ? 'epub-toolbar-btn--blue' : 'epub-toolbar-btn--gray'}`}
               onClick={onToggleGraph}
               aria-label="그래프 토글"
               style={{
                 width: 150,
                 marginRight: '0.35rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.45em',width:'100%'}}>
                {showGraph ? <FaColumns style={{ marginBottom: '-2px' }} /> : <FaExpand style={{ marginBottom: '-2px' }} />}
                {getGraphToggleText()}
              </span>
            </button>
            <div className="current-view-mode" style={{ 
              padding: '0.42rem 1.15rem',
              marginLeft: '0.5rem',
              borderRadius: '1rem',
              backgroundColor: '#f0f4ff',
              color: '#4F6DDE',
              fontWeight: '600',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5em'
            }}>
              {pageMode === 'single' ? <FaColumns style={{ marginBottom: '-2px' }} /> : <FaColumns style={{ marginBottom: '-2px' }} />}
              {getViewModeText()}
            </div>
          </div>
        </div>

        {/* 오른쪽 버튼 그룹 (설정 및 닫기) */}
        <div className="toolbar-group-right" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ marginRight: '75px' }}>
                         <button
               className="epub-toolbar-btn epub-toolbar-btn--gray"
               aria-label="설정"
               onClick={onOpenSettings}
               style={{
                 width: 76,
                 marginRight: '0.25rem',
               }}
             >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                <FaCog style={{ marginBottom: '-2px' }} />
                설정
              </span>
            </button>
          </div>
          <div>
                         <button
               onClick={() => navigate('/mypage')}
               className="epub-toolbar-btn epub-close-btn"
               aria-label="닫기"
               style={{
                 width: 32,
               }}
             >
              <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
                <FaTimes style={{ marginBottom: '-2px' }} />
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

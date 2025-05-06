import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaArrowLeft, FaArrowRight, FaStar, FaBookOpen, FaTimes, FaSitemap } from 'react-icons/fa';

const buttonStyle = {
  base: {
    fontSize: '1rem',
    fontWeight: 600,
    padding: '0.42rem 1.15rem',
    borderRadius: '12px',
    border: '1.2px solid #e7eaf7',
    marginRight: '0.35rem',
    background: '#f8fafc',
    color: '#22336b',
    boxShadow: '0 2px 8px rgba(79,109,222,0.07)',
    cursor: 'pointer',
    transition: 'background 0.28s cubic-bezier(.4,2,.6,1), color 0.18s, box-shadow 0.18s, border 0.18s, transform 0.13s',
    outline: 'none',
    minWidth: 60,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
  },
  blue: {
    background: 'linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 60%, #bfc8e6 100%)',
    color: '#fff',
    border: '1.2px solid #4F6DDE',
    boxShadow: '0 4px 16px rgba(79,109,222,0.13)',
  },
  purple: {
    background: 'linear-gradient(100deg, #a259e6 0%, #7f6fff 60%, #6fa7ff 100%)',
    color: '#fff',
    border: '1.2px solid #a259e6',
    boxShadow: '0 4px 16px rgba(162,89,230,0.13)',
  },
  gray: {
    background: '#f8fafc',
    color: '#22336b',
    border: '1.2px solid #e7eaf7',
    boxShadow: '0 2px 8px rgba(79,109,222,0.07)',
  },
  red: {
    background: 'linear-gradient(100deg, #f87171 0%, #fca5a5 60%, #ffeaea 100%)',
    color: '#c82333',
    border: '1.2px solid #f87171',
    boxShadow: '0 4px 16px rgba(248,113,113,0.13)',
  },
};

const ViewerToolbar = ({ showControls, onPrev, onNext, onAddBookmark, onToggleBookmarkList }) => {
  const navigate = useNavigate();
  const { filename } = useParams();

  return (
    <div
      className={`w-full z-20 p-2 flex items-center shadow-md transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
      style={{
        backgroundColor: 'white',
        backdropFilter: 'blur(4px)',
        height: 'auto',
        borderBottom: '1.5px solid #e7eaf7',
        padding: '0.4rem 0.7rem',
      }}
    >
      <div className="viewer-toolbar-group-wrap" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'flex-start' }}>
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
          >
            <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
              <FaStar style={{ marginBottom: '-2px' }} />
              북마크 추가
            </span>
          </button>
          <button
            onClick={onToggleBookmarkList}
            className="epub-toolbar-btn epub-toolbar-btn--gray"
            aria-label="북마크 목록"
          >
            <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
              <FaBookOpen style={{ marginBottom: '-2px' }} />
              북마크 목록
            </span>
          </button>
        </div>
        {/* 기타 그룹 */}
        <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem' }}>
          <button
            className="epub-toolbar-btn epub-toolbar-btn--blue"
            onClick={() => navigate(`/viewer/${filename}/relations`)}
            aria-label="관계도"
          >
            <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
              <FaSitemap style={{ marginBottom: '-2px' }} />
              관계도
            </span>
          </button>
          <button
            onClick={() => navigate('/library')}
            className="epub-toolbar-btn epub-close-btn"
            aria-label="닫기"
          >
            <span style={{display:'flex',alignItems:'center',gap:'0.45em'}}>
              <FaTimes style={{ marginBottom: '-2px' }} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewerToolbar;

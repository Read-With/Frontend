import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const ViewerToolbar = (
  { showControls, onPrev, onNext, onAddBookmark, onToggleBookmarkList }) => {
  const navigate = useNavigate();
  const { filename } = useParams(); // ← 현재 보고 있는 파일명

  return (
    <div
      className={`w-full z-20 p-3 flex justify-between items-center shadow-md
        transition-opacity duration-300
        ${showControls ? 'opacity-100' : 'opacity-0'}`}
      style={{
        backgroundColor: 'white',
        backdropFilter: 'blur(4px)',
        height: '48px',
      }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          className="text-sm px-3 py-1 bg-gray-600 text-white rounded"
        >
          이전
        </button>
        <button
          onClick={onNext}
          className="text-sm px-3 py-1 bg-gray-600 text-white rounded"
        >
          다음
        </button>
        <button
          onClick={() => navigate('/library')}
          className="text-sm px-3 py-1 bg-red-500 text-white rounded"
        >
          닫기
        </button>
        <button onClick={onAddBookmark}>북마크 추가</button>
        <button onClick={onToggleBookmarkList}>📑 북마크 목록</button>
        {/* 🚩 "관계도" 버튼 추가 */}
        <button
          className="text-sm px-3 py-1 bg-blue-500 text-white rounded"
          onClick={() => navigate(`/viewer/${filename}/relations`)}
        >
          관계도
        </button>
      </div>
    </div>
  );
};

export default ViewerToolbar;

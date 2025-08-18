import React from 'react';
import { FaBookmark, FaTrash, FaClock, FaMapMarkerAlt } from 'react-icons/fa';

const BookmarkPanel = ({ bookmarks, onSelect, onDelete }) => {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;
    
    return date.toLocaleDateString('ko-KR', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="absolute right-0 top-16 bg-white shadow-xl border border-gray-200 rounded-xl z-50 w-80 max-h-96 overflow-hidden">
      {/* 헤더 */}
      <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center space-x-2">
          <FaBookmark className="text-blue-600" />
          <h3 className="font-bold text-gray-800 text-lg">북마크</h3>
          <span className="bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full font-medium">
            {bookmarks.length}
          </span>
        </div>
      </div>

      {/* 북마크 목록 */}
      <div className="max-h-80 overflow-y-auto">
        {bookmarks.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <FaBookmark className="mx-auto mb-3 text-3xl text-gray-300" />
            <p className="text-sm">저장된 북마크가 없습니다</p>
            <p className="text-xs text-gray-400 mt-1">중요한 부분을 북마크해보세요</p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {bookmarks.map((bookmark, index) => (
              <li
                key={index}
                className="group relative"
              >
                <button
                  onClick={() => onSelect(bookmark.cfi)}
                  className="w-full text-left p-3 rounded-lg transition-all duration-200 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <FaMapMarkerAlt className="text-blue-500 text-xs mt-0.5 flex-shrink-0" />
                        <p className="text-sm font-medium text-gray-800 truncate">
                          북마크 #{index + 1}
                        </p>
                      </div>
                      
                      {bookmark.preview && (
                        <p className="text-xs text-gray-600 line-clamp-2 ml-4 mb-2">
                          "{bookmark.preview}"
                        </p>
                      )}
                      
                      <div className="flex items-center space-x-2 ml-4">
                        <FaClock className="text-gray-400 text-xs" />
                        <span className="text-xs text-gray-500">
                          {formatDate(bookmark.createdAt)}
                        </span>
                      </div>
                    </div>
                    
                    {onDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(index);
                        }}
                        className="opacity-0 group-hover:opacity-100 ml-2 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all duration-200 flex-shrink-0"
                        title="북마크 삭제"
                      >
                        <FaTrash className="text-xs" />
                      </button>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BookmarkPanel;